import { AlertTriangle, CheckCircle2, Hand, Play, XCircle } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useState } from "react";
import { api } from "../api";
import { useSession } from "../session";
import { SqlView } from "./Sql";
import { Button, Card, cx, ErrorNote, fmtDay } from "./ui";

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

/** Ô số liệu; `bar` (0..1) vẽ thêm thanh tỉ lệ cùng màu dưới con số. */
export function Stat({ label, value, sub, tone, bar }: { label: string; value: string; sub: string; tone?: "good" | "bad"; bar?: number }) {
  const color = tone === "good" ? "var(--color-good)" : tone === "bad" ? "var(--color-bad)" : "var(--color-ink)";
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface px-4 py-3.5">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="font-mono text-[24px] font-medium leading-none" style={{ color }}>{value}</div>
      {bar !== undefined && <div className="h-1.5 rounded-full bg-sunk"><div className="h-1.5 rounded-full" style={{ width: `${Math.min(Math.max(bar, 0.015), 1) * 100}%`, background: color }} /></div>}
      <div className="text-[11.5px] text-faint">{sub}</div>
    </div>
  );
}
const Panel = ({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) => (
  <div className={cx("rounded-xl border border-line bg-surface px-[18px] py-4", className)}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="text-[13.5px] font-semibold">{title}</h3>{aside}</div>
    {children}
  </div>
);
const Key = ({ color, children }: { color: string; children: ReactNode }) => (
  <span className="inline-flex items-center gap-1.5 text-[11px] text-faint"><span className="size-2 rounded-sm" style={{ background: color }} />{children}</span>
);
function Part({ n, title, sub, action }: { n: number; title: string; sub: ReactNode; action: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[280px] flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-accent">Phần {n}</div>
        <h2 className="mt-1 text-[17px] font-semibold">{title}</h2>
        <p className="mt-1 max-w-[44rem] text-[13px] leading-normal text-muted">{sub}</p>
      </div>
      {action}
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
  const [showCases, setShowCases] = useState(false);
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
  const byKind = (v?.items ?? []).filter((i) => filter === "all" || (filter === "miss" ? !i.ok : filter === "agent" ? i.source.startsWith("agent") : i.kind === filter && (filter !== "broken" || i.source === "mutation")));
  const items = rule ? byKind.filter((i) => i.fired.includes(rule)) : byKind;

  const judge = v?.summary.llm_judge;
  const methods = judge ? [
    { l: "Bộ kiểm định lineage", recall: judge.verifier.recall, far: judge.verifier.false_alarm_rate, stab: 1, cost: "0 USD", lat: `${Math.round(judge.verifier.latency_ms)} ms`, best: true },
    ...judge.models.map((m) => ({ l: `Judge ${m.model}`, recall: m.recall, far: m.false_alarm_rate, stab: m.stability, cost: `${m.cost_per_case_usd.toFixed(5)} USD`, lat: `~${m.latency_ms_est} ms`, best: false })),
  ] : [];
  const tmax = Math.max(...(a?.summary.taxonomy ?? []).map((t) => t.count), 1);

  return (
    <div className="flex flex-col gap-9 px-7 pb-12 pt-6">
      <ErrorNote>{error}</ErrorNote>

      <section className="flex flex-col gap-4">
        <Part n={1} title="Bộ kiểm định trên tập SQL có nhãn"
          sub={<>Chạy thật, tất định, cấu hình luật mặc định. Hai nguồn lỗi: gài lỗi vào SQL chuẩn, và câu SQL đầu tiên agent mock viết ra. Chưa phản ánh lỗi của một LLM thật.
            {v && <> Lần chạy gần nhất: {fmtDay(v.created_at, true)}{v.created_by_name ? ` · ${v.created_by_name.split(/\s*\(/)[0]}` : ""}.</>}</>}
          action={<Button variant="primary" disabled={!!busy} onClick={() => run("verifier")} className="h-[34px] rounded-lg px-3.5"><Play size={14} /> {busy === "verifier" ? "Đang chạy…" : "Chạy lại"}</Button>} />
        {!v ? <Card className="p-6 text-muted">Chưa có lần chạy nào. Bấm “Chạy lại”.</Card> : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Bắt được lỗi (recall)" value={pct(v.summary.recall)} sub={`${v.summary.broken_caught}/${v.summary.broken_total} câu SQL lỗi`} tone="good" bar={v.summary.recall} />
              <Stat label="Báo nhầm trên câu đúng" value={pct(v.summary.false_alarm_rate)} sub={`${v.summary.false_alarms}/${v.summary.correct_total} câu SQL đúng`} tone={v.summary.false_alarms ? "bad" : undefined} bar={v.summary.false_alarm_rate} />
              <Stat label="Thời gian kiểm mỗi câu" value={`${Math.round(v.summary.latency_p50_ms)} ms`} sub={`p95 ${Math.round(v.summary.latency_p95_ms)} ms · không gọi LLM`} bar={v.summary.latency_p50_ms / 50} />
            </div>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
              <Panel title="Tỉ lệ bắt được theo từng luật" aside={<span className="flex gap-3"><Key color="var(--color-good)">Bắt được</Key><Key color="var(--color-bad)">Bỏ sót</Key></span>}>
                <div className="flex flex-col gap-1">
                  {v.summary.per_rule.map((r) => (
                    <button key={r.rule} type="button" title={`${r.caught}/${r.total} · bấm để xem các ca của luật này`}
                      onClick={() => { setRule(r.rule); setFilter("all"); setShowCases(true); setTimeout(() => document.getElementById("ca-list")?.scrollIntoView({ behavior: "smooth", block: "start" })); }}
                      className={cx("grid w-full grid-cols-[40px_minmax(0,170px)_1fr_52px] items-center gap-3 rounded-[7px] px-1.5 py-1 text-left text-[12.5px] hover:bg-hover", rule === r.rule && "bg-accent-soft")}>
                      <span className="font-mono text-[11px] font-semibold text-muted">{r.rule}</span>
                      <span className="truncate text-ink-2">{r.title}</span>
                      <span className="flex h-2.5 gap-[2px] overflow-hidden rounded-[5px]">
                        <span className="h-2.5 bg-good" style={{ width: `${(r.caught / r.total) * 100}%` }} />
                        <span className="h-2.5 bg-bad" style={{ width: `${((r.total - r.caught) / r.total) * 100}%` }} />
                      </span>
                      <span className="text-right font-mono text-[12px]">{r.caught}/{r.total}</span>
                    </button>
                  ))}
                </div>
              </Panel>
              <Panel title="Theo nguồn lỗi" className="self-start">
                <div className="flex flex-col gap-3.5">
                  {v.summary.per_source.map((x) => (
                    <div key={x.source} className="flex flex-col gap-1.5">
                      <div className="flex justify-between gap-2 text-[12.5px]"><span className="min-w-0 truncate text-ink-2">{SOURCE_LABEL[x.source] ?? x.source}</span><span className="font-mono">{pct(x.caught / x.total)}</span></div>
                      <div className="h-2 rounded-full bg-bad-soft"><div className="h-2 rounded-full bg-good" style={{ width: `${(x.caught / x.total) * 100}%` }} /></div>
                      <div className="font-mono text-[11px] text-faint">{x.caught}/{x.total}</div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
            {judge && (
              <Panel title={<>So với LLM-as-judge <span className="ml-1 text-[12px] font-normal text-faint">{judge.cases} câu × {judge.runs} lần chạy</span></>}>
                <div className="scroll-thin overflow-x-auto">
                  <div className="grid min-w-[640px] grid-cols-[minmax(150px,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_70px_96px_64px] items-center gap-x-3.5 gap-y-2 text-[12.5px]">
                    {["Cách kiểm", "Bắt được lỗi", "Báo nhầm", "Ổn định", "Chi phí / câu", "Độ trễ"].map((h, k) => <span key={h} className={cx("text-[11px] text-faint", k > 2 && "text-right")}>{h}</span>)}
                    {methods.map((m) => (
                      <Fragment key={m.l}>
                        <span className={cx("text-ink", m.best && "font-semibold")}>{m.l}</span>
                        <span className="flex items-center gap-2"><span className="h-2 flex-1 rounded-full bg-sunk"><span className="block h-2 rounded-full bg-good" style={{ width: `${m.recall * 100}%` }} /></span><span className="w-11 text-right font-mono text-[11.5px]">{pct(m.recall)}</span></span>
                        <span className="flex items-center gap-2"><span className="h-2 flex-1 rounded-full bg-sunk"><span className="block h-2 rounded-full bg-bad" style={{ width: `${Math.min(m.far * 400, 100)}%` }} /></span><span className="w-11 text-right font-mono text-[11.5px]">{pct(m.far)}</span></span>
                        <span className="text-right font-mono text-[11.5px]">{pct(m.stab)}</span>
                        <span className="text-right font-mono text-[11.5px] text-muted">{m.cost}</span>
                        <span className="text-right font-mono text-[11.5px] text-muted">{m.lat}</span>
                      </Fragment>
                    ))}
                  </div>
                </div>
                <p className="mt-3 text-[12px] text-faint">{judge.note} Thanh báo nhầm phóng to ×4 để dễ so.</p>
              </Panel>
            )}
            <div id="ca-list" className="rounded-xl border border-line bg-surface">
              <button onClick={() => setShowCases(!showCases)} aria-expanded={showCases}
                className="flex w-full items-center justify-between px-[18px] py-3.5 text-left text-[13.5px] font-semibold">
                Ca kiểm chi tiết<span className="text-[12.5px] font-medium text-accent">{showCases ? "Ẩn danh sách ca kiểm" : `Xem ${v.items.length} ca kiểm`}</span>
              </button>
              {showCases && <>
                <div className="flex flex-wrap items-center gap-2 border-t border-line px-[18px] py-2.5">
                  <div className="flex gap-[2px] rounded-[9px] bg-sunk p-[3px]" role="radiogroup" aria-label="Lọc ca kiểm">
                    {([["all", "Tất cả"], ["broken", "Gài lỗi"], ["agent", "Lỗi agent"], ["correct", "SQL đúng"], ["miss", "Kiểm sai"]] as const).map(([k, l]) => (
                      <button key={k} role="radio" aria-checked={filter === k} onClick={() => setFilter(k)}
                        className={cx("h-[26px] rounded-[7px] px-2.5 text-[12px]", filter === k ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}>{l}</button>
                    ))}
                  </div>
                  {rule && <button onClick={() => setRule(null)} title="Bỏ lọc theo luật" className="h-[26px] rounded-full bg-held-soft px-2.5 text-[12px] text-held">Luật {rule} ×</button>}
                  <span className="ml-auto text-[12px] text-faint">{items.length} câu</span>
                </div>
                <div className="scroll-thin max-h-[420px] overflow-y-auto border-t border-line">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead className="sticky top-0 bg-sunk text-left text-[11.5px] text-muted">
                      <tr><th className="px-[18px] py-[7px] font-medium">Ca kiểm</th><th className="px-2.5 py-[7px] font-medium">Chỉ số</th><th className="px-2.5 py-[7px] font-medium">Mong đợi</th><th className="px-2.5 py-[7px] font-medium">Luật bắn ra</th><th className="px-[18px] py-[7px] text-right font-medium">Kết quả</th></tr>
                    </thead>
                    <tbody>
                      {items.map((i) => (
                        <Fragment key={i.id}>
                          <tr onClick={() => setOpen(open === i.id ? null : i.id)} className="cursor-pointer border-t border-line hover:bg-hover">
                            <td className="px-[18px] py-2">{i.label}</td>
                            <td className="px-2.5 py-2 font-mono text-[11.5px] text-muted">{i.metric_id ?? "—"}</td>
                            <td className={cx("px-2.5 py-2 font-mono text-[11.5px]", i.expected.length ? "text-bad" : "text-faint")}>{i.expected.join(" ") || "không lỗi"}</td>
                            <td className="px-2.5 py-2"><span className="flex flex-wrap gap-1">{i.fired.length ? i.fired.map((f) => (
                              <span key={f} className={cx("rounded-[5px] px-1.5 py-px font-mono text-[11px] font-medium", i.expected.includes(f) ? "bg-bad-soft text-bad" : "bg-sunk text-ink-2")}>{f}</span>
                            )) : <span className="text-faint">—</span>}</span></td>
                            <td className="px-[18px] py-2 text-right"><span className={cx("inline-flex h-5 items-center rounded-full px-2 text-[11.5px] font-semibold", i.ok ? "bg-good-soft text-good" : "bg-bad-soft text-bad")}>{i.ok ? "Đúng" : "Sai"}</span></td>
                          </tr>
                          {open === i.id && <tr><td colSpan={5} className="bg-paper px-[18px] py-2.5"><SqlView sql={i.sql} maxHeight={220} /></td></tr>}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>}
            </div>
          </>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <Part n={2} title="Agent theo cấu hình (ablation)"
          sub={a ? `${a.summary.questions} câu hỏi tiếng Việt · ${a.summary.models.length} model × 4 cấu hình · ${fmtDay(a.created_at, true)}` : "Benchmark câu hỏi tiếng Việt trên Olist."}
          action={<Button disabled={!!busy} onClick={() => run("agent")} className="h-[34px] rounded-lg px-3.5"><Play size={14} /> {busy === "agent" ? "Đang chạy…" : "Chạy lại"}</Button>} />
        <div className="rounded-[10px] bg-warn-soft px-3.5 py-2.5 text-[12.5px] leading-normal text-warn">
          LLM đang là mock có cài sẵn lỗi điển hình, và SQL chuẩn của benchmark sinh từ cùng định nghĩa chỉ số. Các con số dưới đây chỉ để kiểm tra luồng và giao diện, không dùng làm kết quả đánh giá model.
        </div>
        {a && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Phân loại ý định (AGT-01)" value={pct(a.summary.intent.intent_accuracy)} sub={`${a.summary.intent.intent_correct}/${a.summary.intent.total} câu gán nhãn tay`} tone="good" />
              <Stat label="Khớp chỉ số (MET-04)" value={pct(a.summary.intent.metric_accuracy)} sub={`${a.summary.intent.metric_correct}/${a.summary.intent.metric_total} câu có chỉ số`} tone="good" />
              <Stat label={`Truy xuất bảng recall@${a.summary.retrieval.k}`} value={pct(a.summary.retrieval.recall)} sub={`đủ bảng ở ${pct(a.summary.retrieval.full_recall_share)} câu`} />
              <Stat label="Từ chối đúng ngoài phạm vi" value={`${a.summary.configs[0].refusal_correct}/${a.summary.configs[0].refusal_expected}`} sub="câu hỏi dữ liệu không có" />
            </div>
            <Panel title={`Kết quả ${a.summary.questions} câu theo cấu hình`}
              aside={<span className="flex flex-wrap gap-4">{OUTCOMES.map((o) => <span key={o.key} className="inline-flex items-center gap-1.5 text-[12px] text-ink-2"><span className="size-[9px] rounded-sm" style={{ background: o.color }} />{o.label}</span>)}</span>}>
              <div className="mt-1.5 flex flex-col gap-[22px]">
                {a.summary.models.map((model) => (
                  <div key={model} className="flex flex-col gap-2.5">
                    <div className="flex flex-wrap items-baseline gap-2.5">
                      <span className="font-mono text-[13px] font-semibold">{model}</span>
                      <span className="text-[12px] text-faint">tự sửa thêm <b className="text-good">+{a.summary.fix_gain_pts[model].toLocaleString("vi-VN")} điểm %</b> so với chỉ gắn nhãn</span>
                    </div>
                    {a.summary.configs.filter((c) => c.model === model).map((c) => (
                      <div key={c.id} className="grid grid-cols-[minmax(0,250px)_1fr_92px] items-center gap-4">
                        <div className="min-w-0">
                          <div className="text-[12.5px] font-medium"><span className="font-mono text-accent">{c.id}</span> · {c.label}</div>
                          <div className="truncate text-[11px] text-faint">p50 {Math.round(c.latency_p50_ms).toLocaleString("vi-VN")} ms · {c.cost_avg_usd.toFixed(5)} USD/câu · cache {c.cache_hits}/{c.llm_calls}</div>
                        </div>
                        <OutcomeBar row={c} />
                        <div className="text-right"><div className="font-mono text-[16px] font-medium">{pct(c.accuracy)}</div><div className={cx("text-[11px]", c.wrong_silent ? "text-bad" : "text-faint")}>{c.wrong_silent} sai lọt</div></div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </Panel>
            <Panel title={<>Phân loại lỗi ở lần thử đầu <span className="font-normal text-faint">(mock-small, cấu hình D)</span></>}>
              <div className="flex flex-col gap-2.5">
                {a.summary.taxonomy.map((t) => (
                  <div key={t.rule} className="grid grid-cols-[40px_minmax(0,190px)_1fr_30px] items-center gap-3 text-[12.5px]">
                    <span className="font-mono text-[11px] font-semibold text-bad">{t.rule}</span>
                    <span className="min-w-0"><span className="block text-ink-2">{t.title}</span><span className="block truncate text-[11px] text-faint">{t.example}</span></span>
                    <span className="h-2 rounded-full bg-sunk"><span className="block h-2 rounded-full bg-bad opacity-80" style={{ width: `${(t.count / tmax) * 100}%` }} /></span>
                    <span className="text-right font-mono">{t.count}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </>
        )}
      </section>
    </div>
  );
}
