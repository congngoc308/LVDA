# Agent evaluation — run #5 (2026-10-25 01:04:42.828484+00:00)

> The LLM is a mock with built-in mistakes; numbers validate the pipeline, they do not represent a real model.

116 questions · models: mock-large, mock-small

- Intent classification (AGT-01): 48/50 = 96.0%
- Metric matching (MET-04): 40/42 = 95.2%
- Table retrieval recall@5 (AGT-02): 100.0% (all tables found for 100.0% of questions)

| Model | Config | Correct | Wrong, flagged | Held | Wrong, silent | Accuracy | p50 | p95 | Avg cost | Schema retries | Correct refusals |
|---|---|---|---|---|---|---|---|---|---|---|---|
| mock-large | A | 45 | 0 | 0 | 71 | 38.8% | 129.1 ms | 151.4 ms | 0.001766 USD | 0 | 9/9 |
| mock-large | B | 108 | 0 | 0 | 8 | 93.1% | 164.1 ms | 190.2 ms | 0.001972 USD | 0 | 9/9 |
| mock-large | C | 108 | 0 | 8 | 0 | 93.1% | 145.5 ms | 180.8 ms | 0.00193 USD | 0 | 9/9 |
| mock-large | D | 116 | 0 | 0 | 0 | 100.0% | 143.0 ms | 185.4 ms | 0.00213 USD | 0 | 9/9 |
| mock-small | A | 36 | 0 | 0 | 80 | 31.0% | 124.5 ms | 150.6 ms | 0.000115 USD | 13 | 9/9 |
| mock-small | B | 67 | 0 | 0 | 49 | 57.8% | 155.8 ms | 187.4 ms | 0.000129 USD | 13 | 9/9 |
| mock-small | C | 66 | 9 | 41 | 0 | 56.9% | 126.5 ms | 185.1 ms | 0.000118 USD | 13 | 9/9 |
| mock-small | D | 106 | 9 | 0 | 1 | 91.4% | 153.9 ms | 189.1 ms | 0.000171 USD | 13 | 9/9 |

Configs: A = schema only · B = + metric/verified-query retrieval · C = + verifier labels · D = + self-fix.

## First-attempt error taxonomy (mock-small, config D)

| Rule | Count | Example question |
|---|---|---|
| V06 | 18 | Giá trị đơn trung bình là bao nhiêu? |
| V03 | 17 | Điểm đánh giá trung bình là bao nhiêu? |
| V08 | 14 | Thời gian giao trung bình năm 2018 |
| V05 | 10 | Giá trị đơn trung bình top 5 danh mục năm 2018 |
| V02 | 9 | Giá trị đơn trung bình là bao nhiêu? |
| V07 | 9 | Số khách hàng là bao nhiêu? |

## Misclassified questions

- khách đã trả tổng cộng bao nhiêu tiền năm 2017: expected ['metric', 'payment_total'], got ['out_of_scope', None]
- mất bao nhiêu ngày giao hàng trung bình theo bang: expected ['metric', 'avg_delivery_days'], got ['out_of_scope', None]
