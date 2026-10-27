"""VER-02: mỗi luật có ít nhất 3 test dương (phải bắn) và 3 test âm (không được bắn)."""

import pytest
import yaml

from lvda import config
from lvda.catalog import get_catalog
from lvda.verifier import verify

METRICS = {m["id"]: {**m, "status": "certified"} for m in yaml.safe_load(config.METRICS_YML.read_text(encoding="utf-8"))}
GMV, OC, CC, LATE, REV = (METRICS[k]["canonical_sql"] for k in ("gmv", "order_count", "customer_count", "late_delivery_rate", "avg_review_score"))
ITEMS_O = "FROM mart.fct_order_items i JOIN mart.fct_orders o ON o.order_id = i.order_id"

MATRIX: dict[str, dict[str, list[tuple[str, str | None]]]] = {
    "V01": {
        "pos": [("SELECT SUM(o.total_amount) FROM mart.fct_orders o", None), ("SELECT COUNT(*) FROM mart.fct_sales s", None),
                ("SELECT SUM(i.discount) FROM mart.fct_order_items i", None)],
        "neg": [(GMV, "gmv"), (OC, "order_count"), ("SELECT COUNT(*) FROM mart.fct_orders o", None)],
    },
    "V02": {
        "pos": [("SELECT SUM(p.payment_value) FROM mart.fct_payments p JOIN mart.fct_orders o ON o.order_id = p.order_id WHERE o.order_status = 'delivered'", "gmv"),
                (f"SELECT SUM(i.price) {ITEMS_O} WHERE o.order_status = 'delivered'", "gmv"),
                ("SELECT SUM(o.payment_amount) FROM mart.fct_orders o WHERE o.order_status = 'delivered'", "gmv")],
        "neg": [(GMV, "gmv"), ("SELECT SUM(o.gmv) FROM mart.fct_orders o WHERE o.order_status = 'delivered'", "gmv"),
                (f"SELECT o.customer_state, SUM(i.price + i.freight_value) {ITEMS_O} WHERE o.order_status = 'delivered' GROUP BY 1", "gmv")],
    },
    "V03": {
        "pos": [(f"SELECT SUM(i.price + i.freight_value) {ITEMS_O}", "gmv"), ("SELECT COUNT(DISTINCT o.order_id) FROM mart.fct_orders o", "order_count"),
                ("SELECT AVG(r.review_score) FROM mart.fct_reviews r", "avg_review_score")],
        "neg": [(GMV, "gmv"), (OC, "order_count"), (REV, "avg_review_score")],
    },
    "V04": {
        "pos": [(GMV.replace("= 'delivered'", "IN ('delivered', 'shipped')"), "gmv"), (OC.replace("NOT IN ('canceled', 'unavailable')", "<> 'canceled'"), "order_count"),
                (REV.replace("= TRUE", "= FALSE"), "avg_review_score")],
        "neg": [(GMV + " AND o.customer_state = 'SP'", "gmv"), (OC.replace("('canceled', 'unavailable')", "('unavailable', 'canceled')"), "order_count"),
                ("SELECT AVG(r.review_score) FROM mart.fct_reviews r WHERE r.is_latest", "avg_review_score")],
    },
    "V05": {
        "pos": [(f"SELECT SUM(i.price + i.freight_value) {ITEMS_O} JOIN mart.fct_payments p ON p.order_id = o.order_id WHERE o.order_status = 'delivered'", "gmv"),
                (LATE.replace("FROM mart.fct_orders AS o", "FROM mart.fct_orders AS o JOIN mart.fct_order_items AS i ON i.order_id = o.order_id"), "late_delivery_rate"),
                ("SELECT AVG(r.review_score) FROM mart.fct_reviews r JOIN mart.fct_orders o ON o.order_id = r.order_id "
                 "JOIN mart.fct_order_items i ON i.order_id = o.order_id WHERE r.is_latest", "avg_review_score")],
        "neg": [(f"SELECT SUM(i.price + i.freight_value) {ITEMS_O} JOIN mart.fct_payments p ON p.order_id = o.order_id AND p.payment_sequential = 1 WHERE o.order_status = 'delivered'", "gmv"),
                ("WITH x AS (SELECT i.order_id, SUM(i.price + i.freight_value) AS v FROM mart.fct_order_items i GROUP BY i.order_id) "
                 "SELECT SUM(x.v) FROM x JOIN mart.fct_orders o ON o.order_id = x.order_id JOIN mart.fct_payments p ON p.order_id = o.order_id "
                 "AND p.payment_sequential = 1 WHERE o.order_status = 'delivered'", "gmv"),
                (f"SELECT COUNT(DISTINCT o.order_id) {ITEMS_O} WHERE o.order_status NOT IN ('canceled', 'unavailable')", "order_count")],
    },
    "V06": {
        "pos": [(OC.replace("COUNT(DISTINCT ", "COUNT("), "order_count"), (GMV.replace("SUM(", "AVG("), "gmv"),
                (CC.replace("COUNT(DISTINCT ", "COUNT("), "customer_count")],
        "neg": [(OC, "order_count"), (GMV, "gmv"), (CC, "customer_count")],
    },
    "V07": {
        "pos": [(CC.replace("customer_unique_id", "customer_id"), "customer_count"),
                ("SELECT COUNT(DISTINCT o.customer_id) FROM mart.fct_orders o", None),
                ("SELECT COUNT(DISTINCT o.customer_id) FROM raw.orders o", None)],
        "neg": [(CC, "customer_count"), (OC, "order_count"), ("SELECT COUNT(DISTINCT c.customer_unique_id) FROM mart.dim_customers c", None)],
    },
    "V08": {
        "pos": [(LATE + " AND o.delivered_at >= '2018-01-01' AND o.delivered_at < '2018-02-01'", "late_delivery_rate"),
                ("SELECT DATE_TRUNC('month', o.delivered_at), AVG(CASE WHEN o.delivered_at > o.estimated_at THEN 1.0 ELSE 0.0 END) "
                 "FROM mart.fct_orders o WHERE o.order_status = 'delivered' GROUP BY 1", "late_delivery_rate"),
                (GMV + " AND o.approved_at >= '2018-01-01'", "gmv")],
        "neg": [(LATE + " AND o.purchased_at >= '2018-01-01' AND o.purchased_at < '2018-02-01'", "late_delivery_rate"), (LATE, "late_delivery_rate"),
                ("SELECT DATE_TRUNC('month', o.purchased_at), AVG(CASE WHEN o.delivered_at > o.estimated_at THEN 1.0 ELSE 0.0 END) "
                 "FROM mart.fct_orders o WHERE o.order_status = 'delivered' GROUP BY 1", "late_delivery_rate")],
    },
    "V09": {
        "pos": [("SELECT g.state, COUNT(*) FROM mart.dim_customers c JOIN mart.dim_geolocation g ON g.zip_code_prefix = c.zip_code_prefix GROUP BY 1", None),
                ("SELECT s.state, COUNT(*) FROM mart.dim_sellers s JOIN mart.dim_customers c ON c.state = s.state GROUP BY 1", None),
                ("SELECT COUNT(*) FROM mart.fct_order_items i JOIN mart.fct_payments p ON p.payment_sequential = i.order_item_id", None)],
        "neg": [(GMV, "gmv"), ("SELECT COUNT(*) FROM mart.fct_orders o JOIN mart.dim_customers c ON c.customer_unique_id = o.customer_unique_id", None),
                ("SELECT COUNT(*) FROM mart.fct_order_items i JOIN mart.dim_products p ON p.product_id = i.product_id", None)],
    },
    "V10": {
        "pos": [("SELECT o.customer_unique_id FROM mart.fct_orders o", None), ("SELECT g.lat, g.lng FROM mart.dim_geolocation g", None),
                ("SELECT r.comment FROM mart.fct_reviews r", None)],
        "neg": [(CC, "customer_count"), ("SELECT o.customer_state FROM mart.fct_orders o", None),
                ("SELECT o.customer_state, COUNT(DISTINCT o.customer_unique_id) FROM mart.fct_orders o GROUP BY 1", None)],
    },
    "V11": {
        "pos": [("SELECT COUNT(*) FROM mart.fct_orders_v1 v", None), ("SELECT v.order_status FROM mart.fct_orders_v1 v", None),
                ("SELECT COUNT(DISTINCT v.order_id) FROM mart.fct_orders_v1 v WHERE v.order_status = 'delivered'", None)],
        "neg": [("SELECT COUNT(*) FROM mart.fct_orders o", None), (OC, "order_count"), (GMV, "gmv")],
    },
    "V12": {
        "pos": [("SELEC FROM", None), ("SELECT * FROM mart.fct_orders o WHERE (", None), ("SELECT COUNT(* FROM mart.fct_orders", None)],
        "neg": [(GMV, "gmv"), (OC, "order_count"), ("SELECT 1", None)],
    },
}


@pytest.fixture(scope="module")
def cat():
    return get_catalog()


def test_matrix_has_three_each():
    assert set(MATRIX) == {f"V{i:02d}" for i in range(1, 13)}
    for rule, cases in MATRIX.items():
        assert len(cases["pos"]) >= 3 and len(cases["neg"]) >= 3, rule


CASES = [(rule, kind, sql, mid) for rule, d in MATRIX.items() for kind in ("pos", "neg") for sql, mid in d[kind]]


@pytest.mark.parametrize("rule,kind,sql,metric_id", CASES, ids=[f"{r}-{k}-{i}" for i, (r, k, _, _) in enumerate(CASES)])
def test_rule(cat, rule, kind, sql, metric_id):
    res = verify(sql, cat, METRICS[metric_id] if metric_id else None)
    fired = {f["rule"] for f in res["findings"] if f["severity"] != "info"}
    if kind == "pos":
        assert rule in fired, (sql, fired)
    else:
        assert rule not in fired, (sql, fired)
