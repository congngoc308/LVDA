"""Luồng xử lý một câu hỏi: hiểu → sinh SQL → kiểm định → (tự sửa) → chạy → đối chiếu → soạn trả lời → lưu.

Mỗi bước được ghi vào trace (OBS-01) và log JSON có request_id (OBS-02).
"""

from __future__ import annotations

import json
import logging
import re
import time
import uuid

import psycopg

from lvda import config, db
from lvda.agent import mock_llm
from lvda.agent.answer import compose, guard_numbers
from lvda.agent.nlu import interpret, looks_like_sql, normalize_question
from lvda.agent.retrieval import get_index
from lvda.catalog import get_catalog
from lvda.llm import LLM, AnswerText, CallResult, SqlDraft
from lvda.metrics import list_metrics
from lvda.settings import get_settings
from lvda.verifier import detect_metric, guard, verify
from lvda.verifier.fingerprint import analyze

log = logging.getLogger("lvda.pipeline")


class Trace:
    def __init__(self, request_id: str | None):
        self.request_id = request_id or uuid.uuid4().hex[:12]
        self.steps: list[dict] = []
        self.t0 = time.perf_counter()
        self.tokens = 0
        self.cost = 0.0
        self.retries = 0
        self.cache_hits = 0

    def add(self, step: str, started: float, **detail) -> dict:
        entry = {"step": step, "ms": round((time.perf_counter() - started) * 1000, 1), **detail}
        self.steps.append(entry)
        log.info(json.dumps({"request_id": self.request_id, **entry}, ensure_ascii=False, default=str)[:2000])
        return entry

    def llm(self, step: str, started: float, prompt: str, output: str, **detail) -> None:
        tokens = (len(prompt) + len(output)) // 4 + 300
        self.tokens += tokens
        self.add(step, started, kind="llm", tokens=tokens, input=prompt[:600], output=output[:1200], **detail)

    def call(self, step: str, started: float, res: CallResult, **detail) -> None:
        """Ghi một lời gọi model qua lớp llm.py: token, chi phí, số lần thử lại, cache."""
        tokens = res.tokens_in + res.tokens_out
        self.tokens += tokens
        self.cost += res.cost_usd
        self.retries += res.retries
        self.cache_hits += int(res.cache_hit)
        self.add(step, started, kind="llm", tokens=tokens, cost_usd=res.cost_usd, retries=res.retries,
                 cache_hit=res.cache_hit, schema_errors=res.errors, input=res.prompt[:1500], output=res.raw[:1500], **detail)

    @property
    def total_ms(self) -> int:
        return round((time.perf_counter() - self.t0) * 1000)


def _execute(sql: str) -> tuple[dict | None, str | None]:
    try:
        return db.run_readonly(sql), None
    except psycopg.errors.QueryCanceled:
        return None, "Truy vấn chạy quá 10 giây nên đã bị hủy."
    except psycopg.Error as e:
        return None, f"Lỗi khi chạy SQL: {str(e).splitlines()[0]}"


def _verified_sql(database_id: int, question: str) -> str | None:
    row = db.fetch_one(
        "SELECT sql FROM app.verified_queries WHERE database_id = %s AND question_norm = %s AND active ORDER BY id DESC LIMIT 1",
        (database_id, normalize_question(question)))
    return row["sql"] if row else None


def context_from_run(run_id: str | None, database_id: int) -> dict | None:
    if not run_id:
        return None
    row = db.fetch_one("SELECT interpretation FROM app.qa_runs WHERE id = %s AND database_id = %s", (run_id, database_id))
    return row["interpretation"] if row and row["interpretation"] else None


