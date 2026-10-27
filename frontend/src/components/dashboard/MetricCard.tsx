import { AlertTriangle, ExternalLink, Hand, Table2 } from "lucide-react";
import { type MouseEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api";
import { CARD_COLORS, type CardSpec, type RenderRes } from "../../dashboard";
import { formatDim, formatValue } from "../../format";
import { pct } from "../EvalReport";
import { cx, RuleChip } from "../ui";

// Kết quả card giữ 60 giây theo tham số truy vấn (không gồm kiểu biểu đồ, màu), để kéo thả, đổi cỡ hay đổi dạng
// hiển thị trong trình sửa không phải chạy lại truy vấn
const cache = new Map<string, { at: number; data: RenderRes }>();
const specKey = (dbId: number, s: CardSpec) => JSON.stringify([dbId, s.metric_id, s.dimension, s.period, s.top, s.sort ?? "desc", !!s.compare]);

function useRender(dbId: number, spec: CardSpec | null) {
  const key = spec ? specKey(dbId, spec) : null;
  const [data, setData] = useState<RenderRes | null>(() => (key ? cache.get(key)?.data ?? null : null));
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!key || !spec) return;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 60_000) { setData(hit.data); return; }
    let alive = true;
    setFailed(null);
    const t = setTimeout(() => {
      api<RenderRes>(`/db/${dbId}/dashboards/render`, { body: spec })
        .then((d) => { if (alive) { cache.set(key, { at: Date.now(), data: d }); setData(d); } })
        .catch((e) => alive && setFailed(e.message));
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [key]); // `key` mã hoá đủ tham số truy vấn của spec
  return { data, failed };
}

type Fmt = (v: unknown) => string;
type Row = [unknown, number];
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
// chỉ số mà giảm là tốt: mũi tên đi xuống tô màu tốt
const LOWER_IS_BETTER = /late|cancel|delivery_days|freight/;

function Tip({ left, flip, children }: { left: string; flip: boolean; children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute -top-1 whitespace-nowrap rounded-md border border-line bg-surface px-2 py-0.5 text-[12px] shadow-lg"
      style={{ left, transform: `translateX(${flip ? "-100%" : "0"})` }}>{children}</div>
  );
}

/** Đường, vùng, lũy kế (cùng một khung) và cột dọc theo tháng; nét đứt là cùng kỳ năm trước. */
function TimeChart({ rows, prev, fmt, color, kind }: { rows: Row[]; prev: number[] | null; fmt: Fmt; color: string; kind: "line" | "area" | "cumulative" | "column" }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 320, H = 120, P = { l: 6, r: 6, t: 10, b: 18 }, n = rows.length;
  const vals = rows.map((r) => r[1]);
  const all = prev ? [...vals, ...prev] : vals;
  const column = kind === "column";
  const lo = column ? Math.min(0, ...all) : Math.min(...all), hi = Math.max(...all), span = hi - lo || Math.abs(hi) || 1;
  const bw = (W - P.l - P.r) / n;
  const x = (i: number) => (column ? P.l + i * bw + bw / 2 : P.l + (n === 1 ? (W - P.l - P.r) / 2 : (i / (n - 1)) * (W - P.l - P.r)));
  const y = (v: number) => P.t + (1 - (v - lo) / span) * (H - P.t - P.b);
  const pts = vals.map((v, i) => `${x(i)},${y(v)}`);
  const prevPts = prev?.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const move = (e: MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect(), px = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    rows.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
    setHover(best);
  };
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-[150px] w-full overflow-visible" onMouseMove={move} onMouseLeave={() => setHover(null)} role="img"
        aria-label={`Từ ${formatDim(rows[0][0])} đến ${formatDim(rows[n - 1][0])}, thấp nhất ${fmt(Math.min(...vals))}, cao nhất ${fmt(Math.max(...vals))}`}>
        <line x1={P.l} x2={W - P.r} y1={H - P.b} y2={H - P.b} stroke="var(--color-line)" />
        {column ? vals.map((v, i) => (
          <rect key={i} x={P.l + i * bw + bw * 0.18} width={bw * 0.64} y={Math.min(y(v), y(0))} height={Math.abs(y(0) - y(v))} rx={2} fill={color}
            opacity={hover === null || hover === i ? 1 : 0.45} />
        )) : <>
          <path d={`M${x(0)},${H - P.b} L${pts.join(" L")} L${x(n - 1)},${H - P.b} Z`} fill={color} opacity={kind === "area" ? 0.28 : kind === "cumulative" ? 0.16 : 0.08} />
          <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </>}
        {prevPts && <polyline points={prevPts} fill="none" stroke="var(--color-faint)" strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
        {hover !== null && !column && <>
          <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} stroke="var(--color-edge)" strokeDasharray="2 2" />
          <circle cx={x(hover)} cy={y(vals[hover])} r={4} fill={color} stroke="var(--color-surface)" strokeWidth={2} />
        </>}
      </svg>
      <div className="-mt-3.5 flex justify-between font-mono text-[10px] text-faint"><span>{formatDim(rows[0][0])}</span><span>{formatDim(rows[n - 1][0])}</span></div>
      {hover !== null && (
        <Tip left={`${(x(hover) / W) * 100}%`} flip={hover > n / 2}>
          <b>{formatDim(rows[hover][0])}</b> · <span className="num">{fmt(vals[hover])}</span>
          {prev?.[hover] !== undefined && <span className="text-faint"> · năm trước {fmt(prev[hover])}</span>}
        </Tip>
      )}
    </div>
  );
}

