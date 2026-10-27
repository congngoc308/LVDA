import { CornerDownRight, Download, EyeOff, Info, Scale, ThumbsDown, ThumbsUp } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { toCsv } from "../format";
import { useSession } from "../session";
import type { Run, TraceStep } from "../types";
import { AttemptDetail, AttemptTimeline } from "./Evidence";
import { buildAnswerGraph, GraphLegend, LineageGraph } from "./LineageGraph";
import { ResultView } from "./Result";
import { SqlView } from "./Sql";
import { Button, cx, Pill, timeAgo, VerdictStamp } from "./ui";

type Tab = "lineage" | "checks" | "sql" | "trace";

const STEP_LABEL: Record<string, string> = {
  interpret: "Hiểu câu hỏi", generate_sql: "Viết SQL", fix_sql: "Sửa SQL", verify: "Kiểm định", execute: "Chạy truy vấn",
  reconcile: "Đối chiếu SQL chuẩn", compose: "Soạn trả lời", retrieve_verified: "Lấy truy vấn mẫu", detect_metric: "Nhận chỉ số",
};

const VERDICT_VI: Record<string, string> = { green: "Xanh", yellow: "Vàng", red: "Đỏ", blocked: "Chặn", unchecked: "chưa kiểm" };
const RECON_VI: Record<string, string> = { match: "khớp", mismatch: "lệch", same_sql: "trùng SQL chuẩn", error: "lỗi", no_definition: "chưa có định nghĩa" };

function stepDetail(s: TraceStep): string {
  const parts: string[] = [];
  if (s.verdict) parts.push(`phán quyết ${VERDICT_VI[s.verdict] ?? s.verdict}${s.rules?.length ? ` (${s.rules.join(", ")})` : ""}`);
  if (s.rows !== undefined) parts.push(`${s.rows} dòng`);
  if (s.status) parts.push(`đối chiếu: ${RECON_VI[s.status] ?? s.status}${typeof s.max_diff_pct === "number" ? `, lệch ${s.max_diff_pct.toLocaleString("vi-VN")}%` : ""}`);
  if (s.tokens !== undefined) parts.push(`~${s.tokens} token${s.input ? ", bấm để xem vào/ra" : ""}`);
  return parts.join(" · ") || "—";
}

