"""Đọc lịch sử hỏi đáp từ DB, kèm lineage (mart → raw) để giao diện vẽ đồ thị bằng chứng."""

from __future__ import annotations

from lvda import db
from lvda.catalog import get_catalog
from lvda.metrics import get_metric

METRIC_FIELDS = ("id", "name_vi", "description", "status", "version", "format", "unit", "time_column", "canonical_sql",
                 "required_filters")
MASK = "•••"


def _lineage(verification: dict | None) -> dict | None:
    fp = (verification or {}).get("fingerprint")
    if not fp:
        return None
    cat = get_catalog()
    column_raw = fp.get("column_raw") or {}

    def raw(c: str) -> list[str]:
        return column_raw.get(c) or cat.to_raw([c])

    return {
        "measures": [{"column": c, "raw": raw(c)} for c in fp["measure_columns"]],
        "measure_sql": [m["sql"] for m in fp["measures"]],
        "filters": [{**f, "raw": raw(f["column"])} for f in fp["filters"]],
        "joins": fp["joins"],
        "group_by": [{**g, "raw": sorted({r for c in g["columns"] for r in raw(c)})} for g in fp["group_by"]],
        "tables": fp["tables"],
        "time_columns": fp["time_columns"],
    }


def _pii_outputs(verification: dict | None) -> set[str]:
    """Tên cột đầu ra trả giá trị PII ở mức dòng (không tổng hợp)."""
    fp = (verification or {}).get("fingerprint") or {}
    pii = get_catalog().pii
    return {o["name"] for o in fp.get("outputs", []) if not o["aggregated"] and set(o["columns"]) & pii}


def mask_result(result: dict | None, verification: dict | None) -> tuple[dict | None, list[str]]:
    """SEC-05: che giá trị cột nhạy cảm cho viewer."""
    if not result:
        return result, []
    hidden = _pii_outputs(verification)
    idx = [i for i, c in enumerate(result["columns"]) if c in hidden]
    if not idx:
        return result, []
    rows = [[MASK if i in idx else v for i, v in enumerate(r)] for r in result["rows"]]
    return {**result, "rows": rows, "masked": [result["columns"][i] for i in idx]}, [result["columns"][i] for i in idx]


def get_run(database_id: int, run_id: str, role: str = "engineer") -> dict | None:
    row = db.fetch_one(
        """SELECT r.*, u.name AS user_name FROM app.qa_runs r LEFT JOIN app.users u ON u.id = r.user_id
           WHERE r.id = %s AND r.database_id = %s""", (run_id, database_id))
    if not row:
        return None
    attempts = db.fetch_all("SELECT * FROM app.qa_attempts WHERE run_id = %s ORDER BY attempt_no", (run_id,))
    reviews = db.fetch_all(
        """SELECT q.decision, q.reason, q.edited_sql, q.decided_at, u.name AS reviewer FROM app.qa_reviews q
           LEFT JOIN app.users u ON u.id = q.reviewer_id WHERE q.run_id = %s ORDER BY q.id""", (run_id,))
    metric = get_metric(database_id, row["metric_id"]) if row["metric_id"] else None
    final_ver = attempts[-1]["verification"] if attempts else None
    result = row["result"]
    masked: list[str] = []
    if role != "engineer":
        result, masked = mask_result(result, final_ver)
    return {
        "id": row["id"], "question": row["question"], "input_kind": row["input_kind"], "intent": row["intent"],
        "interpretation": row["interpretation"], "status": row["status"], "final_verdict": row["final_verdict"],
        "final_sql": row["final_sql"], "answer": row["answer"], "result": result, "masked_columns": masked,
        "usage": row["usage"], "review_status": row["review_status"], "feedback": row["feedback"],
        "created_at": row["created_at"], "user_name": row["user_name"], "request_id": row.get("request_id"),
        "metric": {k: metric.get(k) for k in METRIC_FIELDS} if metric else None,
        "attempts": [{
            "no": a["attempt_no"], "sql": a["sql"], "source": a["source"], "verdict": a["verdict"],
            "verification": a["verification"], "notes": (a["notes"] or {}).get("notes", []),
            "fix_notes": (a["notes"] or {}).get("fix_notes", []), "latency_ms": float(a["latency_ms"] or 0),
            "lineage": _lineage(a["verification"]),
        } for a in attempts],
        "lineage": _lineage(final_ver),
        "reviews": reviews,
    }


def list_runs(database_id: int, user_id: int | None = None, limit: int = 30) -> list[dict]:
    where, params = "database_id = %s", [database_id]
    if user_id:
        where += " AND user_id = %s"
        params.append(user_id)
    params.append(limit)
    return db.fetch_all(
        f"""SELECT id, question, input_kind, status, final_verdict, metric_id, review_status, created_at,
                   answer->>'headline' AS headline
            FROM app.qa_runs WHERE {where} ORDER BY created_at DESC LIMIT %s""", params)
