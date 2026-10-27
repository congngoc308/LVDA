import { ArrowRight, FileText } from "lucide-react";
import { type ReactElement, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { RunLite } from "../../types";
import { pct, Stat, type Latest } from "../EvalReport";
import { Button, cx, fmtDate, RuleChip, timeAgo, VerdictDot } from "../ui";

export interface Stats {
  days: number;
  totals: {
    runs: number; questions: number; sql_checks: number; refused: number; held: number; feedback_up: number; feedback_down: number;
    p50_ms: number | null; p95_ms: number | null; tokens: number; cost_usd: number; q_answered: number; q_green: number; q_yellow: number;
  };
  fix: { red_first: number; fixed: number };
  per_day: { day: string; runs: number; green: number; yellow: number; red: number }[];
  by_metric: { id: string; name_vi: string | null; questions: number; green: number; held: number; flagged: number }[];
  top_rules: { rule: string; title: string; runs: number }[];
}
export interface SystemData {
  stats: Stats | null; latest: Latest | null; queue: RunLite[];
  openQueue: (runId?: string) => void; openReport: () => void;
}

const Skeleton = ({ h = 80 }: { h?: number }) => <div className="animate-pulse rounded bg-sunk" style={{ height: h }} aria-busy="true" />;

/** Số câu theo ngày, chồng theo phán quyết (màu trạng thái, có chú thích chữ). */
function DailyBars({ rows }: { rows: Stats["per_day"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...rows.map((r) => r.runs), 1);
  return (
    <div className="relative flex h-28 items-end gap-1" role="img" aria-label="Số câu hỏi theo ngày">
      {rows.map((r, i) => (
        <div key={r.day} className="flex flex-1 flex-col justify-end gap-[2px]" style={{ height: `${(r.runs / max) * 100}%`, minWidth: 6 }}
          onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          {[["red", "var(--color-bad)"], ["yellow", "var(--color-warn)"], ["green", "var(--color-good)"]].map(([k, c]) => {
            const n = r[k as "red" | "yellow" | "green"];
            return n > 0 ? <div key={k} style={{ flexGrow: n, background: c }} className="first:rounded-t" /> : null;
          })}
          {r.runs - r.green - r.yellow - r.red > 0 && <div style={{ flexGrow: r.runs - r.green - r.yellow - r.red }} className="bg-line-strong" />}
        </div>
      ))}
      {hover !== null && (
        <div className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border border-line bg-surface px-2 py-1 text-[12px] shadow">
          <b>{rows[hover].day}</b> · {rows[hover].runs} câu · xanh {rows[hover].green} · vàng {rows[hover].yellow} · đỏ {rows[hover].red}
        </div>
      )}
    </div>
  );
}

function Queue({ queue, openQueue }: SystemData) {
  // cùng một câu hỏi bị gửi duyệt nhiều lần thì gộp thành một dòng "×n" (mở lần gần nhất)
  const grouped = Object.values(queue.reduce<Record<string, { run: RunLite; count: number }>>((acc, r) => {
    const k = r.question.trim().toLowerCase();
    acc[k] = acc[k] ? { ...acc[k], count: acc[k].count + 1 } : { run: r, count: 1 };
    return acc;
  }, {}));
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cx("num rounded-full px-2 text-[12px] font-medium", queue.length ? "bg-warn-soft text-warn" : "bg-sunk text-muted")}>{queue.length} câu chờ duyệt</span>
        <Button size="sm" onClick={() => openQueue()}>Mở hàng đợi <ArrowRight size={14} /></Button>
      </div>
      {queue.length === 0 ? <p className="mt-2 text-[13px] text-muted">Không có câu nào chờ duyệt. Câu Vàng, Đỏ, lệch đối chiếu hoặc bị báo sai sẽ xuất hiện ở đây.</p> : (
        <ul className="mt-2 divide-y divide-line">
          {grouped.slice(0, 4).map(({ run: r, count }) => (
            <li key={r.id}>
              <button onClick={() => openQueue(r.id)} className="flex w-full items-center gap-2.5 rounded px-1 py-2 text-left hover:bg-sunk/60">
                <VerdictDot verdict={r.status === "held" ? "red" : r.final_verdict} />
                <span className={cx("min-w-0 flex-1 truncate", r.input_kind === "sql" && "font-mono text-[12.5px]")}>{r.question}</span>
                {count > 1 && <span className="num shrink-0 rounded bg-sunk px-1.5 text-[11.5px] text-ink-2">×{count}</span>}
                <span className="shrink-0 text-[12px] text-muted">{r.status === "held" ? "bị giữ lại · " : ""}{timeAgo(r.created_at)}</span>
              </button>
            </li>
          ))}
          {grouped.length > 4 && <li className="px-1 pt-2 text-[12.5px] text-muted">và {grouped.length - 4} câu khác</li>}
        </ul>
      )}
    </div>
  );
}

