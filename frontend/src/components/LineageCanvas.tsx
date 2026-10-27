import { Background, Controls, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { cx } from "./ui";

/** Canvas lineage theo bảng: mỗi bảng là một node, cột là hàng bên trong, cạnh đi từ đúng cột.
 *  Dữ liệu là vùng lân cận do backend tính (đã có trần số node), không phải cả warehouse. */

export interface LCol { name: string; pii: boolean; parents: string[]; metrics: { id: string; name_vi: string; status: string; role: string }[] }
export interface LTable { name: string; schema: string; layer: number; deprecated: boolean; center: boolean; columns: LCol[]; neighbors: string[] }

export type Sel =
  | { kind: "table"; table: string }
  | { kind: "column"; table: string; column: string }
  | { kind: "metric"; id: string }
  | null;

interface Link { a: string; aCol?: string; b: string; bCol?: string }

const HEAD = 42; // tiêu đề bảng
const ROW = 24; // một cột
const FOOT = 28; // một dòng nút ở chân node
const GAP = 26; // khoảng cách giữa các bảng trong một làn
const LANE_W = 360;
const METRIC_H = 46;
const METRIC_GAP = 12;
const metricKey = (id: string) => `metric:${id}`;
const tableOf = (col: string) => col.slice(0, col.lastIndexOf("."));
const colOf = (col: string) => col.slice(col.lastIndexOf(".") + 1);

export function layerLabel(layer: number, maxLayer: number) {
  if (layer === 0) return "Nguồn";
  if (layer === maxLayer && maxLayer > 1) return "Mart";
  return maxLayer > 2 ? `Trung gian ${layer}` : "Trung gian";
}

interface Handlers {
  onColumn: (t: string, c: string) => void; onTable: (t: string) => void; onMetric: (id: string) => void;
  onExpand: (k: string) => void; onShowAll: (k: string) => void;
}

type TableData = {
  name: string; title: string; deprecated: boolean; center: boolean; selectedTable: boolean;
  rows: { name: string; pii: boolean; hasIn: boolean; hasOut: boolean; selected: boolean; dim: boolean }[];
  hidden: number; more: number; handlers: Handlers;
};
type MetricData = { id: string; name: string; status: string; selected: boolean; dim: boolean; handlers: Handlers };
type LaneData = { label: string; count: number };

function TableNode({ data }: NodeProps<Node<TableData>>) {
  return (
    <div className={cx("w-[250px] rounded-lg border bg-surface shadow-sm",
      data.center ? "border-accent" : "border-line-strong", data.selectedTable && "ring-2 ring-accent/40")}>
      <button type="button" style={{ height: HEAD }} onClick={(e) => { e.stopPropagation(); data.handlers.onTable(data.name); }}
        className="flex w-full flex-col justify-center rounded-t-lg border-b border-line px-3 text-left hover:bg-sunk/60">
        <span className="truncate text-[10.5px] uppercase tracking-wider text-faint">{data.name.split(".")[0]}{data.deprecated && " · ngừng dùng"}</span>
        <span className={cx("truncate font-mono text-[12.5px] font-medium", data.deprecated && "line-through decoration-faint")}>{data.title}</span>
      </button>
      {data.rows.map((r, i) => (
        <div key={r.name} onClick={(e) => { e.stopPropagation(); data.handlers.onColumn(data.name, r.name); }} style={{ height: ROW }}
          className={cx("flex cursor-pointer items-center justify-between gap-2 px-3 text-[12px] hover:bg-sunk",
            r.selected && "bg-accent-soft font-medium text-accent", r.dim && "opacity-40")}>
          <span className="truncate font-mono">{r.name}</span>
          {r.pii && <span className="shrink-0 rounded bg-warn-soft px-1 text-[10px] text-warn">PII</span>}
          {r.hasIn && <Handle type="target" position={Position.Left} id={`in:${r.name}`} style={{ top: HEAD + i * ROW + ROW / 2 }} />}
          {r.hasOut && <Handle type="source" position={Position.Right} id={`out:${r.name}`} style={{ top: HEAD + i * ROW + ROW / 2 }} />}
        </div>
      ))}
      {data.more > 0 && (
        <button type="button" style={{ height: FOOT }} onClick={(e) => { e.stopPropagation(); data.handlers.onShowAll(data.name); }}
          className="w-full border-t border-line text-[11.5px] text-warn hover:bg-sunk">Đang ẩn {data.more} bảng ít dùng · xem hết</button>
      )}
      {data.hidden > 0 && (
        <button type="button" style={{ height: FOOT }} onClick={(e) => { e.stopPropagation(); data.handlers.onExpand(data.name); }}
          className="w-full rounded-b-lg border-t border-line text-[11.5px] text-accent hover:bg-sunk">+ {data.hidden} bảng liên quan</button>
      )}
    </div>
  );
}

function MetricNode({ data }: NodeProps<Node<MetricData>>) {
  const ok = data.status === "certified";
  return (
    <button type="button" style={{ height: METRIC_H }} onClick={(e) => { e.stopPropagation(); data.handlers.onMetric(data.id); }}
      className={cx("flex w-[220px] items-center gap-2 rounded-lg border bg-surface px-3 text-left shadow-sm hover:bg-sunk/60",
        ok ? "border-good/60" : "border-warn/60", data.selected && "ring-2 ring-accent/40", data.dim && "opacity-40")}>
      <span className={cx("size-2 shrink-0 rounded-full", ok ? "bg-good" : "bg-warn")} />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium">{data.name}</span>
        <span className={cx("block text-[10.5px]", ok ? "text-good" : "text-warn")}>chỉ số · {ok ? "đã chứng nhận" : data.status}</span>
      </span>
      <Handle type="target" position={Position.Left} id="in" style={{ top: METRIC_H / 2 }} />
    </button>
  );
}

function LaneNode({ data }: NodeProps<Node<LaneData>>) {
  return <div className="w-[250px] text-[11px] font-medium uppercase tracking-wider text-faint">{data.label} <span className="num font-normal">· {data.count}</span></div>;
}

const nodeTypes = { table: TableNode, metric: MetricNode, lane: LaneNode };

export function buildLineage(tables: LTable[], more: Record<string, number>, sel: Sel, handlers: Handlers) {
  const byName = new Map(tables.map((t) => [t.name, t]));
  const links: Link[] = [];
  const metricMeta = new Map<string, { name: string; status: string }>();
  for (const t of tables) {
    for (const c of t.columns) {
      for (const p of c.parents) if (byName.has(tableOf(p))) links.push({ a: tableOf(p), aCol: colOf(p), b: t.name, bCol: c.name });
      if (t.center) for (const m of c.metrics) {
        links.push({ a: t.name, aCol: c.name, b: metricKey(m.id) });
        metricMeta.set(metricKey(m.id), { name: m.name_vi, status: m.status });
      }
    }
  }
  const ins = new Set(links.filter((l) => l.bCol).map((l) => `${l.b}|${l.bCol}`));
  const outs = new Set(links.filter((l) => l.aCol).map((l) => `${l.a}|${l.aCol}`));

  // Đang chọn gì thì làm nổi đường đi xuyên qua nó, đi cả lên nguồn lẫn xuống hạ nguồn
  const hot = new Set<string>();
  const hotLinks = new Set<Link>();
  const walk = (start: string[], up: boolean) => {
    const queue = [...start];
    while (queue.length) {
      const k = queue.pop()!;
      for (const l of links) {
        const from = up ? `${l.b}|${l.bCol ?? ""}` : `${l.a}|${l.aCol ?? ""}`;
        const to = up ? `${l.a}|${l.aCol ?? ""}` : `${l.b}|${l.bCol ?? ""}`;
        if (from === k && !hotLinks.has(l)) { hotLinks.add(l); hot.add(to); queue.push(to); }
      }
    }
  };
  if (sel?.kind === "column") {
    const k = `${sel.table}|${sel.column}`;
    hot.add(k); walk([k], true); walk([k], false);
  } else if (sel?.kind === "metric") {
    const k = `${metricKey(sel.id)}|`;
    hot.add(k); walk([k], true);
  } else if (sel?.kind === "table") {
    for (const l of links) if (l.a === sel.table || l.b === sel.table) hotLinks.add(l);
  }
  const colMode = sel?.kind === "column" || sel?.kind === "metric";

  const maxLayer = Math.max(0, ...tables.map((t) => t.layer));
  const metricX = (maxLayer + 1) * LANE_W;
  const laneY = new Map<number, number>();
  const nodes: Node[] = [];
  const ordered = [...tables].sort((a, b) => Number(b.center) - Number(a.center) || a.name.localeCompare(b.name));
  for (const t of ordered) {
    const hidden = t.neighbors.filter((n) => !byName.has(n)).length;
    const rows = t.columns.map((c) => ({
      name: c.name, pii: c.pii, hasIn: ins.has(`${t.name}|${c.name}`), hasOut: outs.has(`${t.name}|${c.name}`),
      selected: sel?.kind === "column" && sel.table === t.name && sel.column === c.name,
      dim: colMode && !hot.has(`${t.name}|${c.name}`),
    }));
    const y = laneY.get(t.layer) ?? 0;
    nodes.push({ id: t.name, type: "table", position: { x: t.layer * LANE_W, y }, draggable: false,
      data: { name: t.name, title: t.name.split(".").slice(1).join("."), deprecated: t.deprecated, center: t.center,
        selectedTable: sel?.kind === "table" && sel.table === t.name, rows, hidden, more: more[t.name] ?? 0, handlers } });
    laneY.set(t.layer, y + HEAD + rows.length * ROW + 4 + (hidden ? FOOT : 0) + (more[t.name] ? FOOT : 0) + GAP);
  }
  let my = 0;
  for (const [k, meta] of metricMeta) {
    const on = hot.has(`${k}|`);
    nodes.push({ id: k, type: "metric", position: { x: metricX, y: my }, draggable: false,
      data: { id: k.slice(7), name: meta.name, status: meta.status, selected: on, dim: !!sel && sel.kind !== "table" && !on, handlers } });
    my += METRIC_H + METRIC_GAP;
  }
  laneY.set(maxLayer + 1, my);

  // căn giữa các làn theo làn cao nhất, rồi đặt tiêu đề làn phía trên
  const tallest = Math.max(...laneY.values());
  const laneOf = (n: Node) => Math.round(n.position.x / LANE_W);
  for (const n of nodes) n.position.y += (tallest - (laneY.get(laneOf(n)) ?? 0)) / 2;
  const counts = new Map<number, number>();
  for (const n of nodes) counts.set(laneOf(n), (counts.get(laneOf(n)) ?? 0) + 1);
  for (const [lane, count] of counts) {
    const top = Math.min(...nodes.filter((n) => laneOf(n) === lane).map((n) => n.position.y));
    nodes.push({ id: `lane:${lane}`, type: "lane", position: { x: lane * LANE_W, y: top - 30 }, draggable: false, selectable: false,
      data: { label: lane === maxLayer + 1 ? "Chỉ số" : layerLabel(lane, maxLayer), count } });
  }

  const edges: Edge[] = links.map((l, i) => {
    const on = hotLinks.has(l);
    return {
      id: `e${i}`, type: "smoothstep", source: l.a, sourceHandle: l.aCol ? `out:${l.aCol}` : undefined,
      target: l.b, targetHandle: l.bCol ? `in:${l.bCol}` : "in", zIndex: on ? 1 : 0,
      style: { stroke: on ? "var(--color-accent)" : "var(--color-line-strong)", strokeWidth: on ? 2 : 1.25, opacity: sel && !on ? 0.2 : 1 },
    };
  });
  return { nodes, edges };
}

export function LineageCanvas({ tables, more, sel, onSelect, onExpand, onShowAll, fitKey }: {
  tables: LTable[]; more: Record<string, number>; sel: Sel; fitKey: string;
  onSelect: (s: Sel) => void; onExpand: (key: string) => void; onShowAll: (key: string) => void;
}) {
  const { nodes, edges } = useMemo(() => buildLineage(tables, more, sel, {
    onColumn: (table, column) => onSelect({ kind: "column", table, column }),
    onTable: (table) => onSelect({ kind: "table", table }),
    onMetric: (id) => onSelect({ kind: "metric", id }),
    onExpand, onShowAll,
  }), [tables, more, sel, onSelect, onExpand, onShowAll]);

  return (
    <ReactFlow key={fitKey} nodes={nodes} edges={edges} nodeTypes={nodeTypes}
      fitView fitViewOptions={{ padding: 0.12, maxZoom: 1, minZoom: 0.55 }} minZoom={0.2} maxZoom={1.6}
      nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} onlyRenderVisibleElements
      // node không kéo/chọn được thì React Flow tắt pointer-events; có onNodeClick để các nút bên trong node nhận click
      onNodeClick={() => {}}
      onPaneClick={() => onSelect(null)} proOptions={{ hideAttribution: true }} colorMode="dark">
      <Background gap={24} size={1} color="var(--color-line-strong)" />
      <Controls showInteractive={false} position="bottom-left" />
    </ReactFlow>
  );
}
