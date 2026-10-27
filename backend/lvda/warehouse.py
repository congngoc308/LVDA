"""Quản lý lớp mart: nạp lại view, kiểm khóa (DATA-05), phát hiện chỉ số cần chứng nhận lại (MET-06),
kiểm lại truy vấn mẫu (REV-05)."""

from __future__ import annotations

import hashlib
import json

import psycopg
import sqlglot

from lvda import config, db
from lvda.catalog import get_catalog, refresh_catalog
from lvda.verifier import metric_analysis, verify
from lvda.verifier.fingerprint import analyze


def fingerprint_hash(metric: dict) -> str | None:
    """Hash phần lineage quyết định ý nghĩa chỉ số: cột đo (tới raw), bộ lọc, join, cột thời gian."""
    cat = get_catalog()
    try:
        an = analyze(sqlglot.parse_one(metric["canonical_sql"], read="postgres"), cat)
    except Exception:
        return None
    if not an.ok:
        return None
    measure_cols = sorted(an.measure_columns())
    payload = {
        "measures": sorted((m["agg"], m["distinct"], tuple(m["columns"])) for m in an.measures),
        "raw": cat.to_raw(measure_cols),
        "filters": sorted((f["column"], f["op"], json.dumps(f["value"], sort_keys=True, default=str)) for f in an.filters),
        "joins": sorted(tuple(sorted((j["left"], j["right"]))) for j in an.joins),
        "time": metric.get("time_column"),
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:16]


def stamp_metric_hashes() -> int:
    from lvda.metrics import list_metrics

    n = 0
    for d in db.fetch_all("SELECT id FROM app.databases"):
        for m in list_metrics(d["id"]):
            if m["status"] == "certified":
                row = db.fetch_one("SELECT fingerprint_hash FROM app.metrics WHERE database_id = %s AND id = %s", (d["id"], m["id"]))
                if row and not row["fingerprint_hash"]:
                    db.execute("UPDATE app.metrics SET fingerprint_hash = %s WHERE database_id = %s AND id = %s",
                               (fingerprint_hash(m), d["id"], m["id"]))
                    n += 1
    return n


def key_checks() -> list[dict]:
    """DATA-05: khóa khai báo trong schema.yml có thực sự duy nhất không."""
    cat = get_catalog()
    out = []
    with psycopg.connect(config.READER_DSN) as conn:
        for table, keys in cat.meta.get("grains", {}).items():
            if not cat.has_table(table):
                continue
            cols = ", ".join(keys)
            row = conn.execute(f"SELECT count(*), count(DISTINCT ({cols})) FROM {table}").fetchone()
            out.append({"table": table, "keys": keys, "rows": row[0], "distinct": row[1], "unique": row[0] == row[1]})
    return out


def _recreate_views() -> int:
    files = config.mart_files()
    with psycopg.connect(config.OWNER_DSN, autocommit=True) as conn:
        conn.execute("DROP SCHEMA IF EXISTS mart CASCADE; CREATE SCHEMA mart;")
        for path in files:
            conn.execute(f"CREATE VIEW mart.{path.stem} AS\n{path.read_text(encoding='utf-8')}")
        conn.execute("GRANT USAGE ON SCHEMA mart TO lvda_reader; GRANT SELECT ON ALL TABLES IN SCHEMA mart TO lvda_reader;")
    return len(files)


def reload_mart(database_id: int) -> dict:
    """Tạo lại view mart từ file .sql rồi kiểm hệ quả lên chỉ số và truy vấn mẫu."""
    from lvda.metrics import list_metrics

    views = _recreate_views()
    cat = refresh_catalog()
    stale, disabled = [], []
    for m in list_metrics(database_id):
        row = db.fetch_one("SELECT status, fingerprint_hash FROM app.metrics WHERE database_id = %s AND id = %s",
                           (database_id, m["id"]))
        if row["status"] != "certified":
            continue
        new_hash = fingerprint_hash(m)
        reason = None
        if new_hash is None:
            reason = "SQL chuẩn không còn phân tích được trên lớp mart mới."
        elif row["fingerprint_hash"] and new_hash != row["fingerprint_hash"]:
            reason = "Lineage của chỉ số đã đổi sau khi nạp lại mart (cột nguồn, bộ lọc hoặc join khác bản đã chứng nhận)."
        if reason:
            db.execute("UPDATE app.metrics SET status = 'stale', stale_reason = %s, updated_at = now() WHERE database_id = %s AND id = %s",
                       (reason, database_id, m["id"]))
            stale.append({"id": m["id"], "name_vi": m["name_vi"], "reason": reason})

    metrics = {m["id"]: m for m in list_metrics(database_id)}
    for q in db.fetch_all("SELECT id, question, sql, metric_id FROM app.verified_queries WHERE database_id = %s AND active", (database_id,)):
        v = verify(q["sql"], cat, metrics.get(q["metric_id"]) if q["metric_id"] else None)
        if v["verdict"] != "green":
            reason = f"Không còn Xanh sau khi nạp lại mart (phán quyết: {v['verdict']})."
            db.execute("UPDATE app.verified_queries SET active = false, inactive_reason = %s WHERE id = %s", (reason, q["id"]))
            disabled.append({"id": q["id"], "question": q["question"], "verdict": v["verdict"]})
    keys = key_checks()
    return {"views": views, "stale_metrics": stale, "disabled_queries": disabled,
            "key_checks": keys, "keys_ok": all(k["unique"] for k in keys)}


def descriptions(database_id: int) -> dict[str, dict]:
    rows = db.fetch_all(
        """SELECT d.column_name, d.description, d.status, d.source, d.updated_at, u.name AS updated_by_name
           FROM app.column_descriptions d LEFT JOIN app.users u ON u.id = d.updated_by WHERE d.database_id = %s""",
        (database_id,))
    return {r["column_name"]: r for r in rows}


def metric_usage(database_id: int) -> dict[str, list[dict]]:
    """Cột mart nào được chỉ số nào dùng (để thấy tác động khi sửa cột)."""
    from lvda.metrics import list_metrics

    cat = get_catalog()
    usage: dict[str, list[dict]] = {}
    for m in list_metrics(database_id):
        an = metric_analysis(m, cat)
        if not an.ok:
            continue
        cols = set(an.measure_columns()) | {f["column"] for f in an.filters} | {m.get("time_column")}
        for c in cols:
            if c:
                usage.setdefault(c, []).append({"id": m["id"], "name_vi": m["name_vi"], "status": m["status"],
                                                "role": "đo" if c in an.measure_columns() else "lọc/thời gian"})
    return usage
