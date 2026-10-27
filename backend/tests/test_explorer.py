"""Danh mục dữ liệu ở quy mô lớn: warehouse 500 bảng, lineage từng lớp, tìm kiếm, vùng lân cận có trần, tin cậy, tác động."""

import pytest
from fastapi.testclient import TestClient

from lvda import db, explorer
from lvda.catalog import catalog_for, is_catalog_only
from lvda.main import app
from lvda.seed.enterprise import plan, singular

client = TestClient(app)


@pytest.fixture(scope="module")
def big_id() -> int:
    row = db.fetch_one("SELECT id FROM app.databases WHERE settings ? 'warehouse'")
    assert row, "bootstrap phải dựng warehouse 500 bảng"
    return row["id"]


def login(email: str) -> dict:
    tok = client.post("/api/auth/login", json={"email": email, "password": "lvda1234"}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}


def test_plan_has_500_tables_in_three_layers():
    p = plan()
    stg = [v for v in p["views"] if v.startswith("ent_stg.")]
    mart = [v for v in p["views"] if v.startswith("ent_mart.")]
    assert (len(p["raw"]), len(stg), len(mart)) == (200, 160, 140)
    assert singular("categories") == "category" and singular("addresses") == "address" and singular("searches") == "search"


def test_crawled_lineage_goes_layer_by_layer(big_id):
    cat = catalog_for(big_id)
    assert len(cat.columns) == 500
    views_with_lineage = {c.rsplit(".", 1)[0] for c in cat.direct_lineage}
    assert set(cat.view_sql) == views_with_lineage  # mọi view đều parse được
    # mart → stg (một bước), → raw (bắc cầu), kể cả khi khác miền
    assert cat.direct_lineage["ent_mart.fct_sales_orders.account_name"] == ["ent_stg.stg_customer_accounts_erp.name"]
    assert cat.mart_lineage["ent_mart.fct_sales_orders.account_name"] == ["ent_raw.customer_accounts_erp.name"]
    idx = explorer.index(big_id)
    assert idx.layer["ent_raw.sales_orders_erp"] == 0
    assert idx.layer["ent_stg.stg_sales_orders_erp"] == 1
    assert idx.layer["ent_mart.fct_sales_orders"] == 2
    assert len(idx.domains) == 10 and idx.domain["ent_mart.fct_sales_orders"] == "sales"


def test_search_ranks_exact_name_first_and_ignores_diacritics(big_id):
    r = explorer.search(big_id, "fct_sales_orders")
    assert r["items"][0]["name"] == "ent_mart.fct_sales_orders" and r["items"][0]["kind"] == "table"
    r = explorer.search(1, "phi van chuyen")  # mô tả tiếng Việt "phí vận chuyển", gõ không dấu
    assert {i.get("column") for i in r["items"]} >= {"freight_value"}
    r = explorer.search(big_id, "", domain="hr", limit=100)
    assert r["total"] == 50 and all(i["domain_label"] == "Nhân sự" for i in r["items"])
    assert explorer.search(big_id, "", tags=("deprecated",))["total"] == 20


def test_search_counts_by_layer_before_the_layer_filter(big_id):
    every = explorer.search(big_id, "")
    assert every["by_layer"] == {"0": 200, "1": 160, "2": 140} and every["total"] == 500
    marts = explorer.search(big_id, "", layer=2)
    assert marts["total"] == 140 and marts["by_layer"] == every["by_layer"]  # tab lớp vẫn thấy số của các lớp khác


def test_lineage_neighbourhood_is_capped(big_id, monkeypatch):
    center = "ent_stg.stg_customer_accounts_erp"
    full = explorer.lineage(big_id, [center])
    assert full["more"] == {} and len(full["tables"]) == 1 + len(explorer.index(big_id).parents[center] | explorer.index(big_id).children[center])
    monkeypatch.setattr(explorer, "CAP", 3)
    capped = explorer.lineage(big_id, [center])
    assert len(capped["tables"]) == 4 and capped["more"][center] == len(full["tables"]) - 4
    assert len(explorer.lineage(big_id, [center], {center})["tables"]) == len(full["tables"])  # "xem hết" bỏ trần


def test_trace_pulls_the_whole_column_path_into_view(big_id):
    center = "ent_mart.fct_sales_orders"
    plain = {t["name"] for t in explorer.lineage(big_id, [center])["tables"]}
    assert "ent_raw.customer_accounts_erp" not in plain  # cách hai bước
    traced = {t["name"] for t in explorer.lineage(big_id, [center], trace=f"{center}.account_name")["tables"]}
    assert {"ent_stg.stg_customer_accounts_erp", "ent_raw.customer_accounts_erp"} <= traced


def test_trust_and_impact_on_olist():
    h = login("engineer@lvda.dev")
    client.post("/api/db/1/ask", json={"question": "Giá trị đơn trung bình là bao nhiêu?"}, headers=h)
    explorer.invalidate(1)
    t = explorer.trust(1, "mart.fct_order_items")
    assert t["questions"] >= 1 and t["green"] >= 1
    assert any(m["id"] == "aov" and m["status"] == "certified" for m in t["metrics"])
    imp = explorer.impact(1, "mart.stg_order_items")
    assert {"mart.fct_orders", "mart.fct_order_items"} <= {x["name"] for x in imp["tables"]}
    assert any(m["id"] == "gmv" for m in imp["metrics"])
    col = explorer.impact(1, "raw.order_items", "price")
    assert "mart.fct_order_items" in {x["name"] for x in col["tables"]} and col["columns"] >= 2


def test_explore_api_permissions_and_catalog_only_guard(big_id):
    viewer = login("analyst@lvda.dev")
    assert client.get(f"/api/db/{big_id}/explore/home", headers=viewer).status_code == 200
    assert client.get(f"/api/db/{big_id}/explore/table/ent_raw.nope", headers=viewer).status_code == 404
    r = client.get(f"/api/db/{big_id}/explore/column/ent_stg.stg_customer_accounts_erp/email", headers=viewer).json()
    assert r["pii"] is True and r["parents"] == ["ent_raw.customer_accounts_erp.email"]
    assert is_catalog_only(big_id) and not is_catalog_only(1)
    assert client.post(f"/api/db/{big_id}/ask", json={"question": "doanh thu"}, headers=viewer).status_code == 409
    assert client.get("/api/db/1/explore/home", headers=login("guest@lvda.dev")).status_code in (403, 404)
