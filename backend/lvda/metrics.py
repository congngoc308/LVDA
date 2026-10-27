"""Kho chỉ số: đọc, sửa (tạo version mới), chứng nhận."""

from __future__ import annotations

import yaml

from lvda import db
from lvda.catalog import get_catalog
from lvda.verifier import metric_analysis, verify

REQUIRED_FIELDS = ["id", "name_vi", "canonical_sql", "time_column", "format"]
FORMATS = {"currency", "percent", "integer", "days", "score", "number"}


def list_metrics(database_id: int) -> list[dict]:
    rows = db.fetch_all(
        """SELECT m.id, m.name_vi, m.status, m.owner, m.current_version, m.certified_at, m.updated_at, m.stale_reason,
                  u.name AS certified_by_name, v.spec
           FROM app.metrics m
           JOIN app.metric_versions v ON v.database_id = m.database_id AND v.metric_id = m.id AND v.version = m.current_version
           LEFT JOIN app.users u ON u.id = m.certified_by
           WHERE m.database_id = %s ORDER BY m.status = 'certified' DESC, m.id""",
        (database_id,),
    )
    return [_with_spec(r) for r in rows]


def get_metric(database_id: int, metric_id: str) -> dict | None:
    for m in list_metrics(database_id):
        if m["id"] == metric_id:
            return m
    return None


def _with_spec(row: dict) -> dict:
    spec = dict(row.pop("spec"))
    spec.update({k: row[k] for k in ("status", "current_version")})
    spec["version"] = row["current_version"]
    spec["meta"] = {k: row.get(k) for k in ("owner", "certified_at", "certified_by_name", "updated_at", "stale_reason")}
    return spec


def metric_detail(database_id: int, metric_id: str) -> dict | None:
    m = get_metric(database_id, metric_id)
    if not m:
        return None
    cat = get_catalog()
    an = metric_analysis(m, cat)
    versions = db.fetch_all(
        """SELECT v.version, v.created_at, u.name AS created_by, v.yaml FROM app.metric_versions v
           LEFT JOIN app.users u ON u.id = v.created_by
           WHERE v.database_id = %s AND v.metric_id = %s ORDER BY v.version DESC""",
        (database_id, metric_id),
    )
    return {**m, "fingerprint": an.to_dict(cat) if an.ok else None, "versions": versions}


def validate_yaml(text: str, database_id: int) -> tuple[dict | None, list[str]]:
    errors: list[str] = []
    try:
        spec = yaml.safe_load(text)
    except yaml.YAMLError as e:
        return None, [f"YAML không hợp lệ: {e}"]
    if not isinstance(spec, dict):
        return None, ["Nội dung phải là một đối tượng YAML (key: value)."]
    for f in REQUIRED_FIELDS:
        if not spec.get(f):
            errors.append(f"Thiếu trường bắt buộc “{f}”.")
    if spec.get("format") and spec["format"] not in FORMATS:
        errors.append(f"format phải là một trong: {', '.join(sorted(FORMATS))}.")
    for i, rf in enumerate(spec.get("required_filters") or []):
        if not isinstance(rf, dict) or not {"column", "op", "value"} <= set(rf):
            errors.append(f"required_filters[{i}] cần đủ column, op, value.")
    if errors:
        return None, errors
    spec.setdefault("synonyms", [])
    spec.setdefault("assumptions", [])
    spec.setdefault("required_filters", [])
    spec["status"] = "certified"  # để tự kiểm SQL chuẩn như một chỉ số đã chứng nhận
    res = verify(spec["canonical_sql"], get_catalog(), spec)
    bad = [f for f in res["findings"] if f["severity"] in ("high", "medium")]
    if res["verdict"] == "blocked":
        errors.append(f"SQL chuẩn bị chặn: {res['blocked_reason']}")
    for f in bad:
        errors.append(f"SQL chuẩn không qua kiểm định: [{f['rule']}] {f['message_vi']}")
    spec["status"] = "draft"
    return (None, errors) if errors else (spec, [])


def save_version(database_id: int, spec: dict, text: str, user_id: int) -> dict:
    existing = db.fetch_one("SELECT current_version FROM app.metrics WHERE database_id = %s AND id = %s",
                            (database_id, spec["id"]))
    version = (existing["current_version"] + 1) if existing else 1
    with db.app_conn() as conn:
        conn.execute(
            "INSERT INTO app.metric_versions (database_id, metric_id, version, spec, yaml, created_by) VALUES (%s,%s,%s,%s,%s,%s)",
            (database_id, spec["id"], version, db.jsonb(spec), text, user_id))
        if existing:
            conn.execute(
                """UPDATE app.metrics SET name_vi = %s, status = 'draft', current_version = %s, certified_by = NULL,
                   certified_at = NULL, updated_at = now() WHERE database_id = %s AND id = %s""",
                (spec["name_vi"], version, database_id, spec["id"]))
        else:
            conn.execute(
                "INSERT INTO app.metrics (database_id, id, name_vi, status, owner, current_version) VALUES (%s,%s,%s,'draft',%s,%s)",
                (database_id, spec["id"], spec["name_vi"], spec.get("owner"), version))
        conn.commit()
    return {"id": spec["id"], "version": version, "status": "draft"}


def certify(database_id: int, metric_id: str, user_id: int) -> None:
    from lvda.warehouse import fingerprint_hash

    m = get_metric(database_id, metric_id)
    db.execute(
        "UPDATE app.metrics SET status = 'certified', certified_by = %s, certified_at = now(), updated_at = now(), "
        "fingerprint_hash = %s, stale_reason = NULL WHERE database_id = %s AND id = %s",
        (user_id, fingerprint_hash(m) if m else None, database_id, metric_id))


