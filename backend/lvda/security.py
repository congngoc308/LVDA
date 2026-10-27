"""Đăng nhập (JWT + bcrypt) và phân quyền theo database."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, UTC

import bcrypt
import jwt
from fastapi import Depends, Header, HTTPException, Request

from lvda import config, db


@dataclass
class User:
    id: int
    email: str
    name: str


@dataclass
class Member:
    user: User
    database_id: int
    role: str  # viewer | engineer
    can_certify: bool
    granted_via: str  # direct | link
    expires_at: datetime | None

    @property
    def is_engineer(self) -> bool:
        return self.role == "engineer"

    @property
    def is_direct_engineer(self) -> bool:
        return self.role == "engineer" and self.granted_via == "direct"


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def check_password(pw: str, hashed: str) -> bool:
    return bcrypt.checkpw(pw.encode(), hashed.encode())


def issue_token(user_id: int) -> str:
    exp = datetime.now(UTC) + timedelta(hours=config.JWT_TTL_HOURS)
    return jwt.encode({"sub": str(user_id), "exp": exp}, config.JWT_SECRET, algorithm="HS256")


def new_link_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(24)
    return token, hash_link_token(token)


def hash_link_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def request_id(request: Request) -> str:
    rid = getattr(request.state, "request_id", None)
    if not rid:
        rid = request.state.request_id = uuid.uuid4().hex[:12]
    return rid


def current_user(authorization: str = Header(default="")) -> User:
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Bạn cần đăng nhập.")
    try:
        payload = jwt.decode(authorization[7:], config.JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError as e:
        raise HTTPException(401, "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.") from e
    row = db.fetch_one("SELECT id, email, name FROM app.users WHERE id = %s", (int(payload["sub"]),))
    if not row:
        raise HTTPException(401, "Tài khoản không còn tồn tại.")
    return User(**row)


def load_member(db_id: int, user: User) -> Member | None:
    row = db.fetch_one(
        "SELECT role, can_certify, granted_via, expires_at FROM app.database_members WHERE database_id = %s AND user_id = %s",
        (db_id, user.id))
    if not row:
        return None
    return Member(user=user, database_id=db_id, **row)


def member(db_id: int, user: User = Depends(current_user)) -> Member:
    m = load_member(db_id, user)
    if not m:
        raise HTTPException(403, "Bạn chưa có quyền truy cập database này.")
    if m.expires_at and m.expires_at < datetime.now(UTC):
        raise HTTPException(403, "Quyền truy cập của bạn đã hết hạn.")
    return m


def engineer(m: Member = Depends(member)) -> Member:
    if not m.is_engineer:
        raise HTTPException(403, "Chỉ engineer được làm thao tác này.")
    return m


def direct_engineer(m: Member = Depends(member)) -> Member:
    if not m.is_direct_engineer:
        raise HTTPException(403, "Chỉ engineer được gán trực tiếp mới quản lý thành viên và link chia sẻ.")
    return m


def audit(database_id: int | None, actor_id: int | None, action: str, target: str, detail: dict, rid: str | None) -> None:
    db.execute(
        "INSERT INTO app.audit_events (database_id, actor_id, action, target, detail, request_id) VALUES (%s,%s,%s,%s,%s,%s)",
        (database_id, actor_id, action, target, db.jsonb(detail), rid))
