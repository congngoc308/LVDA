import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { describeFilter } from "../format";
import type { Finding, RunLineage } from "../types";
import { cx, shortCol } from "./ui";

export type NodeTone = "raw" | "mart" | "op" | "cond" | "result" | "ghost" | "bad" | "metric";
export interface GNode { id: string; col: number; label: string; sub?: string; tone: NodeTone; tip?: string }
export interface GEdge { from: string; to: string; kind: "data" | "control" | "ghost" }
export interface Graph { columns: string[]; nodes: GNode[]; edges: GEdge[] }

const TONE: Record<NodeTone, string> = {
  raw: "border-line-strong bg-sunk text-ink-2",
  mart: "border-accent/40 bg-accent-soft text-accent",
  op: "border-ink/25 bg-surface text-ink",
  cond: "border-warn/40 bg-warn-soft text-ink",
  result: "border-navy bg-navy text-white",
  ghost: "border-bad border-dashed bg-surface text-bad",
  bad: "border-bad bg-bad-soft text-bad ring-2 ring-bad/20",
  metric: "border-good/40 bg-good-soft text-good",
};
const NODE_H = 44;
const GAP_Y = 10;
const HEAD = 26;

/** Đồ thị lineage nhiều tầng: cạnh liền là dữ liệu, cạnh đứt là điều kiện (lọc/join/chia nhóm). */
export function LineageGraph({ graph, minHeight = 160 }: { graph: Graph; minHeight?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(e.contentRect.width, 520)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ncol = graph.columns.length;
  const colW = width / ncol;
  const nodeW = Math.min(colW - 36, 260);
  const byCol = graph.columns.map((_, i) => graph.nodes.filter((n) => n.col === i));
  const maxRows = Math.max(...byCol.map((c) => c.length), 1);
  const height = Math.max(minHeight, HEAD + maxRows * (NODE_H + GAP_Y) + 8);
  const pos = useMemo(() => {
    const p: Record<string, { x: number; y: number }> = {};
    byCol.forEach((col, i) => {
      const total = col.length * NODE_H + (col.length - 1) * GAP_Y;
      const top = HEAD + (height - HEAD - total) / 2;
      col.forEach((n, j) => { p[n.id] = { x: i * colW + (colW - nodeW) / 2, y: top + j * (NODE_H + GAP_Y) }; });
    });
    return p;
  }, [byCol, colW, nodeW, height]);

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
    <div ref={wrap} className="relative w-full overflow-x-auto" style={{ height }}>
      <div className="relative" style={{ width, height }}>
        {graph.columns.map((c, i) => (
          <div key={c} className="absolute top-0 text-center text-[10.5px] font-medium uppercase tracking-wider text-faint" style={{ left: i * colW, width: colW }}>{c}</div>
        ))}
        <svg className="absolute inset-0" width={width} height={height} aria-hidden>
          <defs>
            {["data", "control", "ghost"].map((k) => (
              <marker key={k} id={`arr-${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill={k === "data" ? "var(--color-muted)" : k === "control" ? "var(--color-warn)" : "var(--color-bad)"} />
              </marker>
            ))}
          </defs>
          {graph.edges.map((e, i) => {
            const a = pos[e.from], b = pos[e.to];
            if (!a || !b) return null;
            const x1 = a.x + nodeW, y1 = a.y + NODE_H / 2, x2 = b.x - 2, y2 = b.y + NODE_H / 2;
            const mx = (x1 + x2) / 2;
            const on = !lit || (lit.has(e.from) && lit.has(e.to));
            const stroke = e.kind === "data" ? "var(--color-muted)" : e.kind === "control" ? "var(--color-warn)" : "var(--color-bad)";
            return (
              <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={stroke}
                strokeWidth={on && lit ? 2 : 1.4} strokeDasharray={e.kind === "data" ? undefined : "5 4"}
                opacity={on ? 0.85 : 0.12} markerEnd={`url(#arr-${e.kind})`} />
            );
          })}
        </svg>
        {graph.nodes.map((n) => {
          const p = pos[n.id];
          if (!p) return null;
          const dim = lit && !lit.has(n.id);
          return (
            <div key={n.id} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} title={n.tip ?? n.label}
              tabIndex={0} onFocus={() => setHover(n.id)} onBlur={() => setHover(null)}
              className={cx("absolute flex flex-col justify-center rounded-md border px-2 leading-tight transition-opacity", TONE[n.tone], dim && "opacity-30")}
              style={{ left: p.x, top: p.y, width: nodeW, height: NODE_H }}>
              <span className="truncate font-mono text-[11.5px]">{n.label}</span>
              {n.sub && <span className={cx("truncate text-[10.5px]", n.tone === "result" ? "text-white/70" : "opacity-75")}>{n.sub}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function GraphLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted">
      <span className="inline-flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--color-muted)" strokeWidth="1.6" /></svg>dữ liệu chảy vào</span>
      <span className="inline-flex items-center gap-1.5"><svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="var(--color-warn)" strokeWidth="1.6" strokeDasharray="5 4" /></svg>điều kiện (lọc, join, chia nhóm)</span>
      <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded-sm border border-dashed border-bad" />thiếu so với định nghĩa</span>
      <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded-sm border border-bad bg-bad-soft" />vi phạm luật</span>
      <span>Rê chuột vào một ô để xem đường đi.</span>
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
    add({ id, col: 2, label: `⋈ ${tableOf(j.left)} ↔ ${tableOf(j.right)}`, sub: hit ? (hit.rule === "V05" ? "join làm nhân dòng" : "join chưa khai báo") : `join theo ${colOf(j.left)}`,
      tone: hit ? "bad" : "cond", tip: j.sql });
    edges.push({ from: id, to: RESULT, kind: "control" });
  });
  ln.group_by.forEach((g, i) => {
    const id = `grp:${i}`;
    const bad = g.columns.some((c) => wrongTime.has(c));
    add({ id, col: 2, label: `chia theo ${g.columns.map(colOf).join(", ")}`, sub: bad ? "sai cột thời gian" : "chiều chia", tone: bad ? "bad" : "cond", tip: g.sql });
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
