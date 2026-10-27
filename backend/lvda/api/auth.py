from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from lvda import db
from lvda.security import User, check_password, current_user, hash_password, issue_token

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    email: str
    password: str


class RegisterBody(BaseModel):
    email: str
    password: str
    name: str | None = None


def _databases(user_id: int) -> list[dict]:
    return db.fetch_all(
        """SELECT d.id, d.name, d.description, m.role, m.can_certify, m.granted_via, m.expires_at,
                  (m.expires_at IS NOT NULL AND m.expires_at < now()) AS expired,
                  (d.settings ? 'warehouse') AS catalog_only,
                  EXISTS (SELECT 1 FROM app.sources s WHERE s.database_id = d.id) AS has_source,
                  g.name AS granted_by_name
           FROM app.database_members m JOIN app.databases d ON d.id = m.database_id
           LEFT JOIN app.users g ON g.id = m.granted_by
           WHERE m.user_id = %s ORDER BY d.id""", (user_id,))


@router.post("/login")
def login(body: LoginBody):
    row = db.fetch_one("SELECT id, email, name, password_hash FROM app.users WHERE lower(email) = lower(%s)", (body.email.strip(),))
    if not row or not check_password(body.password, row["password_hash"]):
        raise HTTPException(401, "Email hoặc mật khẩu không đúng.")
    return {"token": issue_token(row["id"]), "user": {"id": row["id"], "email": row["email"], "name": row["name"]}}


@router.post("/register", status_code=201)
def register(body: RegisterBody):
    """Tự tạo tài khoản. Tài khoản mới chưa có quyền ở database nào, như guest: nhận quyền qua link chia sẻ."""
    email = body.email.strip()
    local, _, domain = email.partition("@")
    if not local or "." not in domain:
        raise HTTPException(422, "Email không hợp lệ.")
    if len(body.password) < 8:
        raise HTTPException(422, "Mật khẩu cần ít nhất 8 ký tự.")
    if db.fetch_one("SELECT 1 FROM app.users WHERE lower(email) = lower(%s)", (email,)):
        raise HTTPException(409, "Email này đã được đăng ký.")
    name = (body.name or "").strip() or local
    row = db.execute("INSERT INTO app.users (email, name, password_hash) VALUES (%s,%s,%s) RETURNING id, email, name",
                     (email, name, hash_password(body.password)))
    assert row is not None
    return {"token": issue_token(row["id"]), "user": {"id": row["id"], "email": row["email"], "name": row["name"]}}


@router.get("/me")
def me(user: User = Depends(current_user)):
    dbs = _databases(user.id)
    can_connect = any(d["role"] == "engineer" and d["granted_via"] == "direct" and not d["expired"] for d in dbs)
    return {"user": user.__dict__, "databases": dbs, "can_connect": can_connect}
