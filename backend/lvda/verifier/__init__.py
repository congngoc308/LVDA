"""Bộ kiểm định: guard → trích dấu vân tay → áp luật → phán quyết."""

from __future__ import annotations

import re
import time
from typing import Any

import sqlglot

from lvda.catalog import Catalog
from lvda.verifier import guard, rules
from lvda.verifier.fingerprint import Analysis, analyze

JSON = dict[str, Any]
_metric_cache: dict[tuple[str, int, str], Analysis] = {}


def metric_analysis(metric: JSON, catalog: Catalog) -> Analysis:
    key = (str(metric["id"]), int(metric.get("version", 0) or 0), str(metric["canonical_sql"]))
    if key not in _metric_cache:
        _metric_cache[key] = analyze(sqlglot.parse_one(metric["canonical_sql"], read="postgres"), catalog)
    return _metric_cache[key]


def detect_metric(an: Analysis, metrics: list[JSON], catalog: Catalog) -> JSON | None:
    """Đoán chỉ số cho câu SQL người dùng dán vào: khớp cột đo và hàm tổng hợp."""
    if not an.ok or not an.measures:
        return None
    cols, sigs = an.measure_columns(), an.agg_signatures()
    mapped = {catalog.misleading_keys.get(c, c) for c in cols}
    best: JSON | None = None
    for m in metrics:
        man = metric_analysis(m, catalog)
        if not man.ok:
            continue
        mc = man.measure_columns()
        if mc == cols and man.agg_signatures() == sigs:
            return m
        if best is None and mc in (cols, mapped):
            best = m
    return best


def verify(sql: str, catalog: Catalog, metric: JSON | None = None, settings: JSON | None = None) -> JSON:
    t0 = time.perf_counter()
    g = guard.check(sql, catalog.allowed_schemas)
    certified = bool(metric and metric.get("status") == "certified")
    base: JSON = {"metric_id": metric["id"] if metric else None, "metric_status": metric.get("status") if metric else None}
    if g.blocked:
        return {**base, "verdict": "blocked", "blocked_reason": g.blocked, "findings": [], "fingerprint": None,
                "executable": False, "elapsed_ms": _ms(t0)}
    if g.parse_error or g.tree is None:
        f = rules.apply_settings([rules.finding("V12", "medium", f"Không phân tích được câu SQL: {g.parse_error}", "")], settings)
        # VER-09: parser bó tay thì nhờ LLM (mô phỏng) đoán nguồn, kèm độ tin cậy; phán quyết tối đa là Vàng.
        guess = llm_extract_sources(sql)
        if guess["tables"]:
            f.append(rules.finding("I06", "info", f"LLM (mô phỏng) suy ra nguồn: {', '.join(guess['tables'])} "
                                                  f"(độ tin cậy {guess['confidence']:.1f}). Cần người kiểm lại.", ""))
        verdict = "red" if any(x["severity"] == "high" for x in f) else "yellow"
        return {**base, "verdict": verdict, "blocked_reason": None, "findings": f,
                "fingerprint": {"tables": guess["tables"], "source": "llm", "confidence": guess["confidence"]} if guess["tables"] else None,
                "executable": False, "elapsed_ms": _ms(t0)}

    an = analyze(g.tree, catalog)
    man = metric_analysis(metric, catalog) if metric else None
    findings = rules.apply_settings(rules.check(an, catalog, metric, man), settings)
    if metric and not certified:
        findings.append(rules.finding("I05", "info", f"Chỉ số “{metric['name_vi']}” đang ở trạng thái {metric.get('status')}, chưa được chứng nhận.", ""))
    return {
        **base,
        "verdict": rules.verdict(findings, certified),
        "blocked_reason": None,
        "findings": findings,
        "fingerprint": an.to_dict(catalog) if an.ok else None,
        "executable": an.ok,
        "elapsed_ms": _ms(t0),
    }


def llm_extract_sources(sql: str) -> JSON:
    """Bản mô phỏng của bước LLM extraction (P-116): tìm bảng sau FROM/JOIN bằng mẫu chữ, độ tin cậy thấp."""
    tables = sorted({m.lower() for m in re.findall(r"(?:from|join)\s+((?:raw|mart)\.[a-z_][a-z0-9_]*)", sql, re.IGNORECASE)})
    return {"tables": tables, "confidence": 0.5 if tables else 0.0}


def _ms(t0: float) -> float:
    return round((time.perf_counter() - t0) * 1000, 1)
