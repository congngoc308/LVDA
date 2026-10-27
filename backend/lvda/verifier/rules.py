"""12 luật kiểm định (V01–V12) và các ghi chú (I01–I05). Tất định, không dùng LLM."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from lvda.catalog import Catalog
from lvda.verifier.fingerprint import Analysis

JSON = dict[str, Any]

TITLES = {
    "V01": "Định danh không tồn tại",
    "V02": "Sai cột đo",
    "V03": "Thiếu bộ lọc bắt buộc",
    "V04": "Bộ lọc khác định nghĩa",
    "V05": "Nhân dòng do join",
    "V06": "Sai hàm tổng hợp",
    "V07": "Sai khóa thực thể",
    "V08": "Sai cột thời gian",
    "V09": "Đường join chưa khai báo",
    "V10": "Lộ cột nhạy cảm",
    "V11": "Dùng đối tượng ngừng dùng",
    "V12": "Không phân tích được SQL",
    "I01": "Có bộ lọc thêm",
    "I02": "Lọc để còn 1 dòng mỗi đơn",
    "I03": "Chưa có định nghĩa để so",
    "I04": "Đọc thẳng bảng raw",
    "I05": "Chỉ số chưa chứng nhận",
    "I06": "LLM suy ra nguồn",
}
SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2, "info": 3}
DEFAULT_SEVERITY = {"V01": "high", "V02": "high", "V03": "high", "V04": "medium", "V05": "high", "V06": "high",
                    "V07": "high", "V08": "medium", "V09": "high", "V10": "medium", "V11": "low", "V12": "medium"}


def apply_settings(findings: list[JSON], settings: JSON | None) -> list[JSON]:
    """VER-08: tắt luật hoặc đổi mức độ theo cấu hình của database. Ghi chú (I..) không bị ảnh hưởng."""
    rules_cfg = (settings or {}).get("rules") or {}
    out: list[JSON] = []
    for f in findings:
        cfg = rules_cfg.get(f["rule"]) or {}
        if cfg.get("enabled") is False:
            continue
        if cfg.get("severity") in ("high", "medium", "low") and f["rule"].startswith("V"):
            f = {**f, "severity": cfg["severity"], "severity_overridden": True}
        out.append(f)
    out.sort(key=lambda f: (SEVERITY_ORDER[f["severity"]], f["rule"]))
    return out


def short(col: str) -> str:
    return col[5:] if col.startswith("mart.") else col


def fmt_cols(cols: Iterable[str]) -> str:
    items = sorted(cols)
    return ", ".join(short(c) for c in items) if items else "(không có cột)"


def fmt_value(op: str, value: Any) -> str:
    def one(v: Any) -> str:
        if isinstance(v, bool):
            return "TRUE" if v else "FALSE"
        if isinstance(v, str):
            return f"'{v}'"
        return str(v)

    if isinstance(value, (list, tuple)):
        if op == "between":
            return f"{one(value[0])} AND {one(value[1])}"
        return "(" + ", ".join(one(v) for v in value) + ")"
    return one(value)


def describe_filter(f: JSON) -> str:
    op = f["op"].upper()
    if f["op"] in ("is null", "is not null"):
        return f"{short(f['column'])} {op}"
    return f"{short(f['column'])} {op} {fmt_value(f['op'], f['value'])}"


def finding(rule: str, severity: str, message: str, evidence: str = "", fix: JSON | None = None) -> JSON:
    return {"rule": rule, "title": TITLES[rule], "severity": severity, "message_vi": message,
            "evidence": evidence, "fix": fix}


def _norm_value(v: Any) -> Any:
    if isinstance(v, str):
        low = v.strip().lower()
        if low in ("true", "false"):
            return low == "true"
        return low
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def _norm_filter(op: str, value: Any) -> tuple[str, Any]:
    vals = value if isinstance(value, (list, tuple)) else [value]
    if op in ("=", "in"):
        return ("in", frozenset(_norm_value(v) for v in vals))
    if op in ("<>", "not in"):
        return ("not in", frozenset(_norm_value(v) for v in vals))
    return (op, tuple(_norm_value(v) for v in vals))


def same_filter(f: JSON, rf: JSON) -> bool:
    return bool(_norm_filter(f["op"], f["value"]) == _norm_filter(rf["op"], rf["value"]))


def _is_unique(an: Analysis, catalog: Catalog, table: str) -> bool:
    uw = catalog.unique_when(table)
    if not uw:
        return False
    return any(f["column"] == uw["column"] and same_filter(f, {"op": "=", "value": uw["value"]}) for f in an.filters)


def check(an: Analysis, catalog: Catalog, metric: JSON | None, metric_an: Analysis | None) -> list[JSON]:
    out: list[JSON] = []

    # V01 — định danh không tồn tại
    for u in an.unknown:
        kind = {"table": "bảng", "column": "cột"}.get(u["kind"], "đối tượng")
        out.append(finding("V01", "high", f"Không tìm thấy {kind} “{u['name']}” trong catalog.", u.get("sql", ""),
                           {"type": "check_identifier", "name": u["name"]}))
    if not an.ok:
        return out

    measure_cols = an.measure_columns()

    if metric and metric_an:
        name = metric["name_vi"]
        metric_cols = metric_an.measure_columns()
        sql_cols = set(measure_cols)
        star_counts = [m for m in an.measures if m["star"]]
        mapped = {catalog.misleading_keys.get(c, c) for c in sql_cols}
        explained_by_key = mapped == metric_cols and sql_cols != metric_cols
        # Cột dẫn xuất tương đương: fct_orders.gmv có cùng nguồn raw với price + freight_value
        same_raw = bool(sql_cols) and set(catalog.to_raw(sql_cols)) == set(catalog.to_raw(metric_cols))

        # V02 — cột đo
        if not an.measures:
            out.append(finding("V02", "high", f"Câu trả lời không có phép tổng hợp, trong khi “{name}” là một phép đo.",
                               "", {"type": "replace_measure", "columns": sorted(metric_cols)}))
        elif sql_cols and sql_cols != metric_cols and not explained_by_key and not same_raw:
            out.append(finding(
                "V02", "high",
                f"Cột đo khác định nghĩa “{name}”: câu trả lời dùng {fmt_cols(sql_cols)}, định nghĩa dùng {fmt_cols(metric_cols)}.",
                an.measures[0]["sql"],
                {"type": "replace_measure", "columns": sorted(metric_cols),
                 "measure_sql": metric_an.measures[0]["sql"] if metric_an.measures else ""}))

        # V06 — hàm tổng hợp
        metric_sigs, sql_sigs = metric_an.agg_signatures(), an.agg_signatures()
        if an.measures and metric_sigs != sql_sigs:
            def sig_text(sigs: set[tuple[str, bool]]) -> str:
                return ", ".join(f"{a}({'DISTINCT …' if d else '…'})" for a, d in sorted(sigs))
            out.append(finding(
                "V06", "high",
                f"Hàm tổng hợp khác định nghĩa: định nghĩa dùng {sig_text(metric_sigs)}, câu trả lời dùng {sig_text(sql_sigs)}.",
                (star_counts[0] if star_counts else an.measures[0])["sql"],
                {"type": "replace_aggregate", "expected": sorted(f"{a}{' DISTINCT' if d else ''}" for a, d in metric_sigs)}))

        # V03 / V04 — bộ lọc bắt buộc
        for rf in metric.get("required_filters", []):
            matches = [f for f in an.filters if f["column"] == rf["column"]]
            want = describe_filter(rf)
            if not matches:
                out.append(finding("V03", "high", f"Thiếu bộ lọc bắt buộc của “{name}”: {want}.", "",
                                   {"type": "add_filter", **rf}))
            elif not any(same_filter(f, rf) for f in matches):
                out.append(finding("V04", "medium",
                                   f"Bộ lọc khác định nghĩa: câu trả lời dùng {describe_filter(matches[0])}, định nghĩa dùng {want}.",
                                   matches[0]["sql"], {"type": "replace_filter", **rf}))

        # V08 — cột thời gian
        tc = metric.get("time_column")
        if tc and an.time_columns and tc not in an.time_columns:
            out.append(finding("V08", "medium",
                               f"Chia hoặc lọc thời gian theo {fmt_cols(an.time_columns)}, trong khi “{name}” tính theo {short(tc)}.",
                               "", {"type": "replace_time_column", "column": tc, "wrong": an.time_columns}))

        # I01 / I02 — ghi chú bộ lọc thêm
        required_cols = {rf["column"] for rf in metric.get("required_filters", [])}
        unique_cols = {r["unique_when"]["column"] for r in catalog.relationships if r.get("unique_when")}
        extra = [f for f in an.filters if f["column"] not in required_cols and f["column"] not in unique_cols
                 and not catalog.is_time(f["column"]) and f["clause"] != "on"]
        if extra:
            out.append(finding("I01", "info", "Có bộ lọc ngoài định nghĩa: " + "; ".join(describe_filter(f) for f in extra[:4]) + ".",
                               extra[0]["sql"]))
        uniq = [f for f in an.filters if f["column"] in unique_cols]
        if uniq:
            out.append(finding("I02", "info", f"Dùng {describe_filter(uniq[0])} để mỗi đơn chỉ còn 1 dòng.", uniq[0]["sql"]))
    elif metric is None:
        out.append(finding("I03", "info", "Không có định nghĩa chỉ số chuẩn để so; chỉ áp các luật chung.", ""))

    # V07 — đếm sai khóa thực thể
    for m in an.measures:
        if m["agg"] == "COUNT":
            wrong = [c for c in m["columns"] if c in catalog.misleading_keys]
            if wrong:
                right = catalog.misleading_keys[wrong[0]]
                out.append(finding("V07", "high",
                                   f"Đếm theo {short(wrong[0])} là đếm sai thực thể: mã này đổi theo từng đơn. Dùng {short(right)}.",
                                   m["sql"], {"type": "replace_column", "from": wrong[0], "to": right}))
                break

    # V05 — nhân dòng do join
    for info in an.scopes:
        hit = None
        for s_alias in info.measure_aliases:
            s_table = info.sources.get(s_alias)
            if not s_table:
                continue
            for n_alias, n_table in info.sources.items():
                if n_alias == s_alias or not n_table or n_table == s_table:
                    continue
                if (catalog.child_of(n_table, s_table) or catalog.siblings(n_table, s_table)) and not _is_unique(an, catalog, n_table):
                    hit = (s_table, n_table, n_alias)
                    break
            if hit:
                break
        if hit:
            s_table, n_table, n_alias = hit
            uw = catalog.unique_when(n_table)
            fix = ({"type": "add_filter", "column": uw["column"], "op": "=", "value": uw["value"]} if uw
                   else {"type": "pre_aggregate", "table": s_table})
            out.append(finding(
                "V05", "high",
                f"Tổng hợp trên {short(s_table)} sau khi join {short(n_table)}: một dòng của {short(s_table)} khớp nhiều dòng {short(n_table)}, nên bị đếm lặp.",
                info.join_sql.get(n_alias, info.agg_sql), fix))

    # V09 — đường join chưa khai báo
    for j in an.joins:
        if not catalog.join_allowed(j["left"], j["right"]):
            hint = " Cột zip_code_prefix không duy nhất nên sẽ nhân dòng." if "zip_code_prefix" in j["left"] + j["right"] else ""
            out.append(finding("V09", "high",
                               f"Join {short(j['left'])} = {short(j['right'])} không nằm trong các quan hệ đã khai báo.{hint}",
                               j["sql"], {"type": "check_join"}))

    # V10 — lộ cột nhạy cảm ở mức dòng
    for o in an.outputs:
        pii = set(o["columns"]) & catalog.pii
        if pii and not o["aggregated"]:
            out.append(finding("V10", "medium", f"Trả về cột nhạy cảm {fmt_cols(pii)} ở mức từng dòng.", o["name"],
                               {"type": "aggregate_or_mask", "columns": sorted(pii)}))
            break

    # V11 / I04
    for t in an.tables:
        if t in catalog.deprecated:
            out.append(finding("V11", "low", f"Bảng {short(t)} đã ngừng dùng.", t, {"type": "replace_table"}))
    if any(t.startswith("raw.") for t in an.tables):
        out.append(finding("I04", "info", "Truy vấn đọc thẳng bảng raw; nên dùng lớp mart.", ""))

    out.sort(key=lambda f: (SEVERITY_ORDER[f["severity"]], f["rule"]))
    return out


def verdict(findings: list[JSON], has_certified_metric: bool) -> str:
    sev = {f["severity"] for f in findings}
    if "high" in sev:
        return "red"
    if "medium" in sev or not has_certified_metric:
        return "yellow"
    return "green"
