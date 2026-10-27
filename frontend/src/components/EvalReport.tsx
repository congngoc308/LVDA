import { AlertTriangle, CheckCircle2, Hand, Play, ShieldAlert, XCircle } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { api } from "../api";
import { useSession } from "../session";
import { SqlView } from "./Sql";
import { Button, Card, cx, ErrorNote, fmtDate, RuleChip } from "./ui";

/* Báo cáo kỹ thuật: bộ kiểm định trên tập SQL có nhãn, so với LLM-as-judge, ablation agent.
   Dùng cho báo cáo và EVAL.md, mở từ trang Đánh giá. */

interface VerifierSummary {
  broken_total: number; broken_caught: number; correct_total: number; false_alarms: number; recall: number;
  false_alarm_rate: number; latency_p50_ms: number; latency_p95_ms: number;
  per_rule: { rule: string; title: string; total: number; caught: number }[];
  per_source: { source: string; total: number; caught: number }[];
  llm_judge: Judge | null;
}
interface VerifierItem { id: string; kind: "broken" | "correct"; source: string; metric_id: string | null; expected: string[]; label: string; sql: string; verdict: string; fired: string[]; ok: boolean }
interface AgentRow {
  id: string; label: string; correct: number; wrong_silent: number; wrong_flagged: number; held: number; total: number; accuracy: number;
  latency_p50_ms: number; latency_p95_ms: number; tokens_avg: number; refusal_correct: number; refusal_expected: number; model: string;
  cost_avg_usd: number; schema_retries: number; cache_hits: number; llm_calls: number;
}
interface AgentSummary {
  configs: AgentRow[]; questions: number; note: string; models: string[]; fix_gain_pts: Record<string, number>;
  taxonomy: { rule: string; title: string; count: number; example: string }[]; categories: Record<string, number>;
  retrieval: { k: number; recall: number; full_recall_share: number; questions: number };
  intent: { total: number; intent_correct: number; intent_accuracy: number; metric_total: number; metric_correct: number; metric_accuracy: number; errors: { question: string; expected: unknown[]; got: unknown[] }[] };
}
interface Judge {
  runs: number; cases: number; note: string;
  verifier: { recall: number; false_alarm_rate: number; stability: number; cost_per_case_usd: number; latency_ms: number };
  models: { model: string; label: string; recall: number; false_alarm_rate: number; stability: number; cost_per_case_usd: number; latency_ms_est: number }[];
}
interface EvalRun<S, I> { id: number; summary: S; items: I[]; created_at: string; created_by_name?: string }
export interface Latest { verifier: EvalRun<VerifierSummary, VerifierItem> | null; agent: EvalRun<AgentSummary, unknown> | null }

