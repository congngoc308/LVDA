"""Test bộ kiểm định trên database thật (cần docker compose up + bootstrap)."""

import pytest
import yaml

from lvda import config
from lvda.catalog import get_catalog
from lvda.verifier import verify

METRICS = {m["id"]: m for m in yaml.safe_load(config.METRICS_YML.read_text(encoding="utf-8"))}


@pytest.fixture(scope="module")
def cat():
    return get_catalog()


def rules_of(res):
    return {f["rule"] for f in res["findings"]}


@pytest.mark.parametrize("mid", [m for m in METRICS if METRICS[m]["status"] == "certified"])
def test_canonical_is_green(cat, mid):
    res = verify(METRICS[mid]["canonical_sql"], cat, METRICS[mid])
    assert res["verdict"] == "green", res["findings"]


def test_draft_metric_is_yellow(cat):
    m = METRICS["freight_ratio"]
    assert verify(m["canonical_sql"], cat, m)["verdict"] == "yellow"


def test_v02_v03_payment_value_for_gmv(cat):
    sql = "SELECT SUM(p.payment_value) FROM mart.fct_payments p JOIN mart.fct_orders o ON o.order_id = p.order_id"
    res = verify(sql, cat, METRICS["gmv"])
    assert {"V02", "V03"} <= rules_of(res) and res["verdict"] == "red"


def test_v04_filter_value(cat):
    sql = METRICS["gmv"]["canonical_sql"].replace("= 'delivered'", "IN ('delivered', 'shipped')")
    assert "V04" in rules_of(verify(sql, cat, METRICS["gmv"]))


def test_v05_fanout_and_fix(cat):
    base = """SELECT p.payment_type, SUM(i.price + i.freight_value) AS gmv
              FROM mart.fct_order_items i JOIN mart.fct_orders o ON o.order_id = i.order_id
              JOIN mart.fct_payments p ON p.order_id = o.order_id
              WHERE o.order_status = 'delivered' {extra} GROUP BY p.payment_type"""
    assert "V05" in rules_of(verify(base.format(extra=""), cat, METRICS["gmv"]))
    fixed = verify(base.format(extra="AND p.payment_sequential = 1"), cat, METRICS["gmv"])
    assert fixed["verdict"] == "green", fixed["findings"]


def test_v05_avg_on_parent_with_child_join(cat):
    sql = """SELECT AVG(CASE WHEN o.delivered_at > o.estimated_at THEN 1.0 ELSE 0.0 END)
             FROM mart.fct_orders o JOIN mart.fct_order_items i ON i.order_id = o.order_id
             WHERE o.order_status = 'delivered'"""
    assert "V05" in rules_of(verify(sql, cat, METRICS["late_delivery_rate"]))


def test_v06_count_without_distinct(cat):
    sql = "SELECT COUNT(o.order_id) FROM mart.fct_orders o WHERE o.order_status NOT IN ('canceled','unavailable')"
    assert "V06" in rules_of(verify(sql, cat, METRICS["order_count"]))


def test_v07_customer_id(cat):
    sql = "SELECT COUNT(DISTINCT o.customer_id) FROM mart.fct_orders o WHERE o.order_status NOT IN ('canceled','unavailable')"
    res = verify(sql, cat, METRICS["customer_count"])
    assert "V07" in rules_of(res) and "V02" not in rules_of(res)


def test_v08_time_column(cat):
    sql = METRICS["late_delivery_rate"]["canonical_sql"] + " AND o.delivered_at >= '2018-03-01' AND o.delivered_at < '2018-04-01'"
    assert "V08" in rules_of(verify(sql, cat, METRICS["late_delivery_rate"]))


def test_v09_geolocation_join(cat):
    sql = """SELECT g.state, COUNT(DISTINCT c.customer_unique_id) FROM mart.dim_customers c
             JOIN mart.dim_geolocation g ON g.zip_code_prefix = c.zip_code_prefix GROUP BY g.state"""
    assert "V09" in rules_of(verify(sql, cat, None))


def test_v01_unknown_column(cat):
    assert "V01" in rules_of(verify("SELECT SUM(o.total_amount) FROM mart.fct_orders o", cat, None))


def test_v10_pii_rows(cat):
    assert "V10" in rules_of(verify("SELECT o.customer_unique_id, o.customer_city FROM mart.fct_orders o", cat, None))


def test_v11_deprecated(cat):
    assert "V11" in rules_of(verify("SELECT COUNT(DISTINCT v.order_id) FROM mart.fct_orders_v1 v", cat, None))


def test_pre_aggregated_cte_is_green(cat):
    sql = """WITH items AS (
               SELECT i.order_id, SUM(i.price + i.freight_value) AS gmv FROM mart.fct_order_items i GROUP BY i.order_id)
             SELECT p.payment_type, SUM(x.gmv) AS gmv
             FROM items x JOIN mart.fct_orders o ON o.order_id = x.order_id
             JOIN mart.fct_payments p ON p.order_id = o.order_id AND p.payment_sequential = 1
             WHERE o.order_status = 'delivered' GROUP BY p.payment_type"""
    res = verify(sql, cat, METRICS["gmv"])
    assert res["verdict"] == "green", res["findings"]


@pytest.mark.parametrize("sql", [
    "DELETE FROM raw.orders",
    "SELECT 1; SELECT 2",
    "SELECT * FROM app.users",
    "SELECT pg_sleep(5)",
    "SELECT * FROM pg_user",
    "INSERT INTO raw.orders VALUES ('x')",
])
def test_guard_blocks(cat, sql):
    assert verify(sql, cat, None)["verdict"] == "blocked"


def test_parse_error_is_yellow(cat):
    res = verify("SELEC FROM", cat, None)
    assert res["verdict"] in ("yellow", "blocked")
