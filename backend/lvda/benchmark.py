"""Sinh benchmark câu hỏi tiếng Việt (EVAL-01): python -m lvda.benchmark

Mỗi câu có: câu hỏi, loại, độ khó, chỉ số, SQL chuẩn, các bẫy nhắm tới. Kết quả chuẩn được tính lúc chạy đánh giá.
SQL chuẩn sinh từ định nghĩa chỉ số đã chứng nhận (cùng bộ dựng với bản sửa của agent mock), nên phần
đánh giá agent chỉ dùng để kiểm luồng cho tới khi gắn LLM thật.
"""

from __future__ import annotations

import json

from lvda import config
from lvda.agent import mock_llm
from lvda.agent.nlu import interpret, strip_accents

OUT_OF_SCOPE = [
    "Thời tiết hôm nay thế nào?", "Lợi nhuận năm 2018 là bao nhiêu?", "Chi phí marketing quý 1/2018",
    "Số nhân viên của Olist", "Tồn kho hiện tại theo sản phẩm", "Tỉ lệ chuyển đổi trên website tháng 3/2018",
    "Giá cổ phiếu của Olist", "Doanh số dự báo năm 2019 theo AI", "Ai là khách VIP nhất?",
]
DEFINITIONS = ["Doanh thu gộp là gì?", "Tỉ lệ giao trễ tính thế nào?", "Số khách hàng định nghĩa ra sao?",
               "Giá trị đơn trung bình là gì?"]


def _templates(name: str, i: int) -> list[tuple[str, str]]:
    m, y, q = (i % 12) + 1, 2017 + (i % 2), (i % 4) + 1
    return [
        (f"{name} là bao nhiêu?", "đơn giản"),
        (f"{name} năm {y}", "thời gian"),
        (strip_accents(f"{name} theo bang quý {q}/2018"), "chia nhóm"),  # không dấu (AGT-01)
        (f"{name} tháng {m}/{2017 if m >= 10 else 2018}", "thời gian"),
        (f"{name} quý {q}/{y}", "thời gian"),
        (f"{name} theo bang năm {y}", "chia nhóm"),
        (f"{name} theo tháng năm 2018", "thời gian"),
        (f"{name} theo loại thanh toán năm {y}", "chia nhóm"),
        (f"{name} top 5 danh mục năm 2018", "xếp hạng"),
    ]


def build(metrics: list[dict]) -> list[dict]:
    items: list[dict] = []
    for i, m in enumerate(sorted((x for x in metrics if x["status"] != "deprecated"), key=lambda x: x["id"])):
        for text, category in _templates(m["name_vi"], i):
            interp = interpret(text, metrics)
            if interp["kind"] != "metric" or interp["metric_id"] != m["id"] or not mock_llm.supports(m, interp.get("dimension")):
                continue
            traps = mock_llm.mistake_rules(m["id"], interp)
            if interp.get("dimension") == "payment_type" and mock_llm.needs_unique_payment(m["canonical_sql"]):
                traps.append("V05")
            if traps and category in ("đơn giản", "thời gian", "chia nhóm"):
                category = "bẫy"
            n_parts = sum(bool(interp.get(k)) for k in ("time", "dimension", "top"))
            difficulty = "khó" if len(traps) >= 2 or n_parts >= 2 else "vừa" if n_parts or traps else "dễ"
            items.append({"question": text, "category": category, "difficulty": difficulty, "metric_id": m["id"],
                          "traps": sorted(set(traps)), "gold_sql": mock_llm.reference_sql(m, interp)})
    for text in OUT_OF_SCOPE:
        items.append({"question": text, "category": "ngoài phạm vi", "difficulty": "dễ", "metric_id": None, "traps": [],
                      "expect": "refuse", "gold_sql": None})
    for text in DEFINITIONS:
        interp = interpret(text, metrics)
        items.append({"question": text, "category": "định nghĩa", "difficulty": "dễ", "metric_id": interp.get("metric_id"),
                      "traps": [], "expect": "definition", "gold_sql": None})
    for n, it in enumerate(items, 1):
        it["id"] = f"q{n:03d}"
    return items


def write(database_id: int = 1) -> int:
    from lvda.metrics import list_metrics

    items = build(list_metrics(database_id))
    (config.EVAL_DIR / "benchmark.json").write_text(json.dumps(items, ensure_ascii=False, indent=1), encoding="utf-8")
    return len(items)


if __name__ == "__main__":
    print(f"Đã ghi {write()} câu hỏi vào eval/benchmark.json")