function Bars({ rows, fmt, color }: { rows: Row[]; fmt: Fmt; color: string }) {
  const max = Math.max(...rows.map((r) => r[1]), 1e-9);
  return (
    <ul className="flex flex-col gap-[7px]" aria-label="Biểu đồ cột ngang">
      {rows.map((r, i) => (
        <li key={i} className="grid grid-cols-[minmax(0,100px)_1fr_auto] items-center gap-2.5 text-[12px]" title={`${formatDim(r[0])}: ${fmt(r[1])}`}>
          <span className="truncate text-ink-2">{formatDim(r[0])}</span>
          <span className="block h-2.5 rounded-[5px] bg-sunk">
            <span className="block h-2.5 rounded-[5px]" style={{ width: `${(Math.max(r[1], 0) / max) * 100}%`, background: color, opacity: i === 0 ? 1 : 0.55 + 0.45 * (1 - i / rows.length) }} />
          </span>
          <span className="num text-muted">{fmt(r[1])}</span>
        </li>
      ))}
    </ul>
  );
}

/** Tỉ trọng: top 5 (vòng: top 6) và phần "Khác" khi chỉ số cộng dồn được; một màu, đậm nhạt theo thứ hạng. */
function shares(rows: Row[], keep: number, additive: boolean) {
  const top = rows.slice(0, keep), rest = rows.slice(keep).reduce((a, r) => a + r[1], 0);
  const parts: [string, number][] = top.map((r) => [formatDim(r[0]), r[1]]);
  if (rest > 0 && additive) parts.push(["Khác", rest]);
  const total = parts.reduce((a, p) => a + p[1], 0) || 1;
  return { parts, total, op: (i: number) => Math.max(1 - i * 0.15, 0.22) };
}

