from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from lvda import explorer, metrics
from lvda.security import Member, audit, engineer, member, request_id

router = APIRouter(prefix="/api/db/{db_id}/metrics", tags=["metrics"])


class YamlBody(BaseModel):
    yaml: str = Field(..., min_length=1, max_length=50000)


@router.get("")
def list_all(db_id: int, m: Member = Depends(member)):
    return metrics.list_metrics(db_id)


@router.get("/export", response_class=PlainTextResponse)
def export(db_id: int, m: Member = Depends(member)):
    return PlainTextResponse(metrics.export_yaml(db_id), media_type="application/x-yaml; charset=utf-8",
                             headers={"Content-Disposition": 'attachment; filename="metrics.yml"'})


@router.post("/import")
def import_(db_id: int, body: YamlBody, request: Request, m: Member = Depends(engineer)):
    results = metrics.import_yaml(db_id, body.yaml, m.user.id)
    ok = [r["id"] for r in results if r["ok"]]
    if ok:
        explorer.invalidate(db_id)
        audit(db_id, m.user.id, "metric.import", ",".join(ok), {"count": len(ok)}, request_id(request))
    return {"results": results}


@router.get("/{metric_id}")
def detail(db_id: int, metric_id: str, m: Member = Depends(member)):
    d = metrics.metric_detail(db_id, metric_id)
    if not d:
        raise HTTPException(404, "Không tìm thấy chỉ số.")
    return d


@router.post("/validate")
def validate(db_id: int, body: YamlBody, m: Member = Depends(engineer)):
    spec, errors = metrics.validate_yaml(body.yaml, db_id)
    return {"ok": not errors, "errors": errors, "spec": spec}


@router.put("")
def save(db_id: int, body: YamlBody, request: Request, m: Member = Depends(engineer)):
    spec, errors = metrics.validate_yaml(body.yaml, db_id)
    if errors:
        raise HTTPException(422, {"message": "Định nghĩa chưa hợp lệ.", "errors": errors})
    res = metrics.save_version(db_id, spec, body.yaml, m.user.id)
    explorer.invalidate(db_id)
    audit(db_id, m.user.id, "metric.save", spec["id"], {"version": res["version"]}, request_id(request))
    return metrics.metric_detail(db_id, spec["id"])


@router.post("/{metric_id}/certify")
def certify(db_id: int, metric_id: str, request: Request, m: Member = Depends(member)):
    if not m.can_certify:
        raise HTTPException(403, "Bạn chưa có quyền chứng nhận chỉ số.")
    d = metrics.get_metric(db_id, metric_id)
    if not d:
        raise HTTPException(404, "Không tìm thấy chỉ số.")
    metrics.certify(db_id, metric_id, m.user.id)
    explorer.invalidate(db_id)
    audit(db_id, m.user.id, "metric.certify", metric_id, {"version": d["version"]}, request_id(request))
    return metrics.metric_detail(db_id, metric_id)


@router.post("/{metric_id}/deprecate")
def deprecate(db_id: int, metric_id: str, request: Request, m: Member = Depends(member)):
    if not m.can_certify:
        raise HTTPException(403, "Bạn chưa có quyền đổi trạng thái chỉ số.")
    d = metrics.get_metric(db_id, metric_id)
    if not d:
        raise HTTPException(404, "Không tìm thấy chỉ số.")
    metrics.deprecate(db_id, metric_id)
    explorer.invalidate(db_id)
    audit(db_id, m.user.id, "metric.deprecate", metric_id, {"version": d["version"]}, request_id(request))
    return metrics.metric_detail(db_id, metric_id)
