"""Hỏi dữ liệu, kiểm SQL, lịch sử, thống kê vận hành."""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from lvda import db
from lvda.agent.nlu import interpret
from lvda.agent.pipeline import answer_question, context_from_run
from lvda.catalog import is_catalog_only
from lvda.metrics import list_metrics
from lvda.runs import get_run, list_runs
from lvda.security import Member, engineer, member, request_id

router = APIRouter(prefix="/api/db/{db_id}", tags=["workspace"])


class AskBody(BaseModel):
    question: str = Field(..., min_length=1, max_length=20000)
    simulate_mistakes: bool = True
    context_run_id: str | None = None
    metric_id: str | None = None


class InterpretBody(BaseModel):
    question: str = Field("", max_length=20000)
    context_run_id: str | None = None
    metric_id: str | None = None


class FeedbackBody(BaseModel):
    correct: bool
    note: str | None = Field(None, max_length=1000)


CATALOG_ONLY = "Database này chỉ để duyệt danh mục và lineage, chưa có chỉ số chuẩn nên agent chưa hỏi được. Hãy chọn database Olist."


@router.post("/ask")
def ask(db_id: int, body: AskBody, request: Request, m: Member = Depends(member)):
    if is_catalog_only(db_id):
        raise HTTPException(409, CATALOG_ONLY)
    run = answer_question(db_id, m.user.id, body.question.strip(), simulate_mistakes=body.simulate_mistakes,
                          context_run_id=body.context_run_id, metric_id=body.metric_id, request_id=request_id(request))
    return get_run(db_id, run["id"], m.role)


@router.post("/interpret")
def interpret_question(db_id: int, body: InterpretBody, m: Member = Depends(member)):
    if not body.question.strip() or is_catalog_only(db_id):
        return {"kind": "empty", "chips": []}
    return interpret(body.question, list_metrics(db_id), context_from_run(body.context_run_id, db_id), body.metric_id)


@router.get("/runs")
def runs(db_id: int, mine: bool = True, limit: int = 30, m: Member = Depends(member)):
    return list_runs(db_id, m.user.id if mine else None, min(limit, 100))


@router.get("/runs/{run_id}")
def run_detail(db_id: int, run_id: str, m: Member = Depends(member)):
    run = get_run(db_id, run_id, m.role)
    if not run:
        raise HTTPException(404, "Không tìm thấy câu hỏi này.")
    return run


@router.post("/runs/{run_id}/feedback")
def feedback(db_id: int, run_id: str, body: FeedbackBody, m: Member = Depends(member)):
    row = db.execute(
        """UPDATE app.qa_runs SET feedback = %s,
                  review_status = CASE WHEN %s THEN review_status ELSE 'pending' END
           WHERE id = %s AND database_id = %s RETURNING id""",
        (db.jsonb({"correct": body.correct, "note": body.note, "by": m.user.name}), body.correct, run_id, db_id))
    if not row:
        raise HTTPException(404, "Không tìm thấy câu hỏi này.")
    return get_run(db_id, run_id, m.role)


@router.get("/overview")
def overview(db_id: int, m: Member = Depends(member)):
    pending = db.fetch_one("SELECT count(*) AS n FROM app.qa_runs WHERE database_id = %s AND review_status = 'pending'", (db_id,))
    stale = db.fetch_one("SELECT count(*) AS n FROM app.metrics WHERE database_id = %s AND status = 'stale'", (db_id,))
    return {"pending_reviews": pending["n"] if m.is_engineer else None, "stale_metrics": stale["n"]}


