"""SEC-01 (ma trận quyền mục 2.4), SEC-08 (không leo thang qua link), SEC-05 (che PII cho viewer), AGT-09."""

import pytest
from fastapi.testclient import TestClient

from lvda import db
from lvda.main import app

client = TestClient(app)


def login(email: str) -> dict:
    r = client.post("/api/auth/login", json={"email": email, "password": "lvda1234"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(scope="module")
def eng():
    return login("engineer@lvda.dev")


@pytest.fixture(scope="module")
def viewer():
    return login("analyst@lvda.dev")


@pytest.fixture(scope="module")
def guest():
    clean = "DELETE FROM app.database_members WHERE user_id = (SELECT id FROM app.users WHERE email = 'guest@lvda.dev')"
    db.execute(clean)
    h = login("guest@lvda.dev")
    yield h
    db.execute(clean)


ENGINEER_ONLY = [
    ("get", "/api/db/1/eval", None),
    ("get", "/api/db/1/reviews", None),
    ("get", "/api/db/1/members", None),
    ("get", "/api/db/1/audit", None),
    ("get", "/api/db/1/settings", None),
    ("get", "/api/db/1/stats", None),
    ("post", "/api/db/1/share-links", {"role": "viewer"}),
    ("post", "/api/db/1/metrics/freight_ratio/certify", {}),
    ("post", "/api/db/1/mart/reload", {}),
    ("put", "/api/db/1/descriptions", {"column": "mart.fct_orders.order_id", "description": "x"}),
]


@pytest.mark.parametrize("method,path,body", ENGINEER_ONLY)
def test_viewer_gets_403(viewer, method, path, body):
    r = getattr(client, method)(path, headers=viewer, **({"json": body} if body is not None else {}))
    assert r.status_code == 403, (path, r.status_code)


@pytest.mark.parametrize("path", ["/api/db/1/metrics", "/api/db/1/catalog", "/api/db/1/runs"])
def test_viewer_can_read(viewer, path):
    assert client.get(path, headers=viewer).status_code == 200


def test_no_membership_403(guest):
    assert client.get("/api/db/1/metrics", headers=guest).status_code == 403


def test_link_engineer_cannot_escalate(eng, guest):
    link = client.post("/api/db/1/share-links", headers=eng, json={"role": "engineer", "expires_in_days": 1}).json()
    assert client.post("/api/share-links/accept", headers=guest, json={"token": link["token"]}).status_code == 200
    # link engineer: duyệt được, nhưng không chứng nhận, không quản lý thành viên, không tạo link
    assert client.get("/api/db/1/reviews", headers=guest).status_code == 200
    assert client.post("/api/db/1/metrics/freight_ratio/certify", headers=guest, json={}).status_code == 403
    assert client.post("/api/db/1/share-links", headers=guest, json={"role": "viewer"}).status_code == 403
    assert client.patch("/api/db/1/members/1", headers=guest, json={"role": "viewer"}).status_code == 403
    # thu hồi link → mất quyền ngay
    assert client.delete(f"/api/db/1/share-links/{link['id']}", headers=eng).status_code == 200
    assert client.get("/api/db/1/metrics", headers=guest).status_code == 403


def test_viewer_cannot_create_engineer_link(viewer):
    assert client.post("/api/db/1/share-links", headers=viewer, json={"role": "engineer"}).status_code == 403


def test_pii_masked_for_viewer(eng, viewer):
    sql = "SELECT o.customer_unique_id, o.customer_state FROM mart.fct_orders o LIMIT 3"
    r = client.post("/api/db/1/ask", headers=viewer, json={"question": sql}).json()
    assert r["masked_columns"] == ["customer_unique_id"]
    assert all(row[0] == "•••" for row in r["result"]["rows"])
    r2 = client.get(f"/api/db/1/runs/{r['id']}", headers=eng).json()
    assert r2["result"]["rows"][0][0] != "•••"


def test_ambiguous_question_lists_alternatives(viewer):
    r = client.post("/api/db/1/interpret", headers=viewer, json={"question": "doanh thu tháng 3/2018"}).json()
    assert r["metric_id"] == "gmv"
    assert any(a["id"] == "product_revenue" for a in r["alternatives"])
    r2 = client.post("/api/db/1/interpret", headers=viewer, json={"question": "doanh thu tháng 3/2018", "metric_id": "product_revenue"}).json()
    assert r2["metric_id"] == "product_revenue"


def test_trace_has_request_id(viewer):
    r = client.post("/api/db/1/ask", headers=viewer, json={"question": "Tỉ lệ hủy năm 2018"}).json()
    assert r["request_id"] and r["usage"]["steps"]
    assert {s["step"] for s in r["usage"]["steps"]} >= {"interpret", "generate_sql", "verify", "execute"}


def test_register_creates_account_without_access():
    email = "dangky-test@lvda.dev"
    db.execute("DELETE FROM app.users WHERE email = %s", (email,))
    try:
        assert client.post("/api/auth/register", json={"email": email, "password": "ngan"}).status_code == 422
        assert client.post("/api/auth/register", json={"email": "khong-hop-le", "password": "dai-du-8-ky-tu"}).status_code == 422
        r = client.post("/api/auth/register", json={"email": email, "password": "dai-du-8-ky-tu", "name": " "})
        assert r.status_code == 201, r.text
        assert r.json()["user"]["name"] == "dangky-test"
        me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {r.json()['token']}"}).json()
        assert me["databases"] == [] and me["can_connect"] is False
        dup = client.post("/api/auth/register", json={"email": email.upper(), "password": "dai-du-8-ky-tu"})
        assert dup.status_code == 409
        assert client.post("/api/auth/login", json={"email": email, "password": "dai-du-8-ky-tu"}).status_code == 200
    finally:
        db.execute("DELETE FROM app.users WHERE email = %s", (email,))
