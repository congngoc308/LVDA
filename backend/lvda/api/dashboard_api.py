"""Dashboard trang Đánh giá: đọc/lưu bố cục, hiển thị một card, agent sinh card (NDJSON từng bước)."""

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from lvda import dashboard
from lvda.catalog import is_catalog_only
from lvda.security import Member, audit, engineer, request_id

router = APIRouter(prefix="/api/db/{db_id}/dashboards", tags=["dashboards"])

CATALOG_ONLY = "Database này chỉ để duyệt danh mục, chưa có chỉ số chuẩn nên không dựng được card."


def _need_metrics(db_id: int) -> None:
    if is_catalog_only(db_id):
        raise HTTPException(409, CATALOG_ONLY)


@router.get("/eval")
def get_board(db_id: int, m: Member = Depends(engineer)):
    return dashboard.load(db_id)


@router.put("/eval")
def put_board(db_id: int, body: dashboard.Board, request: Request, m: Member = Depends(engineer)):
    try:
        out = dashboard.save(db_id, m.user.id, body)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    audit(db_id, m.user.id, "dashboard.save", dashboard.KEY,
          {"cards": len(body.cards), "tray": len(body.tray)}, request_id(request))
    return out


@router.get("/options")
def options(db_id: int, m: Member = Depends(engineer)):
    return dashboard.options(db_id)


@router.post("/render")
def render(db_id: int, card: dashboard.CardSpec, m: Member = Depends(engineer)):
    _need_metrics(db_id)
    return dashboard.render(db_id, card)


@router.post("/draft")
def draft(db_id: int, answers: dashboard.Answers, request: Request, m: Member = Depends(engineer)):
    _need_metrics(db_id)
    rid = request_id(request)
    audit(db_id, m.user.id, "dashboard.draft", dashboard.KEY, answers.model_dump(), rid)
    return StreamingResponse(dashboard.draft_stream(db_id, answers, rid), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
