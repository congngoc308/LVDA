# Verifier evaluation — run #6 (2026-10-25 01:04:45.975024+00:00)

- Caught: **142/142** broken SQL (recall 100.0%)
- False alarms: **0/60** correct SQL (0.0%)
- Check latency: p50 11.9 ms, p95 17.4 ms

| Source | Caught |
|---|---|
| agent_log | 82/82 |
| mutation | 60/60 |

| Rule | Title | Caught |
|---|---|---|
| V01 | Định danh không tồn tại | 2/2 |
| V02 | Sai cột đo | 27/27 |
| V03 | Thiếu bộ lọc bắt buộc | 44/44 |
| V04 | Bộ lọc khác định nghĩa | 11/11 |
| V05 | Nhân dòng do join | 8/8 |
| V06 | Sai hàm tổng hợp | 34/34 |
| V07 | Sai khóa thực thể | 12/12 |
| V08 | Sai cột thời gian | 25/25 |
| V09 | Đường join chưa khai báo | 2/2 |
| V10 | Lộ cột nhạy cảm | 2/2 |
| V11 | Dùng đối tượng ngừng dùng | 1/1 |

## Misclassified cases (0)


## Versus LLM-as-judge (simulated, 3 runs, 202 cases)

| Checker | Recall | False alarms | Stability across runs | Cost / case | Latency |
|---|---|---|---|---|---|
| Lineage verifier | 100.0% | 0.0% | 100% | 0 USD | 11.9 ms |
| Judge mock-large | 64.8% | 8.3% | 74.8% | 0.000631 USD | ~1800 ms |
| Judge mock-small | 60.3% | 23.9% | 48.5% | 3.8e-05 USD | ~700 ms |

> The judge is a mock with injected noise; these rows check the comparison harness, not a real model.
