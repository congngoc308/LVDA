"""Trang Dữ liệu (UI-06): catalog, lineage mart → raw, mô tả cột (DATA-04), kiểm khóa (DATA-05),
nạp lại mart (MET-06, REV-05). Và cấu hình luật / LLM (VER-08, US-12)."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from lvda import db, explorer, settings, warehouse
from lvda.catalog import get_catalog, is_catalog_only, rebuild_catalog
from lvda.security import Member, audit, direct_engineer, engineer, member, request_id

router = APIRouter(prefix="/api/db/{db_id}", tags=["data"])


class DescriptionBody(BaseModel):
    column: str = Field(..., max_length=200)
    description: str = Field(..., min_length=1, max_length=1000)


class ApproveBody(BaseModel):
    table: str = Field(..., max_length=200)


class RuleSetting(BaseModel):
    rule: str
    enabled: bool = True
    severity: Literal["high", "medium", "low"] | None = None


class RulesBody(BaseModel):
    rules: list[RuleSetting]


@router.get("/catalog")
def catalog(db_id: int, m: Member = Depends(member)):
    cat = get_catalog()
    desc = warehouse.descriptions(db_id)
    usage = warehouse.metric_usage(db_id)
    tables = []
    for full, cols in cat.columns.items():
        td = desc.get(full)
        raw_tables = sorted({r.rsplit(".", 1)[0] for c in cols for r in cat.mart_lineage.get(f"{full}.{c}", [])})
        tables.append({
            "name": full, "schema": full.split(".")[0], "deprecated": full in cat.deprecated,
            "grain": cat.meta.get("grains", {}).get(full, []), "description": td,
            "sources": raw_tables, "sql": cat.view_sql.get(full),
            "columns": [{"name": c, "type": t, "pii": f"{full}.{c}" in cat.pii,
                         "raw": cat.mart_lineage.get(f"{full}.{c}", []), "description": desc.get(f"{full}.{c}"),
                         "metrics": usage.get(f"{full}.{c}", [])} for c, t in cols.items()],
        })
    tables.sort(key=lambda t: (t["schema"] != "mart", t["deprecated"], t["name"]))
    return {"tables": tables, "relationships": [r for r in cat.relationships if r["child"].startswith("mart.")]}


@router.get("/keys")
def keys(db_id: int, m: Member = Depends(member)):
    return warehouse.key_checks()


@router.put("/descriptions")
def edit_description(db_id: int, body: DescriptionBody, request: Request, m: Member = Depends(engineer)):
    db.execute(
        """INSERT INTO app.column_descriptions (database_id, column_name, description, status, source, updated_by)
           VALUES (%s,%s,%s,'approved','human',%s)
           ON CONFLICT (database_id, column_name) DO UPDATE SET description = EXCLUDED.description, status = 'approved',
             source = 'human', updated_by = EXCLUDED.updated_by, updated_at = now()""",
        (db_id, body.column, body.description.strip(), m.user.id))
    explorer.invalidate(db_id)
    audit(db_id, m.user.id, "description.edit", body.column, {}, request_id(request))
    return {"ok": True}


@router.post("/descriptions/approve")
def approve_descriptions(db_id: int, body: ApproveBody, request: Request, m: Member = Depends(engineer)):
    rows = db.fetch_all(
        """UPDATE app.column_descriptions SET status = 'approved', updated_by = %s, updated_at = now()
           WHERE database_id = %s AND status = 'draft' AND (column_name = %s OR column_name LIKE %s) RETURNING column_name""",
        (m.user.id, db_id, body.table, body.table + ".%"))
    explorer.invalidate(db_id)
    audit(db_id, m.user.id, "description.approve", body.table, {"count": len(rows)}, request_id(request))
    return {"approved": len(rows)}


@router.post("/mart/reload")
def reload_mart(db_id: int, request: Request, m: Member = Depends(engineer)):
    if is_catalog_only(db_id):
        # database chỉ duyệt danh mục: không có chỉ số để kiểm lại, chỉ crawl lại warehouse
        cat = rebuild_catalog(db_id)
        res = {"views": len(cat.view_sql), "stale_metrics": [], "disabled_queries": [], "key_checks": [], "keys_ok": True}
    else:
        res = warehouse.reload_mart(db_id)
    explorer.invalidate(db_id)
    audit(db_id, m.user.id, "mart.reload", "mart",
          {"stale": [s["id"] for s in res["stale_metrics"]], "disabled_queries": len(res["disabled_queries"]),
           "keys_ok": res["keys_ok"]}, request_id(request))
    return res


@router.get("/settings")
def get_settings(db_id: int, m: Member = Depends(engineer)):
    return settings.describe(db_id)


@router.put("/settings/rules")
def save_rules(db_id: int, body: RulesBody, request: Request, m: Member = Depends(direct_engineer)):
    before = settings.get_settings(db_id).get("rules") or {}
    after = settings.save_rules(db_id, [r.model_dump() for r in body.rules])["rules"]
    if before != after:
        audit(db_id, m.user.id, "settings.rules", "rules", {"from": before, "to": after}, request_id(request))
    return settings.describe(db_id)


class ModelBody(BaseModel):
    model: str = Field(..., max_length=100)


@router.put("/settings/llm")
def save_model(db_id: int, body: ModelBody, request: Request, m: Member = Depends(direct_engineer)):
    before = settings.get_settings(db_id).get("llm_model")
    try:
        settings.save_model(db_id, body.model)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    audit(db_id, m.user.id, "settings.llm", "llm_model", {"from": before, "to": body.model}, request_id(request))
    return settings.describe(db_id)


@router.get("/trace/{req_id}")
def trace_by_request(db_id: int, req_id: str, m: Member = Depends(engineer)):
    """OBS-01: mở trace của một câu hỏi bất kỳ theo request_id."""
    from lvda.runs import get_run

    row = db.fetch_one("SELECT id FROM app.qa_runs WHERE database_id = %s AND request_id = %s", (db_id, req_id.strip()))
    if not row:
        raise HTTPException(404, "Không có câu hỏi nào với request_id này.")
    return get_run(db_id, row["id"], m.role)


@router.get("/verified-queries")
def verified_queries(db_id: int, m: Member = Depends(engineer)):
    return db.fetch_all(
        """SELECT q.id, q.question, q.sql, q.metric_id, q.active, q.inactive_reason, q.created_at, u.name AS approved_by_name
           FROM app.verified_queries q LEFT JOIN app.users u ON u.id = q.approved_by
           WHERE q.database_id = %s ORDER BY q.id DESC""", (db_id,))


