"""Thành viên, link chia sẻ, nhật ký phân quyền."""

from datetime import datetime, timedelta, UTC
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from lvda import config, db
from lvda.security import (Member, User, audit, current_user, direct_engineer, engineer, hash_link_token, load_member,
                           new_link_token, request_id)

router = APIRouter(prefix="/api", tags=["access"])
ROLE_RANK = {"viewer": 1, "engineer": 2}


class LinkBody(BaseModel):
    role: Literal["viewer", "engineer"] = "viewer"
    expires_in_days: int = Field(7, ge=1, le=90)
    max_uses: int | None = Field(None, ge=1, le=1000)


class TokenBody(BaseModel):
    token: str = Field(..., min_length=10, max_length=200)


class MemberPatch(BaseModel):
    role: Literal["viewer", "engineer"] | None = None
    can_certify: bool | None = None


@router.get("/db/{db_id}/members")
def members(db_id: int, m: Member = Depends(engineer)):
    return db.fetch_all(
        """SELECT u.id AS user_id, u.name, u.email, dm.role, dm.can_certify, dm.granted_via, dm.expires_at, dm.created_at,
                  g.name AS granted_by_name, (dm.expires_at IS NOT NULL AND dm.expires_at < now()) AS expired
           FROM app.database_members dm JOIN app.users u ON u.id = dm.user_id
           LEFT JOIN app.users g ON g.id = dm.granted_by
           WHERE dm.database_id = %s ORDER BY dm.granted_via, dm.role DESC, u.name""", (db_id,))


@router.patch("/db/{db_id}/members/{user_id}")
def update_member(db_id: int, user_id: int, body: MemberPatch, request: Request, m: Member = Depends(direct_engineer)):
    if user_id == m.user.id:
        raise HTTPException(422, "Không tự đổi quyền của chính mình.")
    target = db.fetch_one("SELECT role, can_certify FROM app.database_members WHERE database_id = %s AND user_id = %s", (db_id, user_id))
    if not target:
        raise HTTPException(404, "Không tìm thấy thành viên.")
    role = body.role or target["role"]
    can_certify = (body.can_certify if body.can_certify is not None else target["can_certify"]) and role == "engineer"
    db.execute("UPDATE app.database_members SET role = %s, can_certify = %s WHERE database_id = %s AND user_id = %s",
               (role, can_certify, db_id, user_id))
    audit(db_id, m.user.id, "member.update", str(user_id), {"from": target, "to": {"role": role, "can_certify": can_certify}},
          request_id(request))
    return {"ok": True}


@router.delete("/db/{db_id}/members/{user_id}")
def remove_member(db_id: int, user_id: int, request: Request, m: Member = Depends(direct_engineer)):
    if user_id == m.user.id:
        raise HTTPException(422, "Không tự xóa chính mình.")
    row = db.execute("DELETE FROM app.database_members WHERE database_id = %s AND user_id = %s RETURNING role", (db_id, user_id))
    if not row:
        raise HTTPException(404, "Không tìm thấy thành viên.")
    audit(db_id, m.user.id, "member.remove", str(user_id), {"role": row["role"]}, request_id(request))
    return {"ok": True}


@router.get("/db/{db_id}/share-links")
def links(db_id: int, m: Member = Depends(direct_engineer)):
    return db.fetch_all(
        """SELECT l.id, l.role, l.expires_at, l.revoked_at, l.max_uses, l.uses, l.created_at, u.name AS created_by_name,
                  CASE WHEN l.revoked_at IS NOT NULL THEN 'revoked' WHEN l.expires_at < now() THEN 'expired'
                       WHEN l.max_uses IS NOT NULL AND l.uses >= l.max_uses THEN 'used_up' ELSE 'active' END AS state
           FROM app.share_links l LEFT JOIN app.users u ON u.id = l.created_by
           WHERE l.database_id = %s ORDER BY l.created_at DESC""", (db_id,))


@router.post("/db/{db_id}/share-links")
def create_link(db_id: int, body: LinkBody, request: Request, m: Member = Depends(direct_engineer)):
    if ROLE_RANK[body.role] > ROLE_RANK[m.role]:  # SEC-08: không cấp quyền cao hơn mình
        raise HTTPException(403, "Không thể tạo link có quyền cao hơn quyền của bạn.")
    token, token_hash = new_link_token()
    expires = datetime.now(UTC) + timedelta(days=body.expires_in_days)
    row = db.execute(
        "INSERT INTO app.share_links (database_id, role, token_hash, created_by, expires_at, max_uses) VALUES (%s,%s,%s,%s,%s,%s) RETURNING id",
        (db_id, body.role, token_hash, m.user.id, expires, body.max_uses))
    audit(db_id, m.user.id, "link.create", str(row["id"]),
          {"role": body.role, "expires_at": expires.isoformat(), "max_uses": body.max_uses}, request_id(request))
    return {"id": row["id"], "url": f"{config.WEB_ORIGIN}/join/{token}", "token": token, "role": body.role,
            "expires_at": expires, "max_uses": body.max_uses}


