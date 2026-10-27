"""Đánh giá. Chạy: python -m lvda.evaluation [verifier|agent|all]

1. Bộ kiểm định (thật, tất định) trên tập SQL có nhãn, hai nguồn (EVAL-02):
   (a) gài lỗi có chủ đích vào SQL chuẩn; (b) câu SQL đầu tiên của agent, nhãn = lỗi cài sẵn trong mock.
2. Agent theo cấu hình (EVAL-04) trên benchmark ≥ 100 câu (EVAL-01). LLM đang là mock nên chỉ để kiểm luồng.
Mỗi lần chạy ghi báo cáo eval/results/<kind>-latest.{json,md} (EVAL-06).
"""

from __future__ import annotations

import json
import statistics
import sys
import time
from collections import Counter

import sqlglot
from sqlglot import exp

from lvda import config, db
from lvda.agent import mock_llm
from lvda.agent.nlu import interpret
from lvda.agent.pipeline import answer_question
from lvda.agent.retrieval import get_index, tables_of
from lvda.catalog import get_catalog
from lvda.llm import LLM, MODELS, JudgeVerdict
from lvda.metrics import list_metrics
from lvda.verifier import verify
from lvda.verifier.rules import TITLES

GLOBAL_BROKEN = [
    ("V09", "Join geolocation theo zip_code_prefix",
     "SELECT g.state, COUNT(DISTINCT c.customer_unique_id) AS n FROM mart.dim_customers AS c "
     "JOIN mart.dim_geolocation AS g ON g.zip_code_prefix = c.zip_code_prefix GROUP BY g.state"),
    ("V09", "Join người bán với khách theo bang",
     "SELECT s.state, COUNT(*) AS n FROM mart.dim_sellers AS s JOIN mart.dim_customers AS c ON c.state = s.state GROUP BY s.state"),
    ("V10", "Trả danh sách khách ở mức dòng",
     "SELECT o.customer_unique_id, o.customer_city FROM mart.fct_orders AS o WHERE o.order_status = 'delivered'"),
    ("V10", "Trả tọa độ ở mức dòng", "SELECT g.zip_code_prefix, g.lat, g.lng FROM mart.dim_geolocation AS g"),
    ("V11", "Đọc bảng đã ngừng dùng", "SELECT COUNT(DISTINCT v.order_id) AS n FROM mart.fct_orders_v1 AS v"),
    ("V01", "Cột không tồn tại", "SELECT SUM(o.total_amount) AS total FROM mart.fct_orders AS o"),
    ("V01", "Bảng không tồn tại", "SELECT COUNT(*) FROM mart.fct_sales AS s"),
    ("V07", "Đếm khách theo customer_id (không định nghĩa)",
     "SELECT o.customer_state, COUNT(DISTINCT o.customer_id) AS n FROM mart.fct_orders AS o GROUP BY o.customer_state"),
]
RESULTS_DIR = config.EVAL_DIR / "results"


def _aliases(sql: str) -> set[str]:
    return {t.alias_or_name for t in sqlglot.parse_one(sql, read="postgres").find_all(exp.Table)}


def _pct(values: list[float], q: float) -> float:
    if not values:
        return 0
    s = sorted(values)
    return round(s[min(len(s) - 1, max(0, int(round(q * len(s))) - 1))], 1)