def _norm_sql(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip().lower()


def reconcile(result: dict, reference: dict) -> dict:
    """VER-06: so kết quả với SQL chuẩn cùng bộ lọc. Khóa = các cột trừ cột cuối; giá trị = cột cuối."""
    def as_map(res):
        return {tuple(r[:-1]): r[-1] for r in res["rows"]}

    a, b = as_map(result), as_map(reference)
    worst, missing = 0.0, sorted(set(b) ^ set(a), key=str)[:5]
    for k, ref in b.items():
        got = a.get(k)
        if isinstance(ref, (int, float)) and isinstance(got, (int, float)):
            diff = abs(got - ref) / max(abs(ref), 1e-9)
            worst = max(worst, diff)
    status = "match" if worst <= 0.005 and not missing else "mismatch"
    return {"status": status, "max_diff_pct": round(worst * 100, 2), "missing_keys": [list(k) for k in missing],
            "rows_compared": len(b)}


def answer_question(database_id: int, user_id: int | None, question: str, *, simulate_mistakes: bool = True,
                    context_run_id: str | None = None, metric_id: str | None = None, persist: bool = True,
                    use_verifier: bool = True, allow_fix: bool = True, use_retrieval: bool = True,
                    request_id: str | None = None, settings: dict | None = None, model: str | None = None,
                    llm: LLM | None = None, log_agent: bool = True) -> dict:
    trace = Trace(request_id)
    cat = get_catalog()
    metrics = list_metrics(database_id)
    if settings is None:
        settings = get_settings(database_id)
    llm = llm or LLM(model or settings.get("llm_model") or config.LLM_MODEL)
    run: dict = {"id": "qa_" + uuid.uuid4().hex[:12], "question": question, "attempts": [], "result": None,
                 "answer": None, "error": None, "request_id": trace.request_id}

    def finish() -> dict:
        run["usage"] = {"llm": llm.info.get("provider", config.LLM_PROVIDER), "model": llm.model, "tokens": trace.tokens,
                        "cost_usd": round(trace.cost, 6), "retries": trace.retries, "cache_hits": trace.cache_hits,
                        "latency_ms": trace.total_ms, "steps": trace.steps}
        return _persist(database_id, user_id, run) if persist else run

    # ---- Chế độ kiểm SQL ----
    if looks_like_sql(question):
        run["input_kind"] = "sql"
        t = time.perf_counter()
        an_metric = next((m for m in metrics if m["id"] == metric_id), None) if metric_id else None
        detected = False
        if an_metric is None:
            g = guard.check(question, cat.allowed_schemas)
            if g.tree is not None:
                an_metric = detect_metric(analyze(g.tree, cat), [m for m in metrics if m["status"] == "certified"], cat)
                detected = an_metric is not None
        trace.add("detect_metric", t, metric=an_metric["id"] if an_metric else None, detected=detected)
        t = time.perf_counter()
        v = verify(question, cat, an_metric, settings)
        trace.add("verify", t, kind="tool", verdict=v["verdict"], rules=[f["rule"] for f in v["findings"]])
        run.update(intent="sql", metric=an_metric,
                   interpretation={"kind": "sql", "metric_id": an_metric["id"] if an_metric else None, "detected": detected})
        run["attempts"].append({"no": 0, "sql": question, "source": "user", "verdict": v["verdict"], "verification": v,
                                "notes": [], "latency_ms": v["elapsed_ms"]})
        run["final_verdict"], run["final_sql"] = v["verdict"], question
        if v["verdict"] == "blocked":
            run["status"] = "blocked"
        elif v["executable"]:
            t = time.perf_counter()
            run["result"], run["error"] = _execute(question)
            trace.add("execute", t, kind="tool", rows=len(run["result"]["rows"]) if run["result"] else 0, error=run["error"])
            run["status"] = "checked" if not run["error"] else "error"
        else:
            run["status"] = "checked"
        return finish()

    # ---- Chế độ hỏi ----
    run["input_kind"] = "question"
    t = time.perf_counter()
    interp = interpret(question, metrics, context_from_run(context_run_id, database_id), metric_id)
    trace.llm("interpret", t, prompt=question, output=json.dumps(interp, ensure_ascii=False, default=str), intent=interp["kind"])
    run["interpretation"] = interp
    run["intent"] = interp["kind"]
    if interp["kind"] == "out_of_scope":
        lead = interp.get("reason") or "Mình chưa tìm thấy chỉ số nào khớp với câu hỏi."
        run.update(status="refused", final_verdict=None, final_sql=None,
                   answer={"text": f"{lead} Mình không viết SQL để tránh đoán sai. "
                                   "Thử hỏi về: " + ", ".join(interp["suggestions"]) + ".", "headline": None})
        return finish()
    if interp["kind"] == "adhoc":
        _answer_adhoc(run, interp, question, llm, trace, cat, settings)
        return finish()

    metric = next(m for m in metrics if m["id"] == interp["metric_id"])
    run["metric"] = metric
    if interp["kind"] == "definition":
        run.update(status="definition", final_verdict=None, final_sql=metric["canonical_sql"],
                   answer={"text": f"{metric['name_vi']}: {metric['description']}", "headline": None})
        t = time.perf_counter()
        v = verify(metric["canonical_sql"], cat, metric, settings)
        trace.add("verify", t, kind="tool", verdict=v["verdict"])
        run["attempts"].append({"no": 0, "sql": metric["canonical_sql"], "source": "metric", "verdict": v["verdict"],
                                "verification": v, "notes": ["Định nghĩa chuẩn của chỉ số"], "latency_ms": v["elapsed_ms"]})
        return finish()

    if not mock_llm.supports(metric, interp.get("dimension")):
        run.update(status="refused", final_verdict=None, final_sql=None,
                   answer={"text": f"Chưa hỗ trợ chia “{metric['name_vi']}” theo {interp['dimension_label'].lower()}: "
                                   "join thêm bảng món hàng sẽ làm nhân dòng và bản mock chưa có cách gộp trước. "
                                   "Hãy thử chia theo bang, tháng hoặc loại thanh toán.", "headline": None})
        return finish()

    # Truy xuất ngữ cảnh (cấu hình B trở lên): định nghĩa chỉ số, bảng liên quan, truy vấn mẫu
    context: dict = {"tables": [], "examples": []}
    if use_retrieval:
        t = time.perf_counter()
        context = get_index(database_id).search(question, interp)
        trace.add("retrieve", t, kind="tool", tables=[x["table"] for x in context["tables"]],
                  examples=len(context["examples"]), metric=metric["id"])
    t = time.perf_counter()
    verified = _verified_sql(database_id, question) if persist else None
    injected: list[str] = []
    if verified:
        sql, source, mistake = verified, "verified", None
        trace.add("retrieve_verified", t, kind="tool", hit=True)
    else:
        payload = {"question": question, "interp": interp, "metric_id": metric["id"], "simulate": simulate_mistakes,
                   "has_definition": use_retrieval, "_metric": metric, "_database_id": database_id}
        if use_retrieval:
            payload.update(definition=metric["canonical_sql"], required_filters=metric.get("required_filters", []),
                           tables=[x["table"] for x in context["tables"]],
                           examples=[{"question": e["question"], "sql": e["sql"]} for e in context["examples"]])
        res = llm.structured("generate_sql", payload, SqlDraft)
        sql, source = res.data.sql, "llm"
        mistake = "; ".join(res.data.assumptions) or None
        injected = json.loads(res.raw).get("_injected", []) if res.raw.startswith("{") else []
        trace.call("generate_sql", t, res, attempt=0)

    extra: list[str] = []
    final = None
    rounds = config.MAX_FIX_ROUNDS if (use_verifier and allow_fix) else 0
    for attempt_no in range(rounds + 1):
        ta = time.perf_counter()
        if use_verifier:
            v = verify(sql, cat, metric, settings)
        else:
            v = {"verdict": "unchecked", "findings": [], "executable": True, "fingerprint": None, "elapsed_ms": 0}
        trace.add("verify", ta, kind="tool", attempt=attempt_no, verdict=v["verdict"],
                  rules=[f["rule"] for f in v["findings"] if f["severity"] != "info"])
        notes = [f"LLM (mô phỏng) mắc lỗi: {mistake}"] if attempt_no == 0 and mistake else []
        run["attempts"].append({"no": attempt_no, "sql": sql, "source": source, "verdict": v["verdict"], "verification": v,
                                "notes": notes, "latency_ms": round((time.perf_counter() - ta) * 1000, 1)})
        final = v
        if attempt_no == 0 and source == "llm" and log_agent:
            _log_agent(database_id, run["id"], llm.model, question, sql, injected, v["verdict"])
        agent_steps = sum(1 for s in trace.steps if s.get("kind") in ("llm", "tool"))
        if v["verdict"] != "red" or attempt_no == rounds:
            break
        if agent_steps >= config.MAX_AGENT_STEPS or trace.tokens >= config.MAX_TOKENS_PER_QUESTION:
            run["attempts"][-1]["notes"].append("Dừng sửa: đã chạm giới hạn số bước hoặc token.")
            break
        tf = time.perf_counter()
        add, add_notes = mock_llm.fix_filters(v["findings"])
        extra = list(dict.fromkeys(extra + add))
        findings = [{"rule": f["rule"], "message": f["message_vi"], "fix": f.get("fix")} for f in v["findings"] if f["severity"] != "info"]
        res = llm.structured("fix_sql", {"question": question, "previous_sql": sql, "findings": findings, "interp": interp,
                                         "metric_id": metric["id"], "extra_filters": extra, "_metric": metric,
                                         "_database_id": database_id}, SqlDraft)
        sql, source = res.data.sql, "fix"
        run["attempts"][-1]["fix_notes"] = mock_llm.fix_notes(v["findings"]) + add_notes
        trace.call("fix_sql", tf, res, attempt=attempt_no + 1)

    run["final_verdict"], run["final_sql"] = final["verdict"], sql
    assumptions = list(metric.get("assumptions", []))
    final_rules = {f["rule"] for f in final["findings"]}
    uses_time = interp.get("time") or interp.get("dimension") == "month"
    if uses_time and "V08" in final_rules:
        wrong = (final.get("fingerprint") or {}).get("time_columns") or []
        assumptions.append(f"Thời gian đang chia theo {', '.join(c.rsplit('.', 1)[-1] for c in wrong)}, chưa đúng định nghĩa")
    elif uses_time and metric["time_column"].endswith("purchased_at"):
        assumptions.append("Chia thời gian theo ngày đặt hàng")
    if any("payment_sequential" in e for e in extra):
        assumptions.append("Loại thanh toán lấy theo lần thanh toán đầu tiên của đơn")
    if metric["status"] != "certified":
        assumptions.append("Chỉ số chưa được chứng nhận")
    if interp.get("alternatives"):
        alt = ", ".join(a["name_vi"] for a in interp["alternatives"])
        assumptions.append(f"“{interp.get('matched_text')}” cũng có thể là {alt}; đang dùng {metric['name_vi']}")

    if final["verdict"] == "red":
        run["status"] = "held"
        run["answer"] = {"text": "Câu trả lời bị giữ lại: sau 2 lần sửa, câu SQL vẫn chưa qua kiểm định. "
                                 "Đã chuyển vào hàng đợi duyệt.", "headline": None, "assumptions": assumptions}
        return finish()
    if final["verdict"] == "blocked":
        run["status"] = "blocked"
        run["answer"] = {"text": final.get("blocked_reason", "Câu SQL bị chặn."), "headline": None}
        return finish()

    t = time.perf_counter()
    result, err = _execute(sql)
    trace.add("execute", t, kind="tool", rows=len(result["rows"]) if result else 0, error=err)
    run["result"], run["error"] = result, err
    if err:
        run["status"] = "error"
        run["answer"] = {"text": err, "headline": None}
        return finish()

    recon = None
    if use_verifier:
        t = time.perf_counter()
        ref_sql = mock_llm.reference_sql(metric, interp)
        if _norm_sql(ref_sql) == _norm_sql(sql):
            recon = {"status": "same_sql"}
        else:
            ref, ref_err = _execute(ref_sql)
            recon = reconcile(result, ref) if ref else {"status": "error", "error": ref_err}
            recon["reference_sql"] = ref_sql
        trace.add("reconcile", t, kind="tool", status=recon["status"], max_diff_pct=recon.get("max_diff_pct"))

    t = time.perf_counter()
    composed = compose(metric, interp, result)
    res = llm.structured("compose_answer", {"template": composed["text"], "question": question,
                                            "rows": result["rows"][:20]}, AnswerText)
    text = res.data.text
    allowed = re.findall(r"\d+", (interp.get("time") or {}).get("label", "")) + ["5"]
    bad = guard_numbers(text, result, question, allowed)
    if bad:
        text = composed["text"]
        assumptions.append("Câu trả lời của model có số không có trong kết quả truy vấn nên đã dùng bản soạn sẵn")
    trace.call("compose", t, res, unsupported_numbers=bad)
    run["status"] = "answered"
    run["answer"] = {**composed, "text": text, "assumptions": assumptions, "reconciliation": recon}
    return finish()


def _answer_adhoc(run: dict, interp: dict, question: str, llm: LLM, trace: Trace, cat, settings: dict) -> None:
    """KB-4: câu hỏi không có chỉ số chuẩn. Viết SQL riêng, chỉ áp luật chung, cao nhất là Vàng; tự vào hàng đợi duyệt."""
    run["metric"] = None
    t = time.perf_counter()
    res = llm.structured("generate_adhoc_sql", {"question": question, "interp": interp}, SqlDraft)
    trace.call("generate_sql", t, res, attempt=0, adhoc=True)
    sql = res.data.sql
    if not sql:
        run.update(status="refused", final_verdict=None, final_sql=None,
                   answer={"text": "Không có chỉ số chuẩn cho câu hỏi này và mình chưa xác định được cần đếm gì "
                                   "(người bán hay khách hàng). Hãy hỏi lại rõ hơn.", "headline": None})
        return
    t = time.perf_counter()
    v = verify(sql, cat, None, settings)
    trace.add("verify", t, kind="tool", attempt=0, verdict=v["verdict"], rules=[f["rule"] for f in v["findings"] if f["severity"] != "info"])
    run["attempts"].append({"no": 0, "sql": sql, "source": "llm", "verdict": v["verdict"], "verification": v,
                            "notes": ["Viết SQL riêng vì chưa có chỉ số chuẩn"], "latency_ms": v["elapsed_ms"]})
    run["final_verdict"], run["final_sql"] = v["verdict"], sql
    assumptions = ["Chưa có định nghĩa chuẩn: câu SQL chỉ qua các luật chung, cần data engineer duyệt", *res.data.assumptions]
    if interp.get("near_metric_name"):
        assumptions.append(f"Không dùng chỉ số “{interp['near_metric_name']}” vì định nghĩa đó không có điều kiện "
                           f"“{interp['threshold']['label']}”")
    if v["verdict"] in ("red", "blocked"):
        run.update(status="held" if v["verdict"] == "red" else "blocked",
                   answer={"text": "Câu trả lời bị giữ lại: câu SQL viết riêng chưa qua các luật chung. Đã chuyển vào hàng đợi duyệt.",
                           "headline": None, "assumptions": assumptions})
        return
    t = time.perf_counter()
    result, err = _execute(sql)
    trace.add("execute", t, kind="tool", rows=len(result["rows"]) if result else 0, error=err)
    run["result"], run["error"] = result, err
    if err or not result:
        run.update(status="error", answer={"text": err, "headline": None})
        return
    n = result["rows"][0][0] if result["rows"] else 0
    where = f" ở bang {interp['state']}" if interp.get("state") else ""
    when = f" trong {interp['time']['label']}" if interp.get("time") else ""
    template = f"Có {n:,} {interp['entity_label']}{where} có {interp['threshold']['label']}{when}.".replace(",", ".")
    t = time.perf_counter()
    res = llm.structured("compose_answer", {"template": template, "question": question, "rows": result["rows"][:20]}, AnswerText)
    text = res.data.text
    if guard_numbers(text, result, question, [str(interp["threshold"]["n"])]):
        text = template
    trace.call("compose", t, res)
    run["status"] = "answered"
    run["answer"] = {"text": text, "headline": f"{n:,}".replace(",", "."), "headline_note": f"{interp['entity_label']}{where}",
                     "assumptions": assumptions, "reconciliation": {"status": "no_definition"}}


def _log_agent(database_id: int, run_id: str, model: str, question: str, sql: str, injected: list[str], verdict: str) -> None:
    """Nhật ký câu SQL đầu tiên của agent, dùng làm nguồn lỗi thật cho đánh giá (EVAL-02b)."""
    try:
        db.execute("INSERT INTO app.agent_logs (database_id, run_id, model, question, sql, injected, verdict) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                   (database_id, run_id, model, question, sql, db.jsonb(injected), verdict))
    except Exception:  # noqa: BLE001 - log không được làm hỏng câu trả lời
        log.exception("agent_log failed")


def _persist(database_id: int, user_id: int | None, run: dict) -> dict:
    metric = run.get("metric")
    recon = (run.get("answer") or {}).get("reconciliation") or {}
    needs_review = run.get("input_kind") == "question" and (
        run.get("final_verdict") in ("yellow", "red") or recon.get("status") == "mismatch")
    review = "pending" if needs_review else "none"
    run["review_status"] = review
    with db.app_conn() as conn:
        conn.execute(
            """INSERT INTO app.qa_runs (id, database_id, user_id, input_kind, question, intent, metric_id, metric_version,
               interpretation, final_verdict, final_sql, answer, result, usage, status, review_status, request_id)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (run["id"], database_id, user_id, run["input_kind"], run["question"], run.get("intent"),
             metric["id"] if metric else None, metric.get("version") if metric else None,
             db.jsonb(run.get("interpretation")), run.get("final_verdict"), run.get("final_sql"),
             db.jsonb(run.get("answer")), db.jsonb(run.get("result")), db.jsonb(run.get("usage")),
             run["status"], review, run["request_id"]))
        for a in run["attempts"]:
            conn.execute(
                "INSERT INTO app.qa_attempts (run_id, attempt_no, sql, source, verdict, verification, notes, latency_ms) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                (run["id"], a["no"], a["sql"], a["source"], a["verdict"], db.jsonb(a["verification"]),
                 db.jsonb({"notes": a.get("notes", []), "fix_notes": a.get("fix_notes", [])}), a["latency_ms"]))
        conn.commit()
    return run
