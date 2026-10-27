import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

/** Nguồn ngoài + đồng bộ tăng dần: kiểu dữ liệu và hook theo dõi trạng thái (tự hỏi lại khi đang chạy). */

export type SourceKind = "postgres" | "mysql";
export interface SourceTableInfo {
  name: string; columns: { name: string; type: string }[]; primary_key: string[]; rows_estimate: number | null;
  readable: boolean; cursor_candidates: string[]; suggested_cursor: string | null;
}
export interface Inspect { server: string; schema: string; read_only: boolean; problems: string[]; tables: SourceTableInfo[]; masked: string }
export type Picks = Record<string, { on: boolean; cursor: string | null }>;

/** Kết quả kiểm tra 4 bước. `error.field`: ô nhập gây lỗi. Có `tables`... khi đã đăng nhập được. */
export interface CheckStep { id: "network" | "auth" | "readonly" | "schema"; label: string; status: "ok" | "fail" | "skip"; detail: string | null }
export interface CheckResult extends Partial<Inspect> { ok: boolean; checks: CheckStep[]; error: { message: string; field: string | null } | null }

export type Environment = "prod" | "staging" | "dev";
export const ENV_LABEL: Record<Environment | "builtin", string> = { prod: "Prod", staging: "Staging", dev: "Dev", builtin: "Có sẵn trong LVDA" };
/** Đoán môi trường từ host để đỡ một lần chọn: localhost/demo/dev → dev, stg/staging → staging, còn lại prod. */
export function guessEnv(host: string): Environment {
  const h = host.toLowerCase();
  if (/(^|[.-])(stg|staging|uat)([.-]|$)/.test(h)) return "staging";
  if (/localhost|127\.0\.0\.1|(^|[.-])(dev|demo|test|sandbox|local)([.-]|$)/.test(h)) return "dev";
  return "prod";
}

export type SourceStatus = "running" | "error" | "stale" | "paused" | "ok" | "never" | "builtin";
export interface SourceListItem {
  id: number; name: string; kind: SourceKind; environment: Environment | "builtin"; status: SourceStatus; host: string;
  database: string | null; tables: number; rows: number | null; last_ok_at: string | null; last_at: string | null;
  schedule_minutes: number | null; error: string | null; progress?: { done: number; total: number; trigger: SyncRun["trigger"] };
}
export interface SourceList { items: SourceListItem[]; counts: { all: number; error: number; running: number; stale: number } }
export const STATUS_DOT: Record<SourceStatus, string> = {
  running: "bg-accent", error: "bg-bad", stale: "bg-warn", paused: "bg-line-strong", ok: "bg-good", never: "bg-line-strong", builtin: "bg-navy/40",
};
export const SOURCE_STATUS_LABEL: Record<SourceStatus, string> = {
  running: "Đang sao chép", error: "Lỗi", stale: "Dữ liệu cũ", paused: "Tạm dừng", ok: "Đã đồng bộ", never: "Chưa đồng bộ", builtin: "Có sẵn",
};
/** Tiến độ một lần chép theo kế hoạch: bảng xong, dòng đã chép, ước tính tổng và thời gian còn lại (theo tốc độ thực tế). */
export function progressOf(run: SyncRun) {
  const plan = run.plan ?? run.tables.map((t) => ({ table: t.table, estimate: null }));
  const byName = new Map(run.tables.map((t) => [t.table, t]));
  const rows = plan.map((p) => {
    const t = byName.get(p.table);
    const state: "waiting" | "running" | "done" | "failed" = !t ? (run.current_table === p.table && run.status === "running" ? "running" : "waiting")
      : t.status === "running" ? "running" : t.status === "failed" ? "failed" : "done";
    // xong thì tổng = số dòng thật ở nguồn; đang chép thì ước tính của database (có thể lệch, nhất là MySQL)
    const total = t?.status !== "running" && t?.source_rows != null ? t.source_rows : Math.max(p.estimate ?? 0, t?.read ?? 0);
    return { table: p.table, state, read: t?.read ?? 0, total, exact: t?.source_rows != null && t.status !== "running", error: t?.error };
  });
  const done = rows.filter((r) => r.state === "done" || r.state === "failed").length;
  const read = rows.reduce((a, r) => a + r.read, 0);
  const total = rows.reduce((a, r) => a + r.total, 0);
  const elapsed = (Date.now() - new Date(run.started_at).getTime()) / 1000;
  const eta = run.status === "running" && read > 0 && total > read ? Math.round(((total - read) / read) * elapsed) : null;
  const pct = total ? Math.min(100, Math.round((read / total) * 100)) : rows.length && done === rows.length ? 100 : 0;
  return { rows, done, read, total, eta, pct };
}