function TraceView({ run }: { run: Run }) {
  const [open, setOpen] = useState<number | null>(null);
  const steps: TraceStep[] = run.usage?.steps ?? [];
  if (!steps.length) return <p className="text-[13px] text-muted">Câu này không có trace.</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        <span>request_id <span className="font-mono text-ink-2">{run.request_id ?? "—"}</span></span>
        <span>tổng <span className="num text-ink-2">{run.usage?.latency_ms} ms</span></span>
        <span>~<span className="num text-ink-2">{run.usage?.tokens}</span> token</span>
        <span>model <span className="font-mono text-ink-2">{run.usage?.model ?? run.usage?.llm}</span></span>
      </div>
      <table className="w-full text-[12.5px]">
        <thead className="text-left text-[11.5px] text-muted"><tr><th className="py-1 font-medium">Bước</th><th className="py-1 font-medium">Loại</th><th className="py-1 font-medium">Chi tiết</th><th className="py-1 text-right font-medium">ms</th></tr></thead>
        <tbody>
          {steps.map((s, i) => (
            <Fragment key={i}>
              <tr className={cx("border-t border-line", s.input && "cursor-pointer hover:bg-sunk/60")} onClick={() => s.input && setOpen(open === i ? null : i)}>
                <td className="py-1.5">{STEP_LABEL[s.step] ?? s.step}{s.attempt !== undefined ? ` · lần ${s.attempt}` : ""}</td>
                <td className="py-1.5 text-muted">{s.kind === "llm" ? "LLM (mô phỏng)" : s.kind === "tool" ? "công cụ" : "—"}</td>
                <td className="py-1.5 text-ink-2">{stepDetail(s)}</td>
                <td className="num py-1.5 text-right">{s.ms}</td>
              </tr>
              {open === i && (
                <tr><td colSpan={4} className="pb-2">
                  <div className="grid gap-2 md:grid-cols-2">
                    <pre className="scroll-thin max-h-48 overflow-auto rounded border border-line bg-paper p-2 font-mono text-[11px] whitespace-pre-wrap">{s.input}</pre>
                    <pre className="scroll-thin max-h-48 overflow-auto rounded border border-line bg-paper p-2 font-mono text-[11px] whitespace-pre-wrap">{s.output}</pre>
                  </div>
                </td></tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AnswerCard({ run, onFollowUp, onChange, onAskWith, compact = false }: {
  run: Run; onFollowUp?: (r: Run) => void; onChange?: (r: Run) => void;
  onAskWith?: (question: string, metricId: string) => void; compact?: boolean;
}) {
  const { db } = useSession();
  const last = run.attempts.length - 1;
  const [active, setActive] = useState(Math.max(last, 0));
  const final = run.attempts[last];
  const verdict = run.final_verdict;
  const [tab, setTab] = useState<Tab>(verdict === "green" || run.status === "definition" ? "lineage" : "checks");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const isSql = run.input_kind === "sql";
  const held = run.status === "held";
  const answer = run.answer;
  const recon = answer?.reconciliation;
  const shown = run.attempts[active];

  const graph = useMemo(() => {
    const ln = shown?.lineage;
    if (!ln) return null;
    const isFinal = shown.no === run.attempts[run.attempts.length - 1].no;
    const label = run.status === "definition" ? run.metric?.name_vi ?? "Chỉ số"
      : !isFinal ? (shown.verdict === "red" ? "Không chạy" : "Đã thay bằng lần sau")
      : held ? "Giữ lại, không công bố" : answer?.headline ?? (run.result ? `${run.result.rows.length} dòng` : "Kết quả");
    const sub = run.status === "definition" ? "định nghĩa chuẩn" : `lần ${shown.no} · ${({ green: "Xanh", yellow: "Vàng", red: "Đỏ" } as Record<string, string>)[shown.verdict] ?? shown.verdict}`;
    return buildAnswerGraph(ln, shown.verification.findings, label, sub);
  }, [shown, run, held, answer]);

  const sendFeedback = async (correct: boolean) => {
    if (!db) return;
    setBusy(true);
    try {
      const r = await api<Run>(`/db/${db.id}/runs/${run.id}/feedback`, { body: { correct } });
      onChange?.(r);
      window.dispatchEvent(new Event("lvda:reviews-changed"));
    } finally { setBusy(false); }
  };

  const downloadCsv = () => {
    if (!run.result) return;
    const blob = new Blob(["﻿" + toCsv(run.result.columns, run.result.rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `lvda-${run.id}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const metricLine = run.metric ? `${run.metric.name_vi} · v${run.metric.version}` : isSql ? "Không khớp chỉ số nào"
    : run.interpretation?.kind === "adhoc" ? "Chưa có chỉ số chuẩn" : null;
  const findingsCount = shown ? shown.verification.findings.filter((f) => f.severity !== "info").length : 0;
  const notesCount = shown ? shown.verification.findings.length - findingsCount : 0;
  // "Phát hiện (0)" mà vẫn có ghi chú thì dễ hiểu nhầm, nên tách lỗi và ghi chú
  const checksLabel = notesCount ? `Phát hiện · ${findingsCount} lỗi, ${notesCount} ghi chú` : `Phát hiện (${findingsCount})`;
  const alts = run.interpretation?.alternatives ?? [];

  return (
    <article className="rounded-lg border border-line bg-surface">
      <header className="flex items-start justify-between gap-4 px-5 pt-4">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[12px] text-muted">
            <span className={cx("rounded px-1.5 py-px font-medium", isSql ? "bg-navy text-white" : "bg-sunk text-ink-2")}>{isSql ? "Kiểm SQL" : run.status === "definition" ? "Định nghĩa" : "Câu hỏi"}</span>
            {run.metric && (
              <button onClick={() => navigate(`/metrics/${run.metric?.id}`)} title="Mở chỉ số này"
                className="underline decoration-line-strong underline-offset-2 hover:text-accent">{metricLine}</button>
            )}
            {!run.metric && metricLine && <span>{metricLine}</span>}
            {run.metric && run.metric.status !== "certified" && <Pill tone="warn">{run.metric.status === "stale" ? "cần chứng nhận lại" : "chỉ số nháp"}</Pill>}
            {run.interpretation?.carried && <span>· nối tiếp câu trước</span>}
            {run.interpretation?.detected && <span>· tự nhận chỉ số</span>}
            <span>· {timeAgo(run.created_at)}</span>
          </div>
          {isSql
            ? <p className="truncate font-mono text-[13px] text-ink-2" title={run.question}>{run.question.replace(/\s+/g, " ")}</p>
            : <h2 className="text-[15.5px] font-medium text-balance">{run.question}</h2>}
        </div>
        {verdict && run.status !== "definition" && <VerdictStamp verdict={verdict} held={held} />}
      </header>

      <div className="flex flex-col gap-4 px-5 py-4">
        {run.status === "blocked" && <p className="text-bad">{final?.verification.blocked_reason ?? answer?.text}</p>}
        {run.status === "error" && <p className="text-bad">{answer?.text ?? "Lỗi khi chạy SQL."}</p>}
        {(run.status === "refused" || run.status === "definition") && <p className="text-ink-2">{answer?.text}</p>}
        {held && <p className="rounded-md bg-held-soft px-3 py-2 text-[13px] text-held">{answer?.text}</p>}

        {run.status === "answered" && answer && (
          <div className="flex flex-col gap-2">
            {answer.headline && (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="num text-[30px] font-medium leading-none tracking-tight">{answer.headline}</span>
                {answer.headline_note && <span className="text-[13px] text-muted">{answer.headline_note}</span>}
              </div>
            )}
            <p className="text-ink-2">{answer.text}</p>
          </div>
        )}

        {recon && recon.status === "mismatch" && (
          <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] text-warn">
            <Scale size={15} className="mt-0.5 shrink-0" />
            <span>Đối chiếu với SQL chuẩn cùng bộ lọc: <b>lệch tới {(recon.max_diff_pct ?? 0).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%</b>{recon.missing_keys?.length ? `, thiếu/thừa ${recon.missing_keys.length} nhóm` : ""}. Câu trả lời đã được gửi duyệt. Xem SQL chuẩn ở tab SQL.</span>
          </div>
        )}
        {recon && recon.status === "match" && <p className="flex items-center gap-1.5 text-[12.5px] text-good"><Scale size={13} />Đối chiếu với SQL chuẩn cùng bộ lọc: khớp ({recon.rows_compared} nhóm).</p>}
        {recon && recon.status === "no_definition" && (
          <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] text-warn">
            <Scale size={15} className="mt-0.5 shrink-0" />
            <span>Chưa có định nghĩa chuẩn cho câu hỏi này nên không đối chiếu được. Câu SQL chỉ qua các luật chung và đã được gửi cho data engineer duyệt.</span>
          </div>
        )}

        {alts.length > 0 && onAskWith && (
          <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
            <span className="text-muted">“{run.interpretation?.matched_text}” cũng có thể là:</span>
            {alts.map((a) => (
              <button key={a.id} onClick={() => onAskWith(run.question, a.id)} className="rounded border border-line-strong px-1.5 py-0.5 hover:border-accent hover:text-accent">{a.name_vi}</button>
            ))}
          </div>
        )}

        {isSql && run.status === "checked" && verdict === "red" && run.result && (
          <p className="rounded-md bg-bad-soft px-3 py-2 text-[13px] text-bad">Câu SQL có lỗi cấu trúc. Kết quả bên dưới chỉ để tham khảo, chưa nên dùng.</p>
        )}
        {run.masked_columns && run.masked_columns.length > 0 && (
          <p className="flex items-center gap-1.5 text-[12.5px] text-muted"><EyeOff size={13} />Đã che cột {run.masked_columns.join(", ")} (dữ liệu cá nhân) vì bạn có quyền viewer.</p>
        )}
        {(run.status === "answered" || run.status === "checked") && !compact && <ResultView run={run} />}

        {answer?.assumptions && answer.assumptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
            <Info size={13} className="text-faint" aria-hidden /><span className="text-muted">Giả định:</span>
            {answer.assumptions.map((a) => <span key={a} className="rounded bg-sunk px-1.5 py-0.5 text-ink-2">{a}</span>)}
          </div>
        )}

        {run.attempts.length > 0 && (
          <section className="rounded-md border border-line bg-paper/60">
            {run.attempts.length > 1 && (
              <div className="border-b border-line px-3 py-2.5">
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">Các lần thử</div>
                <AttemptTimeline attempts={run.attempts} active={active} onSelect={setActive} />
              </div>
            )}
            <div className="flex items-center gap-1 border-b border-line px-2 pt-1.5" role="tablist">
              {([["lineage", "Lineage"], ["checks", checksLabel], ["sql", "SQL"], ["trace", "Trace"]] as [Tab, string][]).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={cx("-mb-px rounded-t px-2.5 py-1.5 text-[12.5px]", tab === k ? "border border-b-surface border-line bg-surface font-medium" : "text-muted hover:text-ink")}>
                  {label}
                </button>
              ))}
              <span className="ml-auto pr-2 text-[11.5px] text-faint">{run.attempts.length > 1 ? `đang xem lần ${shown?.no} · ` : ""}kiểm trong {shown?.verification.elapsed_ms ?? 0} ms</span>
            </div>
            <div className="bg-surface p-3">
              {tab === "lineage" && (graph ? <div className="flex flex-col gap-2"><LineageGraph graph={graph} /><GraphLegend /></div>
                : <p className="text-[13px] text-muted">Không dựng được lineage cho câu SQL này.</p>)}
              {tab === "checks" && shown && <AttemptDetail attempt={shown} previous={active > 0 ? run.attempts[active - 1] : undefined} />}
              {tab === "sql" && shown && (
                <div className="flex flex-col gap-2">
                  {active > 0 && <p className="text-[12px] text-muted">So với lần {active - 1}: dòng xanh là thêm, dòng đỏ gạch là bỏ.</p>}
                  <SqlView sql={shown.sql} previous={active > 0 ? run.attempts[active - 1].sql : undefined}
                    highlight={shown.verification.findings.map((f) => f.evidence).filter((e) => e && e.length < 80)} />
                  {recon?.reference_sql && active === last && (
                    <details className="text-[12.5px]"><summary className="cursor-pointer text-muted">SQL chuẩn dùng để đối chiếu</summary>
                      <div className="mt-2"><SqlView sql={recon.reference_sql} previous={shown.sql} maxHeight={260} /></div></details>
                  )}
                </div>
              )}
              {tab === "trace" && <TraceView run={run} />}
            </div>
          </section>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-2.5">
        {onFollowUp && run.input_kind === "question" && run.metric && (
          <Button size="sm" variant="ghost" onClick={() => onFollowUp(run)}><CornerDownRight size={14} /> Hỏi tiếp</Button>
        )}
        {run.result && <Button size="sm" variant="ghost" onClick={downloadCsv}><Download size={14} /> CSV</Button>}
        <div className="ml-auto flex items-center gap-2 text-[12px] text-muted">
          {run.review_status === "pending" && <Pill tone="warn">chờ duyệt</Pill>}
          {run.review_status === "approved" && <Pill tone="good">đã duyệt</Pill>}
          {run.review_status === "rejected" && <Pill tone="bad">bị từ chối</Pill>}
          {run.usage && <span className="num">{run.usage.llm === "mock" ? "LLM mô phỏng" : run.usage.llm} · {run.usage.latency_ms} ms</span>}
          {run.input_kind === "question" && run.status === "answered" && (
            run.feedback ? <span>{run.feedback.correct ? "Bạn đánh dấu: đúng" : "Bạn đánh dấu: sai"}</span> : (
              <span className="flex items-center gap-0.5">
                <button disabled={busy} onClick={() => sendFeedback(true)} className="rounded p-1 hover:bg-sunk hover:text-good" title="Số này đúng" aria-label="Số này đúng"><ThumbsUp size={14} /></button>
                <button disabled={busy} onClick={() => sendFeedback(false)} className="rounded p-1 hover:bg-sunk hover:text-bad" title="Số này sai, gửi duyệt" aria-label="Số này sai"><ThumbsDown size={14} /></button>
              </span>
            )
          )}
        </div>
      </footer>
    </article>
  );
}