function Donut({ rows, fmt, color, additive, compact }: { rows: Row[]; fmt: Fmt; color: string; additive: boolean; compact: boolean }) {
  const { parts, total, op } = shares(rows, compact ? 4 : 6, additive);
  const C = 2 * Math.PI * 42;
  const starts = parts.map((_, i) => parts.slice(0, i).reduce((a, p) => a + (p[1] / total) * C, 0));
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="relative size-[120px] shrink-0">
        <svg viewBox="0 0 110 110" className="block size-[120px]" role="img" aria-label={parts.map((p) => `${p[0]}: ${fmt(p[1])}`).join(", ")}>
          <circle cx={55} cy={55} r={42} fill="none" stroke="var(--color-sunk)" strokeWidth={14} />
          {parts.map((p, i) => (
            <circle key={i} cx={55} cy={55} r={42} fill="none" stroke={color} opacity={op(i)} strokeWidth={14} transform="rotate(-90 55 55)"
              strokeDasharray={`${Math.max((p[1] / total) * C - 1.5, 0)} ${C}`} strokeDashoffset={-starts[i]}><title>{`${p[0]}: ${fmt(p[1])}`}</title></circle>
          ))}
        </svg>
        {additive && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div><div className="break-all font-mono text-[11.5px] font-medium leading-tight">{fmt(total)}</div><div className="text-[10.5px] text-faint">tổng</div></div>
          </div>
        )}
      </div>
      <div className="flex min-w-[140px] flex-1 flex-col gap-1.5">
        {parts.map((p, i) => (
          <div key={i} className="grid grid-cols-[10px_minmax(0,1fr)_auto_auto] items-center gap-2 text-[12px]">
            <span className="size-2 rounded-sm" style={{ background: color, opacity: op(i) }} /><span className="truncate text-ink-2">{p[0]}</span>
            <span className="num text-[11.5px] text-muted">{fmt(p[1])}</span><span className="num w-10 text-right text-[11px] text-faint">{additive ? pct(p[1] / total) : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stacked({ rows, fmt, color }: { rows: Row[]; fmt: Fmt; color: string }) {
  const { parts, total, op } = shares(rows, 5, true);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-[22px] gap-[2px] overflow-hidden rounded-md">
        {parts.map((p, i) => <span key={i} title={`${p[0]}: ${fmt(p[1])} (${pct(p[1] / total)})`} className="h-full" style={{ width: `${(p[1] / total) * 100}%`, background: color, opacity: op(i) }} />)}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-1.5">
        {parts.map((p, i) => (
          <div key={i} className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2 text-[12px]">
            <span className="size-2 rounded-sm" style={{ background: color, opacity: op(i) }} /><span className="truncate text-ink-2">{p[0]}</span>
            <span className="num text-[11.5px] text-muted">{pct(p[1] / total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Dải nhiệt theo tháng: mỗi ô một tháng, càng đậm càng cao. */
function Heat({ rows, fmt, color }: { rows: Row[]; fmt: Fmt; color: string }) {
  const vals = rows.map((r) => r[1]), lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1, every = rows.length > 12 ? 3 : 1;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${rows.length},minmax(0,1fr))` }}>
        {rows.map((r, i) => (
          <div key={i} className="flex min-w-0 flex-col gap-1">
            <span title={`${formatDim(r[0])}: ${fmt(r[1])}`} className="h-11 rounded-[5px]" style={{ background: color, opacity: 0.14 + 0.86 * ((r[1] - lo) / span) }} />
            <span className="text-center font-mono text-[10px] text-faint">{i % every === 0 ? `T${Number(String(r[0]).slice(5, 7))}` : ""}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-faint">
        <span className="whitespace-nowrap font-mono">{fmt(lo)}</span>
        <span className="h-1.5 max-w-[120px] flex-1 rounded-full" style={{ background: `linear-gradient(90deg, color-mix(in oklch, ${color} 14%, transparent), ${color})` }} />
        <span className="whitespace-nowrap font-mono">{fmt(hi)}</span>
      </div>
    </div>
  );
}

function DataTable({ rows, fmt, dimLabel }: { rows: Row[]; fmt: Fmt; dimLabel: string }) {
  return (
    <div className="scroll-thin max-h-[220px] overflow-y-auto rounded-lg border border-line">
      <table className="w-full text-[12.5px]">
        <thead className="sticky top-0 bg-sunk text-left text-[11.5px] text-muted"><tr><th className="px-2.5 py-1.5 font-medium">{dimLabel}</th><th className="px-2.5 py-1.5 text-right font-medium">Giá trị</th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line"><td className="px-2.5 py-1.5">{formatDim(r[0])}</td><td className="num px-2.5 py-1.5 text-right">{fmt(r[1])}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Delta({ cur, prev, metricId }: { cur: number; prev: number; metricId: string }) {
  const d = (cur - prev) / Math.abs(prev || 1);
  const good = LOWER_IS_BETTER.test(metricId) ? d < 0 : d >= 0;
  return (
    <span className={cx("inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full px-[7px] font-mono text-[11.5px] font-medium", good ? "bg-good-soft text-good" : "bg-bad-soft text-bad")}>
      {d >= 0 ? "▲" : "▼"} {Math.abs(d * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%
    </span>
  );
}

/** Một card chỉ số: dựng lại SQL từ định nghĩa chuẩn ở backend, qua bộ kiểm định, rồi mới hiện số. */
export function MetricCard({ dbId, spec, dimLabel, compact = false }: { dbId: number; spec: CardSpec; dimLabel?: string; compact?: boolean }) {
  const nav = useNavigate();
  const { data, failed } = useRender(dbId, spec);
  // số lớn có thêm đường xu hướng theo tháng bên dưới (cùng định nghĩa, cùng khoảng thời gian)
  const sparkSpec = spec.chart === "number" && !compact ? { ...spec, dimension: "month", chart: "line" as const, compare: false, top: null } : null;
  const spark = useRender(dbId, sparkSpec).data;
  const [asTable, setAsTable] = useState(false);
  const color = CARD_COLORS[spec.color ?? "blue"].css;
  const fmt = useMemo<Fmt>(() => (v) => formatValue(typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : v, data?.metric?.format, data?.metric?.unit), [data]);

  if (failed) return <p className="text-[12.5px] text-bad">{failed}</p>;
  if (!data) return <div className="flex flex-col gap-2" aria-busy="true"><div className="h-6 w-1/2 animate-pulse rounded bg-sunk" /><div className="h-16 animate-pulse rounded bg-sunk" /></div>;
  if (data.status !== "ok") {
    const held = data.status === "held";
    return (
      <div className={cx("flex items-start gap-2 rounded-lg px-3 py-2.5 text-[12.5px] leading-[1.45]", held ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn")}>
        {held ? <Hand size={15} className="mt-px shrink-0" /> : <AlertTriangle size={15} className="mt-px shrink-0" />}
        <span>{data.message}{held && data.rules?.length ? <span className="ml-1 inline-flex gap-1">{data.rules.map((r) => <RuleChip key={r} rule={r} severity="high" />)}</span> : null}</span>
      </div>
    );
  }

  const ch = spec.chart;
  const single = ch === "number" || ch === "gauge";
  const raw = data.rows ?? [];
  let rows: Row[] = raw.map((r) => [r[0], num(r[1])]);
  if (ch === "cumulative") { let run = 0; rows = rows.map((r) => [r[0], (run += r[1])]); }
  const cut = compact ? rows.slice(0, 5) : rows;
  const prevRows = data.previous?.rows ?? null;
  const prevMonth = prevRows && spec.dimension === "month" && ch !== "cumulative" ? prevRows.slice(0, rows.length).map((r) => num(r[1])) : null;
  const value = single ? num(raw[0]?.[raw[0].length - 1]) : 0;
  const prevValue = single && prevRows?.[0] ? num(prevRows[0][prevRows[0].length - 1]) : null;
  const tableMode = !single && (asTable || ch === "table");
  const chartable = !single && ch !== "table";
  const checked = new Date(data.checked_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  const sparkRows = spark?.status === "ok" ? (spark.rows ?? []).map((r) => num(r[1])) : [];
  const yellow = data.verdict === "yellow";

  let body: ReactNode;
  if (single) {
    const head = (
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
        {prevValue !== null && <><Delta cur={value} prev={prevValue} metricId={spec.metric_id} /><span className="text-faint">so với {data.previous?.label}</span></>}
        <span>{data.period_label}</span>
      </div>
    );
    if (ch === "gauge") {
      const top = data.metric?.format === "score" ? 5 : 1, frac = Math.max(0, Math.min(1, value / top)), LEN = Math.PI * 60;
      body = (
        <div className="flex flex-col items-center gap-1">
          <div className="relative w-[180px] max-w-full">
            <svg viewBox="0 0 160 90" className="block w-full overflow-visible" role="img" aria-label={`${fmt(value)} trên thang ${top === 5 ? "0 tới 5" : "0 tới 100%"}`}>
              <path d="M20 80 A60 60 0 0 1 140 80" fill="none" stroke="var(--color-sunk)" strokeWidth={14} strokeLinecap="round" />
              <path d="M20 80 A60 60 0 0 1 140 80" fill="none" stroke={color} strokeWidth={14} strokeLinecap="round" strokeDasharray={`${frac * LEN} 999`} />
            </svg>
            <div className="absolute inset-x-0 bottom-0.5 text-center font-mono text-[22px] font-medium tracking-tight">{fmt(value)}</div>
          </div>
          <div className="flex w-[180px] max-w-full justify-between font-mono text-[10px] text-faint"><span>{top === 5 ? "0" : "0%"}</span><span>{top === 5 ? "5" : "100%"}</span></div>
          {head}
        </div>
      );
    } else {
      const lo = Math.min(...sparkRows), hi = Math.max(...sparkRows), sp = hi - lo || 1;
      const pts = sparkRows.map((v, i) => `${(i / Math.max(sparkRows.length - 1, 1)) * 200},${3 + (1 - (v - lo) / sp) * 34}`);
      body = (
        <div className="flex flex-col gap-2.5">
          <div>
            <div className="num text-[24px] font-medium leading-[1.1] tracking-tight">{fmt(value)}</div>
            <div className="mt-1.5">{head}</div>
          </div>
          {pts.length > 1 && (
            <svg viewBox="0 0 200 40" preserveAspectRatio="none" className="block h-10 w-full overflow-visible" aria-hidden>
              <path d={`M0,40 L${pts.join(" L")} L200,40 Z`} fill={color} opacity={0.12} />
              <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
          )}
        </div>
      );
    }
  } else if (rows.length === 0) body = <p className="text-[12.5px] text-muted">Không có dữ liệu trong khoảng này.</p>;
  else if (tableMode) body = <DataTable rows={cut} fmt={fmt} dimLabel={dimLabel ?? data.columns?.[0] ?? ""} />;
  else if (ch === "line" || ch === "area" || ch === "cumulative" || ch === "column") body = <TimeChart rows={rows} prev={prevMonth} fmt={fmt} color={color} kind={ch} />;
  else if (ch === "heat") body = <Heat rows={rows} fmt={fmt} color={color} />;
  else if (ch === "donut") body = <Donut rows={rows} fmt={fmt} color={color} additive={!!data.metric?.additive} compact={compact} />;
  else if (ch === "stacked") body = <Stacked rows={rows} fmt={fmt} color={color} />;
  else body = <Bars rows={cut} fmt={fmt} color={color} />;

  return (
    <div className="flex flex-1 flex-col gap-2.5">
      {body}
      {prevMonth && !tableMode && (
        <div className="flex gap-3.5 text-[11px] text-faint">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="h-0.5 w-3" style={{ background: color }} />Năm 2018</span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="w-3 border-t-[1.5px] border-dashed border-faint" />Cùng kỳ 2017</span>
        </div>
      )}
      {!compact && (
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1 text-[11.5px] text-faint">
          <span className={cx("inline-flex h-5 shrink-0 items-center gap-[5px] whitespace-nowrap rounded-full px-[7px] font-medium", yellow ? "bg-warn-soft text-warn" : "bg-good-soft text-good")}>
            <span className="size-1.5 rounded-full bg-current" />{yellow ? `Vàng${data.rules?.length ? ` · ${data.rules.join(" ")}` : ""}` : "Xanh"}
          </span>
          <span>kiểm lúc {checked} · {data.metric?.name_vi} v{data.metric?.version}{!single ? ` · ${data.period_label.toLowerCase()}` : ""}</span>
          <span className="ml-auto flex items-center gap-0.5">
            {chartable && (
              <button onClick={() => setAsTable(!asTable)} aria-pressed={asTable} className="inline-flex items-center gap-1 rounded-md px-[7px] py-[3px] text-muted hover:bg-hover hover:text-ink">
                <Table2 size={12} /> {asTable ? "Biểu đồ" : "Bảng"}
              </button>
            )}
            <button onClick={() => nav(`/metrics/${spec.metric_id}`)} title="Mở định nghĩa chỉ số" className="inline-flex items-center gap-1 rounded-md px-[7px] py-[3px] text-muted hover:bg-hover hover:text-ink">
              <ExternalLink size={12} /> Định nghĩa
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
