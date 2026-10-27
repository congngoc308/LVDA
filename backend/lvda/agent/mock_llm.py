"""LLM giả lập: dựng SQL từ định nghĩa chỉ số, có thể cố tình mắc các lỗi điển hình của text-to-SQL.

Bộ kiểm định và vòng tự sửa là thật; chỉ phần "viết SQL" ở đây là mock.
Khi gắn LLM thật, thay generate()/fix() bằng lời gọi model, giữ nguyên đầu vào/đầu ra.
"""

from __future__ import annotations

import sqlglot
from sqlglot import exp

ALIAS = {"mart.fct_orders": "o", "mart.fct_order_items": "i", "mart.fct_payments": "p",
         "mart.fct_reviews": "r", "mart.dim_sellers": "s"}
JOINS = {
    "o": ("mart.fct_orders AS o", "o.order_id = r.order_id"),  # chỉ cần khi gốc là reviews
    "i": ("mart.fct_order_items AS i", "i.order_id = o.order_id"),
    "p": ("mart.fct_payments AS p", "p.order_id = o.order_id"),
    "s": ("mart.dim_sellers AS s", "s.seller_id = i.seller_id"),
}
DIM_EXPR = {
    "customer_state": ("o", "o.customer_state"),
    "category": ("i", "COALESCE(i.category, 'unknown')"),
    "payment_type": ("p", "p.payment_type"),
    "seller_state": ("s", "s.state"),
}

# Lỗi điển hình mà LLM hay mắc, theo từng chỉ số (dùng ở lần thử đầu khi bật "mô phỏng LLM hay sai").
WRONG_BASE = {
    "gmv": ("SELECT SUM(p.payment_value) AS gmv FROM mart.fct_payments AS p "
            "JOIN mart.fct_orders AS o ON o.order_id = p.order_id",
            "Lấy tiền thanh toán làm doanh thu và quên lọc đơn đã giao"),
    "product_revenue": ("SELECT SUM(p.payment_value) AS product_revenue FROM mart.fct_payments AS p "
                        "JOIN mart.fct_orders AS o ON o.order_id = p.order_id WHERE o.order_status = 'delivered'",
                        "Lấy tiền thanh toán làm tiền hàng"),
    "aov": ("SELECT AVG(p.payment_value) AS aov FROM mart.fct_payments AS p "
            "JOIN mart.fct_orders AS o ON o.order_id = p.order_id WHERE o.order_status = 'delivered'",
            "Lấy trung bình mỗi lần thanh toán thay vì mỗi đơn"),
    "order_count": ("SELECT COUNT(o.order_id) AS order_count FROM mart.fct_orders AS o",
                    "Đếm không DISTINCT và quên loại đơn hủy"),
    "customer_count": ("SELECT COUNT(DISTINCT o.customer_id) AS customer_count FROM mart.fct_orders AS o "
                       "WHERE o.order_status NOT IN ('canceled', 'unavailable')",
                       "Đếm khách theo customer_id"),
    "seller_count": ("SELECT COUNT(i.seller_id) AS seller_count FROM mart.fct_order_items AS i "
                     "JOIN mart.fct_orders AS o ON o.order_id = i.order_id WHERE o.order_status NOT IN ('canceled', 'unavailable')",
                     "Đếm người bán không DISTINCT"),
    "avg_review_score": ("SELECT AVG(r.review_score) AS avg_review_score FROM mart.fct_reviews AS r",
                         "Tính cả các đánh giá cũ của cùng một đơn"),
    "freight_ratio": ("SELECT SUM(i.freight_value) / SUM(i.price) AS freight_ratio FROM mart.fct_order_items AS i "
                      "JOIN mart.fct_orders AS o ON o.order_id = i.order_id",
                      "Quên lọc đơn đã giao"),
}
WRONG_TIME = {"late_delivery_rate", "avg_delivery_days"}  # hay chia tháng theo ngày giao thay vì ngày đặt


def _short_time(metric: dict, wrong: bool) -> str:
    table, _, col = metric["time_column"].rpartition(".")
    alias = ALIAS.get(table, "o")
    if wrong:
        return f"{alias}.delivered_at"
    return f"{alias}.{col}"