@router.delete("/db/{db_id}/share-links/{link_id}")
def revoke_link(db_id: int, link_id: int, request: Request, m: Member = Depends(direct_engineer)):
    with db.app_conn() as conn:
        row = conn.execute("UPDATE app.share_links SET revoked_at = now() WHERE id = %s AND database_id = %s AND revoked_at IS NULL RETURNING id",
                           (link_id, db_id)).fetchone()
        if not row:
            raise HTTPException(404, "Link không tồn tại hoặc đã bị thu hồi.")
        removed = conn.execute("DELETE FROM app.database_members WHERE share_link_id = %s RETURNING user_id", (link_id,)).fetchall()
        conn.commit()
    audit(db_id, m.user.id, "link.revoke", str(link_id), {"members_removed": len(removed)}, request_id(request))
    return {"ok": True, "members_removed": len(removed)}


def _find_link(token: str) -> tuple[dict | None, str | None]:
    link = db.fetch_one(
        """SELECT l.*, d.name AS database_name, u.name AS created_by_name FROM app.share_links l
           JOIN app.databases d ON d.id = l.database_id LEFT JOIN app.users u ON u.id = l.created_by
           WHERE l.token_hash = %s""", (hash_link_token(token),))
    if not link:
        return None, "Link không hợp lệ."
    if link["revoked_at"]:
        return link, "Link đã bị thu hồi."
    if link["expires_at"] < datetime.now(UTC):
        return link, "Link đã hết hạn."
    if link["max_uses"] is not None and link["uses"] >= link["max_uses"]:
        return link, "Link đã dùng hết số lượt."
    return link, None


@router.post("/share-links/preview")
def preview(body: TokenBody, user: User = Depends(current_user)):
    link, problem = _find_link(body.token)
    if not link:
        raise HTTPException(404, problem)
    current = load_member(link["database_id"], user)
    return {"database_id": link["database_id"], "database_name": link["database_name"], "role": link["role"],
            "expires_at": link["expires_at"], "created_by_name": link["created_by_name"], "problem": problem,
            "current_role": current.role if current else None}


@router.post("/share-links/accept")
def accept(body: TokenBody, request: Request, user: User = Depends(current_user)):
    link, problem = _find_link(body.token)
    if problem:
        raise HTTPException(410 if link else 404, problem)
    db_id = link["database_id"]
    current = load_member(db_id, user)
    if current and ROLE_RANK[current.role] >= ROLE_RANK[link["role"]] and current.granted_via == "direct":
        return {"database_id": db_id, "role": current.role, "changed": False}
    with db.app_conn() as conn:
        conn.execute(
            """INSERT INTO app.database_members (database_id, user_id, role, can_certify, granted_via, granted_by, share_link_id, expires_at)
               VALUES (%s,%s,%s,false,'link',%s,%s,%s)
               ON CONFLICT (database_id, user_id) DO UPDATE SET role = EXCLUDED.role, granted_via = 'link',
                 granted_by = EXCLUDED.granted_by, share_link_id = EXCLUDED.share_link_id, expires_at = EXCLUDED.expires_at,
                 can_certify = false""",
            (db_id, user.id, link["role"], link["created_by"], link["id"], link["expires_at"]))
        conn.execute("UPDATE app.share_links SET uses = uses + 1 WHERE id = %s", (link["id"],))
        conn.commit()
    audit(db_id, user.id, "link.accept", str(link["id"]), {"role": link["role"]}, request_id(request))
    return {"database_id": db_id, "role": link["role"], "changed": True}


@router.get("/db/{db_id}/audit")
def audit_log(db_id: int, m: Member = Depends(engineer)):
    return db.fetch_all(
        """SELECT a.id, a.action, a.target, a.detail, a.request_id, a.created_at, u.name AS actor_name
           FROM app.audit_events a LEFT JOIN app.users u ON u.id = a.actor_id
           WHERE a.database_id = %s ORDER BY a.created_at DESC LIMIT 200""", (db_id,))