def deprecate(database_id: int, metric_id: str) -> None:
    db.execute("UPDATE app.metrics SET status = 'deprecated', updated_at = now() WHERE database_id = %s AND id = %s",
               (database_id, metric_id))

# ---------------------------------------------------------------- xuất / nhập (MET-01, MET-07)
EXPORT_FIELDS = ["id", "name_vi", "description", "unit", "format", "synonyms", "owner", "status", "grain", "entity_key",
                 "time_column", "canonical_sql", "required_filters", "assumptions"]


def export_yaml(database_id: int) -> str:
    specs = [{k: m[k] for k in EXPORT_FIELDS if k in m} for m in list_metrics(database_id)]
    return yaml.safe_dump(specs, allow_unicode=True, sort_keys=False)


def metricflow_to_specs(doc: dict) -> list[dict]:
    """MET-07: chuyển semantic_models + metrics (type: simple) của dbt MetricFlow sang định nghĩa LVDA."""
    import re

    models = {sm["name"]: sm for sm in doc.get("semantic_models", [])}
    measures = {}
    for sm in models.values():
        ref = re.search(r"ref\(['\"]([^'\"]+)['\"]\)", sm.get("model", ""))
        table = f"mart.{ref.group(1)}" if ref else f"mart.{sm['name']}"
        for ms in sm.get("measures", []):
            measures[ms["name"]] = {**ms, "table": table, "model": sm}
    specs = []
    for mt in doc.get("metrics", []):
        if mt.get("type", "simple") != "simple":
            continue
        ms = measures.get((mt.get("type_params") or {}).get("measure", ""))
        if not ms:
            continue
        agg = {"sum": "SUM", "average": "AVG", "count": "COUNT", "count_distinct": "COUNT", "max": "MAX", "min": "MIN"}[ms["agg"]]
        expr = ms.get("expr") or ms["name"]
        body = f"DISTINCT t.{expr}" if ms["agg"] == "count_distinct" else f"t.{expr}"
        sql = f"SELECT {agg}({body}) AS {mt['name']}\nFROM {ms['table']} AS t"
        required = []
        filt = mt.get("filter")
        if filt:
            m = re.search(r"Dimension\('(?:\w+__)?(\w+)'\)\s*\}\}\s*=\s*'([^']+)'", filt)
            if m:
                sql += f"\nWHERE t.{m.group(1)} = '{m.group(2)}'"
                required.append({"column": f"{ms['table']}.{m.group(1)}", "op": "=", "value": m.group(2)})
        time_dim = (ms["model"].get("defaults") or {}).get("agg_time_dimension")
        specs.append({"id": mt["name"], "name_vi": mt.get("label") or mt["name"], "description": mt.get("description", ""),
                      "unit": "", "format": "number", "synonyms": [mt.get("label", "")] if mt.get("label") else [],
                      "grain": ms["model"]["name"], "time_column": f"{ms['table']}.{time_dim}" if time_dim else "",
                      "canonical_sql": sql, "required_filters": required, "assumptions": ["Nhập từ dbt MetricFlow"]})
    return specs


def import_yaml(database_id: int, text: str, user_id: int) -> list[dict]:
    """Nhập một hoặc nhiều định nghĩa (định dạng LVDA hoặc MetricFlow). Mỗi chỉ số hợp lệ tạo một phiên bản nháp."""
    try:
        doc = yaml.safe_load(text)
    except yaml.YAMLError as e:
        return [{"id": None, "ok": False, "errors": [f"YAML không hợp lệ: {e}"]}]
    if isinstance(doc, dict) and ("semantic_models" in doc or "metrics" in doc):
        specs = metricflow_to_specs(doc)
    elif isinstance(doc, list):
        specs = doc
    else:
        specs = [doc]
    out = []
    for s in specs:
        one = yaml.safe_dump(s, allow_unicode=True, sort_keys=False)
        spec, errors = validate_yaml(one, database_id)
        if errors:
            out.append({"id": (s or {}).get("id"), "ok": False, "errors": errors})
            continue
        res = save_version(database_id, spec, one, user_id)
        out.append({"id": spec["id"], "ok": True, "version": res["version"], "errors": []})
    return out


def run_certified(database_id: int, metric_id: str, start: str | None = None, end: str | None = None,
                  dimension: str | None = None, top: int | None = None) -> dict:
    """MCP-04: chạy SQL chuẩn của một chỉ số đã chứng nhận với tham số đã kiểm (không nhận SQL tự do)."""
    import re

    from lvda.agent import mock_llm
    from lvda.agent.nlu import DIMENSIONS

    m = get_metric(database_id, metric_id)
    if not m or m["status"] != "certified":
        raise ValueError(f"Chỉ số {metric_id} không tồn tại hoặc chưa được chứng nhận.")
    for d in (start, end):
        if d is not None and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
            raise ValueError("Ngày phải có dạng YYYY-MM-DD.")
    if dimension is not None and dimension not in DIMENSIONS:
        raise ValueError(f"Chiều chia phải là một trong: {', '.join(DIMENSIONS)}.")
    if dimension and not mock_llm.supports(m, dimension):
        raise ValueError(f"Chưa hỗ trợ chia {metric_id} theo {dimension}.")
    interp: dict = {"dimension": dimension, "top": {"n": max(1, min(int(top), 100)), "order": "desc"} if top else None}
    if start or end:
        interp["time"] = {"start": start or "2016-01-01", "end": end or "2019-01-01", "label": f"{start} → {end}"}
    sql = mock_llm.reference_sql(m, interp)
    return {"metric_id": metric_id, "sql": sql, **db.run_readonly(sql, max_rows=200)}
