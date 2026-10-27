import { ChevronRight, CornerUpLeft, Download, EyeOff, Scale, ThumbsDown, ThumbsUp } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { toCsv } from "../format";
import { useSession } from "../session";
import type { Run, TraceStep } from "../types";
import { AttemptChips, AttemptDetail } from "./Evidence";
import { buildAnswerGraph, GraphLegend, LineageGraph } from "./LineageGraph";
import { ResultView } from "./Result";
import { SqlView } from "./Sql";
import { cx, Pill, timeAgo, VerdictStamp } from "./ui";

type Tab = "lineage" | "checks" | "sql" | "trace";

const STEP_LABEL: Record<string, string> = {
  interpret: "Hiểu câu hỏi", generate_sql: "Viết SQL", fix_sql: "Sửa SQL", verify: "Kiểm định", execute: "Chạy truy vấn",
  reconcile: "Đối chiếu SQL chuẩn", compose: "Soạn trả lời", retrieve_verified: "Lấy truy vấn mẫu", detect_metric: "Nhận chỉ số",
};

const VERDICT_VI: Record<string, string> = { green: "Xanh", yellow: "Vàng", red: "Đỏ", blocked: "Chặn", unchecked: "chưa kiểm" };
const RECON_VI: Record<string, string> = { match: "khớp", mismatch: "lệch", same_sql: "trùng SQL chuẩn", error: "lỗi", no_definition: "chưa có định nghĩa" };
// màu con số chính theo phán quyết (Xanh dùng màu nhấn)
const HEADLINE_TONE: Record<string, string> = { green: "text-accent", yellow: "text-warn", red: "text-bad", blocked: "text-bad" };

function stepDetail(s: TraceStep): string {
  const parts: string[] = [];
  if (s.verdict) parts.push(`phán quyết ${VERDICT_VI[s.verdict] ?? s.verdict}${s.rules?.length ? ` (${s.rules.join(", ")})` : ""}`);
  if (s.rows !== undefined) parts.push(`${s.rows} dòng`);
  if (s.status) parts.push(`đối chiếu: ${RECON_VI[s.status] ?? s.status}${typeof s.max_diff_pct === "number" ? `, lệch ${s.max_diff_pct.toLocaleString("vi-VN")}%` : ""}`);
  if (s.tokens !== undefined) parts.push(`~${s.tokens} token${s.input ? ", bấm để xem vào/ra" : ""}`);
  return parts.join(" · ");
}

