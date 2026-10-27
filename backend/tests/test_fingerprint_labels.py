"""VER-01: trích lineage của câu trả lời đúng 100% trên 30 câu SQL có nhãn viết tay.

Mỗi ca chỉ ghi các trường cần kiểm: cột đo, hàm tổng hợp, bộ lọc, join, group by, cột thời gian, LIMIT.
"""

import pytest

from lvda.catalog import get_catalog
from lvda.verifier import verify

O, I, P, R = "mart.fct_orders", "mart.fct_order_items", "mart.fct_payments", "mart.fct_reviews"


def c(t, col):
    return f"{t}.{col}"


CASES = [
    ("SELECT SUM(i.price) FROM mart.fct_order_items i",
     {"measure_columns": {c(I, "price")}, "aggs": {("SUM", False)}}),
    ("SELECT SUM(i.price + i.freight_value) AS g FROM mart.fct_order_items i JOIN mart.fct_orders o ON o.order_id = i.order_id WHERE o.order_status = 'delivered'",
     {"measure_columns": {c(I, "price"), c(I, "freight_value")}, "filters": {(c(O, "order_status"), "=", "delivered")},
      "joins": {frozenset({c(I, "order_id"), c(O, "order_id")})}}),
    ("SELECT COUNT(DISTINCT o.order_id) FROM mart.fct_orders o",
     {"measure_columns": {c(O, "order_id")}, "aggs": {("COUNT", True)}}),
    ("SELECT COUNT(*) FROM mart.fct_orders o", {"aggs": {("COUNT", False)}, "measure_columns": set()}),
    ("SELECT AVG(r.review_score) FROM mart.fct_reviews r WHERE r.is_latest",
     {"measure_columns": {c(R, "review_score")}, "filters": {(c(R, "is_latest"), "=", True)}, "aggs": {("AVG", False)}}),
    ("SELECT AVG(r.review_score) FROM mart.fct_reviews r WHERE r.is_latest = TRUE",
     {"filters": {(c(R, "is_latest"), "=", True)}}),
    ("SELECT o.customer_state, COUNT(DISTINCT o.customer_unique_id) FROM mart.fct_orders o GROUP BY o.customer_state",
     {"group_by": {c(O, "customer_state")}, "measure_columns": {c(O, "customer_unique_id")}}),
    ("SELECT SUM(p.payment_value) FROM mart.fct_payments p WHERE p.payment_type IN ('voucher', 'boleto')",
     {"filters": {(c(P, "payment_type"), "in", ("boleto", "voucher"))}}),
    ("SELECT COUNT(*) FROM mart.fct_orders o WHERE o.order_status NOT IN ('canceled', 'unavailable')",
     {"filters": {(c(O, "order_status"), "not in", ("canceled", "unavailable"))}}),
    ("SELECT COUNT(*) FROM mart.fct_orders o WHERE o.order_status <> 'canceled'",
     {"filters": {(c(O, "order_status"), "<>", "canceled")}}),
    ("SELECT COUNT(*) FROM mart.fct_orders o WHERE o.purchased_at >= '2018-01-01' AND o.purchased_at < '2018-02-01'",
     {"time_columns": {c(O, "purchased_at")}, "filters": {(c(O, "purchased_at"), ">=", "2018-01-01"), (c(O, "purchased_at"), "<", "2018-02-01")}}),
    ("SELECT COUNT(*) FROM mart.fct_orders o WHERE o.purchased_at BETWEEN '2018-01-01' AND '2018-03-31'",
     {"time_columns": {c(O, "purchased_at")}, "filters": {(c(O, "purchased_at"), "between", ("2018-01-01", "2018-03-31"))}}),
    ("SELECT DATE_TRUNC('month', o.delivered_at) AS m, COUNT(*) FROM mart.fct_orders o GROUP BY 1",
     {"time_columns": {c(O, "delivered_at")}, "group_by": {c(O, "delivered_at")}}),
    ("SELECT o.order_id FROM mart.fct_orders o LIMIT 10", {"limit": 10, "aggs": set()}),
    ("SELECT o.customer_state, SUM(o.gmv) AS g FROM mart.fct_orders o GROUP BY o.customer_state ORDER BY g DESC LIMIT 5",
     {"limit": 5, "measure_columns": {c(O, "gmv")}, "group_by": {c(O, "customer_state")}}),
    ("SELECT SUM(i.price) FROM mart.fct_order_items i JOIN mart.fct_payments p ON p.order_id = i.order_id",
     {"joins": {frozenset({c(I, "order_id"), c(P, "order_id")})}}),
    ("WITH x AS (SELECT i.order_id, SUM(i.price) AS v FROM mart.fct_order_items i GROUP BY i.order_id) SELECT SUM(x.v) FROM x",
     {"measure_columns": {c(I, "price")}, "group_by": {c(I, "order_id")}}),
    ("WITH x AS (SELECT i.order_id, SUM(i.price) AS v FROM mart.fct_order_items i GROUP BY i.order_id) "
     "SELECT o.customer_state, SUM(x.v) FROM x JOIN mart.fct_orders o ON o.order_id = x.order_id GROUP BY o.customer_state",
     {"joins": {frozenset({c(I, "order_id"), c(O, "order_id")})}, "group_by": {c(I, "order_id"), c(O, "customer_state")}}),
    ("SELECT SUM(t.v) FROM (SELECT i.price AS v FROM mart.fct_order_items i) t",
     {"measure_columns": {c(I, "price")}}),
    ("SELECT MAX(i.price), MIN(i.price) FROM mart.fct_order_items i",
     {"aggs": {("MAX", False), ("MIN", False)}}),
    ("SELECT AVG(CASE WHEN o.delivered_at > o.estimated_at THEN 1.0 ELSE 0.0 END) FROM mart.fct_orders o WHERE o.order_status = 'delivered'",
     {"measure_columns": {c(O, "delivered_at"), c(O, "estimated_at")}, "time_columns": set()}),
    ("SELECT o.order_status, COUNT(*) FROM mart.fct_orders o GROUP BY o.order_status HAVING COUNT(*) > 10",
     {"group_by": {c(O, "order_status")}}),
    ("SELECT COUNT(*) FROM mart.fct_orders o WHERE o.delivered_at IS NULL",
     {"filters": {(c(O, "delivered_at"), "is null", None)}}),
    ("SELECT COUNT(*) FROM mart.fct_orders o WHERE o.customer_city LIKE 'sao%'",
     {"filters": {(c(O, "customer_city"), "like", "sao%")}}),
    ("SELECT SUM(i.price) FROM mart.fct_order_items i JOIN mart.dim_sellers s ON s.seller_id = i.seller_id WHERE s.state = 'SP'",
     {"joins": {frozenset({c(I, "seller_id"), "mart.dim_sellers.seller_id"})}, "filters": {("mart.dim_sellers.state", "=", "SP")}}),
    ("SELECT COUNT(DISTINCT c.customer_unique_id) FROM mart.dim_customers c",
     {"measure_columns": {"mart.dim_customers.customer_unique_id"}}),
    ("SELECT SUM(oi.price) FROM raw.order_items oi JOIN raw.orders o ON o.order_id = oi.order_id WHERE o.order_status = 'delivered'",
     {"measure_columns": {"raw.order_items.price"}, "filters": {("raw.orders.order_status", "=", "delivered")}}),
    ("SELECT SUM(price) FROM fct_order_items",
     {"measure_columns": {c(I, "price")}}),
    ("SELECT p.payment_type, SUM(p.payment_value) FROM mart.fct_payments p WHERE p.payment_sequential = 1 GROUP BY p.payment_type",
     {"filters": {(c(P, "payment_sequential"), "=", 1)}, "group_by": {c(P, "payment_type")}}),
    ("SELECT COUNT(*) FROM mart.fct_orders o WHERE NOT o.order_status = 'canceled'",
     {"filters": {(c(O, "order_status"), "<>", "canceled")}}),
]


