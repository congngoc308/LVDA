import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { describeFilter } from "../format";
import type { Finding, RunLineage } from "../types";
import { cx, shortCol } from "./ui";

export type NodeTone = "raw" | "mart" | "op" | "cond" | "join" | "group" | "result" | "ghost" | "bad" | "metric";
export interface GNode { id: string; col: number; label: string; sub?: string; tone: NodeTone; tip?: string }
export interface GEdge { from: string; to: string; kind: "data" | "control" | "ghost" }
export interface Graph { columns: string[]; nodes: GNode[]; edges: GEdge[] }

// màu theo loại phép tính: phép đo xanh dương, bộ lọc vàng, join xanh lơ, chia nhóm hồng
const KIND: Partial<Record<NodeTone, string>> = {
  op: "var(--color-accent)", cond: "var(--color-warn)", join: "var(--color-cyan)", group: "var(--color-pink)", metric: "var(--color-accent)",
};
function toneStyle(t: NodeTone): { box?: CSSProperties; cls: string; sub: string } {
  const k = KIND[t];
  if (k) return { box: { borderColor: k, background: `color-mix(in oklch, ${k} 14%, var(--color-surface))` }, cls: "text-ink", sub: "" };
  switch (t) {
    case "result": return { cls: "border-accent bg-accent text-on-accent", sub: "text-[#0e2d66]" };
    case "mart": return { cls: "border-[#44485f] bg-sunk text-ink", sub: "text-faint" };
    case "ghost": return { cls: "border-dashed border-bad bg-surface text-bad", sub: "text-bad" };
    case "bad": return { cls: "border-bad bg-bad-soft text-ink", sub: "text-bad" };
    default: return { cls: "border-line-strong bg-paper text-ink", sub: "text-faint" };
  }
}
const NODE_H = 38;
const GAP_Y = 10;
const HEAD = 24;