@router.get("/stats")
def stats(db_id: int, days: int = 30, m: Member = Depends(engineer)):
    """OBS-03: số câu theo nhãn, tỉ lệ tự sửa thành công, độ trễ, phản hồi, theo ngày."""
    where = "database_id = %s AND created_at > now() - make_interval(days => %s)"
    p = (db_id, days)
    totals = db.fetch_one(f"""
        SELECT count(*) AS runs,
               count(*) FILTER (WHERE input_kind = 'question') AS questions,
               count(*) FILTER (WHERE input_kind = 'sql') AS sql_checks,
               count(*) FILTER (WHERE status = 'refused') AS refused,
               count(*) FILTER (WHERE status = 'held') AS held,
               count(*) FILTER (WHERE (feedback->>'correct')::boolean) AS feedback_up,
               count(*) FILTER (WHERE (feedback->>'correct')::boolean = false) AS feedback_down,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY (usage->>'latency_ms')::numeric) AS p50_ms,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY (usage->>'latency_ms')::numeric) AS p95_ms,
               coalesce(sum((usage->>'tokens')::int), 0) AS tokens,
               coalesce(sum((usage->>'cost_usd')::numeric), 0) AS cost_usd,
               count(*) FILTER (WHERE input_kind = 'question' AND status = 'answered') AS q_answered,
               count(*) FILTER (WHERE input_kind = 'question' AND status = 'answered' AND final_verdict = 'green') AS q_green,
               count(*) FILTER (WHERE input_kind = 'question' AND status = 'answered' AND final_verdict = 'yellow') AS q_yellow
        FROM app.qa_runs WHERE {where}""", p)
    verdicts = db.fetch_all(f"SELECT coalesce(final_verdict, 'none') AS verdict, count(*) AS n FROM app.qa_runs WHERE {where} GROUP BY 1", p)
    fix = db.fetch_one("""
        SELECT count(DISTINCT r.id) FILTER (WHERE a.attempt_no = 0 AND a.verdict = 'red') AS red_first,
               count(DISTINCT r.id) FILTER (WHERE a.attempt_no = 0 AND a.verdict = 'red' AND r.final_verdict IN ('green','yellow')) AS fixed
        FROM app.qa_runs r JOIN app.qa_attempts a ON a.run_id = r.id
        WHERE r.database_id = %s AND r.created_at > now() - make_interval(days => %s) AND r.input_kind = 'question'""", p)
    per_day = db.fetch_all(f"""
        SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*) AS runs,
               count(*) FILTER (WHERE final_verdict = 'green') AS green,
               count(*) FILTER (WHERE final_verdict = 'yellow') AS yellow,
               count(*) FILTER (WHERE final_verdict = 'red') AS red
        FROM app.qa_runs WHERE {where} GROUP BY 1 ORDER BY 1""", p)
    # Chỉ số nào được hỏi nhiều, và bao nhiêu câu trong đó thật sự Xanh hay bị báo sai
    by_metric = db.fetch_all("""
        SELECT r.metric_id AS id, max(m.name_vi) AS name_vi, count(*) AS questions,
               count(*) FILTER (WHERE r.status = 'answered' AND r.final_verdict = 'green') AS green,
               count(*) FILTER (WHERE r.status = 'held') AS held,
               count(*) FILTER (WHERE (r.feedback->>'correct')::boolean = false) AS flagged
        FROM app.qa_runs r LEFT JOIN app.metrics m ON m.database_id = r.database_id AND m.id = r.metric_id
        WHERE r.database_id = %s AND r.created_at > now() - make_interval(days => %s)
          AND r.input_kind = 'question' AND r.metric_id IS NOT NULL
        GROUP BY r.metric_id ORDER BY questions DESC LIMIT 8""", p)
    # Lỗi agent mắc ở lần viết SQL đầu tiên (trước khi tự sửa)
    top_rules = db.fetch_all("""
        SELECT f->>'rule' AS rule, max(f->>'title') AS title, count(DISTINCT r.id) AS runs
        FROM app.qa_runs r
        JOIN app.qa_attempts a ON a.run_id = r.id AND a.attempt_no = 0
        CROSS JOIN LATERAL jsonb_array_elements(coalesce(a.verification->'findings', '[]'::jsonb)) AS f
        WHERE r.database_id = %s AND r.created_at > now() - make_interval(days => %s)
          AND r.input_kind = 'question' AND f->>'severity' <> 'info'
        GROUP BY 1 ORDER BY runs DESC LIMIT 8""", p)
    return {"days": days, "totals": totals, "verdicts": verdicts, "fix": fix, "per_day": per_day,
            "by_metric": by_metric, "top_rules": top_rules}