def supports(metric: dict, dimension: str | None) -> bool:
    if dimension in (None, "month", "customer_state", "payment_type"):
        return True
    base_aliases = {t.alias_or_name for t in sqlglot.parse_one(metric["canonical_sql"], read="postgres").find_all(exp.Table)}
    distinct_count = "COUNT(DISTINCT" in metric["canonical_sql"].upper()
    return "i" in base_aliases or distinct_count


def build(metric: dict, interp: dict, *, wrong: bool = False, wrong_base: bool | None = None,
          wrong_time: bool | None = None, extra_filters: list[str] | None = None) -> tuple[str, str | None]:
    """Dựng SQL từ định nghĩa chỉ số. Trả (sql, mô tả lỗi cố ý nếu có).

    wrong=True bật mọi lỗi điển hình; wrong_base / wrong_time bật riêng từng loại (dùng cho các model mock khác nhau).
    """
    if wrong_base is None:
        wrong_base = wrong
    if wrong_time is None:
        wrong_time = wrong
    mistakes: list[str] = []
    base_sql = metric["canonical_sql"]
    if wrong_base and metric["id"] in WRONG_BASE:
        base_sql, m = WRONG_BASE[metric["id"]]
        mistakes.append(m)
    wrong_time = bool(wrong_time and metric["id"] in WRONG_TIME and (interp.get("time") or interp.get("dimension") == "month"))
    if wrong_time:
        mistakes.append("Chia thời gian theo ngày giao thay vì ngày đặt")
    mistake = "; ".join(mistakes) or None

    q: exp.Select = sqlglot.parse_one(base_sql, read="postgres")
    present = {t.alias_or_name for t in q.find_all(exp.Table)}

    def ensure(alias: str) -> None:
        if alias in present:
            return
        if alias == "s":
            ensure("i")
        if alias in ("i", "p") and "o" not in present:
            ensure("o")
        table, on = JOINS[alias]
        q.join(table, on=on, dialect="postgres", copy=False)
        present.add(alias)

    time_expr = _short_time(metric, wrong_time)
    if time_expr.startswith("o.") and "o" not in present:
        ensure("o")
    t = interp.get("time")
    if t:
        q.where(f"{time_expr} >= '{t['start']}' AND {time_expr} < '{t['end']}'", dialect="postgres", copy=False)
    for f in extra_filters or []:
        q.where(f, dialect="postgres", copy=False)

    dim = interp.get("dimension")
    measure_alias = q.selects[0].alias_or_name
    if dim:
        if dim == "month":
            dim_sql = f"CAST(DATE_TRUNC('month', {time_expr}) AS DATE)"
        else:
            alias, dim_sql = DIM_EXPR[dim]
            ensure(alias)
        q.set("expressions", [sqlglot.parse_one(f"{dim_sql} AS {dim}", read="postgres"), *q.selects])
        q.group_by(dim_sql, dialect="postgres", copy=False)
        if dim == "month":
            q.order_by(f"{dim} ASC", dialect="postgres", copy=False)
        else:
            top = interp.get("top") or {"n": 30, "order": "desc"}
            q.order_by(f"{measure_alias} {top['order'].upper()} NULLS LAST", dialect="postgres", copy=False)
            q.limit(top["n"], copy=False)
    return q.sql(dialect="postgres", pretty=True), mistake


def needs_unique_payment(sql: str) -> bool:
    """Chia theo loại thanh toán có làm nhân dòng không: có SUM/AVG/COUNT không DISTINCT và chưa có bảng thanh toán."""
    tree = sqlglot.parse_one(sql, read="postgres")
    if "p" in {t.alias_or_name for t in tree.find_all(exp.Table)}:
        return False
    return any(isinstance(a, (exp.Sum, exp.Avg, exp.Count)) and not isinstance(a.this, exp.Distinct)
               for a in tree.find_all(exp.AggFunc))