function TraceView({ run }: { run: Run }) {
  const [open, setOpen] = useState<number | null>(null);
  const steps: TraceStep[] = run.usage?.steps ?? [];
  if (!steps.length) return <p className="py-2 text-[13px] text-muted">Câu này không có trace.</p>;
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-line-soft pb-2.5 pt-1 text-[12px] text-faint">
        <span>request_id <span className="font-mono text-ink-2">{run.request_id ?? "—"}</span></span>
        <span>tổng <span className="num text-ink-2">{run.usage?.latency_ms} ms</span></span>
        <span>~<span className="num text-ink-2">{run.usage?.tokens}</span> token</span>
        <span>model <span className="font-mono text-ink-2">{run.usage?.model ?? run.usage?.llm}</span></span>
      </div>
      {steps.map((s, i) => {
        const detail = stepDetail(s);
        return (
          <Fragment key={i}>
            <div onClick={() => s.input && setOpen(open === i ? null : i)}
              className={cx("grid grid-cols-[24px_minmax(0,1fr)_70px] gap-3 border-b border-line-soft py-[9px] text-[13px]", s.input && "cursor-pointer hover:bg-hover/50")}>
              <span className="font-mono text-[11.5px] text-dim">{i}</span>
              <span className="text-ink-2">
                {STEP_LABEL[s.step] ?? s.step}{s.attempt !== undefined ? ` (lần ${s.attempt})` : ""}
                {s.kind === "llm" && <span className="text-faint"> · LLM</span>}
                {detail && <span className="text-faint"> · {detail}</span>}
              </span>
              <span className="num text-right text-[12px] text-faint">{s.ms.toLocaleString("vi-VN")} ms</span>
            </div>
            {open === i && (
              <div className="grid gap-2 border-b border-line-soft py-2 md:grid-cols-2">
                <pre className="scroll-thin max-h-48 overflow-auto whitespace-pre-wrap rounded border border-line bg-paper p-2 font-mono text-[11px]">{s.input}</pre>
                <pre className="scroll-thin max-h-48 overflow-auto whitespace-pre-wrap rounded border border-line bg-paper p-2 font-mono text-[11px]">{s.output}</pre>
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/** Tách đơn vị chữ ở cuối ("499.240,84 BRL") để in nhỏ hơn con số. */
function splitUnit(h: string): [string, string | null] {
  const m = /^(.*\d)\s+([^\d\s]+)$/.exec(h.trim());
  return m ? [m[1], m[2]] : [h, null];
}

export function AnswerCard({ run, onFollowUp, onChange, onAskWith, compact = false, bubble = false }: {
  run: Run; onFollowUp?: (r: Run) => void; onChange?: (r: Run) => void;
  onAskWith?: (question: string, metricId: string) => void; compact?: boolean;
  /** hiện câu hỏi thành bong bóng phía trên thẻ (màn hỏi) thay vì trong đầu thẻ */
  bubble?: boolean;
}) {
  const { db, user } = useSession();
  const last = run.attempts.length - 1;
  const [active, setActive] = useState(Math.max(last, 0));
  const final = run.attempts[last];
  const verdict = run.final_verdict;
  const [tab, setTab] = useState<Tab>(verdict === "green" || run.status === "definition" ? "lineage" : "checks");
  const [busy, setBusy] = useState(false);
  const [showAssume, setShowAssume] = useState(false);
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
    const sub = run.status === "definition" ? "định nghĩa chuẩn" : `lần ${shown.no} · ${VERDICT_VI[shown.verdict] ?? shown.verdict}`;
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

  const findingsCount = shown ? shown.verification.findings.filter((f) => f.severity !== "info").length : 0;
  const notesCount = shown ? shown.verification.findings.length - findingsCount : 0;
  // "Phát hiện (0)" mà vẫn có ghi chú thì dễ hiểu nhầm, nên tách lỗi và ghi chú
  const checksLabel = findingsCount && notesCount ? `Phát hiện · ${findingsCount} lỗi, ${notesCount} ghi chú`
    : notesCount ? `Phát hiện · ${notesCount} ghi chú` : `Phát hiện · ${findingsCount} lỗi`;
  const alts = run.interpretation?.alternatives ?? [];
  const assumptions = answer?.assumptions ?? [];
  const [num, unit] = answer?.headline ? splitUnit(answer.headline) : ["", null];
  const initial = (run.user_name ?? user?.name ?? "?").slice(0, 1);

  return (
    <div className="flex flex-col gap-4">
      {bubble && (
        <div className="flex items-start justify-end gap-2.5">
          <div className={cx("max-w-[80%] rounded-[10px_10px_2px_10px] bg-raised px-3.5 py-2.5 text-pretty text-ink",
            isSql ? "whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.6]" : "text-[15px] leading-normal")}>{run.question}</div>
          <div className="grid size-7 shrink-0 place-items-center rounded-full bg-edge text-[12px] font-semibold" aria-hidden>{initial}</div>
        </div>
      )}

      <article className="overflow-hidden rounded-[10px] border border-line bg-surface">
        <header className="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-2.5">
          <div className="grid size-5 shrink-0 place-items-center rounded-[5px] bg-accent font-mono text-[10px] font-medium text-on-accent" aria-hidden>L</div>
          {run.metric ? (
            <>
              <span className="whitespace-nowrap text-[12.5px] text-muted">{isSql ? "Kiểm SQL theo" : run.status === "definition" ? "Định nghĩa" : "Trả lời theo"}</span>
              <button onClick={() => navigate(`/metrics/${run.metric?.id}`)} title="Mở chỉ số này"
                className="whitespace-nowrap text-[12.5px] text-ink hover:text-accent">{run.metric.name_vi}</button>
              <span className="shrink-0 whitespace-nowrap rounded border border-line-strong px-1.5 py-px font-mono text-[11.5px] text-faint">{run.metric.id} · v{run.metric.version}</span>
              {run.metric.status !== "certified" && <Pill tone="warn">{run.metric.status === "stale" ? "cần chứng nhận lại" : "chỉ số nháp"}</Pill>}
            </>
          ) : (
            <span className="whitespace-nowrap text-[12.5px] text-muted">
              {isSql ? "Kiểm SQL · không khớp chỉ số nào" : run.interpretation?.kind === "adhoc" ? "Chưa có chỉ số chuẩn" : "Trả lời"}
            </span>
          )}
          {run.interpretation?.carried && <span className="text-[12px] text-dim">nối tiếp câu trước</span>}
          {run.interpretation?.detected && <span className="text-[12px] text-dim">tự nhận chỉ số</span>}
          <span className="whitespace-nowrap text-[12px] text-dim">{timeAgo(run.created_at)}</span>
          {verdict && run.status !== "definition" && <span className="ml-auto"><VerdictStamp verdict={verdict} held={held} /></span>}
        </header>

        <div className="flex flex-col gap-[18px] px-4 pb-[18px] pt-5">
          {!bubble && (isSql
            ? <p className="truncate font-mono text-[12.5px] text-ink-2" title={run.question}>{run.question.replace(/\s+/g, " ")}</p>
            : <h2 className="text-balance text-[15px] font-medium">{run.question}</h2>)}
          {run.status === "blocked" && <p className="text-bad">{final?.verification.blocked_reason ?? answer?.text}</p>}
          {run.status === "error" && <p className="text-bad">{answer?.text ?? "Lỗi khi chạy SQL."}</p>}
          {(run.status === "refused" || run.status === "definition") && <p className="text-[14px] leading-relaxed text-muted">{answer?.text}</p>}
          {held && <p className="rounded-md bg-held-soft px-3 py-2 text-[13px] text-held">{answer?.text}</p>}

          {run.status === "answered" && answer && (
            <div className="flex flex-col gap-1.5">
              {answer.headline && (
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className={cx("font-mono text-[36px] font-medium leading-[1.15] tracking-[-0.02em]", HEADLINE_TONE[verdict ?? ""] ?? "text-ink")}>
                    {num}{unit && <span className="text-[18px] text-muted"> {unit}</span>}
                  </span>
                  {answer.headline_note && <span className="text-[13px] text-faint">{answer.headline_note}</span>}
                </div>
              )}
              <p className="text-[14px] leading-relaxed text-muted">{answer.text}</p>
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

          {isSql && run.status === "checked" && verdict === "red" && run.result && (
            <p className="rounded-md bg-bad-soft px-3 py-2 text-[13px] text-bad">Câu SQL có lỗi cấu trúc. Kết quả bên dưới chỉ để tham khảo, chưa nên dùng.</p>
          )}
          {run.masked_columns && run.masked_columns.length > 0 && (
            <p className="flex items-center gap-1.5 text-[12.5px] text-faint"><EyeOff size={13} />Đã che cột {run.masked_columns.join(", ")} (dữ liệu cá nhân) vì bạn có quyền viewer.</p>
          )}
          {(run.status === "answered" || run.status === "checked") && !compact && <ResultView run={run} />}

          {(assumptions.length > 0 || (alts.length > 0 && onAskWith)) && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                {assumptions.length > 0 && (
                  <button onClick={() => setShowAssume(!showAssume)} aria-expanded={showAssume}
                    className="flex items-center gap-1.5 whitespace-nowrap text-[13px] text-ink-2 hover:text-white">
                    <ChevronRight size={12} strokeWidth={2.4} className={cx("transition-transform", showAssume && "rotate-90")} />
                    Giả định <span className="text-dim">{assumptions.length}</span>
                  </button>
                )}
                {alts.length > 0 && onAskWith && (
                  <span className="ml-auto flex flex-wrap items-center gap-2 text-[12.5px] text-faint">
                    “{run.interpretation?.matched_text}” cũng có thể là
                    {alts.map((a) => (
                      <button key={a.id} onClick={() => onAskWith(run.question, a.id)}
                        className="h-[26px] whitespace-nowrap rounded-[5px] border border-edge px-2.5 text-ink hover:bg-line">{a.name_vi}</button>
                    ))}
                  </span>
                )}
              </div>
              {showAssume && (
                <ol className="flex list-decimal flex-col gap-1.5 rounded-md bg-paper py-2.5 pl-8 pr-3.5 text-[13px] leading-normal text-ink-2">
                  {assumptions.map((a) => <li key={a}>{a}</li>)}
                </ol>
              )}
            </div>
          )}
        </div>

        {run.attempts.length > 0 && (
          <section className="border-t border-line bg-[#0f101a]">
            <div className="flex flex-wrap items-center gap-2.5 px-4 py-3">
              <span className="text-[13px] font-medium">Phiếu kiểm</span>
              <AttemptChips attempts={run.attempts} active={active} onSelect={setActive} />
              <span className="ml-auto whitespace-nowrap text-[12px] text-dim">kiểm trong {(shown?.verification.elapsed_ms ?? 0).toLocaleString("vi-VN")} ms</span>
            </div>
            <div className="flex flex-wrap items-center gap-1 border-b border-line px-2.5" role="tablist">
              {([["lineage", "Lineage"], ["checks", checksLabel], ["sql", "SQL"], ["trace", "Trace"]] as [Tab, string][]).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={cx("h-9 whitespace-nowrap px-2 text-[13px]", tab === k ? "text-ink shadow-[inset_0_-2px_0_var(--color-accent)]" : "text-faint hover:text-ink-2")}>
                  {label}
                </button>
              ))}
            </div>
            <div className={cx(tab === "sql" ? "p-4" : tab === "lineage" ? "p-4" : "px-4 pb-3 pt-1.5")}>
              {tab === "lineage" && (graph ? <div className="flex flex-col gap-4"><LineageGraph graph={graph} /><GraphLegend /></div>
                : <p className="text-[13px] text-muted">Không dựng được lineage cho câu SQL này.</p>)}
              {tab === "checks" && shown && <AttemptDetail attempt={shown} previous={active > 0 ? run.attempts[active - 1] : undefined} />}
              {tab === "sql" && shown && (
                <div className="flex flex-col gap-2">
                  {active > 0 && <p className="text-[12px] text-faint">So với lần {active - 1}: dòng xanh là thêm, dòng đỏ gạch là bỏ.</p>}
                  <SqlView sql={shown.sql} previous={active > 0 ? run.attempts[active - 1].sql : undefined}
                    highlight={shown.verification.findings.map((f) => f.evidence).filter((e) => e && e.length < 80)} />
                  {recon?.reference_sql && active === last && (
                    <details className="text-[12.5px]"><summary className="cursor-pointer text-faint">SQL chuẩn dùng để đối chiếu</summary>
                      <div className="mt-2"><SqlView sql={recon.reference_sql} previous={shown.sql} maxHeight={260} /></div></details>
                  )}
                </div>
              )}
              {tab === "trace" && <TraceView run={run} />}
            </div>
          </section>
        )}

        <footer className="flex flex-wrap items-center gap-1.5 border-t border-line px-2.5 py-2">
          {onFollowUp && run.input_kind === "question" && run.metric && (
            <button onClick={() => onFollowUp(run)} title="Hỏi tiếp" aria-label="Hỏi tiếp"
              className="grid size-[30px] place-items-center rounded-[5px] text-muted hover:bg-hover hover:text-ink"><CornerUpLeft size={15} /></button>
          )}
          {run.result && (
            <button onClick={downloadCsv} title="Tải CSV" aria-label="Tải CSV"
              className="grid size-[30px] place-items-center rounded-[5px] text-muted hover:bg-hover hover:text-ink"><Download size={15} /></button>
          )}
          <div className="ml-auto flex items-center gap-2 text-[12px] text-faint">
            {run.review_status === "pending" && <Pill tone="warn">chờ duyệt</Pill>}
            {run.review_status === "approved" && <Pill tone="good">đã duyệt</Pill>}
            {run.review_status === "rejected" && <Pill tone="bad">bị từ chối</Pill>}
            {run.usage && <span className="whitespace-nowrap font-mono text-[11.5px] text-dim">{run.usage.llm === "mock" ? "LLM mô phỏng" : run.usage.llm} · {run.usage.latency_ms.toLocaleString("vi-VN")} ms</span>}
            {run.input_kind === "question" && run.status === "answered" && (
              run.feedback ? <span>{run.feedback.correct ? "Bạn đánh dấu: đúng" : "Bạn đánh dấu: sai"}</span> : (
                <span className="flex items-center">
                  <button disabled={busy} onClick={() => sendFeedback(true)} className="grid size-[30px] place-items-center rounded-[5px] text-faint hover:bg-hover hover:text-good" title="Số này đúng" aria-label="Số này đúng"><ThumbsUp size={14} /></button>
                  <button disabled={busy} onClick={() => sendFeedback(false)} className="grid size-[30px] place-items-center rounded-[5px] text-faint hover:bg-hover hover:text-bad" title="Số này sai, gửi duyệt" aria-label="Số này sai"><ThumbsDown size={14} /></button>
                </span>
              )
            )}
          </div>
        </footer>
      </article>
    </div>
  );
}
