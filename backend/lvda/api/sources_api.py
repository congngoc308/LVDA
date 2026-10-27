"""Kết nối nguồn ngoài (Postgres / MySQL, chỉ đọc) và đồng bộ tăng dần. Chuỗi kết nối không bao giờ được trả ra."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from lvda import config, db, sources
from lvda.security import Member, User, audit, current_user, direct_engineer, engineer, request_id

router = APIRouter(prefix="/api", tags=["sources"])


def _err(e: sources.SourceError) -> HTTPException:
    # field: ô nhập gây lỗi, để giao diện tô đỏ đúng chỗ thay vì một thông báo chung
    return HTTPException(422, {"message": str(e), "field": e.field})


def _schedule(v: int) -> int:
    if v not in sources.SCHEDULES:
        raise ValueError("Lịch chỉ nhận 0, 15, 60 hoặc 1440 phút.")
    return v


class SourceIn(BaseModel):
    kind: Literal["postgres", "mysql"]
    dsn: str = Field(..., min_length=10, max_length=500)
    schema_name: str | None = Field(None, max_length=63)


class TablePick(BaseModel):
    name: str = Field(..., max_length=128)
    keys: list[str] = Field(default_factory=list, max_length=8)
    cursor: str | None = Field(None, max_length=128)


class CreateBody(SourceIn):
    name: str = Field(..., min_length=1, max_length=80)
    environment: Literal["prod", "staging", "dev"] = "prod"
    tables: list[TablePick] = Field(..., min_length=1, max_length=500)
    schedule_minutes: int = 60
    lookback_minutes: int = Field(5, ge=0, le=1440)
    check_schedule = field_validator("schedule_minutes")(_schedule)


class ScheduleBody(BaseModel):
    schedule_minutes: int
    lookback_minutes: int = Field(5, ge=0, le=1440)
    environment: Literal["prod", "staging", "dev"] | None = None
    name: str | None = Field(None, max_length=80)
    check_schedule = field_validator("schedule_minutes")(_schedule)


class TablesBody(BaseModel):
    tables: list[TablePick] = Field(..., min_length=1, max_length=500)


class CredentialsBody(BaseModel):
    user: str | None = Field(None, max_length=128)
    password: str = Field(..., max_length=256)


class PauseBody(BaseModel):
    paused: bool


class SyncBody(BaseModel):
    full: bool = False


def can_connect(user: User = Depends(current_user)) -> User:
    """Kết nối nguồn mới tạo ra một database: chỉ người đang là engineer (gán trực tiếp) ở đâu đó mới làm được."""
    row = db.fetch_one("""SELECT 1 FROM app.database_members WHERE user_id = %s AND role = 'engineer' AND granted_via = 'direct'
                          AND (expires_at IS NULL OR expires_at > now()) LIMIT 1""", (user.id,))
    if not row:
        raise HTTPException(403, "Chỉ engineer mới kết nối được nguồn dữ liệu mới.")
    return user


@router.get("/sources/demo")
def demo_sources(user: User = Depends(can_connect)):
    out = []
    for item in filter(None, config.DEMO_SOURCES.split(";")):
        label, kind, dsn = item.split("|", 2)
        out.append({"label": label, "kind": kind, "dsn": dsn})
    return out


@router.get("/sources")
def list_sources(user: User = Depends(can_connect)):
    """Trang Nguồn dữ liệu: mọi database người dùng quản lý, kèm trạng thái để lọc (lỗi, đang chép, dữ liệu cũ)."""
    items = sources.list_for(user.id)
    counts = {k: sum(1 for i in items if i["status"] == k) for k in ("error", "running", "stale")}
    return {"items": items, "counts": {"all": len(items), **counts}}


@router.post("/sources/test")
def test_source(body: SourceIn, user: User = Depends(can_connect)):
    """Kiểm tra 4 bước (mạng, xác thực, role chỉ đọc, đọc schema). Luôn trả 200: kết quả từng bước nằm trong `checks`,
    lỗi (nếu có) trong `error` kèm ô nhập gây lỗi."""
    return sources.check(body.kind, body.dsn, body.schema_name)


@router.post("/sources")
def create_source(body: CreateBody, request: Request, user: User = Depends(can_connect)):
    try:
        db_id = sources.create(user.id, body.name, body.kind, body.dsn, body.schema_name, [t.model_dump() for t in body.tables],
                               body.schedule_minutes, body.lookback_minutes, body.environment)
    except sources.SourceError as e:
        raise _err(e) from e
    rid = request_id(request)
    audit(db_id, user.id, "source.create", sources.mask(body.kind, body.dsn),
          {"kind": body.kind, "tables": [t.name for t in body.tables], "schedule_minutes": body.schedule_minutes}, rid)
    run_id = sources.start(db_id, "initial", user_id=user.id)
    return {"database_id": db_id, "run_id": run_id}


def _described(db_id: int) -> dict:
    out = sources.describe(db_id)
    if out is None:
        raise HTTPException(404, "Database này không đồng bộ từ nguồn ngoài.")
    return out


@router.get("/db/{db_id}/source")
def get_source(db_id: int, m: Member = Depends(engineer)):
    return _described(db_id)


@router.post("/db/{db_id}/source/sync")
def sync_now(db_id: int, body: SyncBody, request: Request, m: Member = Depends(engineer)):
    try:
        run_id = sources.start(db_id, "manual", full=body.full, user_id=m.user.id)
    except sources.Busy as e:
        raise HTTPException(409, str(e)) from e
    except sources.SourceError as e:
        raise HTTPException(404, str(e)) from e
    audit(db_id, m.user.id, "source.sync", "full" if body.full else "incremental", {"run_id": run_id}, request_id(request))
    return {"run_id": run_id}


@router.put("/db/{db_id}/source")
def save_schedule(db_id: int, body: ScheduleBody, request: Request, m: Member = Depends(engineer)):
    before = _described(db_id)
    sources.update_schedule(db_id, body.schedule_minutes, body.lookback_minutes, body.environment, body.name)
    audit(db_id, m.user.id, "source.settings", "settings",
          {"schedule": [before["schedule_minutes"], body.schedule_minutes], "lookback": body.lookback_minutes,
           "environment": [before["environment"], body.environment or before["environment"]],
           "name": [before["name"], (body.name or before["name"]).strip()]}, request_id(request))
    return sources.describe(db_id)


@router.get("/db/{db_id}/source/inspect")
def inspect_source(db_id: int, m: Member = Depends(engineer)):
    try:
        return sources.inspect_saved(db_id)
    except sources.SourceError as e:
        raise _err(e) from e


@router.put("/db/{db_id}/source/tables")
def save_tables(db_id: int, body: TablesBody, request: Request, m: Member = Depends(engineer)):
    """Thêm / bớt bảng, đổi cột mốc; rồi chạy đồng bộ ngay để bảng mới có dữ liệu."""
    try:
        diff = sources.update_tables(db_id, [t.model_dump() for t in body.tables])
    except sources.Busy as e:
        raise HTTPException(409, str(e)) from e
    except sources.SourceError as e:
        raise _err(e) from e
    audit(db_id, m.user.id, "source.tables", "tables", diff, request_id(request))
    if diff["added"] or diff["changed"]:
        sources.start(db_id, "manual", user_id=m.user.id)
    return {**diff, "source": sources.describe(db_id)}


@router.put("/db/{db_id}/source/credentials")
def save_credentials(db_id: int, body: CredentialsBody, request: Request, m: Member = Depends(direct_engineer)):
    try:
        masked = sources.update_credentials(db_id, body.user, body.password)
    except sources.SourceError as e:
        raise _err(e) from e
    audit(db_id, m.user.id, "source.credentials", masked, {}, request_id(request))  # không ghi mật khẩu vào nhật ký
    return sources.describe(db_id)


@router.put("/db/{db_id}/source/pause")
def pause(db_id: int, body: PauseBody, request: Request, m: Member = Depends(engineer)):
    _described(db_id)
    sources.set_paused(db_id, body.paused)
    audit(db_id, m.user.id, "source.pause" if body.paused else "source.resume", "schedule", {}, request_id(request))
    return sources.describe(db_id)


@router.delete("/db/{db_id}/source")
def disconnect(db_id: int, confirm: str, request: Request, m: Member = Depends(direct_engineer)):
    """Ngắt kết nối và xóa bản sao. Phải gõ đúng tên database để xác nhận."""
    s = _described(db_id)
    if confirm.strip() != s["name"]:
        raise HTTPException(422, {"message": "Tên xác nhận không khớp tên database.", "field": "confirm"})
    masked = s["dsn_masked"]
    try:
        sources.disconnect(db_id)
    except sources.Busy as e:
        raise HTTPException(409, str(e)) from e
    audit(None, m.user.id, "source.disconnect", masked, {"database_id": db_id, "name": s["name"]}, request_id(request))
    return {"ok": True}