def load_benchmark() -> list[dict]:
    return json.loads((config.EVAL_DIR / "benchmark.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------- bộ kiểm định
def build_verifier_cases(metrics: list[dict], benchmark: list[dict]) -> list[dict]:
    cases: list[dict] = []
    seen: set[str] = set()

    def add(kind, source, metric, expected, label, sql):
        key = " ".join(sql.split()).lower() + "|" + (metric["id"] if metric else "")
        if key in seen:
            return
        seen.add(key)
        cases.append({"id": f"c{len(cases) + 1:03d}", "kind": kind, "source": source, "metric_id": metric["id"] if metric else None,
                      "expected": expected, "label": label, "sql": sql})

    for m in metrics:
        sql = m["canonical_sql"].strip()
        aliases = _aliases(sql)
        q = sqlglot.parse_one(sql, read="postgres")
        upper = sql.upper()
        # (a0) câu đúng
        add("correct", "mutation", m, [], "SQL chuẩn", sql)
        add("correct", "mutation", m, [], "Lọc thời gian đúng cột", mock_llm.build(m, {"time": {"start": "2018-01-01", "end": "2018-04-01"}})[0])
        add("correct", "mutation", m, [], "Chia theo bang", mock_llm.build(m, {"dimension": "customer_state"})[0])
        add("correct", "mutation", m, [], "Chia theo tháng", mock_llm.build(m, {"dimension": "month"})[0])
        add("correct", "mutation", m, [], "Chia theo loại thanh toán, lọc lần trả đầu", mock_llm.reference_sql(m, {"dimension": "payment_type"}))
        # (a) gài lỗi
        if m.get("required_filters"):
            no_where = q.copy()
            no_where.set("where", None)
            add("broken", "mutation", m, ["V03"], "Bỏ bộ lọc bắt buộc", no_where.sql(dialect="postgres"))
            if "= 'delivered'" in sql:
                add("broken", "mutation", m, ["V04"], "Đổi giá trị lọc", sql.replace("= 'delivered'", "IN ('delivered', 'shipped')"))
            elif "NOT IN ('canceled', 'unavailable')" in sql:
                add("broken", "mutation", m, ["V04"], "Đổi giá trị lọc", sql.replace("NOT IN ('canceled', 'unavailable')", "<> 'canceled'"))
            elif "= TRUE" in sql:
                add("broken", "mutation", m, ["V04"], "Đổi giá trị lọc", sql.replace("= TRUE", "= FALSE"))
        if m["id"] in mock_llm.WRONG_BASE and "payment_value" in mock_llm.WRONG_BASE[m["id"]][0]:
            add("broken", "mutation", m, ["V02"], "Lấy payment_value làm doanh thu", mock_llm.WRONG_BASE[m["id"]][0])
        if "i" in aliases and mock_llm.needs_unique_payment(sql):
            add("broken", "mutation", m, ["V05"], "Join thêm thanh toán (nhân dòng)", mock_llm.build(m, {"dimension": "payment_type"})[0])
        if aliases == {"o"} and mock_llm.needs_unique_payment(sql):
            add("broken", "mutation", m, ["V05"], "Join thêm món hàng (nhân dòng)",
                sqlglot.parse_one(sql, read="postgres").join("mart.fct_order_items AS i", on="i.order_id = o.order_id").sql(dialect="postgres"))
        if aliases == {"r"}:
            add("broken", "mutation", m, ["V05"], "Join thêm món hàng (nhân dòng)",
                sqlglot.parse_one(sql, read="postgres").join("mart.fct_orders AS o", on="o.order_id = r.order_id")
                .join("mart.fct_order_items AS i", on="i.order_id = o.order_id").sql(dialect="postgres"))
        if "COUNT(DISTINCT " in upper:
            add("broken", "mutation", m, ["V06"], "Bỏ DISTINCT", sql.replace("COUNT(DISTINCT ", "COUNT("))
        if "SUM(" in upper and "/" not in sql:
            add("broken", "mutation", m, ["V06"], "Đổi SUM thành AVG", sql.replace("SUM(", "AVG("))
        if "customer_unique_id" in sql:
            add("broken", "mutation", m, ["V07"], "Đếm theo customer_id", sql.replace("customer_unique_id", "customer_id"))
        if m["time_column"].endswith("purchased_at") and "o" in aliases:
            add("broken", "mutation", m, ["V08"], "Lọc thời gian theo ngày giao",
                sqlglot.parse_one(sql, read="postgres").where("o.delivered_at >= '2018-01-01' AND o.delivered_at < '2018-04-01'")
                .sql(dialect="postgres"))
    for rule, label, sql in GLOBAL_BROKEN:
        add("broken", "mutation", None, [rule], label, sql)

    # (b) lỗi thật của agent, lấy từ nhật ký app.agent_logs (câu SQL đầu tiên model viết ra).
    # Nhãn = lỗi model mock đã cài; khi có model thật, nhãn do người gán.
    by_id = {m["id"]: m for m in metrics}
    logs = db.fetch_all(
        """SELECT DISTINCT ON (sql) question, sql, injected, model FROM app.agent_logs
           WHERE jsonb_array_length(coalesce(injected, '[]'::jsonb)) > 0 ORDER BY sql, id""")
    for row in logs:
        interp = interpret(row["question"], metrics)
        m = by_id.get(interp.get("metric_id") or "")
        if m:
            add("broken", "agent_log", m, list(row["injected"]), f"Log agent ({row['model']}): {row['question']}", row["sql"])
    if not logs:  # chưa có nhật ký: sinh lại từ benchmark để tập đánh giá không rỗng
        for item in benchmark:
            m = by_id.get(item.get("metric_id") or "")
            if not m or item.get("expect"):
                continue
            interp = interpret(item["question"], metrics)
            rules = mock_llm.mistake_rules(m["id"], interp)
            if rules:
                sql, mistake = mock_llm.build(m, interp, wrong=True)
                add("broken", "agent_sim", m, rules, f"Agent (sinh lại): {mistake}", sql)
    return cases


def run_verifier_eval(database_id: int, user_id: int | None) -> dict:
    cat = get_catalog()
    metrics = [{**m, "status": "certified"} for m in list_metrics(database_id) if m["status"] != "deprecated"]
    by_id = {m["id"]: m for m in metrics}
    cases = build_verifier_cases(metrics, load_benchmark())
    items, per_rule, per_source = [], {}, {}
    latencies = []
    for c in cases:
        v = verify(c["sql"], cat, by_id.get(c["metric_id"]) if c["metric_id"] else None)
        latencies.append(v["elapsed_ms"])
        fired = sorted({f["rule"] for f in v["findings"] if f["severity"] != "info"})
        if c["kind"] == "correct":
            ok = not any(f["severity"] in ("high", "medium") for f in v["findings"])
        else:
            caught = [r for r in c["expected"] if r in fired]
            ok = len(caught) == len(c["expected"])
            for r in c["expected"]:
                pr = per_rule.setdefault(r, {"rule": r, "title": TITLES[r], "total": 0, "caught": 0})
                pr["total"] += 1
                pr["caught"] += r in fired
            ps = per_source.setdefault(c["source"], {"source": c["source"], "total": 0, "caught": 0})
            ps["total"] += 1
            ps["caught"] += ok
        items.append({**c, "verdict": v["verdict"], "fired": fired, "ok": ok, "ms": v["elapsed_ms"]})
    broken = [i for i in items if i["kind"] == "broken"]
    correct = [i for i in items if i["kind"] == "correct"]
    summary = {
        "broken_total": len(broken), "broken_caught": sum(i["ok"] for i in broken),
        "correct_total": len(correct), "false_alarms": sum(not i["ok"] for i in correct),
        "recall": round(sum(i["ok"] for i in broken) / max(len(broken), 1), 4),
        "false_alarm_rate": round(sum(not i["ok"] for i in correct) / max(len(correct), 1), 4),
        "per_rule": sorted(per_rule.values(), key=lambda r: r["rule"]),
        "per_source": sorted(per_source.values(), key=lambda r: r["source"]),
        "latency_p50_ms": _pct(latencies, 0.5), "latency_p95_ms": _pct(latencies, 0.95),
    }
    summary["llm_judge"] = run_judge(cases, by_id, summary)
    return _store(database_id, user_id, "verifier", summary, items)


JUDGE_RUNS = 3


def run_judge(cases: list[dict], by_id: dict[str, dict], verifier: dict) -> dict:
    """EVAL-05: LLM-as-judge (mô phỏng) trên cùng tập SQL, chạy 3 lần để đo độ ổn định."""
    models = []
    for model, info in MODELS.items():
        runs: list[list[bool]] = []
        cost = 0.0
        tokens = 0
        for seed in range(JUDGE_RUNS):
            llm = LLM(model, cache=True, seed=seed)
            flagged = []
            for c in cases:
                m = by_id.get(c["metric_id"] or "")
                payload = {"sql": c["sql"], "metric": {k: m[k] for k in ("id", "name_vi", "canonical_sql", "required_filters")} if m else None}
                res = llm.structured("judge_sql", payload, JudgeVerdict)
                flagged.append(not res.data.correct)
                cost += res.cost_usd
                tokens += res.tokens_in + res.tokens_out
            runs.append(flagged)
        broken = [i for i, c in enumerate(cases) if c["kind"] == "broken"]
        correct = [i for i, c in enumerate(cases) if c["kind"] == "correct"]
        recalls = [sum(r[i] for i in broken) / max(len(broken), 1) for r in runs]
        fprs = [sum(r[i] for i in correct) / max(len(correct), 1) for r in runs]
        stable = sum(1 for i in range(len(cases)) if len({r[i] for r in runs}) == 1) / max(len(cases), 1)
        models.append({"model": model, "label": info["label"], "recall": round(statistics.mean(recalls), 4),
                       "recall_runs": [round(x, 4) for x in recalls], "false_alarm_rate": round(statistics.mean(fprs), 4),
                       "false_alarm_runs": [round(x, 4) for x in fprs], "stability": round(stable, 4),
                       "cost_per_case_usd": round(cost / (JUDGE_RUNS * len(cases)), 6),
                       "tokens_per_case": round(tokens / (JUDGE_RUNS * len(cases))), "latency_ms_est": info["latency_ms"]})
    return {"runs": JUDGE_RUNS, "cases": len(cases), "models": models,
            "verifier": {"recall": verifier["recall"], "false_alarm_rate": verifier["false_alarm_rate"], "stability": 1.0,
                         "cost_per_case_usd": 0.0, "latency_ms": verifier["latency_p50_ms"]},
            "note": "Judge là LLM mô phỏng: đọc SQL như văn bản, có nhiễu giữa các lần chạy. Cần model thật để có số đo thật."}


# ---------------------------------------------------------------- agent
def _rows_equal(a: dict | None, b: dict | None) -> bool:
    """So tập kết quả: không phụ thuộc thứ tự dòng; số so theo sai số tương đối 0,01%."""
    if a is None or b is None or len(a["rows"]) != len(b["rows"]):
        return False

    def key(r):
        return tuple(str(v) for v in r[:-1])

    ra, rb = sorted(a["rows"], key=key), sorted(b["rows"], key=key)
    for x, y in zip(ra, rb, strict=False):
        if key(x) != key(y):
            return False
        vx, vy = x[-1], y[-1]
        if isinstance(vx, (int, float)) and isinstance(vy, (int, float)):
            if abs(vx - vy) > 1e-4 * max(abs(vy), 1e-9):
                return False
        elif vx != vy:
            return False
    return True


CONFIGS = [
    {"id": "A", "label": "Agent trơn", "retrieval": False, "verifier": False, "fix": False},
    {"id": "B", "label": "+ Truy xuất chỉ số và truy vấn mẫu", "retrieval": True, "verifier": False, "fix": False},
    {"id": "C", "label": "+ Kiểm định (chỉ gắn nhãn)", "retrieval": True, "verifier": True, "fix": False},
    {"id": "D", "label": "+ Kiểm định + tự sửa", "retrieval": True, "verifier": True, "fix": True},
]


def retrieval_recall(database_id: int, questions: list[dict], metrics: list[dict], k: int = 5) -> dict:
    """AGT-02: recall@k của bảng cần dùng (lấy từ SQL chuẩn) trong top-k bảng truy xuất được."""
    index = get_index(database_id, refresh=True)
    scores, full = [], 0
    misses = []
    for q in questions:
        if not q.get("gold_sql"):
            continue
        need = {t for t in tables_of(q["gold_sql"]) if t.startswith("mart.")}
        got = {x["table"] for x in index.search(q["question"], interpret(q["question"], metrics), k)["tables"]}
        r = len(need & got) / len(need)
        scores.append(r)
        full += r == 1
        if r < 1 and len(misses) < 5:
            misses.append({"question": q["question"], "missing": sorted(need - got)})
    return {"k": k, "questions": len(scores), "recall": round(statistics.mean(scores), 4) if scores else 0,
            "full_recall_share": round(full / max(len(scores), 1), 4), "misses": misses}


def intent_accuracy(metrics: list[dict]) -> dict:
    """AGT-01 / MET-04: trên tập 50 câu gán nhãn tay (eval/intent_set.json)."""
    items = json.loads((config.EVAL_DIR / "intent_set.json").read_text(encoding="utf-8"))
    ok_i = ok_m = n_m = 0
    errors = []
    for it in items:
        r = interpret(it["q"], metrics)
        good_i = r["kind"] == it["intent"]
        ok_i += good_i
        good_m = True
        if it["metric"]:
            n_m += 1
            good_m = r.get("metric_id") == it["metric"]
            ok_m += good_m
        if not (good_i and good_m):
            errors.append({"question": it["q"], "expected": [it["intent"], it["metric"]], "got": [r["kind"], r.get("metric_id")]})
    return {"total": len(items), "intent_correct": ok_i, "intent_accuracy": round(ok_i / len(items), 4),
            "metric_total": n_m, "metric_correct": ok_m, "metric_accuracy": round(ok_m / max(n_m, 1), 4), "errors": errors}


def run_agent_eval(database_id: int, user_id: int | None) -> dict:
    questions = load_benchmark()
    metrics = list_metrics(database_id)
    golds = {q["id"]: db.run_readonly(q["gold_sql"]) for q in questions if q.get("gold_sql")}
    table, items = [], []
    taxonomy: Counter = Counter()
    examples: dict[str, str] = {}
    for model in MODELS:
      llm = LLM(model, cache=True)
      for cfg in CONFIGS:
        counts = {"correct": 0, "wrong_silent": 0, "wrong_flagged": 0, "held": 0, "total": 0}
        lat, tokens, costs, retries = [], [], [], 0
        refusals = {"expected": 0, "correct": 0}
        hits_before = llm.stats["cache_hits"]
        calls_before = llm.stats["calls"]
        for q in questions:
            t0 = time.perf_counter()
            run = answer_question(database_id, user_id, q["question"], simulate_mistakes=True, persist=False,
                                  use_retrieval=cfg["retrieval"], use_verifier=cfg["verifier"], allow_fix=cfg["fix"],
                                  settings={}, llm=llm, log_agent=cfg["id"] in ("A", "B"))
            lat.append((time.perf_counter() - t0) * 1000)
            tokens.append(run["usage"]["tokens"])
            costs.append(run["usage"]["cost_usd"])
            retries += run["usage"].get("retries", 0)
            counts["total"] += 1
            expect = q.get("expect")
            if expect == "refuse":
                refusals["expected"] += 1
                outcome = "correct" if run["status"] == "refused" else "wrong_silent"
                refusals["correct"] += outcome == "correct"
            elif expect == "definition":
                outcome = "correct" if run["status"] == "definition" and (run.get("metric") or {}).get("id") == q["metric_id"] else "wrong_silent"
            elif run["status"] == "held":
                outcome = "held"
            elif _rows_equal(run.get("result"), golds.get(q["id"])):
                outcome = "correct"
            else:
                outcome = "wrong_flagged" if run.get("final_verdict") in ("red", "yellow") else "wrong_silent"
            counts[outcome] += 1
            if model == "mock-small" and cfg["id"] == "D" and run["attempts"]:
                for f in run["attempts"][0]["verification"]["findings"]:
                    if f["severity"] != "info":
                        taxonomy[f["rule"]] += 1
                        examples.setdefault(f["rule"], q["question"])
            items.append({"model": model, "config": cfg["id"], "question_id": q["id"], "question": q["question"],
                          "category": q["category"], "difficulty": q["difficulty"], "outcome": outcome,
                          "verdict": run.get("final_verdict"), "attempts": len(run["attempts"])})
        table.append({**cfg, **counts, "model": model, "accuracy": round(counts["correct"] / counts["total"], 4),
                      "latency_avg_ms": round(sum(lat) / len(lat), 1), "latency_p50_ms": _pct(lat, 0.5),
                      "latency_p95_ms": _pct(lat, 0.95), "tokens_avg": round(sum(tokens) / len(tokens)),
                      "cost_avg_usd": round(sum(costs) / len(costs), 6), "schema_retries": retries,
                      "cache_hits": llm.stats["cache_hits"] - hits_before, "llm_calls": llm.stats["calls"] - calls_before,
                      "refusal_correct": refusals["correct"], "refusal_expected": refusals["expected"]})
    acc = {(c["model"], c["id"]): c["accuracy"] for c in table}
    summary = {
        "configs": table, "questions": len(questions), "llm": "mock", "models": list(MODELS),
        "fix_gain_pts": {m: round((acc[(m, "D")] - acc[(m, "C")]) * 100, 1) for m in MODELS},
        "taxonomy": [{"rule": r, "title": TITLES[r], "count": n, "example": examples[r]} for r, n in taxonomy.most_common()],
        "categories": dict(Counter(q["category"] for q in questions)),
        "retrieval": retrieval_recall(database_id, questions, metrics),
        "intent": intent_accuracy(metrics),
        "note": "LLM đang là mock có lỗi cài sẵn; số liệu chỉ để kiểm tra luồng, không đại diện cho model thật.",
    }
    return _store(database_id, user_id, "agent", summary, items)


# ---------------------------------------------------------------- lưu + báo cáo
def _store(database_id: int, user_id: int | None, kind: str, summary: dict, items: list[dict]) -> dict:
    row = db.execute("INSERT INTO app.eval_runs (database_id, kind, summary, items, created_by) VALUES (%s,%s,%s,%s,%s) RETURNING id, created_at",
                     (database_id, kind, db.jsonb(summary), db.jsonb(items), user_id))
    out = {"id": row["id"], "created_at": row["created_at"], "kind": kind, "summary": summary, "items": items}
    write_report(out)
    return out


def write_report(run: dict) -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    kind, s = run["kind"], run["summary"]
    (RESULTS_DIR / f"{kind}-latest.json").write_text(json.dumps(run, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    lines = [f"# {'Verifier' if kind == 'verifier' else 'Agent'} evaluation — run #{run['id']} ({run['created_at']})", ""]
    if kind == "verifier":
        lines += [f"- Caught: **{s['broken_caught']}/{s['broken_total']}** broken SQL (recall {s['recall']:.1%})",
                  f"- False alarms: **{s['false_alarms']}/{s['correct_total']}** correct SQL ({s['false_alarm_rate']:.1%})",
                  f"- Check latency: p50 {s['latency_p50_ms']} ms, p95 {s['latency_p95_ms']} ms", "",
                  "| Source | Caught |", "|---|---|"]
        lines += [f"| {p['source']} | {p['caught']}/{p['total']} |" for p in s["per_source"]]
        lines += ["", "| Rule | Title | Caught |", "|---|---|---|"]
        lines += [f"| {r['rule']} | {r['title']} | {r['caught']}/{r['total']} |" for r in s["per_rule"]]
        misses = [i for i in run["items"] if not i["ok"]]
        lines += ["", f"## Misclassified cases ({len(misses)})", ""] + [f"- {i['label']} ({i['metric_id']}): expected {i['expected']}, fired {i['fired']}" for i in misses]
        j = s.get("llm_judge")
        if j:
            lines += ["", f"## Versus LLM-as-judge (simulated, {j['runs']} runs, {j['cases']} cases)", "",
                      "| Checker | Recall | False alarms | Stability across runs | Cost / case | Latency |", "|---|---|---|---|---|---|",
                      f"| Lineage verifier | {j['verifier']['recall']:.1%} | {j['verifier']['false_alarm_rate']:.1%} | 100% | 0 USD | {j['verifier']['latency_ms']} ms |"]
            lines += [f"| Judge {m['model']} | {m['recall']:.1%} | {m['false_alarm_rate']:.1%} | {m['stability']:.1%} | "
                      f"{m['cost_per_case_usd']} USD | ~{m['latency_ms_est']} ms |" for m in j["models"]]
            lines += ["", "> The judge is a mock with injected noise; these rows check the comparison harness, not a real model."]
    else:
        r, it = s["retrieval"], s["intent"]
        lines += ["> The LLM is a mock with built-in mistakes; numbers validate the pipeline, they do not represent a real model.", "",
                  f"{s['questions']} questions · models: {', '.join(s['models'])}", "",
                  f"- Intent classification (AGT-01): {it['intent_correct']}/{it['total']} = {it['intent_accuracy']:.1%}",
                  f"- Metric matching (MET-04): {it['metric_correct']}/{it['metric_total']} = {it['metric_accuracy']:.1%}",
                  f"- Table retrieval recall@{r['k']} (AGT-02): {r['recall']:.1%} (all tables found for {r['full_recall_share']:.1%} of questions)", "",
                  "| Model | Config | Correct | Wrong, flagged | Held | Wrong, silent | Accuracy | p50 | p95 | Avg cost | Schema retries | Correct refusals |",
                  "|---|---|---|---|---|---|---|---|---|---|---|---|"]
        lines += [f"| {c['model']} | {c['id']} | {c['correct']} | {c['wrong_flagged']} | {c['held']} | {c['wrong_silent']} | "
                  f"{c['accuracy']:.1%} | {c['latency_p50_ms']} ms | {c['latency_p95_ms']} ms | {c['cost_avg_usd']} USD | "
                  f"{c['schema_retries']} | {c['refusal_correct']}/{c['refusal_expected']} |" for c in s["configs"]]
        lines += ["", "Configs: A = schema only · B = + metric/verified-query retrieval · C = + verifier labels · D = + self-fix.", "",
                  "## First-attempt error taxonomy (mock-small, config D)", "", "| Rule | Count | Example question |", "|---|---|---|"]
        lines += [f"| {t['rule']} | {t['count']} | {t['example']} |" for t in s["taxonomy"]]
        if it["errors"]:
            lines += ["", "## Misclassified questions", ""] + [f"- {e['question']}: expected {e['expected']}, got {e['got']}" for e in it["errors"]]
    (RESULTS_DIR / f"{kind}-latest.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def latest(database_id: int) -> dict:
    out = {}
    for kind in ("verifier", "agent"):
        out[kind] = db.fetch_one(
            """SELECT e.id, e.kind, e.summary, e.items, e.created_at, u.name AS created_by_name FROM app.eval_runs e
               LEFT JOIN app.users u ON u.id = e.created_by WHERE e.database_id = %s AND e.kind = %s
               ORDER BY e.id DESC LIMIT 1""", (database_id, kind))
    return out


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what not in ("verifier", "agent", "all"):
        sys.exit("usage: python -m lvda.evaluation [verifier|agent|all]")
    # agent first: its failed attempts land in agent_logs and become verifier cases
    if what in ("agent", "all"):
        a = run_agent_eval(1, None)["summary"]
        for c in a["configs"]:
            print(f"agent {c['model']} {c['id']}: correct {c['correct']}/{c['total']}, silent wrong {c['wrong_silent']}, "
                  f"{c['cost_avg_usd']:.5f} USD/question")
        print(f"intent {a['intent']['intent_accuracy']:.1%}, metric {a['intent']['metric_accuracy']:.1%}, "
              f"retrieval recall@{a['retrieval']['k']} {a['retrieval']['recall']:.1%}")
    if what in ("verifier", "all"):
        s = run_verifier_eval(1, None)["summary"]
        print(f"verifier: caught {s['broken_caught']}/{s['broken_total']}, false alarms {s['false_alarms']}/{s['correct_total']}")
    print(f"reports: {RESULTS_DIR}")
