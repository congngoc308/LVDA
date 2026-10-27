import { ApiError, getToken } from "./api";

/** Dashboard trang Đánh giá: kiểu dữ liệu, gọi API, và các phép biến đổi bố cục (thuần, dùng được cho hoàn tác). */

export type Size = "s" | "m" | "l" | "xl";
export type Chart = "number" | "bar" | "line" | "table";
export type Period = "all" | "2017" | "2018";
export interface CardSpec {
  id: string; kind: "metric"; title: string; metric_id: string; dimension: string | null;
  period: Period; chart: Chart; top: number | null; why: string | null;
}
export interface LayoutItem { id: string; size: Size; collapsed: boolean }
export interface Board { layout: LayoutItem[]; cards: CardSpec[]; tray: CardSpec[] }
export interface BoardRes extends Board { updated_at: string | null; updated_by_name: string | null; system: { id: string; title: string; size: Size }[] }
export interface Options {
  metrics: { id: string; name_vi: string; format: string | null; unit: string | null; dimensions: string[] }[];
  dimensions: Record<string, string>; periods: Record<Period, string>; charts: Record<Chart, string>;
}
export interface RenderRes {
  status: "ok" | "held" | "stale" | "invalid" | "error"; message?: string; checked_at: string; period_label: string;
  metric?: { id: string; name_vi: string; format: string | null; unit: string | null; version: number };
  verdict?: string; rules?: string[]; sql?: string; columns?: string[]; rows?: unknown[][];
}
export type DraftEvent =
  | { type: "start"; request_id: string }
  | { type: "running"; id: string; label: string }
  | { type: "step"; id: string; label: string; status: "ok" | "warn" | "fail"; detail: string; ms: number; assumptions?: string[] }
  | { type: "done"; cards: CardSpec[]; request_id: string; ms: number }
  | { type: "error"; message: string };
export interface Answers { goal: string; audience: string; cadence: string; focus: string }

export const isSystem = (id: string) => id.startsWith("sys:");
export const SIZE_LABEL: Record<Size, string> = { s: "Nhỏ", m: "Vừa", l: "Lớn", xl: "Hết hàng" };
// 12 cột: điện thoại 1 card một hàng, máy tính bảng 2, màn rộng theo cỡ đã chọn
export const SIZE_CLASS: Record<Size, string> = {
  s: "col-span-12 md:col-span-6 lg:col-span-4", m: "col-span-12 md:col-span-6",
  l: "col-span-12 lg:col-span-8", xl: "col-span-12",
};

export function newCardId() {
  return "c_" + Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, "0")).join("");
}
export function defaultChart(dimension: string | null): Chart {
  return dimension === null ? "number" : dimension === "month" ? "line" : "bar";
}
export function validCharts(dimension: string | null): Chart[] {
  if (dimension === null) return ["number"];
  return dimension === "month" ? ["line", "bar", "table"] : ["bar", "table"];
}

// ---- phép biến đổi bố cục (không đổi đối tượng cũ)
const without = <T extends { id: string }>(xs: T[], id: string) => xs.filter((x) => x.id !== id);

export function moveBefore(b: Board, id: string, beforeId: string | null): Board {
  const item = b.layout.find((i) => i.id === id);
  if (!item || id === beforeId) return b;
  const rest = without(b.layout, id);
  const at = beforeId === null ? rest.length : rest.findIndex((i) => i.id === beforeId);
  return { ...b, layout: [...rest.slice(0, at < 0 ? rest.length : at), item, ...rest.slice(at < 0 ? rest.length : at)] };
}
export function shift(b: Board, id: string, dir: -1 | 1): Board {
  const i = b.layout.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= b.layout.length) return b;
  const layout = [...b.layout];
  [layout[i], layout[j]] = [layout[j], layout[i]];
  return { ...b, layout };
}
export function patchItem(b: Board, id: string, patch: Partial<LayoutItem>): Board {
  return { ...b, layout: b.layout.map((i) => (i.id === id ? { ...i, ...patch } : i)) };
}
export function addFromTray(b: Board, id: string, beforeId: string | null = null): Board {
  const card = b.tray.find((c) => c.id === id);
  if (!card) return b;
  const next: Board = { layout: [...b.layout, { id, size: card.chart === "number" ? "s" : "m", collapsed: false }], cards: [...b.cards, card], tray: without(b.tray, id) };
  return beforeId ? moveBefore(next, id, beforeId) : next;
}
export function toTray(b: Board, id: string): Board {
  const card = b.cards.find((c) => c.id === id);
  if (!card) return b;
  return { layout: without(b.layout, id), cards: without(b.cards, id), tray: [card, ...b.tray] };
}
export function removeCard(b: Board, id: string): Board {
  return { layout: without(b.layout, id), cards: without(b.cards, id), tray: without(b.tray, id) };
}
export function upsertCard(b: Board, card: CardSpec): Board {
  if (b.cards.some((c) => c.id === card.id)) return { ...b, cards: b.cards.map((c) => (c.id === card.id ? card : c)) };
  if (b.tray.some((c) => c.id === card.id)) return { ...b, tray: b.tray.map((c) => (c.id === card.id ? card : c)) };
  return { ...b, tray: [card, ...b.tray] };
}

// ---- agent: đọc NDJSON từng dòng, mỗi dòng là một bước
export async function streamDraft(dbId: number, answers: Answers, onEvent: (e: DraftEvent) => void, signal: AbortSignal) {
  const token = getToken();
  const res = await fetch(`/api/db/${dbId}/dashboards/draft`, {
    method: "POST", signal, body: JSON.stringify(answers),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, typeof data?.detail === "string" ? data.detail : "Agent không chạy được.", data?.detail);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as DraftEvent);
    }
  }
}