def adhoc_sql(interp: dict) -> str | None:
    """KB-4: SQL ngoài định nghĩa chuẩn cho câu "số người bán / khách hàng có trên N đơn"."""
    entity, th = interp.get("entity"), interp["threshold"]
    time, state = interp.get("time"), interp.get("state")
    if entity == "seller":
        key, frm = "i.seller_id", "mart.fct_order_items AS i"
        joins = ["JOIN mart.dim_sellers AS s ON s.seller_id = i.seller_id"] if state else []
        if time:
            joins.append("JOIN mart.fct_orders AS o ON o.order_id = i.order_id")
        where = [f"s.state = '{state}'"] if state else []
        count = "COUNT(DISTINCT i.order_id)"
    elif entity == "customer":
        key, frm, joins = "o.customer_unique_id", "mart.fct_orders AS o", []
        where = [f"o.customer_state = '{state}'"] if state else []
        count = "COUNT(DISTINCT o.order_id)"
    else:
        return None
    if time:
        where += [f"o.purchased_at >= DATE '{time['start']}'", f"o.purchased_at < DATE '{time['end']}'"]
    inner = "\n    ".join([f"SELECT {key}", f"FROM {frm}", *joins, *(["WHERE " + "\n      AND ".join(where)] if where else []),
                            f"GROUP BY {key}", f"HAVING {count} {th['op']} {th['n']}"])
    return f"SELECT COUNT(*) AS {entity}_count\nFROM (\n    {inner}\n) AS t"


def reference_sql(metric: dict, interp: dict) -> str:
    """SQL chuẩn cùng bộ lọc thời gian và chiều chia, dùng để đối chiếu kết quả (VER-06)."""
    extra = ["p.payment_sequential = 1"] if interp.get("dimension") == "payment_type" and needs_unique_payment(metric["canonical_sql"]) else []
    return build(metric, interp, extra_filters=extra)[0]


# Nhãn lỗi cài sẵn của từng chỉ số: dùng làm "lỗi thật của agent" có nhãn (EVAL-02 nguồn b).
MISTAKE_RULES = {"gmv": ["V02", "V03"], "product_revenue": ["V02"], "aov": ["V02", "V06"], "order_count": ["V03", "V06"],
                 "customer_count": ["V07"], "seller_count": ["V06"], "avg_review_score": ["V03"], "freight_ratio": ["V03"]}


def mistake_rules(metric_id: str, interp: dict) -> list[str]:
    rules = list(MISTAKE_RULES.get(metric_id, []))
    if metric_id in WRONG_TIME and (interp.get("time") or interp.get("dimension") == "month"):
        rules.append("V08")
    return rules


def fix_filters(findings: list[dict]) -> tuple[list[str], list[str]]:
    """Từ phát hiện của bộ kiểm định → bộ lọc cần thêm và ghi chú "đã sửa gì"."""
    extra, notes = [], []
    for f in findings:
        fx = f.get("fix") or {}
        if f["rule"] == "V05" and fx.get("type") == "add_filter":
            table, _, col = fx["column"].rpartition(".")
            alias = ALIAS.get(table)
            if alias:
                value = "TRUE" if fx["value"] is True else fx["value"]
                extra.append(f"{alias}.{col} = {value}")
                notes.append(f"Thêm {alias}.{col} = {value} để mỗi đơn chỉ còn 1 dòng (sửa {f['rule']})")
    return extra, notes


FIX_NOTES = {
    "V02": "Đổi cột đo về đúng định nghĩa",
    "V03": "Thêm bộ lọc bắt buộc của chỉ số",
    "V04": "Đưa bộ lọc về đúng định nghĩa",
    "V06": "Đổi hàm tổng hợp về đúng định nghĩa",
    "V07": "Đếm theo customer_unique_id",
    "V08": "Chia thời gian theo cột thời gian của định nghĩa",
}


def fix_notes(findings: list[dict]) -> list[str]:
    seen, notes = set(), []
    for f in findings:
        if f["rule"] in FIX_NOTES and f["rule"] not in seen:
            seen.add(f["rule"])
            notes.append(f"{FIX_NOTES[f['rule']]} (sửa {f['rule']})")
    return notes
