"""Kết nối nguồn ngoài + đồng bộ tăng dần, chạy trên một database nguồn tạm dựng ngay trong Postgres của LVDA."""

import time
from urllib.parse import urlparse

import psycopg
import pytest
from fastapi.testclient import TestClient

from lvda import config, db, sources
from lvda.main import app

client = TestClient(app)
_u = urlparse(config.OWNER_DSN)
ADMIN = f"postgresql://{_u.username}:{_u.password}@{_u.hostname}:{_u.port or 5432}/lvda_src_test"
SECRET = "ro_secret_pw"
RO = f"postgresql://lvda_src_ro:{SECRET}@{_u.hostname}:{_u.port or 5432}/lvda_src_test"


def login(email: str) -> dict:
    tok = client.post("/api/auth/login", json={"email": email, "password": "lvda1234"}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


def src(sql: str) -> None:
    with psycopg.connect(ADMIN, autocommit=True) as c:
        c.execute(sql)


def wait(db_id: int, h: dict, timeout: float = 60) -> dict:
    t0 = time.time()
    while time.time() - t0 < timeout:
        s = client.get(f"/api/db/{db_id}/source", headers=h).json()
        if not s["running"]:
            return s
        time.sleep(0.2)
    raise AssertionError("đồng bộ chạy quá lâu")


def table(s: dict, name: str) -> dict:
    return next(t for t in s["tables"] if t["name"] == name)


def last_run(s: dict, name: str) -> dict:
    return next(t for t in s["runs"][0]["tables"] if t["table"] == name)


@pytest.fixture(scope="module")
def eng():
    with psycopg.connect(config.OWNER_DSN, autocommit=True) as c:
        c.execute("DROP DATABASE IF EXISTS lvda_src_test WITH (FORCE)")
        c.execute("CREATE DATABASE lvda_src_test")
        if not c.execute("SELECT 1 FROM pg_roles WHERE rolname = 'lvda_src_ro'").fetchone():
            c.execute(f"CREATE ROLE lvda_src_ro LOGIN PASSWORD '{SECRET}'")
    src("""
        CREATE TABLE customers (id int PRIMARY KEY, name text NOT NULL, updated_at timestamptz NOT NULL);
        CREATE TABLE orders (id int PRIMARY KEY, customer_id int REFERENCES customers(id), amount numeric(10,2),
                             meta jsonb, updated_at timestamptz NOT NULL);
        CREATE TABLE tags (code text PRIMARY KEY, label text);
        COMMENT ON COLUMN orders.amount IS 'Giá trị đơn';
        INSERT INTO customers SELECT g, 'KH ' || g, now() - interval '1 day' FROM generate_series(1, 50) g;
        INSERT INTO orders SELECT g, 1 + g % 50, g * 1.5, jsonb_build_object('n', g), now() - interval '1 day' - g * interval '1 second'
          FROM generate_series(1, 12000) g;
        INSERT INTO tags VALUES ('a', 'A'), ('b', 'B'), ('c', 'C');
        GRANT CONNECT ON DATABASE lvda_src_test TO lvda_src_ro;
        GRANT USAGE ON SCHEMA public TO lvda_src_ro;
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO lvda_src_ro;
    """)
    h = login("engineer@lvda.dev")
    yield h
    for r in db.fetch_all("SELECT database_id FROM app.sources WHERE dsn_masked LIKE '%%lvda_src_test'"):
        db.execute("DELETE FROM app.database_members WHERE database_id = %s", (r["database_id"],))
        db.execute("DELETE FROM app.databases WHERE id = %s", (r["database_id"],))
        db.execute(f"DROP SCHEMA IF EXISTS src_{r['database_id']} CASCADE")
    with psycopg.connect(config.OWNER_DSN, autocommit=True) as c:
        c.execute("DROP DATABASE IF EXISTS lvda_src_test WITH (FORCE)")


@pytest.fixture(scope="module")
def synced(eng):
    body = {"kind": "postgres", "dsn": RO, "name": "Nguồn test", "schedule_minutes": 0, "lookback_minutes": 0, "environment": "staging",
            "tables": [{"name": "customers", "cursor": "updated_at"}, {"name": "orders", "cursor": "updated_at"}, {"name": "tags"}]}
    r = client.post("/api/sources", json=body, headers=eng)
    assert r.status_code == 200, r.text
    return r.json()["database_id"]


def test_write_role_is_rejected(eng):
    r = client.post("/api/sources/test", json={"kind": "postgres", "dsn": ADMIN}, headers=eng).json()
    assert r["read_only"] is False and any("SUPERUSER" in p for p in r["problems"])
    bad = client.post("/api/sources", headers=eng, json={"kind": "postgres", "dsn": ADMIN, "name": "x", "tables": [{"name": "tags"}]})
    assert bad.status_code == 422 and "quyền ghi" in bad.json()["detail"]["message"]


def test_inspect_suggests_keys_and_cursor(eng):
    r = client.post("/api/sources/test", json={"kind": "postgres", "dsn": RO}, headers=eng)
    body = r.json()
    assert body["read_only"] is True and SECRET not in r.text
    t = {x["name"]: x for x in body["tables"]}
    assert t["orders"]["primary_key"] == ["id"] and t["orders"]["suggested_cursor"] == "updated_at"
    assert t["tags"]["suggested_cursor"] is None


def test_bad_dsn_and_missing_host_are_explained(eng):
    r = client.post("/api/sources/test", json={"kind": "mysql", "dsn": "postgresql://a:b@h/x"}, headers=eng).json()
    assert r["ok"] is False and "Ví dụ" in r["error"]["message"]


@pytest.mark.parametrize(("dsn", "field"), [
    (RO.replace(SECRET, "sai_mat_khau"), "password"),
    (RO.replace("/lvda_src_test", "/khong_co_db"), "database"),
    (RO.replace(f"@{_u.hostname}", "@khong-co-host.invalid"), "host"),
])
def test_connection_errors_point_at_the_field(eng, dsn, field):
    r = client.post("/api/sources/test", json={"kind": "postgres", "dsn": dsn}, headers=eng)
    body = r.json()
    assert body["ok"] is False and body["error"]["field"] == field
    assert "sai_mat_khau" not in r.text
    steps = {c["id"]: c["status"] for c in body["checks"]}
    assert steps["network"] == ("fail" if field == "host" else "ok")
    assert steps["schema"] == "skip"


def test_missing_schema_points_at_schema(eng):
    r = client.post("/api/sources/test", json={"kind": "postgres", "dsn": RO, "schema_name": "khong_co"}, headers=eng).json()
    assert r["error"]["field"] == "schema"
    assert [c["status"] for c in r["checks"]] == ["ok", "ok", "skip", "fail"]


def test_all_four_checks_pass(eng):
    r = client.post("/api/sources/test", json={"kind": "postgres", "dsn": RO}, headers=eng).json()
    assert r["ok"] is True and [c["status"] for c in r["checks"]] == ["ok", "ok", "ok", "ok"]
    assert "3 bảng trong public" in r["checks"][3]["detail"]
    write = client.post("/api/sources/test", json={"kind": "postgres", "dsn": ADMIN}, headers=eng).json()
    assert [c["status"] for c in write["checks"]][:3] == ["ok", "ok", "fail"]


def test_initial_sync_copies_everything_and_builds_catalog(eng, synced):
    s = wait(synced, eng)
    assert s["runs"][0]["status"] == "ok" and s["runs"][0]["trigger"] == "initial"
    assert table(s, "orders")["target_rows"] == 12000 and table(s, "orders")["mode"] == "incremental"
    assert table(s, "tags")["mode"] == "full" and table(s, "tags")["target_rows"] == 3
    assert last_run(s, "orders")["mode"] == "initial" and last_run(s, "orders")["read"] == 12000
    spec = db.fetch_one("SELECT settings->'warehouse' AS w FROM app.databases WHERE id = %s", (synced,))["w"]
    assert spec["meta"]["grains"][f"src_{synced}.orders"] == ["id"]
    assert any(r["child"] == f"src_{synced}.orders" for r in spec["meta"]["relationships"])
    home = client.get(f"/api/db/{synced}/explore/home", headers=eng).json()
    assert home["tables"] == 3
    desc = db.fetch_one("SELECT description FROM app.column_descriptions WHERE database_id = %s AND column_name = %s",
                        (synced, f"src_{synced}.orders.amount"))
    assert desc and desc["description"] == "Giá trị đơn"


def test_incremental_reads_only_changed_rows(eng, synced):
    src("UPDATE orders SET amount = amount + 1, updated_at = now() WHERE id IN (1, 2);"
        "INSERT INTO orders VALUES (12001, 1, 9.99, NULL, now());")
    assert client.post(f"/api/db/{synced}/source/sync", json={}, headers=eng).status_code == 200
    s = wait(synced, eng)
    o = last_run(s, "orders")
    assert o["mode"] == "incremental" and o["inserted"] == 1 and o["updated"] == 2 and o["read"] <= 4
    assert last_run(s, "customers")["inserted"] == 0 and last_run(s, "tags")["mode"] == "full"
    row = db.run_readonly(f"SELECT amount FROM src_{synced}.orders WHERE id = 1")["rows"][0][0]
    assert row == 2.5


def test_delete_shows_drift_until_full_refresh(eng, synced):
    src("DELETE FROM orders WHERE id = 5")
    client.post(f"/api/db/{synced}/source/sync", json={}, headers=eng)
    assert table(wait(synced, eng), "orders")["drift"] == 1
    client.post(f"/api/db/{synced}/source/sync", json={"full": True}, headers=eng)
    s = wait(synced, eng)
    assert table(s, "orders")["drift"] == 0 and last_run(s, "orders")["mode"] == "refresh"


def test_schema_change_rebuilds_the_copy(eng, synced):
    src("ALTER TABLE customers ADD COLUMN phone text; UPDATE customers SET phone = '090' WHERE id = 3")
    client.post(f"/api/db/{synced}/source/sync", json={}, headers=eng)
    s = wait(synced, eng)
    assert last_run(s, "customers")["mode"] == "refresh"
    assert db.run_readonly(f"SELECT phone FROM src_{synced}.customers WHERE id = 3")["rows"] == [["090"]]


def test_source_list_groups_status_and_environment(eng, synced):
    body = client.get("/api/sources", headers=eng).json()
    item = next(i for i in body["items"] if i["id"] == synced)
    assert item["environment"] == "staging" and item["status"] == "ok" and item["tables"] == 3 and item["rows"] >= 12000
    assert item["host"] == _u.hostname and item["database"] == "lvda_src_test"
    olist = next(i for i in body["items"] if i["id"] == 1)
    assert olist["environment"] == "builtin" and olist["status"] == "builtin" and olist["tables"] > 0
    run = db.fetch_one("SELECT plan FROM app.sync_runs WHERE database_id = %s ORDER BY id LIMIT 1", (synced,))
    assert [p["table"] for p in run["plan"]] == ["customers", "orders", "tags"]
    db.execute("UPDATE app.sources SET schedule_minutes = 15 WHERE database_id = %s", (synced,))
    db.execute("UPDATE app.sync_runs SET finished_at = now() - interval '1 hour' WHERE database_id = %s", (synced,))
    assert next(i for i in client.get("/api/sources", headers=eng).json()["items"] if i["id"] == synced)["status"] == "stale"
    db.execute("UPDATE app.sources SET schedule_minutes = 0 WHERE database_id = %s", (synced,))
    r = client.put(f"/api/db/{synced}/source", json={"schedule_minutes": 0, "lookback_minutes": 0, "environment": "dev", "name": "Nguồn test"},
                   headers=eng).json()
    assert r["environment"] == "dev"
    assert client.get("/api/sources", headers=analyst_headers()).status_code == 403


def analyst_headers() -> dict:
    return login("analyst@lvda.dev")


def test_secret_is_encrypted_and_never_returned(eng, synced):
    r = client.get(f"/api/db/{synced}/source", headers=eng)
    assert SECRET not in r.text and r.json()["dsn_masked"].startswith("lvda_src_ro@")
    enc = db.fetch_one("SELECT dsn_enc FROM app.sources WHERE database_id = %s", (synced,))["dsn_enc"]
    assert SECRET not in enc and sources.decrypt(enc) == RO


def test_only_engineers_manage_sources(eng, synced):
    analyst = login("analyst@lvda.dev")
    assert client.post("/api/sources/test", json={"kind": "postgres", "dsn": RO}, headers=analyst).status_code == 403
    assert client.post(f"/api/db/{synced}/source/sync", json={}, headers=analyst).status_code == 403
    assert client.get("/api/auth/me", headers=analyst).json()["can_connect"] is False


def test_schedule_marks_source_due(eng, synced):
    r = client.put(f"/api/db/{synced}/source", json={"schedule_minutes": 15, "lookback_minutes": 0}, headers=eng)
    assert r.status_code == 200 and r.json()["schedule_minutes"] == 15
    db.execute("UPDATE app.sources SET last_run_at = now() - interval '20 minutes' WHERE database_id = %s", (synced,))
    assert synced in sources.due()
    db.execute("UPDATE app.sources SET last_run_at = now() WHERE database_id = %s", (synced,))
    assert synced not in sources.due()
    assert client.put(f"/api/db/{synced}/source", json={"schedule_minutes": 7}, headers=eng).status_code == 422


def test_remove_and_add_tables(eng, synced):
    picks = client.get(f"/api/db/{synced}/source/inspect", headers=eng).json()["tables"]
    assert {t["name"] for t in picks if t["synced"]} == {"customers", "orders", "tags"}
    keep = [{"name": "customers", "cursor": "updated_at"}, {"name": "orders", "cursor": "updated_at"}]
    r = client.put(f"/api/db/{synced}/source/tables", json={"tables": keep}, headers=eng).json()
    assert r["removed"] == ["tags"] and r["added"] == []
    assert client.get(f"/api/db/{synced}/explore/home", headers=eng).json()["tables"] == 2  # biến mất khỏi catalog ngay
    assert not db.fetch_one("SELECT 1 FROM information_schema.tables WHERE table_schema = %s AND table_name = 'tags'", (f"src_{synced}",))
    r = client.put(f"/api/db/{synced}/source/tables", json={"tables": [*keep, {"name": "tags"}]}, headers=eng).json()
    assert r["added"] == ["tags"]
    s = wait(synced, eng)  # thêm bảng thì tự chạy đồng bộ
    assert table(s, "tags")["target_rows"] == 3


def test_rotate_password(eng, synced):
    bad = client.put(f"/api/db/{synced}/source/credentials", json={"password": "sai"}, headers=eng)
    assert bad.status_code == 422 and bad.json()["detail"]["field"] == "password"
    ok = client.put(f"/api/db/{synced}/source/credentials", json={"password": SECRET}, headers=eng)
    assert ok.status_code == 200 and SECRET not in ok.text


def test_pause_skips_schedule(eng, synced):
    client.put(f"/api/db/{synced}/source", json={"schedule_minutes": 15, "lookback_minutes": 0}, headers=eng)
    db.execute("UPDATE app.sources SET last_run_at = now() - interval '1 hour' WHERE database_id = %s", (synced,))
    assert client.put(f"/api/db/{synced}/source/pause", json={"paused": True}, headers=eng).json()["paused"] is True
    assert synced not in sources.due()
    client.put(f"/api/db/{synced}/source/pause", json={"paused": False}, headers=eng)
    assert synced in sources.due()
    client.put(f"/api/db/{synced}/source", json={"schedule_minutes": 0, "lookback_minutes": 0}, headers=eng)


def test_busy_source_refuses_second_run(eng, synced):
    db.execute("INSERT INTO app.sync_runs (database_id, trigger, status) VALUES (%s, 'manual', 'running')", (synced,))
    try:
        assert client.post(f"/api/db/{synced}/source/sync", json={}, headers=eng).status_code == 409
    finally:
        db.execute("DELETE FROM app.sync_runs WHERE database_id = %s AND status = 'running'", (synced,))


def test_disconnect_needs_exact_name_then_removes_everything(eng, synced):
    wrong = client.delete(f"/api/db/{synced}/source", params={"confirm": "nhầm"}, headers=eng)
    assert wrong.status_code == 422 and wrong.json()["detail"]["field"] == "confirm"
    assert client.delete(f"/api/db/{synced}/source", params={"confirm": "Nguồn test"}, headers=eng).status_code == 200
    assert not db.fetch_one("SELECT 1 FROM app.databases WHERE id = %s", (synced,))
    assert not db.fetch_one("SELECT 1 FROM information_schema.schemata WHERE schema_name = %s", (f"src_{synced}",))
    assert all(d["id"] != synced for d in client.get("/api/auth/me", headers=eng).json()["databases"])
