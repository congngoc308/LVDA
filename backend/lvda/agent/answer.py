"""Soạn câu trả lời tiếng Việt từ kết quả truy vấn. Mọi con số đều lấy từ kết quả, không tự sinh."""

from __future__ import annotations

import re

from lvda.agent.nlu import DIMENSIONS


def _vi_number(v: float, decimals: int) -> str:
    s = f"{v:,.{decimals}f}"
    return s.replace(",", "§").replace(".", ",").replace("§", ".")


def format_value(v, fmt: str, unit: str = "") -> str:
    if v is None:
        return "—"
    v = float(v)
    if fmt == "currency":
        return f"{_vi_number(v, 2)} {unit or 'BRL'}"
    if fmt == "percent":
        return f"{_vi_number(v * 100, 1)}%"
    if fmt == "integer":
        return _vi_number(v, 0)
    if fmt == "days":
        return f"{_vi_number(v, 1)} ngày"
    if fmt == "score":
        return f"{_vi_number(v, 2)} / 5"
    return _vi_number(v, 2)


def _label(v) -> str:
    if v is None:
        return "(không có)"
    s = str(v)
    if len(s) == 10 and s[4] == "-" and s[7] == "-":  # tháng
        return f"{int(s[5:7])}/{s[:4]}"
    return s


_NUM = re.compile(r"\d[\d.,]*\d|\d")


def _num_forms(v) -> set[str]:
    if v is None:
        return set()
    if isinstance(v, (int, float)):
        out = {format_value(v, f) .split(" ")[0].rstrip("%") for f in ("currency", "percent", "integer", "days", "score", "number")}
        out |= {str(v), _vi_number(float(v), 0), _vi_number(float(v), 1), _vi_number(float(v), 2)}
        return out
    return set(_NUM.findall(_label(v))) | set(_NUM.findall(str(v)))


def guard_numbers(text: str, result: dict, question: str = "", extra: list[str] | None = None) -> list[str]:
    """AGT-06: mọi con số trong câu trả lời phải có trong kết quả truy vấn hoặc câu hỏi. Trả các số không có nguồn."""
    allowed: set[str] = set(_NUM.findall(question)) | set(extra or [])
    for row in result.get("rows", []):
        for v in row:
            allowed |= _num_forms(v)
    allowed.add(str(len(result.get("rows", []))))
    return [n for n in _NUM.findall(text) if n not in allowed and n.rstrip(".,") not in allowed]


def compose(metric: dict, interp: dict, result: dict) -> dict:
    fmt, unit = metric.get("format", "number"), metric.get("unit", "")
    name = metric["name_vi"]
    t = interp.get("time")
    when = f" {t['label']}" if t else " (toàn bộ dữ liệu)"
    dim = interp.get("dimension")
    rows = result["rows"]
    columns = [{"key": c, "label": DIMENSIONS[c]["label"] if c in DIMENSIONS else name,
                "kind": "dimension" if c in DIMENSIONS else "measure",
                "format": None if c in DIMENSIONS else fmt, "unit": None if c in DIMENSIONS else unit}
               for c in result["columns"]]
    if not rows:
        return {"text": f"Không có dữ liệu cho {name.lower()}{when}.", "headline": None, "columns": columns}
    if not dim:
        value = rows[0][-1]
        return {"text": f"{name}{when}: {format_value(value, fmt, unit)}.", "headline": format_value(value, fmt, unit),
                "headline_raw": value, "columns": columns}
    dim_label = DIMENSIONS[dim]["label"].lower()
    valid = [r for r in rows if r[-1] is not None]
    if dim == "month":
        peak = max(valid, key=lambda r: r[-1]) if valid else rows[0]
        text = (f"{name} theo tháng{when}: {len(rows)} tháng, từ {_label(rows[0][0])} đến {_label(rows[-1][0])}; "
                f"cao nhất {_label(peak[0])} với {format_value(peak[-1], fmt, unit)}.")
        return {"text": text, "headline": format_value(peak[-1], fmt, unit), "headline_note": f"cao nhất · {_label(peak[0])}",
                "columns": columns}
    first = rows[0]
    order = (interp.get("top") or {}).get("order", "desc")
    word = "cao nhất" if order == "desc" else "thấp nhất"
    text = f"{name} theo {dim_label}{when}: {word} là {_label(first[0])} với {format_value(first[-1], fmt, unit)} ({len(rows)} nhóm)."
    return {"text": text, "headline": format_value(first[-1], fmt, unit), "headline_note": f"{word} · {_label(first[0])}",
            "columns": columns}