/** Các ô của form kết nối. `params`: phần sau "?" của chuỗi dán vào (ví dụ sslmode=require), giữ nguyên khi ghép lại. */
export interface ConnFields { kind: SourceKind; host: string; port: string; database: string; user: string; password: string; schema: string; params: string }
export const DEFAULT_PORT: Record<SourceKind, string> = { postgres: "5432", mysql: "3306" };

/** Đọc chuỗi kết nối dán vào: postgres(ql)://, mysql://, kèm driver (postgresql+psycopg://) hoặc dạng JDBC
 *  (jdbc:postgresql://host/db?user=..&password=..). Trả null nếu không nhận ra. */
export function parseConnection(text: string): Partial<ConnFields> | null {
  const raw = text.trim().replace(/^jdbc:/i, "");
  const m = raw.match(/^([a-z0-9]+)(\+[a-z0-9]+)?:\/\//i);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const kind: SourceKind | null = scheme.startsWith("postgres") ? "postgres" : scheme === "mysql" || scheme === "mariadb" ? "mysql" : null;
  if (!kind) return null;
  let u: URL;
  try { u = new URL(raw.replace(m[0], "http://")); } catch { return null; }
  const q = new URLSearchParams(u.search);
  const user = decodeURIComponent(u.username) || q.get("user") || "";
  const password = decodeURIComponent(u.password) || q.get("password") || "";
  ["user", "password"].forEach((k) => q.delete(k));
  const schema = q.get("currentSchema") ?? q.get("schema") ?? "";
  ["currentSchema", "schema"].forEach((k) => q.delete(k));
  return {
    kind, host: u.hostname, port: u.port || DEFAULT_PORT[kind], database: decodeURIComponent(u.pathname.replace(/^\//, "")),
    user, password, schema, params: q.toString(),
  };
}

export function buildDsn(f: ConnFields) {
  const enc = encodeURIComponent;
  const scheme = f.kind === "postgres" ? "postgresql" : "mysql";
  return `${scheme}://${enc(f.user.trim())}:${enc(f.password)}@${f.host.trim()}:${f.port.trim() || DEFAULT_PORT[f.kind]}/${enc(f.database.trim())}${f.params ? `?${f.params}` : ""}`;
}

/** Mặc định hợp lý: mọi bảng đọc được, bảng có khóa thì dùng cột mốc gợi ý (updated_at...). */
export function defaultPicks(tables: SourceTableInfo[]): Picks {
  return Object.fromEntries(tables.map((t) => [t.name, { on: t.readable, cursor: t.primary_key.length ? t.suggested_cursor : null }]));
}

/** Những bảng cần người dùng để ý, gom thành vài dòng ngắn thay vì bắt đọc cả bảng. */
export function attention(tables: SourceTableInfo[], picks: Picks) {
  const on = tables.filter((t) => picks[t.name]?.on);
  return {
    chosen: on,
    incremental: on.filter((t) => picks[t.name]?.cursor),
    full: on.filter((t) => !picks[t.name]?.cursor),
    noKey: on.filter((t) => !t.primary_key.length),
    unreadable: tables.filter((t) => !t.readable),
  };
}
export const needsAttention = (t: SourceTableInfo, picks: Picks) => !t.readable || !t.primary_key.length || (picks[t.name]?.on && !picks[t.name]?.cursor);
export type RunMode = "incremental" | "initial" | "refresh" | "full";
export interface RunTable {
  table: string; mode: RunMode; read: number; inserted: number; updated: number; from: string | null; to: string | null;
  status: "ok" | "failed" | "running"; error?: string; source_rows?: number; target_rows?: number; drift?: number; ms?: number;
}
export interface SyncRun {
  id: number; trigger: "initial" | "manual" | "schedule"; full_refresh: boolean; status: "running" | "ok" | "partial" | "failed";
  current_table: string | null; tables: RunTable[]; plan: { table: string; estimate: number | null }[] | null;
  error: string | null; started_at: string; finished_at: string | null;
  ms: number | null; started_by_name: string | null;
}
export interface SourceTable {
  name: string; keys: string[]; cursor_column: string | null; enabled: boolean; source_rows: number | null; target_rows: number | null;
  last_synced_at: string | null; last_status: string | null; last_error: string | null; mode: "incremental" | "full";
  watermark_label: string | null; drift: number | null;
}
export interface SourceState {
  name: string; paused: boolean; environment: Environment;
  kind: SourceKind; dsn_masked: string; source_schema: string; target_schema: string; schedule_minutes: number;
  lookback_minutes: number; last_run_at: string | null; next_run_at: string | null; created_at: string;
  tables: SourceTable[]; runs: SyncRun[]; running: SyncRun | null;
}

export const KIND_LABEL: Record<SourceKind, string> = { postgres: "PostgreSQL", mysql: "MySQL" };
export const SCHEDULES: [number, string][] = [[0, "Tắt, chỉ bấm tay"], [15, "Mỗi 15 phút"], [60, "Mỗi giờ"], [1440, "Mỗi ngày"]];
export const MODE_LABEL: Record<RunMode, string> = {
  incremental: "Tăng dần", initial: "Chép lần đầu", refresh: "Làm mới toàn bộ", full: "Làm mới toàn bộ",
};
export const TRIGGER_LABEL: Record<SyncRun["trigger"], string> = { initial: "Lần đầu", manual: "Bấm tay", schedule: "Theo lịch" };
export const STATUS_LABEL: Record<SyncRun["status"], string> = { running: "Đang chạy", ok: "Thành công", partial: "Một phần lỗi", failed: "Thất bại" };
export const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("vi-VN"));
/** Mốc đồng bộ: thời điểm có múi giờ thì hiện theo giờ máy người xem; thời điểm không múi giờ (MySQL DATETIME) và số giữ nguyên. */
export function fmtMark(v: string | null | undefined) {
  if (!v) return "—";
  if (/T.*(Z|[+-]\d\d:\d\d)$/.test(v)) return new Date(v).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "medium" });
  return v.replace("T", " ").slice(0, 19);
}

export function totals(run: SyncRun) {
  return run.tables.reduce((a, t) => ({ read: a.read + t.read, inserted: a.inserted + t.inserted, updated: a.updated + t.updated }),
    { read: 0, inserted: 0, updated: 0 });
}

/** Trạng thái nguồn của một database. Khi có lần chạy đang diễn ra thì hỏi lại mỗi giây để thấy tiến độ từng bảng. */
export function useSource(dbId: number | null, enabled = true) {
  const [state, setState] = useState<SourceState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!dbId || !enabled) return;
    try { setState(await api<SourceState>(`/db/${dbId}/source`)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Không đọc được trạng thái đồng bộ."); }
  }, [dbId, enabled]);
  useEffect(() => { setState(null); void load(); }, [load]);
  const running = !!state?.running;
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(load, running ? 1000 : 30000);
    return () => clearInterval(t);
  }, [load, running, enabled]);
  return { state, error, reload: load };
}
