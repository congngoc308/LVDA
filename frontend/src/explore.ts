import type { LTable } from "./components/LineageCanvas";

/** Kiểu dữ liệu của API /explore (tab Dữ liệu ở quy mô lớn). */

export interface Desc { description: string; status: "draft" | "approved"; source: "llm" | "human"; updated_by_name: string | null }
export interface Brief {
  name: string; schema: string; layer: number; object: "view" | "table"; domain: string; domain_label: string;
  description: string | null; description_status: string | null; drafts: number; pii: number; deprecated: boolean; columns: number; uses: number;
}
export interface DomainCard { key: string; label: string; tables: number; layers: Record<string, number>; pii: number; drafts: number; deprecated: number; uses: number }
export interface Home { tables: number; columns: number; views: number; max_layer: number; domains: DomainCard[]; popular: Brief[]; certified: (Brief & { metrics: number })[] }
export type SearchItem =
  | ({ kind: "table"; score: number } & Brief)
  | { kind: "column"; name: string; column: string; type: string; layer: number; domain_label: string; pii: boolean; deprecated: boolean; description: string | null; uses: number; score: number };
export interface SearchRes { total: number; by_layer: Record<string, number>; items: SearchItem[] }
export interface LineageRes { tables: LTable[]; more: Record<string, number>; max_layer: number }
export interface MetricRef { id: string; name_vi: string; status: string; role?: string; certified_at?: string | null; certified_by?: string | null }
export interface Trust {
  catalog_only: boolean; questions: number; sql_checks: number; green: number; yellow: number; held: number; caught: number;
  caught_rules: { rule: string; count: number }[]; metrics: MetricRef[];
}
export interface Impact {
  tables: { name: string; layer: number; domain_label: string }[]; tables_total: number; by_layer: Record<string, number>;
  columns: number; metrics: MetricRef[]; verified_queries: { id: number; question: string }[]; questions: number;
}
export interface Relationship { child: string; parent: string; keys: string[]; unique_when?: { column: string; value: unknown } }
export interface TableDetail extends Brief {
  description_obj: Desc | null; grain: string[]; sql: string | null; relationships: Relationship[]; upstream: string[]; downstream: string[];
  key: { keys: string[]; rows: number; distinct: number; unique: boolean } | null; trust: Trust; impact: Impact;
  columns_detail: { name: string; type: string; pii: boolean; description: Desc | null; parents: string[]; sources: string[]; metrics: MetricRef[] }[];
}
export interface ColumnDetail {
  table: Brief; column: string; type: string; pii: boolean; description: Desc | null; parents: string[]; sources: string[]; children: string[];
  metrics: MetricRef[]; trust: Trust; impact: Impact;
}

export const tablePath = (name: string) => `/data/${name.replace(".", "/")}`;
export const colPath = (full: string) => {
  const cut = full.lastIndexOf(".");
  return `${tablePath(full.slice(0, cut))}?col=${encodeURIComponent(full.slice(cut + 1))}`;
};

// Bảng vừa xem, lưu theo database trong trình duyệt (chỉ là tiện ích, mất cũng không sao)
const RECENT_MAX = 8;
export function recentTables(dbId: number): string[] {
  try { return JSON.parse(localStorage.getItem(`lvda.recent.${dbId}`) ?? "[]") as string[]; } catch { return []; }
}
export function pushRecent(dbId: number, name: string) {
  try {
    const next = [name, ...recentTables(dbId).filter((n) => n !== name)].slice(0, RECENT_MAX);
    localStorage.setItem(`lvda.recent.${dbId}`, JSON.stringify(next));
  } catch { /* trình duyệt chặn lưu trữ thì bỏ qua */ }
}
