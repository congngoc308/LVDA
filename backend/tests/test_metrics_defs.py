"""MET-02 (dấu vân tay khớp nhãn tay), MET-01 (xuất/nhập YAML không mất trường), MET-07 (nhập MetricFlow)."""

import pytest
import yaml

from lvda import db
from lvda.catalog import get_catalog
from lvda.metrics import EXPORT_FIELDS, export_yaml, get_metric, import_yaml, list_metrics, validate_yaml
from lvda.verifier import metric_analysis

O, I, P, R = "mart.fct_orders", "mart.fct_order_items", "mart.fct_payments", "mart.fct_reviews"
LABELS = {
    "gmv": ({f"{I}.price", f"{I}.freight_value"}, {("SUM", False)}, {f"{O}.order_status"}),
    "product_revenue": ({f"{I}.price"}, {("SUM", False)}, {f"{O}.order_status"}),
    "payment_total": ({f"{P}.payment_value"}, {("SUM", False)}, {f"{O}.order_status"}),
    "order_count": ({f"{O}.order_id"}, {("COUNT", True)}, {f"{O}.order_status"}),
    "aov": ({f"{I}.price", f"{I}.freight_value", f"{O}.order_id"}, {("SUM", False), ("COUNT", True)}, {f"{O}.order_status"}),
    "customer_count": ({f"{O}.customer_unique_id"}, {("COUNT", True)}, {f"{O}.order_status"}),
    "seller_count": ({f"{I}.seller_id"}, {("COUNT", True)}, {f"{O}.order_status"}),
    "late_delivery_rate": ({f"{O}.delivered_at", f"{O}.estimated_at"}, {("AVG", False)}, {f"{O}.order_status"}),
    "avg_delivery_days": ({f"{O}.delivered_at", f"{O}.purchased_at"}, {("AVG", False)}, {f"{O}.order_status"}),
    "avg_review_score": ({f"{R}.review_score"}, {("AVG", False)}, {f"{R}.is_latest"}),
    "cancel_rate": ({f"{O}.order_status"}, {("AVG", False)}, set()),
    "freight_ratio": ({f"{I}.freight_value", f"{I}.price"}, {("SUM", False)}, {f"{O}.order_status"}),
}


@pytest.mark.parametrize("metric_id", sorted(LABELS))
def test_metric_fingerprint_matches_label(metric_id):
    m = get_metric(1, metric_id)
    an = metric_analysis(m, get_catalog())
    cols, aggs, filters = LABELS[metric_id]
    assert an.measure_columns() == cols
    assert an.agg_signatures() == aggs
    assert {f["column"] for f in an.filters} == filters
    assert all(f["column"] in filters for f in m["required_filters"])


def test_export_import_roundtrip():
    exported = yaml.safe_load(export_yaml(1))
    current = {m["id"]: m for m in list_metrics(1)}
    assert len(exported) == len(current) == 12
    for spec in exported:
        for field in EXPORT_FIELDS:
            if field in current[spec["id"]]:
                assert spec[field] == current[spec["id"]][field], (spec["id"], field)
        parsed, errors = validate_yaml(yaml.safe_dump(spec, allow_unicode=True), 1)
        assert not errors and parsed["canonical_sql"] == spec["canonical_sql"]


def test_invalid_yaml_rejected_with_reason():
    _, errors = validate_yaml("id: x\nname_vi: X\nformat: weird\n", 1)
    assert any("canonical_sql" in e for e in errors) and any("format" in e for e in errors)


METRICFLOW = """
semantic_models:
  - name: orders
    model: ref('fct_orders')
    defaults:
      agg_time_dimension: purchased_at
    entities:
      - name: order_id
        type: primary
    measures:
      - name: gmv_total
        agg: sum
        expr: gmv
    dimensions:
      - name: purchased_at
        type: time
metrics:
  - name: gmv_from_orders
    label: Doanh thu gộp (từ fct_orders)
    description: Tổng cột gmv của các đơn đã giao.
    type: simple
    type_params:
      measure: gmv_total
    filter: "{{ Dimension('order_id__order_status') }} = 'delivered'"
"""


def test_import_metricflow():
    try:
        res = import_yaml(1, METRICFLOW, 1)
        assert res == [{"id": "gmv_from_orders", "ok": True, "version": 1, "errors": []}]
        m = get_metric(1, "gmv_from_orders")
        assert m["status"] == "draft"
        assert m["time_column"] == "mart.fct_orders.purchased_at"
        assert m["required_filters"] == [{"column": "mart.fct_orders.order_status", "op": "=", "value": "delivered"}]
        an = metric_analysis(m, get_catalog())
        assert an.measure_columns() == {"mart.fct_orders.gmv"}
    finally:
        db.execute("DELETE FROM app.metric_versions WHERE metric_id = 'gmv_from_orders'")
        db.execute("DELETE FROM app.metrics WHERE id = 'gmv_from_orders'")
