"""Hiểu câu hỏi tiếng Việt (bản mock, dựa luật): chỉ số, khoảng thời gian, chiều chia, top N.

Khi có LLM thật, phần này được thay bằng structured output; giao diện trả về giữ nguyên.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import date

DIMENSIONS = {
    "seller_state": {"label": "Bang người bán", "patterns": ["theo bang nguoi ban", "bang cua nguoi ban", "seller state"]},
    "customer_state": {"label": "Bang", "patterns": ["theo bang", "theo tieu bang", "tung bang", "moi bang", "by state"]},
    "category": {"label": "Danh mục", "patterns": ["danh muc", "nganh hang", "theo loai san pham", "by category"]},
    "payment_type": {"label": "Loại thanh toán", "patterns": ["theo loai thanh toan", "theo phuong thuc thanh toan", "theo hinh thuc thanh toan", "by payment"]},
    "month": {"label": "Tháng", "patterns": ["theo thang", "tung thang", "hang thang", "moi thang", "xu huong", "by month"]},
}
DEFINITION_HINTS = ["la gi", "dinh nghia", "tinh nhu the nao", "tinh the nao", "cong thuc", "lay tu dau", "lineage"]
SQL_START = re.compile(r"^\s*(select|with)\b", re.IGNORECASE)


def strip_accents(s: str) -> str:
    s = s.replace("đ", "d").replace("Đ", "D")
    s = "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s.lower()).strip()


def normalize_question(q: str) -> str:
    return re.sub(r"[^a-z0-9/ ]", "", strip_accents(q)).strip()


def looks_like_sql(text: str) -> bool:
    return bool(SQL_START.match(text))


def _month_range(y: int, m: int) -> tuple[date, date]:
    return date(y, m, 1), date(y + (m == 12), m % 12 + 1, 1)


def parse_time(t: str) -> dict | None:
    m = re.search(r"thang\s*(\d{1,2})\s*(?:/|-)?\s*(?:nam\s*)?(\d{4})", t)
    if m and 1 <= int(m.group(1)) <= 12:
        mo, y = int(m.group(1)), int(m.group(2))
        s, e = _month_range(y, mo)
        return {"kind": "month", "start": s.isoformat(), "end": e.isoformat(), "label": f"tháng {mo}/{y}"}
    q = re.search(r"quy\s*([1-4])\s*(?:/|-)?\s*(?:nam\s*)?(\d{4})", t)
    if q:
        qq, y = int(q.group(1)), int(q.group(2))
        s = date(y, (qq - 1) * 3 + 1, 1)
        e = date(y + (qq == 4), (qq * 3) % 12 + 1, 1)
        return {"kind": "quarter", "start": s.isoformat(), "end": e.isoformat(), "label": f"quý {qq}/{y}"}
    y = re.search(r"nam\s*(\d{4})", t) or re.search(r"\b(201[5-9])\b", t)
    if y:
        yy = int(y.group(1))
        return {"kind": "year", "start": f"{yy}-01-01", "end": f"{yy + 1}-01-01", "label": f"năm {yy}"}
    return None


def parse_dimension(t: str) -> str | None:
    for key, d in DIMENSIONS.items():
        if any(p in t for p in d["patterns"]):
            return key
    return None


def parse_top(t: str) -> dict | None:
    m = re.search(r"top\s*(\d{1,2})", t)
    if m:
        return {"n": int(m.group(1)), "order": "desc"}
    if any(w in t for w in ("cao nhat", "nhieu nhat", "lon nhat")):
        return {"n": 5, "order": "desc"}
    if any(w in t for w in ("thap nhat", "it nhat", "nho nhat")):
        return {"n": 5, "order": "asc"}
    return None


# KB-4: điều kiện mà định nghĩa chỉ số không diễn tả được ("người bán có trên 10 đơn").
# Gặp điều kiện này thì không được trả lời bằng chỉ số chuẩn (sẽ bỏ qua điều kiện), mà viết SQL riêng → Vàng.
ENTITIES = {
    "seller": {"label": "người bán", "patterns": ["nguoi ban", "seller"]},
    "customer": {"label": "khách hàng", "patterns": ["khach hang", "nguoi mua", "customer"]},
}
BR_STATES = {"AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR",
             "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"}
_THRESHOLD = re.compile(r"(?<![a-z])(nhieu hon|it nhat|it hon|tren|duoi|hon|tu|>=|<=|>|<)\s*(\d+)\s*don(?: hang)?( tro len)?")
_OPS = {"nhieu hon": ">", "tren": ">", "hon": ">", ">": ">", "it nhat": ">=", ">=": ">=", "tu": ">=",
        "it hon": "<", "duoi": "<", "<": "<", "<=": "<="}


def parse_threshold(t: str) -> dict | None:
    m = _THRESHOLD.search(t)
    if not m or (m.group(1) == "tu" and not m.group(3)):
        return None
    op = _OPS[m.group(1)]
    label = {">": "trên", ">=": "từ", "<": "dưới", "<=": "tối đa"}[op]
    return {"op": op, "n": int(m.group(2)), "label": f"{label} {m.group(2)} đơn" + (" trở lên" if op == ">=" else "")}


def parse_state(question: str, t: str) -> str | None:
    for code in re.findall(r"bang\s+([a-z]{2})\b", t):
        if code.upper() in BR_STATES:
            return code.upper()
    hit = [w for w in re.findall(r"\b([A-Z]{2})\b", question) if w in BR_STATES]
    return hit[0] if hit else None


def match_metric(t: str, metrics: list[dict]) -> tuple[dict | None, str]:
    best, best_syn = None, ""
    for m in metrics:
        if m.get("status") == "deprecated":
            continue
        for syn in [m["name_vi"], *m.get("synonyms", [])]:
            s = strip_accents(syn)
            if s and re.search(rf"(?<![a-z]){re.escape(s)}(?![a-z])", t) and len(s) > len(best_syn):
                best, best_syn = m, s
    return best, best_syn


def alternatives(matched: str, chosen: dict, metrics: list[dict]) -> list[dict]:
    """AGT-09: các chỉ số khác mà cụm từ người dùng gõ cũng có thể chỉ tới (ví dụ “doanh thu”)."""
    out = []
    for m in metrics:
        if m["id"] == chosen["id"] or m.get("status") == "deprecated":
            continue
        names = [strip_accents(x) for x in [m["name_vi"], *m.get("synonyms", [])]]
        if any(matched in n for n in names):
            out.append({"id": m["id"], "name_vi": m["name_vi"], "status": m["status"]})
    return out


# AGT-08: các chủ đề dữ liệu không có, dù câu hỏi có chứa tên chỉ số ("doanh số dự báo…").
OUT_OF_SCOPE_HINTS = ["du bao", "forecast", "loi nhuan", "profit", "chi phi", "marketing", "ton kho", "inventory",
                      "website", "chuyen doi", "conversion", "co phieu", "nhan vien", "thoi tiet", "ngan sach", "vip"]
DATA_YEARS = range(2016, 2019)


def out_of_scope_reason(t: str) -> str | None:
    for h in OUT_OF_SCOPE_HINTS:
        if re.search(rf"(?<![a-z]){h}(?![a-z])", t):
            return f"Dữ liệu không có thông tin về “{h}”."
    for y in re.findall(r"\b(20\d\d)\b", t):
        if int(y) not in DATA_YEARS:
            return f"Dữ liệu chỉ có từ 10/2016 đến 08/2018, không có năm {y}."
    return None


def interpret(question: str, metrics: list[dict], context: dict | None = None, metric_id: str | None = None) -> dict:
    if looks_like_sql(question):
        return {"kind": "sql", "chips": ["Kiểm SQL"]}
    t = strip_accents(question)
    reason = out_of_scope_reason(t)
    if reason and not metric_id:
        return {"kind": "out_of_scope", "chips": [], "reason": reason,
                "suggestions": [m["name_vi"] for m in metrics if m["status"] == "certified"][:6]}
    metric, matched = match_metric(t, metrics)
    threshold = parse_threshold(t)
    if threshold and not metric_id:
        entity = next((k for k, e in ENTITIES.items() if any(p in t for p in e["patterns"])), None)
        state, time = parse_state(question, t), parse_time(t)
        chips = [f"Số {ENTITIES[entity]['label']}" if entity else "Không rõ đối tượng", f"có {threshold['label']}"]
        if state:
            chips.insert(1, f"bang {state}")
        if time:
            chips.append(time["label"])
        return {"kind": "adhoc", "entity": entity, "entity_label": ENTITIES[entity]["label"] if entity else None,
                "threshold": threshold, "state": state, "time": time, "chips": chips + ["chưa có chỉ số chuẩn"],
                "near_metric_id": metric["id"] if metric else None, "near_metric_name": metric["name_vi"] if metric else None}
    alts: list[dict] = []
    overridden = False
    if metric_id:
        chosen = next((m for m in metrics if m["id"] == metric_id), None)
        if chosen:
            overridden = metric is not None and chosen["id"] != metric["id"]
            metric = chosen
    elif metric and matched:
        alts = alternatives(matched, metric, metrics)
    time, dim, top = parse_time(t), parse_dimension(t), parse_top(t)
    carried = False
    if not metric and context and context.get("metric_id") and (time or dim or top or t.startswith("con ")):
        metric = next((m for m in metrics if m["id"] == context["metric_id"]), None)
        time = time or context.get("time")
        dim = dim or context.get("dimension")
        carried = metric is not None
    if not metric:
        return {"kind": "out_of_scope", "chips": [], "suggestions": [m["name_vi"] for m in metrics if m["status"] == "certified"][:6]}
    kind = "definition" if any(h in t for h in DEFINITION_HINTS) and not (time or dim) else "metric"
    if dim == "month" and top:
        top = None
    chips = [metric["name_vi"]]
    if time:
        chips.append(time["label"])
    if dim:
        chips.append(f"theo {DIMENSIONS[dim]['label'].lower()}")
    if top:
        chips.append(f"top {top['n']}" if top["order"] == "desc" else f"{top['n']} thấp nhất")
    return {"kind": kind, "metric_id": metric["id"], "metric_name": metric["name_vi"], "metric_status": metric["status"],
            "time": time, "dimension": dim, "dimension_label": DIMENSIONS[dim]["label"] if dim else None,
            "top": top, "carried": carried, "chips": chips, "matched_text": matched or None,
            "alternatives": alts, "overridden": overridden}