export const pct = (x: number) => `${(x * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;
const SOURCE_LABEL: Record<string, string> = { mutation: "Gài lỗi vào SQL chuẩn", agent_log: "Lỗi thật trong nhật ký agent", agent_sim: "Lỗi agent (sinh lại)" };

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="text-[12px] text-muted">{label}</div>
      <div className={cx("num mt-1 text-[24px] font-medium leading-none", tone === "good" && "text-good", tone === "bad" && "text-bad")}>{value}</div>
      <div className="mt-1 text-[12px] text-muted">{sub}</div>
    </div>
  );
}

const OUTCOMES = [
  { key: "correct", label: "Đúng", color: "var(--color-good)", Icon: CheckCircle2 },
  { key: "wrong_flagged", label: "Sai nhưng có cảnh báo", color: "var(--color-warn)", Icon: AlertTriangle },
  { key: "held", label: "Bị giữ lại", color: "var(--color-held)", Icon: Hand },
  { key: "wrong_silent", label: "Sai lọt tới người dùng", color: "var(--color-bad)", Icon: XCircle },
] as const;

function OutcomeBar({ row }: { row: AgentRow }) {
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className="relative flex h-5 w-full gap-[2px]" role="img" aria-label={OUTCOMES.map((o) => `${o.label}: ${row[o.key]}`).join(", ")}>
      {OUTCOMES.map((o) => row[o.key] > 0 && (
        <div key={o.key} className="h-full first:rounded-l last:rounded-r" style={{ width: `${(row[o.key] / row.total) * 100}%`, background: o.color, opacity: hover && hover !== o.key ? 0.45 : 1 }}
          onMouseEnter={() => setHover(o.key)} onMouseLeave={() => setHover(null)} />
      ))}
      {hover && (
        <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded border border-line bg-surface px-2 py-0.5 text-[12px] shadow">
          {OUTCOMES.find((o) => o.key === hover)?.label}: <b className="num">{row[hover as keyof AgentRow]}</b>/{row.total}
        </div>
      )}
    </div>
  );
}

export function EvalReport({ onChanged }: { onChanged?: () => void }) {
  const { db } = useSession();
  const [data, setData] = useState<Latest | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "broken" | "correct" | "agent" | "miss">("all");
  const [rule, setRule] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!db) return;
    api<Latest>(`/db/${db.id}/eval`).then(setData).catch((e) => setError(e.message));
  };
  useEffect(load, [db]);

  const run = async (kind: "verifier" | "agent") => {
    if (!db) return;
    setBusy(kind); setError(null);
    try { await api(`/db/${db.id}/eval/${kind}`, { body: {} }); load(); onChanged?.(); }
    catch (e) { setError(e instanceof Error ? e.message : "Chạy đánh giá thất bại."); }
    finally { setBusy(null); }
  };

  const v = data?.verifier;
  const a = data?.agent;
  const byKind = (v?.items ?? []).filter((i) => filter === "all" || (filter === "miss" ? !i.ok : filter === "agent" ? i.source === "agent" : i.kind === filter && (filter !== "broken" || i.source === "mutation")));
  const items = rule ? byKind.filter((i) => i.fired.includes(rule)) : byKind;

  return (
    <div className="flex flex-col gap-8 p-6">
      <p className="text-[13px] text-muted">Số liệu nào trong README cũng truy được về một lần chạy ở đây. Báo cáo md/json được ghi ở <span className="font-mono">backend/eval/results</span>.</p>
      <ErrorNote>{error}</ErrorNote>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold">Bộ kiểm định trên tập SQL có nhãn</h2>
            <p className="mt-0.5 max-w-2xl text-[13px] text-muted">
              Chạy thật, tất định, cấu hình luật mặc định. Hai nguồn lỗi: gài lỗi vào SQL chuẩn, và câu SQL đầu tiên agent mock viết ra (nhãn là lỗi cài sẵn). Chưa phản ánh lỗi của một LLM thật.
              {v && <> Lần chạy gần nhất: {fmtDate(v.created_at)}{v.created_by_name ? ` · ${v.created_by_name}` : ""}.</>}
            </p>
          </div>
          <Button variant="primary" disabled={!!busy} onClick={() => run("verifier")}><Play size={14} /> {busy === "verifier" ? "Đang chạy…" : "Chạy lại"}</Button>
        </div>
        {!v ? <Card className="p-6 text-muted">Chưa có lần chạy nào. Bấm “Chạy lại”.</Card> : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Bắt được lỗi (recall)" value={pct(v.summary.recall)} sub={`${v.summary.broken_caught}/${v.summary.broken_total} câu SQL lỗi`} tone="good" />
              <Stat label="Báo nhầm trên câu đúng" value={pct(v.summary.false_alarm_rate)} sub={`${v.summary.false_alarms}/${v.summary.correct_total} câu SQL đúng`} tone={v.summary.false_alarms ? "bad" : undefined} />
              <Stat label="Thời gian kiểm mỗi câu" value={`${Math.round(v.summary.latency_p50_ms)} ms`} sub={`p95 ${Math.round(v.summary.latency_p95_ms)} ms · không gọi LLM`} />
            </div>
            <div className="grid gap-4 md:grid-cols-[1fr_300px]">
              <Card className="p-4">
                <h3 className="mb-3 text-[13px] font-medium">Tỉ lệ bắt được theo từng luật</h3>
                <div className="flex flex-col gap-2">
                  {v.summary.per_rule.map((r) => (
                    <button key={r.rule} type="button" title={`${r.caught}/${r.total} · bấm để xem các ca của luật này`}
                      onClick={() => { setRule(r.rule); setFilter("all"); document.getElementById("ca-list")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                      className={cx("grid w-full grid-cols-[44px_170px_1fr_56px] items-center gap-3 rounded px-1 py-0.5 text-left text-[13px] hover:bg-sunk/60", rule === r.rule && "bg-accent-soft/60")}>
                      <RuleChip rule={r.rule} severity="high" />
                      <span className="truncate text-ink-2">{r.title}</span>
                      <span className="h-2.5 rounded-sm bg-sunk"><span className="block h-2.5 rounded-sm bg-accent" style={{ width: `${(r.caught / r.total) * 100}%` }} /></span>
                      <span className="num text-right">{r.caught}/{r.total}</span>
                    </button>
                  ))}
                </div>
              </Card>
              <Card className="p-4">
                <h3 className="mb-3 text-[13px] font-medium">Theo nguồn lỗi</h3>
                <div className="flex flex-col gap-3">
                  {v.summary.per_source.map((s) => (
                    <div key={s.source}>
                      <div className="flex justify-between text-[13px]"><span className="text-ink-2">{SOURCE_LABEL[s.source] ?? s.source}</span><span className="num">{s.caught}/{s.total}</span></div>
                      <span className="mt-1 block h-2.5 rounded-sm bg-sunk"><span className="block h-2.5 rounded-sm bg-accent" style={{ width: `${(s.caught / s.total) * 100}%` }} /></span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
            <Card>
              <div id="ca-list" className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2">
                {([["all", "Tất cả"], ["broken", "Gài lỗi"], ["agent", "Lỗi agent"], ["correct", "SQL đúng"], ["miss", "Kiểm sai"]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setFilter(k)} className={cx("rounded-md px-2.5 py-1 text-[12.5px]", filter === k ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-sunk")}>{l}</button>
                ))}
                {rule && (
                  <button onClick={() => setRule(null)} className="rounded-md bg-held-soft px-2.5 py-1 text-[12.5px] text-held" title="Bỏ lọc theo luật">
                    Luật {rule} ×
                  </button>
                )}
                <span className="ml-auto text-[12px] text-muted">{items.length} câu</span>
              </div>
              <div className="scroll-thin max-h-[420px] overflow-y-auto">
                <table className="w-full text-[13px]">
                  <thead className="sticky top-0 bg-sunk text-left text-[12px] text-muted">
                    <tr><th className="px-3 py-1.5 font-medium">Ca kiểm</th><th className="px-3 py-1.5 font-medium">Chỉ số</th><th className="px-3 py-1.5 font-medium">Mong đợi</th><th className="px-3 py-1.5 font-medium">Luật bắn ra</th><th className="px-3 py-1.5 text-right font-medium">Kết quả</th></tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <Fragment key={i.id}>
                        <tr onClick={() => setOpen(open === i.id ? null : i.id)} className="cursor-pointer border-t border-line hover:bg-sunk/60">
                          <td className="px-3 py-1.5">{i.label}</td>
                          <td className="px-3 py-1.5 font-mono text-[12px] text-muted">{i.metric_id ?? "—"}</td>
                          <td className="px-3 py-1.5"><span className="flex flex-wrap gap-1">{i.expected.length ? i.expected.map((r) => <RuleChip key={r} rule={r} severity="high" />) : <span className="text-[12px] text-muted">không lỗi</span>}</span></td>
                          <td className="px-3 py-1.5"><span className="flex flex-wrap gap-1">{i.fired.length ? i.fired.map((f) => <RuleChip key={f} rule={f} severity={i.expected.includes(f) ? "high" : "low"} />) : <span className="text-[12px] text-muted">—</span>}</span></td>
                          <td className="px-3 py-1.5 text-right">{i.ok ? <span className="text-good">đúng</span> : <span className="font-medium text-bad">sai</span>}</td>
                        </tr>
                        {open === i.id && <tr><td colSpan={5} className="bg-paper px-3 py-2"><SqlView sql={i.sql} maxHeight={220} /></td></tr>}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            {v.summary.llm_judge && (
              <Card>
                <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[13px] font-medium">
                  <ShieldAlert size={15} className="text-faint" /> So với LLM-as-judge · {v.summary.llm_judge.cases} câu × {v.summary.llm_judge.runs} lần chạy
                </div>
                <table className="w-full text-[13px]">
                  <thead className="bg-sunk text-left text-[12px] text-muted">
                    <tr><th className="px-4 py-1.5 font-medium">Cách kiểm</th><th className="px-3 py-1.5 text-right font-medium">Bắt được lỗi</th>
                      <th className="px-3 py-1.5 text-right font-medium">Báo nhầm</th><th className="px-3 py-1.5 text-right font-medium">Trùng kết quả giữa các lần</th>
                      <th className="px-3 py-1.5 text-right font-medium">Chi phí / câu</th><th className="px-3 py-1.5 text-right font-medium">Độ trễ</th></tr>
                  </thead>
                  <tbody className="num">
                    <tr className="border-t border-line bg-good-soft/40"><td className="px-4 py-1.5 font-sans font-medium">Bộ kiểm định lineage</td>
                      <td className="px-3 py-1.5 text-right">{pct(v.summary.llm_judge.verifier.recall)}</td><td className="px-3 py-1.5 text-right">{pct(v.summary.llm_judge.verifier.false_alarm_rate)}</td>
                      <td className="px-3 py-1.5 text-right">100%</td><td className="px-3 py-1.5 text-right">0 USD</td><td className="px-3 py-1.5 text-right">{Math.round(v.summary.llm_judge.verifier.latency_ms)} ms</td></tr>
                    {v.summary.llm_judge.models.map((m) => (
                      <tr key={m.model} className="border-t border-line"><td className="px-4 py-1.5 font-sans">Judge <span className="font-mono">{m.model}</span></td>
                        <td className="px-3 py-1.5 text-right">{pct(m.recall)}</td><td className="px-3 py-1.5 text-right">{pct(m.false_alarm_rate)}</td>
                        <td className="px-3 py-1.5 text-right">{pct(m.stability)}</td><td className="px-3 py-1.5 text-right">{m.cost_per_case_usd.toFixed(5)} USD</td>
                        <td className="px-3 py-1.5 text-right">~{m.latency_ms_est} ms</td></tr>
                    ))}
                  </tbody>
                </table>
                <p className="border-t border-line px-4 py-2 text-[12px] text-muted">{v.summary.llm_judge.note}</p>
              </Card>
            )}
          </>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold">Agent theo cấu hình (ablation)</h2>
            <p className="mt-0.5 text-[13px] text-muted">{a ? `${a.summary.questions} câu hỏi tiếng Việt · ${a.summary.models.length} model × 4 cấu hình · ${fmtDate(a.created_at)}` : "Benchmark câu hỏi tiếng Việt trên Olist."}</p>
          </div>
          <Button disabled={!!busy} onClick={() => run("agent")}><Play size={14} /> {busy === "agent" ? "Đang chạy…" : "Chạy lại"}</Button>
        </div>
        <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] text-warn">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>LLM đang là mock có cài sẵn lỗi điển hình, và SQL chuẩn của benchmark sinh từ cùng định nghĩa chỉ số. Các con số dưới đây chỉ để kiểm tra luồng và giao diện, không dùng làm kết quả đánh giá model.</span>
        </div>
        {a && (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Phân loại ý định (AGT-01)" value={pct(a.summary.intent.intent_accuracy)} sub={`${a.summary.intent.intent_correct}/${a.summary.intent.total} câu gán nhãn tay`} tone="good" />
              <Stat label="Khớp chỉ số (MET-04)" value={pct(a.summary.intent.metric_accuracy)} sub={`${a.summary.intent.metric_correct}/${a.summary.intent.metric_total} câu có chỉ số`} tone="good" />
              <Stat label={`Truy xuất bảng recall@${a.summary.retrieval.k}`} value={pct(a.summary.retrieval.recall)} sub={`đủ bảng ở ${pct(a.summary.retrieval.full_recall_share)} câu`} />
              <Stat label="Từ chối đúng ngoài phạm vi" value={`${a.summary.configs[0].refusal_correct}/${a.summary.configs[0].refusal_expected}`} sub="câu hỏi dữ liệu không có" />
            </div>
            <Card className="p-4">
              <div className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
                {OUTCOMES.map((o) => <span key={o.key} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: o.color }} /><o.Icon size={13} className="text-muted" />{o.label}</span>)}
              </div>
              <div className="flex flex-col gap-6">
                {a.summary.models.map((model) => (
                  <div key={model} className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="font-mono text-[13.5px] font-medium">{model}</h3>
                      <span className="text-[12px] text-muted">tự sửa thêm <b className="text-ink">{a.summary.fix_gain_pts[model]} điểm %</b> so với chỉ gắn nhãn</span>
                    </div>
                    {a.summary.configs.filter((c) => c.model === model).map((c) => (
                      <div key={c.id} className="grid grid-cols-[minmax(0,240px)_1fr_120px] items-center gap-4">
                        <div><div className="font-medium"><span className="font-mono text-muted">{c.id}</span> · {c.label}</div>
                          <div className="text-[11.5px] text-muted">p50 {Math.round(c.latency_p50_ms)} ms · {c.cost_avg_usd.toFixed(5)} USD/câu</div>
                          <div className="text-[11.5px] text-muted">thử lại lược đồ {c.schema_retries} · cache {c.cache_hits}/{c.llm_calls} lần gọi</div></div>
                        <OutcomeBar row={c} />
                        <div className="text-right"><span className="num text-[18px] font-medium">{pct(c.accuracy)}</span><div className="text-[11.5px] text-muted">đúng · {c.wrong_silent} sai lọt</div></div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <div className="border-b border-line px-4 py-2.5 text-[13px] font-medium">Phân loại lỗi ở lần thử đầu (mock-small, cấu hình D)</div>
              <table className="w-full text-[13px]">
                <thead className="bg-sunk text-left text-[12px] text-muted"><tr><th className="px-4 py-1.5 font-medium">Luật</th><th className="px-3 py-1.5 text-right font-medium">Số lần</th><th className="px-3 py-1.5 font-medium">Ví dụ</th></tr></thead>
                <tbody>
                  {a.summary.taxonomy.map((t) => (
                    <tr key={t.rule} className="border-t border-line">
                      <td className="px-4 py-1.5"><span className="inline-flex items-center gap-2"><RuleChip rule={t.rule} severity="high" />{t.title}</span></td>
                      <td className="num px-3 py-1.5 text-right">{t.count}</td>
                      <td className="px-3 py-1.5 text-ink-2">{t.example}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </section>
    </div>
  );
}