function Kpis({ stats }: SystemData) {
  const t = stats?.totals;
  if (!stats || !t) return <div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} h={88} />)}</div>;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Stat label="Câu trả lời Xanh" value={t.q_answered ? pct(t.q_green / t.q_answered) : "—"} sub={`${t.q_green}/${t.q_answered} câu đã trả lời khớp định nghĩa`} tone="good" />
      <Stat label="Cần xem lại (Vàng)" value={String(t.q_yellow)} sub="chưa có định nghĩa chuẩn hoặc lệch đối chiếu" />
      <Stat label="Bị giữ lại" value={String(t.held)} sub="vẫn sai sau 2 lần sửa, không công bố số" tone={t.held ? "bad" : undefined} />
      <Stat label="Tự sửa thành công" value={stats.fix.red_first ? pct(stats.fix.fixed / stats.fix.red_first) : "—"} sub={`${stats.fix.fixed}/${stats.fix.red_first} câu Đỏ ở lần viết đầu`} tone="good" />
      <Stat label="Người dùng báo sai" value={String(t.feedback_down)} sub={`trên ${t.feedback_up + t.feedback_down} lượt phản hồi`} tone={t.feedback_down ? "bad" : undefined} />
      <Stat label="Độ trễ trả lời" value={t.p50_ms ? `${Math.round(t.p50_ms)} ms` : "—"}
        sub={`p95 ${t.p95_ms ? Math.round(t.p95_ms) : "—"} ms · ${Number(t.cost_usd).toFixed(4)} USD (LLM mô phỏng)`} />
    </div>
  );
}

function PerDay({ stats }: SystemData) {
  if (!stats) return <Skeleton h={130} />;
  if (stats.per_day.length === 0) return <p className="text-[13px] text-muted">Chưa có câu hỏi nào trong {stats.days} ngày qua.</p>;
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-3 text-[12px] text-muted">
        <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-good" />Xanh</span>
        <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-warn" />Vàng</span>
        <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-bad" />Đỏ</span>
        <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-line-strong" />Không áp dụng</span>
      </div>
      <DailyBars rows={stats.per_day} />
    </div>
  );
}

function TopRules({ stats }: SystemData) {
  if (!stats) return <Skeleton h={130} />;
  const max = Math.max(...stats.top_rules.map((r) => r.runs), 1);
  return (
    <div>
      <p className="mb-3 text-[12px] text-muted">Bộ kiểm định bắt các lỗi này trước khi trả lời; phần lớn được tự sửa.</p>
      {stats.top_rules.length === 0 ? <p className="py-4 text-center text-[13px] text-muted">Chưa có lỗi nào.</p> : (
        <div className="flex flex-col gap-2">
          {stats.top_rules.map((r) => (
            <div key={r.rule} className="grid grid-cols-[40px_1fr_auto] items-center gap-2 text-[13px]">
              <RuleChip rule={r.rule} severity="high" />
              <span className="min-w-0">
                <span className="block truncate text-ink-2">{r.title}</span>
                <span className="mt-0.5 block h-1.5 rounded-sm bg-sunk"><span className="block h-1.5 rounded-sm bg-bad/70" style={{ width: `${(r.runs / max) * 100}%` }} /></span>
              </span>
              <span className="num text-[12px] text-muted">{r.runs} câu</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ByMetric({ stats }: SystemData) {
  const nav = useNavigate();
  if (!stats) return <Skeleton h={130} />;
  if (stats.by_metric.length === 0) return <p className="py-4 text-center text-[13px] text-muted">Chưa có câu hỏi nào khớp chỉ số.</p>;
  return (
    <div className="-mx-4 -mb-4 overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead className="bg-sunk text-left text-[12px] text-muted">
          <tr><th className="px-4 py-1.5 font-medium">Chỉ số</th><th className="px-3 py-1.5 text-right font-medium">Câu hỏi</th>
            <th className="px-3 py-1.5 font-medium">Xanh</th><th className="px-3 py-1.5 text-right font-medium">Giữ lại</th><th className="px-3 py-1.5 text-right font-medium">Báo sai</th></tr>
        </thead>
        <tbody>
          {stats.by_metric.map((m) => (
            <tr key={m.id} onClick={() => nav(`/metrics/${m.id}`)} className="cursor-pointer border-t border-line hover:bg-sunk/60" title="Mở định nghĩa chỉ số">
              <td className="px-4 py-2">{m.name_vi ?? m.id}</td>
              <td className="num px-3 py-2 text-right">{m.questions}</td>
              <td className="px-3 py-2">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-20 rounded-sm bg-sunk"><span className="block h-2 rounded-sm bg-good" style={{ width: `${(m.green / m.questions) * 100}%` }} /></span>
                  <span className="num text-[12px] text-muted">{pct(m.green / m.questions)}</span>
                </span>
              </td>
              <td className={cx("num px-3 py-2 text-right", m.held > 0 && "text-bad")}>{m.held}</td>
              <td className={cx("num px-3 py-2 text-right", m.flagged > 0 && "text-bad")}>{m.flagged}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Verifier({ latest, openReport }: SystemData) {
  const v = latest?.verifier?.summary;
  return (
    <div className="flex h-full flex-col gap-3">
      <p className="text-[13px] text-muted">
        {v ? <>Bắt <b className="num text-ink">{v.broken_caught}/{v.broken_total}</b> câu SQL lỗi, báo nhầm <b className="num text-ink">{v.false_alarms}/{v.correct_total}</b> câu đúng,
          {" "}{Math.round(v.latency_p50_ms)} ms mỗi câu. Lần chạy {fmtDate(latest!.verifier!.created_at)}.</> : "Chưa chạy đánh giá."}
      </p>
      <Button size="sm" className="self-start" onClick={openReport}><FileText size={14} /> Báo cáo chi tiết</Button>
    </div>
  );
}

export const SYSTEM_BODIES: Record<string, (d: SystemData) => ReactElement> = {
  "sys:queue": Queue, "sys:kpis": Kpis, "sys:per_day": PerDay, "sys:top_rules": TopRules, "sys:by_metric": ByMetric, "sys:verifier": Verifier,
};
