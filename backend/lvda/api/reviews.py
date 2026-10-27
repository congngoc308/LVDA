from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from lvda import db
from lvda.agent.nlu import normalize_question
from lvda.catalog import get_catalog
from lvda.metrics import get_metric
from lvda.runs import get_run
from lvda.security import Member, audit, engineer, request_id
from lvda.verifier import verify

router = APIRouter(prefix="/api/db/{db_id}/reviews", tags=["reviews"])


class DecisionBody(BaseModel):
    decision: Literal["approve", "edit_approve", "reject"]
    edited_sql: str | None = Field(None, max_length=20000)
    reason: str | None = Field(None, max_length=1000)


@router.get("")
def queue(db_id: int, status: str = "pending", m: Member = Depends(engineer)):
    return db.fetch_all(
        """SELECT r.id, r.question, r.final_verdict, r.status, r.metric_id, r.review_status, r.created_at, r.feedback,
                  u.name AS user_name, r.answer->>'headline' AS headline
           FROM app.qa_runs r LEFT JOIN app.users u ON u.id = r.user_id
           WHERE r.database_id = %s AND r.review_status = %s ORDER BY r.created_at DESC LIMIT 100""",
        (db_id, status))


@router.post("/{run_id}")
def decide(db_id: int, run_id: str, body: DecisionBody, request: Request, m: Member = Depends(engineer)):
    run = get_run(db_id, run_id)
    if not run:
        raise HTTPException(404, "Không tìm thấy câu hỏi này.")
    if body.decision == "reject" and not (body.reason or "").strip():
        raise HTTPException(422, "Hãy ghi lý do từ chối.")
    sql = run["final_sql"]
    if body.decision == "edit_approve":
        if not (body.edited_sql or "").strip():
            raise HTTPException(422, "Hãy nhập câu SQL đã sửa.")
        sql = body.edited_sql.strip()
    if body.decision in ("approve", "edit_approve"):
        metric = get_metric(db_id, run["metric_id"]) if run["metric_id"] else None
        v = verify(sql, get_catalog(), metric)
        if v["verdict"] in ("blocked", "red"):
            raise HTTPException(422, {"message": "Câu SQL chưa qua kiểm định nên chưa thể duyệt.", "verification": v})
        db.execute(
            "INSERT INTO app.verified_queries (database_id, question, question_norm, sql, metric_id, approved_by) VALUES (%s,%s,%s,%s,%s,%s)",
            (db_id, run["question"], normalize_question(run["question"]), sql, run["metric_id"], m.user.id))
    new_status = "rejected" if body.decision == "reject" else "approved"
    with db.app_conn() as conn:
        conn.execute("UPDATE app.qa_runs SET review_status = %s WHERE id = %s", (new_status, run_id))
        conn.execute("INSERT INTO app.qa_reviews (run_id, reviewer_id, decision, edited_sql, reason) VALUES (%s,%s,%s,%s,%s)",
                     (run_id, m.user.id, body.decision, body.edited_sql, body.reason))
        conn.commit()
    audit(db_id, m.user.id, f"review.{body.decision}", run_id, {"question": run["question"]}, request_id(request))
    return get_run(db_id, run_id)
