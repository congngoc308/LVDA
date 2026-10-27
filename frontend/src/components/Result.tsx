import { useState } from "react";
import { formatDim, formatValue } from "../format";
import type { ResultColumn, Run } from "../types";
import { cx } from "./ui";

function columnsOf(run: Run): ResultColumn[] {
  if (run.answer?.columns?.length) return run.answer.columns;
  const first = run.result?.rows[0] ?? [];
  return (run.result?.columns ?? []).map((c, i) => ({
    key: c, label: c, kind: typeof first[i] === "number" ? "measure" : "dimension", format: null, unit: null,
  }));
}

/** Biểu đồ cột theo tháng: một chuỗi, một màu, có tooltip khi rê chuột. */
function MonthBars({ rows, measure }: { rows: unknown[][]; measure: ResultColumn }) {
  const [hover, setHover] = useState<number | null>(null);
  const vals = rows.map((r) => (typeof r[r.length - 1] === "number" ? (r[r.length - 1] as number) : 0));
  const max = Math.max(...vals, 0) || 1;
  const W = 640, H = 150, pad = { l: 8, r: 8, t: 12, b: 22 };
  const bw = (W - pad.l - pad.r) / rows.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${measure.label} theo tháng`}>
        {[0.5, 1].map((g) => <line key={g} x1={pad.l} x2={W - pad.r} y1={y(max * g)} y2={y(max * g)} stroke="var(--color-line)" strokeWidth={1} />)}
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--color-line-strong)" />
        {rows.map((r, i) => {
          const x = pad.l + i * bw + bw * 0.18, w = Math.max(bw * 0.64, 2), top = y(vals[i]);
          const h = H - pad.b - top;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
              <path d={`M${x},${H - pad.b} V${top + Math.min(4, h)} q0,-4 4,-4 h${w - 8} q4,0 4,4 V${H - pad.b} Z`}
                fill={hover === i ? "oklch(0.84 0.1 235)" : "var(--color-accent)"} opacity={hover === null || hover === i ? 1 : 0.55} />
              {(rows.length <= 12 || i % Math.ceil(rows.length / 12) === 0) && (
                <text x={pad.l + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--color-faint)" fontFamily="JetBrains Mono">{formatDim(r[0])}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-0 rounded-md border border-line bg-surface px-2 py-1 text-[12px] shadow-md"
          style={{ left: `${Math.min(((hover + 0.5) / rows.length) * 100, 80)}%` }}>
          <div className="text-muted">Tháng {formatDim(rows[hover][0])}</div>
          <div className="num font-medium">{formatValue(rows[hover][rows[hover].length - 1], measure.format, measure.unit)}</div>
        </div>
      )}
    </div>
  );
}

export function ResultView({ run, limit = 12 }: { run: Run; limit?: number }) {
  const [all, setAll] = useState(false);
  const res = run.result;
  if (!res) return null;
  const cols = columnsOf(run);
  const hasDim = cols.some((c) => c.kind === "dimension");
  if (!hasDim && res.rows.length === 1 && run.input_kind === "question") return null; // một số → đã hiện ở headline
  const measure = cols.find((c) => c.kind === "measure") ?? cols[cols.length - 1];
  const mIdx = cols.indexOf(measure);
  const nums = res.rows.map((r) => (typeof r[mIdx] === "number" ? (r[mIdx] as number) : 0));
  const max = Math.max(...nums.map(Math.abs), 0) || 1;
  const rows = all ? res.rows : res.rows.slice(0, limit);
  const isMonth = cols[0]?.key === "month";

  return (
    <div className="flex flex-col gap-3">
      {isMonth && res.rows.length > 1 && <MonthBars rows={res.rows} measure={measure} />}
      <div className="scroll-thin overflow-x-auto rounded-md border border-line">
        <table className="w-full text-[13px]">
          <thead className="bg-sunk text-left text-[12px] text-muted">
            <tr>{cols.map((c) => <th key={c.key} className={cx("px-3 py-1.5 font-medium", c.kind === "measure" && "text-right")}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                {cols.map((c, j) => (
                  <td key={c.key} className={cx("px-3 py-1.5", c.kind === "measure" ? "num text-right" : "font-mono text-[12.5px]")}>
                    {c.kind === "measure" && hasDim && j === mIdx ? (
                      <div className="flex items-center justify-end gap-2">
                        <span>{formatValue(r[j], c.format, c.unit)}</span>
                        <span className="hidden h-2 w-28 rounded-sm bg-sunk sm:block" aria-hidden>
                          <span className="block h-2 rounded-sm bg-accent" style={{ width: `${(Math.abs(nums[i]) / max) * 100}%` }} />
                        </span>
                      </div>
                    ) : c.kind === "measure" ? formatValue(r[j], c.format, c.unit) : formatDim(r[j])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {res.rows.length > limit && (
        <button className="w-fit text-[12.5px] text-accent hover:underline" onClick={() => setAll(!all)}>
          {all ? "Thu gọn" : `Xem đủ ${res.rows.length} dòng${res.truncated ? " (đã cắt ở 1.000)" : ""}`}
        </button>
      )}
    </div>
  );
}
