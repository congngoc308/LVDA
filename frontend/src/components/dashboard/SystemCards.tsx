import { ArrowRight, Check, ChevronRight } from "lucide-react";
import { Fragment, type ReactElement, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { RunLite } from "../../types";
import { pct, type Latest } from "../EvalReport";
import { cx, fmtDay, timeAgo } from "../ui";

export interface DayStat {
  day: string; runs: number; green: number; yellow: number; red: number; held: number; down: number; p50_ms: number | null; red_first: number; fixed: number;
}
export interface Stats {
  days: number;
  totals: {
    runs: number; questions: number; sql_checks: number; refused: number; held: number; feedback_up: number; feedback_down: number;
    p50_ms: number | null; p95_ms: number | null; tokens: number; cost_usd: number; q_answered: number; q_green: number; q_yellow: number;
  };
  verdicts: { verdict: string; n: number }[];
  fix: { red_first: number; fixed: number };
  per_day: DayStat[];
  by_metric: { id: string; name_vi: string | null; questions: number; green: number; yellow: number; red: number; held: number; flagged: number }[];
  top_rules: { rule: string; title: string; runs: number }[];
}
export interface SystemData {
  stats: Stats | null; latest: Latest | null; queue: RunLite[];
  openQueue: (runId?: string) => void; openReport: () => void;
}

const Skeleton = ({ h = 80 }: { h?: number }) => <div className="animate-pulse rounded-lg bg-sunk" style={{ height: h }} aria-busy="true" />;
const Swatch = ({ color, className }: { color: string; className?: string }) => <span className={cx("size-2 shrink-0 rounded-sm", className)} style={{ background: color }} />;
const C = { good: "var(--color-good)", warn: "var(--color-warn)", bad: "var(--color-bad)", held: "var(--color-held)", na: "var(--color-line-strong)", accent: "var(--color-accent)" };
const num1 = (x: number) => x.toLocaleString("vi-VN", { maximumFractionDigits: 1 });

/** Đủ `days` ngày, ngày không có câu nào là 0 (API chỉ trả ngày có dữ liệu). */
function fillDays(stats: Stats): DayStat[] {
  const by = new Map(stats.per_day.map((d) => [d.day, d]));
  const out: DayStat[] = [];
  const today = new Date();
  for (let i = stats.days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push(by.get(key) ?? { day: key, runs: 0, green: 0, yellow: 0, red: 0, held: 0, down: 0, p50_ms: null, red_first: 0, fixed: 0 });
  }
  return out;
}
const dayLabel = (day: string) => `${Number(day.slice(8, 10))}/${Number(day.slice(5, 7))}`;

function spark(vals: number[], W = 160, H = 36) {
  const lo = Math.min(...vals), hi = Math.max(...vals), sp = hi - lo || 1;
  const pts = vals.map((v, i) => `${(i / Math.max(vals.length - 1, 1)) * W},${3 + (1 - (v - lo) / sp) * (H - 6)}`);
  return { line: pts.join(" "), area: `M0,${H} L${pts.join(" L")} L${W},${H} Z` };
}

// ---------------------------------------------------------------- cần xử lý
type Reason = { label: string; key: "held" | "flag" | "red" | "yellow"; tone: string };
function reasonOf(r: RunLite): Reason {
  if (r.status === "held") return { label: "Bị giữ lại", key: "held", tone: "bg-held-soft text-held" };
  if (r.feedback && !r.feedback.correct) return { label: "Người dùng báo sai", key: "flag", tone: "bg-bad-soft text-bad" };
  if (r.final_verdict === "red" || r.final_verdict === "blocked") return { label: "Đỏ", key: "red", tone: "bg-bad-soft text-bad" };
  if (r.recon_status === "mismatch") return { label: "Lệch đối chiếu", key: "yellow", tone: "bg-warn-soft text-warn" };
  if (r.recon_status === "no_definition") return { label: "Chưa có định nghĩa", key: "yellow", tone: "bg-warn-soft text-warn" };
  return { label: "Vàng", key: "yellow", tone: "bg-warn-soft text-warn" };
}
const REASONS: [Reason["key"], string, string][] = [["held", "Bị giữ lại", C.held], ["red", "Đỏ", C.bad], ["flag", "Người dùng báo sai", C.bad], ["yellow", "Vàng / lệch", C.warn]];

function Attention({ queue, openQueue }: SystemData) {
  if (queue.length === 0) return (
    <div className="flex items-center gap-3.5 py-[18px]">
      <span className="grid size-10 place-items-center rounded-full bg-good-soft text-good"><Check size={20} strokeWidth={2.2} /></span>
      <div><div className="text-[15px] font-semibold">Không có gì cần xử lý</div><div className="mt-0.5 text-[13px] text-muted">Câu Vàng, Đỏ, lệch đối chiếu hoặc bị báo sai sẽ xuất hiện ở đây.</div></div>
    </div>
  );
  // cùng một câu hỏi bị gửi duyệt nhiều lần thì gộp thành một dòng "×n" (mở lần gần nhất)
  const grouped = Object.values(queue.reduce<Record<string, { run: RunLite; count: number }>>((acc, r) => {
    const k = r.question.trim().toLowerCase();
    acc[k] = acc[k] ? { ...acc[k], count: acc[k].count + 1 } : { run: r, count: 1 };
    return acc;
  }, {}));
  const counts = Object.fromEntries(REASONS.map(([k]) => [k, 0])) as Record<Reason["key"], number>;
  queue.forEach((r) => { counts[reasonOf(r).key]++; });
  const segs = REASONS.filter(([k]) => counts[k] > 0);
  return (
    <div className="@container">
      <div className="grid items-start gap-6 @[540px]:grid-cols-[minmax(180px,220px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3.5">
          <div>
            <div className="font-mono text-[44px] font-medium leading-none tracking-[-0.03em] text-warn">{queue.length}</div>
            <div className="mt-1.5 text-[12.5px] text-muted">câu chờ duyệt{grouped.length !== queue.length ? ` · ${grouped.length} câu hỏi khác nhau` : ""}</div>
          </div>
          <div className="flex h-2 gap-[2px] overflow-hidden rounded-full">
            {segs.map(([k, l, c]) => <span key={k} title={`${l}: ${counts[k]}`} className="h-full" style={{ width: `${(counts[k] / queue.length) * 100}%`, background: c }} />)}
          </div>
          <div className="flex flex-col gap-1.5">
            {segs.map(([k, l, c]) => (
              <div key={k} className="flex items-center gap-2 text-[12.5px]"><Swatch color={c} /><span className="flex-1 text-ink-2">{l}</span><span className="font-mono text-muted">{counts[k]}</span></div>
            ))}
          </div>
          <button onClick={() => openQueue()} className="inline-flex h-[34px] items-center justify-center gap-1.5 rounded-lg bg-accent text-[13px] font-semibold text-on-accent hover:bg-accent-2">
            Mở hàng đợi duyệt <ArrowRight size={14} strokeWidth={2.2} />
          </button>
        </div>
        <ul className="flex flex-col">
          {grouped.slice(0, 5).map(({ run: r, count }) => {
            const why = reasonOf(r);
            return (
              <li key={r.id} className="border-b border-line">
                <button onClick={() => openQueue(r.id)} className="-mx-2 grid w-[calc(100%+16px)] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-[11px] text-left hover:bg-hover">
                  <span className="min-w-0">
                    <span className={cx("block truncate", r.input_kind === "sql" ? "font-mono text-[12.5px]" : "text-[13.5px]")}>{r.question.replace(/\s+/g, " ")}</span>
                    <span className="mt-[3px] flex items-center gap-2 text-[11.5px] text-faint">
                      <span className={cx("inline-flex h-[18px] shrink-0 items-center whitespace-nowrap rounded-full px-[7px] font-medium", why.tone)}>{why.label}</span>
                      <span className="min-w-0 truncate">{r.user_name ?? "—"} · {timeAgo(r.created_at)}</span>
                      {count > 1 && <span className="font-mono text-muted">×{count}</span>}
                    </span>
                  </span>
                  <ChevronRight size={16} className="text-faint" />
                </button>
              </li>
            );
          })}
          {grouped.length > 5 && <li className="pt-2.5 text-[12.5px] text-faint">và {grouped.length - 5} câu khác</li>}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- phán quyết
function Mix({ stats }: SystemData) {
  if (!stats) return <Skeleton h={230} />;
  const n = (v: string) => stats.verdicts.find((x) => x.verdict === v)?.n ?? 0;
  const held = stats.totals.held;
  const segs: [string, number, string][] = [["Xanh", n("green"), C.good], ["Vàng", n("yellow"), C.warn],
    ["Đỏ, có cảnh báo", Math.max(n("red") + n("blocked") - held, 0), C.bad], ["Bị giữ lại", held, C.held]];
  const total = segs.reduce((a, s) => a + s[1], 0);
  if (!total) return <p className="py-6 text-center text-[13px] text-muted">Chưa có câu nào được kiểm trong {stats.days} ngày qua.</p>;
  const CIRC = 2 * Math.PI * 52;
  const starts = segs.map((_, i) => segs.slice(0, i).reduce((a, s) => a + (s[1] / total) * CIRC, 0));
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative size-[150px]">
        <svg viewBox="0 0 140 140" className="block size-[150px]" role="img" aria-label={segs.map((s) => `${s[0]}: ${s[1]}`).join(", ")}>
          <circle cx={70} cy={70} r={52} fill="none" stroke="var(--color-sunk)" strokeWidth={14} />
          {segs.map((s, i) => s[1] > 0 && (
            <circle key={s[0]} cx={70} cy={70} r={52} fill="none" stroke={s[2]} strokeWidth={14} transform="rotate(-90 70 70)"
              strokeDasharray={`${Math.max((s[1] / total) * CIRC - 2, 0)} ${CIRC}`} strokeDashoffset={-starts[i]} />
          ))}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div><div className="font-mono text-[24px] font-medium tracking-[-0.02em]">{pct(segs[0][1] / total)}</div><div className="text-[11.5px] text-muted">Xanh</div></div>
        </div>
      </div>
      <div className="flex w-full flex-col gap-[7px]">
        {segs.map(([l, v, c]) => (
          <div key={l} className="grid grid-cols-[10px_1fr_auto_auto] items-center gap-2 text-[12.5px]">
            <Swatch color={c} /><span className="text-ink-2">{l}</span><span className="font-mono">{v}</span>
            <span className="w-[46px] text-right font-mono text-[11.5px] text-faint">{pct(v / total)}</span>
          </div>
        ))}
        <div className="mt-1 text-[11.5px] text-faint">{total} câu đã kiểm</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- chỉ số vận hành
/** Mức thay đổi: nửa sau của khoảng (15 ngày gần đây) so với nửa đầu. */
function halves<T>(days: T[], f: (xs: T[]) => number | null) {
  const mid = Math.floor(days.length / 2);
  return [f(days.slice(0, mid)), f(days.slice(mid))] as const;
}
const ratio = (xs: DayStat[], a: "green" | "fixed", b: (d: DayStat) => number) => {
  const den = xs.reduce((s, d) => s + b(d), 0);
  return den ? xs.reduce((s, d) => s + d[a], 0) / den : null;
};

function Kpis({ stats }: SystemData) {
  if (!stats) return <div className="grid grid-cols-2 gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={130} />)}</div>;
  const t = stats.totals, days = fillDays(stats);
  const checked = (d: DayStat) => d.green + d.yellow + d.red;
  const pts = (a: number | null, b: number | null) => (a === null || b === null ? null : (b - a) * 100);
  const [g1, g2] = halves(days, (xs) => ratio(xs, "green", checked));
  const [f1, f2] = halves(days, (xs) => ratio(xs, "fixed", (d) => d.red_first));
  const [d1, d2] = halves(days, (xs) => xs.reduce((s, d) => s + d.down, 0));
  const lat = days.filter((d) => d.p50_ms !== null);
  const [l1, l2] = halves(lat, (xs) => (xs.length ? xs.reduce((s, d) => s + Number(d.p50_ms), 0) / xs.length : null));
  // cộng dồn để đường tự sửa không rơi về 0 vào ngày không có câu Đỏ nào
  let rf = 0, fx = 0;
  const fixLine = days.map((d) => { rf += d.red_first; fx += d.fixed; return rf ? fx / rf : 0; });
  const delta = (v: number | null, unit: string, higherGood: boolean) => {
    if (v === null) return { t: "chưa đủ dữ liệu", c: "text-faint" };
    if (Math.abs(v) < 0.05) return { t: "bằng kỳ trước", c: "text-faint" };
    return { t: `${v > 0 ? "+" : "−"}${num1(Math.abs(v))} ${unit}`, c: v > 0 === higherGood ? "text-good" : "text-bad" };
  };
  const tiles = [
    { l: "Câu trả lời Xanh", v: t.q_answered ? pct(t.q_green / t.q_answered) : "—", sub: `${t.q_green}/${t.q_answered} câu khớp định nghĩa`, c: C.good,
      sp: days.map((d) => (checked(d) ? d.green / checked(d) : 0)), d: delta(pts(g1, g2), "điểm", true) },
    { l: "Tự sửa thành công", v: stats.fix.red_first ? pct(stats.fix.fixed / stats.fix.red_first) : "—", sub: `${stats.fix.fixed}/${stats.fix.red_first} câu Đỏ ở lần viết đầu`, c: C.good,
      sp: fixLine, d: delta(pts(f1, f2), "điểm", true) },
    { l: "Người dùng báo sai", v: String(t.feedback_down), sub: `trên ${t.feedback_up + t.feedback_down} lượt phản hồi`, c: t.feedback_down ? C.bad : "var(--color-ink)",
      sp: days.map((d) => d.down), d: delta(d1 === null || d2 === null ? null : d2 - d1, "câu", false) },
    { l: "Độ trễ trả lời p50", v: t.p50_ms ? `${Math.round(t.p50_ms)} ms` : "—", sub: `p95 ${t.p95_ms ? Math.round(t.p95_ms) : "—"} ms · ${Number(t.cost_usd).toFixed(4)} USD`, c: "var(--color-ink)",
      sp: days.map((d) => Number(d.p50_ms ?? 0)), d: delta(l1 === null || l2 === null ? null : l2 - l1, "ms", false) },
  ];
  return (
    <div className="@container">
      <div className="grid grid-cols-2 gap-3 @[880px]:grid-cols-4">
        {tiles.map((k) => {
          const sp = spark(k.sp);
          return (
            <div key={k.l} className="flex flex-col gap-2 rounded-[10px] bg-sunk px-4 py-3.5">
              <div className="flex items-center justify-between gap-2 text-[12px] text-muted">
                <span>{k.l}</span><span className={cx("text-[11px]", k.d.c)} title="15 ngày gần đây so với 15 ngày trước đó">{k.d.t}</span>
              </div>
              <div className="font-mono text-[24px] font-medium leading-none tracking-[-0.02em]" style={{ color: k.c }}>{k.v}</div>
              <svg viewBox="0 0 160 36" preserveAspectRatio="none" className="block h-8 w-full overflow-visible" aria-hidden>
                <path d={sp.area} fill={k.c} opacity={0.1} />
                <polyline points={sp.line} fill="none" stroke={k.c} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              </svg>
              <div className="text-[11.5px] text-faint">{k.sub}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- xu hướng theo ngày
function Trend({ stats }: SystemData) {
  const [hover, setHover] = useState<number | null>(null);
  if (!stats) return <Skeleton h={230} />;
  const days = fillDays(stats);
  if (!days.some((d) => d.runs)) return <p className="py-6 text-center text-[13px] text-muted">Chưa có câu hỏi nào trong {stats.days} ngày qua.</p>;
  const W = 720, H = 210, P = { l: 30, r: 34, t: 14, b: 26 }, pw = W - P.l - P.r, ph = H - P.t - P.b;
  const mx = Math.max(Math.ceil(Math.max(...days.map((d) => d.runs)) / 5) * 5, 5), bw = pw / days.length;
  const yc = (v: number) => P.t + ph * (1 - v / mx), yr = (v: number) => P.t + ph * (1 - v);
  const rate = days.map((d) => { const c = d.green + d.yellow + d.red; return c ? d.green / c : null; });
  const line = rate.map((r, i) => (r === null ? null : `${P.l + i * bw + bw / 2},${yr(r)}`)).filter(Boolean).join(" ");
  const SEG: ["green" | "yellow" | "red", string, string][] = [["green", C.good, "Xanh"], ["yellow", C.warn, "Vàng"], ["red", C.bad, "Đỏ"]];
  const na = (d: DayStat) => Math.max(d.runs - d.green - d.yellow - d.red, 0);
  const parts = (d: DayStat): [string, number, string][] => [...SEG.map(([k, c, l]): [string, number, string] => [l, d[k], c]), ["Không áp dụng", na(d), C.na]];
  const h = hover !== null ? days[hover] : null;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-3.5 text-[12px] text-muted">
        {SEG.map(([, c, l]) => <span key={l} className="inline-flex items-center gap-1.5"><Swatch color={c} />{l}</span>)}
        <span className="inline-flex items-center gap-1.5"><Swatch color={C.na} />Không áp dụng</span>
        <span className="ml-auto inline-flex items-center gap-1.5"><span className="h-0.5 w-3.5 bg-ink" />Tỉ lệ Xanh (trục phải)</span>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" onMouseLeave={() => setHover(null)} role="img"
          aria-label={`Số câu theo ngày trong ${stats.days} ngày, chồng theo phán quyết`}>
          {[0, 0.5, 1].map((g) => <line key={g} x1={P.l} x2={W - P.r} y1={yc(mx * g)} y2={yc(mx * g)} stroke="var(--color-line)" strokeDasharray="2 3" />)}
          {days.map((d, i) => {
            let y0 = 0;
            return (
              <g key={d.day} opacity={hover === null || hover === i ? 1 : 0.45}>
                {parts(d).filter(([, v]) => v > 0).map(([l, v, c]) => {
                  const y1 = yc(y0 + v), y2 = yc(y0);
                  y0 += v;
                  return <rect key={l} x={P.l + i * bw + bw * 0.16} width={bw * 0.68} y={y1 + 0.5} height={Math.max(y2 - y1 - 1, 0.5)} rx={2} fill={c} />;
                })}
                <rect x={P.l + i * bw} y={0} width={bw} height={H - P.b} fill="transparent" onMouseEnter={() => setHover(i)} />
              </g>
            );
          })}
          <polyline points={line} fill="none" stroke="var(--color-ink)" strokeWidth={1.6} strokeLinejoin="round" opacity={0.85} pointerEvents="none" />
          {hover !== null && rate[hover] !== null && <circle cx={P.l + hover * bw + bw / 2} cy={yr(rate[hover]!)} r={4} fill="var(--color-ink)" stroke="var(--color-surface)" strokeWidth={2} pointerEvents="none" />}
        </svg>
        {[0, 0.5, 1].map((g) => (
          <Fragment key={g}>
            <span className="pointer-events-none absolute left-0 w-[3.4%] -translate-y-1/2 text-right font-mono text-[10px] text-faint" style={{ top: `${(yc(mx * g) / H) * 100}%` }}>{Math.round(mx * g)}</span>
            <span className="pointer-events-none absolute right-0 w-[4%] -translate-y-1/2 font-mono text-[10px] text-faint" style={{ top: `${(yc(mx * g) / H) * 100}%` }}>{Math.round(g * 100)}%</span>
          </Fragment>
        ))}
        {days.map((d, i) => i % 5 === 0 && (
          <span key={d.day} className="pointer-events-none absolute bottom-0 -translate-x-1/2 font-mono text-[10px] text-faint" style={{ left: `${((P.l + i * bw + bw / 2) / W) * 100}%` }}>{dayLabel(d.day)}</span>
        ))}
        {h && hover !== null && (
          <div className="pointer-events-none absolute top-0 min-w-[150px] rounded-lg border border-line bg-surface px-2.5 py-2 text-[12px] shadow-lg"
            style={{ left: `${((P.l + hover * bw + bw / 2) / W) * 100}%`, transform: `translateX(${hover > days.length / 2 ? "-100%" : "0"})` }}>
            <div className="mb-1.5 flex justify-between gap-3"><b>{dayLabel(h.day)}</b><span className="font-mono text-muted">{rate[hover] === null ? "—" : `${pct(rate[hover]!)} Xanh`}</span></div>
            {parts(h).map(([l, v, c]) => (
              <div key={l} className="flex items-center gap-1.5 leading-[1.6]"><Swatch color={c} className="size-[7px]" /><span className="flex-1 text-ink-2">{l}</span><span className="font-mono">{v}</span></div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- phễu
function Funnel({ stats }: SystemData) {
  if (!stats) return <Skeleton h={230} />;
  const t = stats.totals, n = (v: string) => stats.verdicts.find((x) => x.verdict === v)?.n ?? 0;
  const ask = t.runs;
  if (!ask) return <p className="py-6 text-center text-[13px] text-muted">Chưa có câu hỏi nào trong {stats.days} ngày qua.</p>;
  const noSql = n("none") + n("unchecked"), withSql = ask - noSql, published = withSql - t.held, green = n("green");
  const steps: [string, number, string][] = [
    ["Câu hỏi nhận được", ask, ""],
    ["Có SQL để kiểm", withSql, noSql ? `${noSql} câu ngoài phạm vi hoặc chỉ hỏi định nghĩa` : ""],
    ["Được công bố số", published, t.held ? `${t.held} câu bị giữ lại, không công bố` : ""],
    ["Xanh: khớp định nghĩa", green, n("yellow") ? `${n("yellow")} câu Vàng cần xem lại` : ""],
  ];
  return (
    <div className="flex flex-col gap-1">
      {steps.map(([l, v, note], i) => (
        <div key={l} className="flex flex-col gap-[5px]">
          <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
            <span className="text-ink-2">{l}</span>
            <span><span className="font-mono font-medium">{v}</span> <span className="font-mono text-[11px] text-faint">{i ? pct(v / ask) : "100%"}</span></span>
          </div>
          <div className="h-3.5 rounded bg-sunk"><div className="h-3.5 rounded" style={{ width: `${(v / ask) * 100}%`, background: i === 3 ? C.good : C.accent, opacity: 1 - i * 0.14 }} /></div>
          {note && <div className="pl-0.5 text-[11px] text-faint">↳ {note}</div>}
        </div>
      ))}
      {stats.fix.red_first > 0 && (
        <div className="mt-2 rounded-lg bg-good-soft px-2.5 py-2 text-[12px] text-ink-2">
          {stats.fix.red_first} câu Đỏ ở lần viết đầu, agent tự sửa được <b className="text-good">{stats.fix.fixed}</b> ({pct(stats.fix.fixed / stats.fix.red_first)}).
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- lỗi theo luật
function Rules({ stats }: SystemData) {
  if (!stats) return <Skeleton h={180} />;
  const rules = stats.top_rules.slice(0, 6);
  const max = Math.max(...rules.map((r) => r.runs), 1), total = rules.reduce((a, r) => a + r.runs, 0) || 1;
  return (
    <div className="flex flex-col gap-3">
      {rules.length === 0 ? <p className="py-4 text-center text-[13px] text-muted">Chưa có lỗi nào.</p> : rules.map((r) => (
        <div key={r.rule} className="grid grid-cols-[42px_minmax(0,1fr)_56px] items-center gap-2.5 text-[12.5px]">
          <span className="justify-self-start rounded-[5px] bg-bad-soft px-1.5 py-px font-mono text-[11px] font-medium text-bad">{r.rule}</span>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-ink-2">{r.title}</span>
            <span className="block h-1.5 rounded-full bg-sunk"><span className="block h-1.5 rounded-full bg-bad opacity-80" style={{ width: `${(r.runs / max) * 100}%` }} /></span>
          </div>
          <span className="text-right font-mono text-[12px]">{r.runs} câu<span className="block text-[10.5px] text-faint">{pct(r.runs / total)}</span></span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- chỉ số × phán quyết
const HEAT_COLS: [string, "green" | "yellow" | "red" | "held" | "flagged", string][] = [
  ["Xanh", "green", C.good], ["Vàng", "yellow", C.warn], ["Đỏ", "red", C.bad], ["Giữ lại", "held", C.held], ["Báo sai", "flagged", C.bad],
];
function Heatmap({ stats }: SystemData) {
  const nav = useNavigate();
  if (!stats) return <Skeleton h={180} />;
  if (stats.by_metric.length === 0) return <p className="py-4 text-center text-[13px] text-muted">Chưa có câu hỏi nào khớp chỉ số.</p>;
  return (
    <div className="scroll-thin overflow-x-auto">
      <div className="grid min-w-[360px] grid-cols-[minmax(130px,2fr)_repeat(5,minmax(30px,1fr))_34px] gap-[3px] text-[12px]">
        <span />
        {HEAT_COLS.map(([l]) => <span key={l} className="pb-1 text-center text-[11px] text-faint">{l}</span>)}
        <span className="pb-1 text-right text-[11px] text-faint">Tổng</span>
        {stats.by_metric.map((m) => (
          <Fragment key={m.id}>
            <button onClick={() => nav(`/metrics/${m.id}`)} title="Mở định nghĩa chỉ số" className="flex min-w-0 items-center truncate pr-1.5 text-left text-ink-2 hover:text-accent">{m.name_vi ?? m.id}</button>
            {HEAT_COLS.map(([l, k, c], j) => {
              const v = m[k], share = v / Math.max(m.questions, 1);
              const strength = v ? Math.round((j === 0 ? share : Math.min(1, share * 3)) * 70 + 10) : 0;
              return (
                <span key={k} title={`${m.name_vi ?? m.id} · ${l}: ${v}`} className={cx("grid h-[30px] place-items-center rounded-md font-mono", v ? "text-ink" : "text-faint")}
                  style={{ background: v ? `color-mix(in oklch, ${c} ${strength}%, transparent)` : "transparent" }}>{v || "·"}</span>
              );
            })}
            <span className="flex items-center justify-end font-mono text-muted">{m.questions}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- bộ kiểm định
function Verifier({ latest, openReport }: SystemData) {
  const run = latest?.verifier, v = run?.summary;
  const items = v ? [
    { l: "Bắt được lỗi", v: pct(v.recall), sub: `${v.broken_caught}/${v.broken_total} câu SQL lỗi`, w: v.recall, c: C.good },
    { l: "Báo nhầm câu đúng", v: pct(v.false_alarm_rate), sub: `${v.false_alarms}/${v.correct_total} câu SQL đúng`, w: Math.max(v.false_alarm_rate, 0.015), c: C.bad },
    { l: "Thời gian kiểm mỗi câu", v: `${Math.round(v.latency_p50_ms)} ms`, sub: `p95 ${Math.round(v.latency_p95_ms)} ms · không gọi LLM`, w: Math.min(v.latency_p50_ms / 50, 1), c: C.accent },
  ] : [];
  return (
    <div className="flex flex-wrap items-center gap-6">
      {v ? (
        <div className="grid min-w-[300px] flex-1 grid-cols-3 gap-5">
          {items.map((x) => (
            <div key={x.l} className="flex flex-col gap-1.5">
              <div className="text-[12px] text-muted">{x.l}</div>
              <div className="font-mono text-[20px] font-medium leading-none">{x.v}</div>
              <div className="h-1.5 rounded-full bg-sunk"><div className="h-1.5 rounded-full" style={{ width: `${x.w * 100}%`, background: x.c }} /></div>
              <div className="text-[11.5px] text-faint">{x.sub}</div>
            </div>
          ))}
        </div>
      ) : <p className="flex-1 text-[13px] text-muted">Chưa chạy đánh giá bộ kiểm định. Mở báo cáo và bấm Chạy lại.</p>}
      <div className="flex flex-col items-start gap-2">
        {run && <span className="text-[11.5px] text-faint">Lần chạy {fmtDay(run.created_at, true)}</span>}
        <button onClick={openReport} className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-line px-3 text-[12.5px] font-medium hover:bg-hover">
          Xem báo cáo chi tiết <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

export const SYSTEM_BODIES: Record<string, (d: SystemData) => ReactElement> = {
  "sys:attention": Attention, "sys:mix": Mix, "sys:kpis": Kpis, "sys:trend": Trend, "sys:funnel": Funnel,
  "sys:rules": Rules, "sys:heatmap": Heatmap, "sys:verifier": Verifier,
};
