import { ArrowUp, Code2, CornerDownRight, X } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { api } from "../api";
import { useSession } from "../session";
import type { Interpretation, MetricLite, Run } from "../types";
import { cx, Kbd } from "./ui";

export interface ComposerHandle { focus: () => void; fill: (text: string) => void }

const isSqlText = (t: string) => /^\s*(select|with)\b/i.test(t);

export const Composer = forwardRef<ComposerHandle, {
  onSubmit: (text: string, opts: { simulate: boolean; metricId: string | null }) => void;
  busy: boolean; context: Run | null; clearContext: () => void; metrics: MetricLite[];
}>(function Composer({ onSubmit, busy, context, clearContext, metrics }, ref) {
  const { db } = useSession();
  const [text, setText] = useState("");
  const [simulate, setSimulate] = useState(true);
  const [metricId, setMetricId] = useState<string>("");
  const [override, setOverride] = useState<string | null>(null);
  const [interp, setInterp] = useState<Interpretation | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const sql = isSqlText(text);

  useImperativeHandle(ref, () => ({
    focus: () => ta.current?.focus(),
    fill: (t: string) => { setText(t); setTimeout(() => ta.current?.focus(), 0); },
  }));

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, sql ? 320 : 160)}px`;
  }, [text, sql]);

  // Diễn giải trực tiếp: agent hiểu câu hỏi thế nào, trước khi gửi
  useEffect(() => {
    if (!db || sql || !text.trim()) { setInterp(null); return; }
    const t = setTimeout(() => {
      api<Interpretation>(`/db/${db.id}/interpret`, { body: { question: text, context_run_id: context?.id ?? null, metric_id: override } })
        .then(setInterp).catch(() => setInterp(null));
    }, 220);
    return () => clearTimeout(t);
  }, [text, db, sql, context, override]);

  const submit = () => {
    if (!text.trim() || busy) return;
    onSubmit(text.trim(), { simulate, metricId: sql ? (metricId || null) : override });
    setText("");
    setInterp(null);
    setOverride(null);
  };

  return (
    <div className="lv-glow-frame">
    <div className="rounded-[15px] bg-[#0f1520]">
      {(context || interp || sql) && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2 text-[12.5px]">
          {context && !sql && (
            <span className="inline-flex items-center gap-1 rounded bg-sunk px-1.5 py-0.5 text-ink-2">
              <CornerDownRight size={12} /> Hỏi tiếp: <span className="max-w-[220px] truncate">{context.question}</span>
              <button onClick={clearContext} className="ml-0.5 rounded hover:bg-line" aria-label="Bỏ ngữ cảnh"><X size={12} /></button>
            </span>
          )}
          {sql ? (
            <>
              <span className="inline-flex items-center gap-1 font-medium text-accent"><Code2 size={13} /> Kiểm SQL</span>
              <span className="text-muted">· so với</span>
              <select value={metricId} onChange={(e) => setMetricId(e.target.value)} className="rounded border border-line bg-surface px-1 py-0.5" aria-label="So với chỉ số">
                <option value="">chỉ số tự nhận ra</option>
                {metrics.map((m) => <option key={m.id} value={m.id}>{m.name_vi}</option>)}
              </select>
            </>
          ) : interp && interp.kind === "out_of_scope" ? (
            <span className="text-warn">Chưa khớp chỉ số nào. Thử: {interp.suggestions?.slice(0, 3).join(", ")}</span>
          ) : interp && interp.chips.length > 0 ? (
            <>
              <span className="text-muted">Hiểu là</span>
              {interp.chips.map((c, i) => (
                <span key={c} className={cx("rounded px-1.5 py-0.5", c === "chưa có chỉ số chuẩn" ? "bg-warn-soft text-warn"
                  : i === 0 ? "bg-accent-soft font-medium text-accent" : "bg-sunk text-ink-2")}>{c}</span>
              ))}
              {interp.metric_status && interp.metric_status !== "certified" && <span className="text-warn">· chỉ số chưa chứng nhận</span>}
              {interp.kind === "definition" && <span className="text-muted">· hỏi định nghĩa</span>}
              {interp.kind === "adhoc" && <span className="text-warn">· sẽ viết SQL riêng, tối đa Vàng</span>}
              {override && <button onClick={() => setOverride(null)} className="text-muted underline-offset-2 hover:underline">· bỏ chọn tay</button>}
              {!override && interp.alternatives && interp.alternatives.length > 0 && (
                <span className="flex flex-wrap items-center gap-1 text-muted">
                  · “{interp.matched_text}” cũng có thể là
                  {interp.alternatives.map((a) => (
                    <button key={a.id} onClick={() => setOverride(a.id)} className="rounded border border-line-strong px-1 text-ink-2 hover:border-accent hover:text-accent">{a.name_vi}</button>
                  ))}
                </span>
              )}
            </>
          ) : null}
        </div>
      )}
      <div className="flex items-end gap-3 pb-2.5 pl-[18px] pr-3.5 pt-3.5">
        <textarea ref={ta} value={text} onChange={(e) => setText(e.target.value)} rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && ((!sql && !e.shiftKey) || e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
          }}
          placeholder="Hỏi một con số, ví dụ “Doanh thu theo bang tháng 3/2018”, hoặc dán một câu SQL để kiểm"
          aria-label="Câu hỏi hoặc câu SQL"
          className={cx("scroll-thin max-h-80 min-h-[48px] flex-1 resize-none bg-transparent outline-none placeholder:text-faint focus-visible:outline-none",
            sql ? "font-mono text-[13px] leading-[1.55]" : "text-[15px] leading-[1.55]")} />
        <button onClick={submit} disabled={!text.trim() || busy} aria-label="Gửi"
          className={cx("grid size-[38px] shrink-0 place-items-center rounded-[10px] transition-all", text.trim() && !busy ? "lv-send text-white" : "bg-[#1c2433] text-faint")}>
          <ArrowUp size={17} strokeWidth={2.3} />
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-[9px] pl-4 pr-3.5 text-[12.5px] text-muted">
        <label className="inline-flex cursor-pointer items-center gap-2" title="Bật để LLM giả lập mắc các lỗi điển hình của text-to-SQL ở lần thử đầu, nhằm thấy bộ kiểm định và vòng tự sửa làm việc.">
          <span className="relative inline-flex">
            <input type="checkbox" className="peer sr-only" checked={simulate} onChange={(e) => setSimulate(e.target.checked)} />
            <span className="h-[18px] w-[30px] rounded-[9px] bg-line-strong transition-colors peer-checked:bg-[oklch(0.78_0.14_70)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent" />
            <span className="absolute left-0.5 top-0.5 size-3.5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.4)] transition-transform peer-checked:translate-x-3" />
          </span>
          LLM mô phỏng hay mắc lỗi
        </label>
        <span className="hidden items-center gap-1.5 text-[12px] text-faint lg:flex">{sql ? <><Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> để kiểm</> : <><Kbd>Enter</Kbd> gửi <span className="w-1" /> <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> xuống dòng <span className="w-1" /> <Kbd>/</Kbd> để gõ</>}</span>
      </div>
    </div>
    </div>
  );
});