def norm_value(v):
    if isinstance(v, list):
        return tuple(sorted(str(x) for x in v))
    return v


@pytest.fixture(scope="module")
def cat():
    return get_catalog()


def test_thirty_cases():
    assert len(CASES) == 30


@pytest.mark.parametrize("sql,expect", CASES)
def test_fingerprint_matches_hand_label(cat, sql, expect):
    fp = verify(sql, cat, None)["fingerprint"]
    assert fp is not None, sql
    if "measure_columns" in expect:
        assert set(fp["measure_columns"]) == expect["measure_columns"]
    if "aggs" in expect:
        assert {(m["agg"], m["distinct"]) for m in fp["measures"]} == expect["aggs"]
    if "filters" in expect:
        got = {(f["column"], f["op"], norm_value(f["value"])) for f in fp["filters"] if f["op"] != "expr"}
        assert expect["filters"] <= got, got
    if "joins" in expect:
        assert {frozenset((j["left"], j["right"])) for j in fp["joins"]} == expect["joins"]
    if "group_by" in expect:
        assert {col for g in fp["group_by"] for col in g["columns"]} == expect["group_by"]
    if "time_columns" in expect:
        assert set(fp["time_columns"]) == expect["time_columns"]
    if "limit" in expect:
        assert fp["limit"] == expect["limit"]
