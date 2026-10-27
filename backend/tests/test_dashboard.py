"""Dashboard Đánh giá: card hệ thống bị khóa, card chỉ nhận tham số của chỉ số đã chứng nhận, agent sinh card theo từng bước."""

import json

import pytest
from fastapi.testclient import TestClient

from lvda import dashboard
from lvda.main import app

client = TestClient(app)


def login(email: str) -> dict:
    tok = client.post("/api/auth/login", json={"email": email, "password": "lvda1234"}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture()
def eng():
    h = login("engineer@lvda.dev")
    yield h
    client.put("/api/db/1/dashboards/eval", json={"layout": dashboard.default_layout(), "cards": [], "tray": []}, headers=h)


def card(**kw) -> dict:
    return {"id": "c_test01", "title": "Doanh thu", "metric_id": "gmv", **kw}


def draft(h: dict, **answers) -> list[dict]:
    body = {"goal": "theo_doi", "audience": "phan_tich", "cadence": "thang", "focus": "", **answers}
    with client.stream("POST", "/api/db/1/dashboards/draft", json=body, headers=h) as r:
        assert r.status_code == 200
        return [json.loads(line) for line in r.iter_lines() if line]


def test_chart_must_match_data_shape():
    assert dashboard.chart_problem(None, "number") is None
    assert dashboard.chart_problem(None, "bar")
    assert dashboard.chart_problem("customer_state", "line")
    assert dashboard.chart_problem("month", "line") is None


def test_system_cards_cannot_be_removed(eng):
    layout = [i for i in dashboard.default_layout() if i["id"] != "sys:kpis"]
    r = client.put("/api/db/1/dashboards/eval", json={"layout": layout, "cards": [], "tray": []}, headers=eng)
    assert r.status_code == 422


def test_card_must_use_certified_metric(eng):
    layout = dashboard.default_layout() + [{"id": "c_test01", "size": "m"}]
    ok = client.put("/api/db/1/dashboards/eval", json={"layout": layout, "cards": [card()], "tray": []}, headers=eng)
    assert ok.status_code == 200 and ok.json()["cards"][0]["metric_id"] == "gmv"
    draft_metric = client.put("/api/db/1/dashboards/eval", headers=eng,
                              json={"layout": layout, "cards": [card(metric_id="freight_ratio")], "tray": []})
    assert draft_metric.status_code == 422 and "nháp" in draft_metric.json()["detail"]
    raw_sql = client.put("/api/db/1/dashboards/eval", headers=eng,
                         json={"layout": layout, "cards": [card(sql="SELECT 1")], "tray": []})
    assert raw_sql.status_code == 200 and "sql" not in raw_sql.json()["cards"][0]  # trường lạ bị bỏ, không có SQL tự do


def test_render_runs_canonical_sql_through_verifier(eng):
    r = client.post("/api/db/1/dashboards/render", json=card(dimension="month", chart="line", period="2017"), headers=eng).json()
    assert r["status"] == "ok" and r["verdict"] == "green" and len(r["rows"]) == 12
    assert "2017-01-01" in r["sql"] and r["metric"]["version"] >= 1


def test_agent_streams_steps_and_drops_invalid_cards(eng):
    events = draft(eng, goal="so_sanh")
    steps = [e for e in events if e["type"] == "step"]
    assert steps[0]["id"] == "read" and steps[1]["id"] == "plan"
    dropped = [s for s in steps if s["status"] == "fail"]
    assert any("Tỉ lệ phí vận chuyển" in s["detail"] for s in dropped)  # mock đề xuất chỉ số nháp, bước kiểm loại nó
    done = events[-1]
    assert done["type"] == "done" and done["cards"] and all(c["metric_id"] != "freight_ratio" for c in done["cards"])
    assert client.get("/api/db/1/dashboards/eval", headers=eng).json()["cards"] == []  # chưa tự vào dashboard


def test_focus_puts_mentioned_metric_first(eng):
    done = draft(eng, focus="tỉ lệ hủy", audience="lanh_dao")[-1]
    assert done["cards"][0]["metric_id"] == "cancel_rate" and len(done["cards"]) <= 4


def test_dashboard_is_engineer_only():
    assert client.get("/api/db/1/dashboards/eval", headers=login("analyst@lvda.dev")).status_code == 403


def test_chart_kinds_follow_metric_shape():
    gmv = {"name_vi": "Doanh thu gộp", "format": "currency", "canonical_sql": "SELECT SUM(o.payment_value) AS gmv FROM mart.fct_orders AS o"}
    late = {"name_vi": "Tỉ lệ giao trễ", "format": "percent", "canonical_sql": "SELECT AVG(CASE WHEN o.late THEN 1 ELSE 0 END) AS r FROM mart.fct_orders AS o"}
    assert dashboard.chart_problem(None, "gauge", late) is None
    assert dashboard.chart_problem(None, "gauge", gmv)  # đồng hồ cần thang cố định
    assert dashboard.chart_problem("month", "cumulative", gmv) is None
    assert dashboard.chart_problem("month", "cumulative", late)  # tỉ lệ không cộng dồn được
    assert dashboard.chart_problem("customer_state", "stacked", late)
    assert dashboard.chart_problem("customer_state", "donut", gmv) is None
    assert dashboard.chart_problem("month", "donut", gmv)
    assert dashboard.chart_problem("customer_state", "heat", gmv)


def test_old_system_cards_map_to_new_ones(eng):
    from lvda import db
    old = [{"id": i, "size": "m", "collapsed": False} for i in ("sys:queue", "sys:kpis", "sys:per_day", "sys:top_rules", "sys:by_metric", "sys:verifier")]
    db.execute("""INSERT INTO app.dashboards (database_id, key, layout, cards, tray) VALUES (1, 'eval', %s, '[]', '[]')
                  ON CONFLICT (database_id, key) DO UPDATE SET layout = EXCLUDED.layout""", (db.jsonb(old),))
    board = client.get("/api/db/1/dashboards/eval", headers=eng).json()
    ids = [i["id"] for i in board["layout"]]
    assert ids[:6] == ["sys:attention", "sys:kpis", "sys:trend", "sys:rules", "sys:heatmap", "sys:verifier"]
    assert set(ids) == dashboard.SYSTEM_IDS
    r = client.put("/api/db/1/dashboards/eval", json={"layout": board["layout"], "cards": [], "tray": []}, headers=eng)
    assert r.status_code == 200


def test_render_sorts_ascending_and_compares_same_period(eng):
    top = client.post("/api/db/1/dashboards/render", headers=eng,
                      json=card(dimension="customer_state", chart="bar", period="2018", top=3, sort="asc")).json()
    vals = [float(r[1]) for r in top["rows"]]
    assert top["status"] == "ok" and vals == sorted(vals) and len(vals) == 3
    num = client.post("/api/db/1/dashboards/render", headers=eng, json=card(period="2018", compare=True)).json()
    assert num["previous"] and num["previous"]["label"].startswith("cùng kỳ 2017") and len(num["previous"]["rows"]) == 1
    month = client.post("/api/db/1/dashboards/render", headers=eng, json=card(dimension="month", chart="area", period="2018", compare=True)).json()
    assert len(month["previous"]["rows"]) == 12
    off = client.post("/api/db/1/dashboards/render", headers=eng, json=card(period="2017", compare=True)).json()
    assert off["previous"] is None  # 2017 không có kỳ trước trong dữ liệu
