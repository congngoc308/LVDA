import { AlertTriangle, ExternalLink, Hand, Table2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api";
import type { CardSpec, RenderRes } from "../../dashboard";
import { formatDim, formatValue } from "../../format";
import type { Verdict } from "../../types";
import { cx, RuleChip, VerdictStamp } from "../ui";

// Kết quả card giữ 60 giây theo tham số, để kéo thả hay đổi cỡ không phải chạy lại truy vấn
const cache = new Map<string, { at: number; data: RenderRes }>();
const specKey = (dbId: number, s: CardSpec) => JSON.stringify([dbId, s.metric_id, s.dimension, s.period, s.top, s.chart]);

type Fmt = (v: unknown) => string;

function Bars({ rows, fmt }: { rows: unknown[][]; fmt: Fmt }) {
  const max = Math.max(...rows.map((r) => Number(r[1]) || 0), 1e-9);
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Biểu đồ cột ngang">
      {rows.map((r, i) => (
        <li key={i} className="group grid grid-cols-[minmax(0,90px)_1fr_auto] items-center gap-2 text-[12px]" title={`${formatDim(r[0])}: ${fmt(r[1])}`}>
          <span className="truncate text-ink-2">{formatDim(r[0])}</span>
          <span className="h-3 rounded-r bg-sunk">
            <span className="block h-3 rounded-r bg-accent transition-opacity group-hover:opacity-80" style={{ width: `${(Math.max(Number(r[1]) || 0, 0) / max) * 100}%` }} />
          </span>
          <span className="num text-muted">{fmt(r[1])}</span>
        </li>
      ))}
    </ul>
  );
}

/** Đường theo tháng: một màu, đường 2px, điểm ≥ 8px khi hover, đường dóng dọc + ô giá trị. */
function Line({ rows, fmt }: { rows: unknown[][]; fmt: Fmt }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 320, H = 120, P = { l: 6, r: 6, t: 10, b: 18 };
  const vals = rows.map((r) => Number(r[1]) || 0);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || Math.abs(hi) || 1;
  const x = (i: number) => P.l + (rows.length === 1 ? (W - P.l - P.r) / 2 : (i / (rows.length - 1)) * (W - P.l - P.r));
  const y = (v: number) => P.t + (1 - (v - lo) / span) * (H - P.t - P.b);
  const pts = vals.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[140px] w-full overflow-visible" role="img"
        aria-label={`Từ ${formatDim(rows[0]?.[0])} đến ${formatDim(rows.at(-1)?.[0])}, thấp nhất ${fmt(lo)}, cao nhất ${fmt(hi)}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - box.left) / box.width) * W;
          let best = 0;
          rows.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
          setHover(best);
        }}>
        <line x1={P.l} x2={W - P.r} y1={H - P.b} y2={H - P.b} stroke="var(--color-line)" />
        <polyline points={pts} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {hover !== null && <>
          <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} stroke="var(--color-line-strong)" strokeDasharray="2 2" />
          <circle cx={x(hover)} cy={y(vals[hover])} r={4} fill="var(--color-accent)" stroke="var(--color-surface)" strokeWidth={2} />
        </>}
        <text x={P.l} y={H - 4} fontSize={9} fill="var(--color-muted)">{formatDim(rows[0]?.[0])}</text>
        <text x={W - P.r} y={H - 4} fontSize={9} fill="var(--color-muted)" textAnchor="end">{formatDim(rows.at(-1)?.[0])}</text>
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-0 rounded border border-line bg-surface px-2 py-0.5 text-[12px] shadow"
          style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > rows.length / 2 ? "-100%" : "0"})` }}>
          <b>{formatDim(rows[hover][0])}</b> · <span className="num">{fmt(rows[hover][1])}</span>
        </div>
      )}
    </div>
  );
}