/** Đồ thị lineage nhiều tầng: cạnh liền là dữ liệu, cạnh đứt là điều kiện (lọc/join/chia nhóm). */
export function LineageGraph({ graph, minHeight = 160 }: { graph: Graph; minHeight?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(e.contentRect.width, 640)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ncol = graph.columns.length;
  const byCol = graph.columns.map((_, i) => graph.nodes.filter((n) => n.col === i));
  const maxRows = Math.max(...byCol.map((c) => c.length), 1);
  const height = Math.max(minHeight, HEAD + maxRows * (NODE_H + GAP_Y));
  const pos = useMemo(() => {
    // cột phép tính rộng hơn vì nhãn là biểu thức SQL
    const weights = byCol.map((_, i) => (i === 2 && ncol === 4 ? 1.2 : 1));
    const unit = width / weights.reduce((a, b) => a + b, 0);
    const p: Record<string, { x: number; y: number; w: number }> = {};
    let x = 0;
    byCol.forEach((col, i) => {
      const w = Math.min(weights[i] * unit - 28, 260);
      const total = col.length * NODE_H + (col.length - 1) * GAP_Y;
      const top = HEAD + (height - HEAD - total) / 2;
      col.forEach((n, j) => { p[n.id] = { x, y: top + j * (NODE_H + GAP_Y), w }; });
      p[`__col${i}`] = { x, y: 0, w };
      x += weights[i] * unit;
    });
    return p;
  }, [byCol, ncol, width, height]);

  // Đường đi qua node đang rê chuột (cả phía trên lẫn phía dưới)
  const lit = useMemo(() => {
    if (!hover) return null;
    const set = new Set<string>([hover]);
    const walk = (dir: "up" | "down") => {
      let changed = true;
      while (changed) {
        changed = false;
        for (const e of graph.edges) {
          const [a, b] = dir === "up" ? [e.to, e.from] : [e.from, e.to];
          if (set.has(a) && !set.has(b)) { set.add(b); changed = true; }
        }
      }
    };
    const base = new Set(set);
    walk("up");
    const up = new Set(set);
    set.clear(); base.forEach((x) => set.add(x));
    walk("down");
    up.forEach((x) => set.add(x));
    return set;
  }, [hover, graph.edges]);

  useEffect(() => setHover(null), [graph]);

  return (
    <div ref={wrap} className="scroll-thin relative w-full overflow-x-auto" style={{ height }}>
      <div className="relative" style={{ width, height }}>
        {graph.columns.map((c, i) => (
          <div key={c} className="absolute top-0 text-[11px] text-dim" style={{ left: pos[`__col${i}`]?.x ?? 0 }}>{c}</div>
        ))}
        <svg className="absolute inset-0 overflow-visible" width={width} height={height} aria-hidden>
          {graph.edges.map((e, i) => {
            const a = pos[e.from], b = pos[e.to];
            if (!a || !b) return null;
            const x1 = a.x + a.w, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
            const mx = (x1 + x2) / 2;
            const on = !!lit && lit.has(e.from) && lit.has(e.to);
            const stroke = e.kind === "ghost" ? "var(--color-bad)" : on ? "var(--color-accent)" : "#44485f";
            return (
              <path key={i} d={`M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`} fill="none" stroke={stroke}
                strokeWidth={on ? 1.6 : 1.2} strokeDasharray={e.kind === "data" ? undefined : "4 4"}
                opacity={!lit || on ? 1 : 0.25} />
            );
          })}
        </svg>
        {graph.nodes.map((n) => {
          const p = pos[n.id];
          if (!p) return null;
          const dim = lit && !lit.has(n.id);
          const st = toneStyle(n.tone);
          const kind = KIND[n.tone];
          return (
            <div key={n.id} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} title={n.tip ?? n.label}
              tabIndex={0} onFocus={() => setHover(n.id)} onBlur={() => setHover(null)}
              className={cx("absolute flex flex-col justify-center rounded-[5px] border px-[9px] py-1 leading-tight transition-opacity", st.cls, dim && "opacity-30")}
              style={{ left: p.x, top: p.y, width: p.w, height: NODE_H, ...st.box }}>
              <span className="truncate font-mono text-[11.5px]">{n.label}</span>
              {n.sub && <span className={cx("truncate text-[10.5px]", st.sub)} style={kind ? { color: kind } : undefined}>{n.sub}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function GraphLegend({ hint = true }: { hint?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-[18px] gap-y-1.5 border-t border-line-soft pt-3 text-[11.5px] text-faint">
      <span className="inline-flex items-center gap-1.5"><span className="w-[18px] border-t-[1.5px] border-[#61668a]" />dữ liệu chạy vào</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-[18px] border-t-[1.5px] border-dashed border-[#61668a]" />điều kiện (lọc, join, chia nhóm)</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-[9px] w-3 rounded-[2px] border border-dashed border-bad" />thiếu so với định nghĩa</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-[9px] w-3 rounded-[2px] border border-bad" />vi phạm luật</span>
      {hint && <span className="ml-auto">Rê chuột vào một ô để xem đường đi</span>}
    </div>
  );
}

const colOf = (c: string) => c.split(".").pop() ?? c;
const tableOf = (c: string) => shortCol(c.split(".").slice(0, -1).join("."));

function filterLabel(f: { column: string; op: string; value: unknown }) {
  return describeFilter({ ...f, column: colOf(f.column) });
}

/** Dựng đồ thị cho một lần thử: cột raw → cột mart → phép tính & điều kiện → kết quả. */
export function buildAnswerGraph(ln: RunLineage, findings: Finding[], resultLabel: string, resultSub?: string): Graph {
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const have = new Set<string>();
  const add = (n: GNode) => { if (!have.has(n.id)) { have.add(n.id); nodes.push(n); } };
  const rules = new Set(findings.filter((f) => f.severity !== "info").map((f) => f.rule));
  const wrongTime = new Set<string>(findings.flatMap((f) => (f.rule === "V08" ? ((f.fix?.wrong as string[]) ?? []) : [])));
  const badFilterCols = new Set<string>(findings.filter((f) => f.rule === "V04").map((f) => String(f.fix?.column ?? "")));
  const RESULT = "result";
  add({ id: RESULT, col: 3, label: resultLabel, sub: resultSub, tone: "result" });

  const linkRaw = (col: string, raws: string[]) => raws.forEach((r) => {
    add({ id: `raw:${r}`, col: 0, label: colOf(r), sub: tableOf(r), tone: "raw", tip: r });
    edges.push({ from: `raw:${r}`, to: `mart:${col}`, kind: "data" });
  });

  // Phép đo
  const measureBad = rules.has("V02") || rules.has("V06") || rules.has("V07");
  ln.measure_sql.slice(0, 3).forEach((sql, i) => {
    add({ id: `op:${i}`, col: 2, label: sql, sub: "phép đo", tone: measureBad ? "bad" : "op", tip: sql });
    edges.push({ from: `op:${i}`, to: RESULT, kind: "data" });
  });
  ln.measures.forEach((m) => {
    add({ id: `mart:${m.column}`, col: 1, label: colOf(m.column), sub: `${tableOf(m.column)} · cột đo`, tone: "mart", tip: m.column });
    linkRaw(m.column, m.raw);
    ln.measure_sql.slice(0, 3).forEach((_, i) => edges.push({ from: `mart:${m.column}`, to: `op:${i}`, kind: "data" }));
  });

  // Điều kiện: gộp cặp >= / < thành khoảng
  const used = new Set<number>();
  ln.filters.forEach((f, i) => {
    if (used.has(i) || f.op === "expr") return;
    let label = filterLabel(f);
    if (f.op === ">=") {
      const j = ln.filters.findIndex((g, k) => k !== i && !used.has(k) && g.column === f.column && g.op === "<");
      if (j >= 0) { used.add(j); label = `${colOf(f.column)} ∈ [${String(f.value).slice(0, 10)}, ${String(ln.filters[j].value).slice(0, 10)})`; }
    }
    used.add(i);
    const bad = wrongTime.has(f.column) || badFilterCols.has(f.column);
    const id = `cond:${i}`;
    add({ id, col: 2, label, sub: bad ? "sai so với định nghĩa" : `bộ lọc · ${tableOf(f.column)}`, tone: bad ? "bad" : "cond", tip: f.sql });
    add({ id: `mart:${f.column}`, col: 1, label: colOf(f.column), sub: `${tableOf(f.column)} · cột lọc`, tone: "mart", tip: f.column });
    linkRaw(f.column, f.raw ?? []);
    edges.push({ from: `mart:${f.column}`, to: id, kind: "control" });
    edges.push({ from: id, to: RESULT, kind: "control" });
  });
  const joinFindings = findings.filter((f) => f.rule === "V05" || f.rule === "V09");
  ln.joins.forEach((j, i) => {
    const hit = joinFindings.find((f) => f.evidence && (f.evidence.includes(j.sql) || j.sql.includes(f.evidence)));
    const id = `join:${i}`;
    add({ id, col: 2, label: `${tableOf(j.left)} ⋈ ${tableOf(j.right)}`, sub: hit ? (hit.rule === "V05" ? "join làm nhân dòng" : "join chưa khai báo") : `join theo ${colOf(j.left)}`,
      tone: hit ? "bad" : "join", tip: j.sql });
    edges.push({ from: id, to: RESULT, kind: "control" });
  });
  ln.group_by.forEach((g, i) => {
    const id = `grp:${i}`;
    const bad = g.columns.some((c) => wrongTime.has(c));
    add({ id, col: 2, label: `chia theo ${g.columns.map(colOf).join(", ")}`, sub: bad ? "sai cột thời gian" : "chiều chia", tone: bad ? "bad" : "group", tip: g.sql });
    g.columns.forEach((c) => {
      add({ id: `mart:${c}`, col: 1, label: colOf(c), sub: `${tableOf(c)} · cột chia`, tone: "mart", tip: c });
      edges.push({ from: `mart:${c}`, to: id, kind: "control" });
    });
    edges.push({ from: id, to: RESULT, kind: "control" });
  });
  // Bộ lọc bắt buộc bị thiếu
  findings.filter((f) => f.rule === "V03" && f.fix).forEach((f, i) => {
    const fx = f.fix as { column: string; op: string; value: unknown };
    const id = `ghost:${i}`;
    add({ id, col: 2, label: `thiếu ${filterLabel(fx)}`, sub: "bộ lọc bắt buộc (V03)", tone: "ghost", tip: describeFilter(fx) });
    edges.push({ from: id, to: RESULT, kind: "ghost" });
  });
  return { columns: ["Nguồn raw", "Cột mart", "Phép tính & điều kiện", "Kết quả"], nodes, edges };
}
