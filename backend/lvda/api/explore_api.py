"""Tab Dữ liệu ở quy mô lớn: trình duyệt chỉ nhận đúng phần đang xem (trang chủ, một trang kết quả tìm kiếm,
vùng lineage quanh vài bảng, chi tiết một bảng hoặc một cột)."""

from fastapi import APIRouter, Depends, HTTPException, Query

from lvda import explorer
from lvda.security import Member, member

router = APIRouter(prefix="/api/db/{db_id}/explore", tags=["explore"])


@router.get("/home")
def home(db_id: int, m: Member = Depends(member)):
    return explorer.home(db_id)


@router.get("/search")
def search(db_id: int, q: str = Query("", max_length=200), domain: str | None = None, layer: int | None = None,
           tag: list[str] = Query(default=[]), limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0),
           m: Member = Depends(member)):
    return explorer.search(db_id, q, domain, layer, tuple(tag), limit, offset)


@router.get("/lineage")
def lineage(db_id: int, centers: str = Query(..., max_length=4000), full: str = "", trace: str | None = Query(None, max_length=300),
            m: Member = Depends(member)):
    names = [c for c in centers.split(",") if c][:20]
    return explorer.lineage(db_id, names, {f for f in full.split(",") if f}, trace)


@router.get("/table/{name}")
def table(db_id: int, name: str, m: Member = Depends(member)):
    out = explorer.table_detail(db_id, name)
    if out is None:
        raise HTTPException(404, "Không có bảng này.")
    return out


@router.get("/column/{name}/{column}")
def column(db_id: int, name: str, column: str, m: Member = Depends(member)):
    out = explorer.column_detail(db_id, name, column)
    if out is None:
        raise HTTPException(404, "Không có cột này.")
    return out