function DataTable({ rows, fmt, dimLabel }: { rows: unknown[][]; fmt: Fmt; dimLabel: string }) {
  return (
    <div className="scroll-thin max-h-[220px] overflow-y-auto">
      <table className="w-full text-[12.5px]">
        <thead className="sticky top-0 bg-sunk text-left text-[11.5px] text-muted"><tr><th className="px-2 py-1 font-medium">{dimLabel}</th><th className="px-2 py-1 text-right font-medium">Giá trị</th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line"><td className="px-2 py-1">{formatDim(r[0])}</td><td className="num px-2 py-1 text-right">{fmt(r[1])}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/** Một card chỉ số: dựng lại SQL từ định nghĩa chuẩn ở backend, qua bộ kiểm định, rồi mới hiện số. */
export function MetricCard({ dbId, spec, dimLabel, compact = false }: { dbId: number; spec: CardSpec; dimLabel?: string; compact?: boolean }) {
  const nav = useNavigate();
  const key = specKey(dbId, spec);
  const [data, setData] = useState<RenderRes | null>(() => cache.get(key)?.data ?? null);
  const [asTable, setAsTable] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
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
  }, [key]); // `key` mã hoá đủ tham số của spec

  const fmt = useMemo<Fmt>(() => (v) => formatValue(typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : v, data?.metric?.format, data?.metric?.unit), [data]);

  if (failed) return <p className="text-[12.5px] text-bad">{failed}</p>;
  if (!data) return <div className="flex flex-col gap-2" aria-busy="true"><div className="h-6 w-1/2 animate-pulse rounded bg-sunk" /><div className="h-16 animate-pulse rounded bg-sunk" /></div>;
  if (data.status !== "ok") {
    const held = data.status === "held";
    return (
      <div className={cx("flex items-start gap-2 rounded-md border px-3 py-2 text-[12.5px]", held ? "border-bad/30 bg-bad-soft text-bad" : "border-warn/30 bg-warn-soft text-warn")}>
        {held ? <Hand size={15} className="mt-0.5 shrink-0" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0" />}
        <span>{data.message}{held && data.rules?.length ? <span className="ml-1 inline-flex gap-1">{data.rules.map((r) => <RuleChip key={r} rule={r} severity="high" />)}</span> : null}</span>
      </div>
    );
  }
  const rows = data.rows ?? [];
  const checked = new Date(data.checked_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  const chartable = spec.chart !== "number" && spec.chart !== "table";
  return (
    <div className="flex flex-col gap-2">
      {spec.chart === "number" && (
        <div>
          <div className="num text-[28px] font-medium leading-none tracking-tight">{fmt(rows[0]?.[rows[0].length - 1])}</div>
          <div className="mt-1 text-[12px] text-muted">{data.period_label}</div>
        </div>
      )}
      {spec.chart !== "number" && rows.length === 0 && <p className="text-[12.5px] text-muted">Không có dữ liệu trong khoảng này.</p>}
      {spec.chart !== "number" && rows.length > 0 && (asTable || spec.chart === "table"
        ? <DataTable rows={compact ? rows.slice(0, 5) : rows} fmt={fmt} dimLabel={dimLabel ?? data.columns?.[0] ?? ""} />
        : spec.chart === "line" ? <Line rows={rows} fmt={fmt} /> : <Bars rows={compact ? rows.slice(0, 5) : rows} fmt={fmt} />)}
      {data.verdict === "yellow" && data.rules?.length ? (
        <p className="flex flex-wrap items-center gap-1 text-[11.5px] text-warn">Cần xem lại: {data.rules.map((r) => <RuleChip key={r} rule={r} severity="medium" />)}</p>
      ) : null}
      {!compact && (
        <div className="mt-auto flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
          <VerdictStamp verdict={(data.verdict ?? null) as Verdict | null} size="sm" />
          <span>kiểm lúc {checked} · {data.metric?.name_vi} v{data.metric?.version}{spec.chart !== "number" ? ` · ${data.period_label.toLowerCase()}` : ""}</span>
          <span className="ml-auto flex items-center gap-1">
            {chartable && (
              <button onClick={() => setAsTable(!asTable)} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-sunk" aria-pressed={asTable}>
                <Table2 size={12} /> {asTable ? "Biểu đồ" : "Bảng"}
              </button>
            )}
            <button onClick={() => nav(`/metrics/${spec.metric_id}`)} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-sunk" title="Mở định nghĩa chỉ số">
              <ExternalLink size={12} /> Định nghĩa
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
