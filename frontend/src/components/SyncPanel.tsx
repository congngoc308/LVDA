import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Database, Eye, EyeOff, KeyRound, ListPlus, Loader2, Pause, Play, RefreshCcw, Unplug, X, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import {
  ENV_LABEL, type Environment, fmtMark, type Inspect, KIND_LABEL, MODE_LABEL, num, type Picks, type SourceTableInfo, SCHEDULES, STATUS_LABEL, type SyncRun, progressOf, totals, TRIGGER_LABEL, useSource, type RunTable,
} from "../sources";
import { TablePicker } from "./TablePicker";
import { Button, cx, ErrorNote, fmtDate, Modal, Pill, timeAgo } from "./ui";

const tone = (s: SyncRun["status"]) => (s === "ok" ? "good" : s === "running" ? "accent" : s === "partial" ? "warn" : "bad") as "good" | "accent" | "warn" | "bad";

function TableIcon({ t }: { t: RunTable }) {
  if (t.status === "running") return <Loader2 size={14} className="animate-spin text-accent" aria-label="Đang chép" />;
  if (t.status === "failed") return <XCircle size={14} className="text-bad" aria-label="Lỗi" />;
  if (t.drift) return <AlertTriangle size={14} className="text-warn" aria-label="Lệch số dòng" />;
  return <CheckCircle2 size={14} className="text-good" aria-label="Xong" />;
}

/** Kết quả từng bảng trong một lần đồng bộ: cách chép, số dòng đọc / thêm / sửa, mốc trước → sau, lệch số dòng. */
export function RunTables({ run }: { run: SyncRun }) {
  const rows = run.tables;
  const pendingCurrent = run.status === "running" && run.current_table && !rows.some((t) => t.table === run.current_table);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead className="text-left text-[11.5px] text-muted">
          <tr><th className="py-1 pr-2 font-medium">Bảng</th><th className="px-2 py-1 font-medium">Cách chép</th>
            <th className="px-2 py-1 text-right font-medium">Đọc</th><th className="px-2 py-1 text-right font-medium">Thêm</th>
            <th className="px-2 py-1 text-right font-medium">Sửa</th><th className="px-2 py-1 font-medium">Mốc</th></tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.table} className="border-t border-line align-top">
              <td className="py-1.5 pr-2">
                <span className="flex items-center gap-1.5 font-mono"><TableIcon t={t} />{t.table}</span>
                {t.error && <span className="mt-0.5 block text-[12px] text-bad">{t.error}</span>}
                {!!t.drift && <span className="mt-0.5 block text-[12px] text-warn">Bản sao {t.drift > 0 ? "nhiều" : "ít"} hơn nguồn {num(Math.abs(t.drift))} dòng{t.drift > 0 ? ": có thể đã xóa ở nguồn" : ""}</span>}
              </td>
              <td className="px-2 py-1.5 text-ink-2">{MODE_LABEL[t.mode]}</td>
              <td className="num px-2 py-1.5 text-right">{num(t.read)}</td>
              <td className="num px-2 py-1.5 text-right">{num(t.inserted)}</td>
              <td className="num px-2 py-1.5 text-right">{num(t.updated)}</td>
              <td className="num whitespace-nowrap px-2 py-1.5 text-[11.5px] text-muted">{t.mode === "incremental" ? <>{fmtMark(t.from)} → {t.to ? fmtMark(t.to) : "…"}</> : t.to ? <>→ {fmtMark(t.to)}</> : "—"}</td>
            </tr>
          ))}
          {pendingCurrent && (
            <tr className="border-t border-line"><td colSpan={6} className="py-1.5"><span className="flex items-center gap-1.5 font-mono text-muted"><Loader2 size={14} className="animate-spin" />{run.current_table}</span></td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RunRow({ run }: { run: SyncRun }) {
  const [open, setOpen] = useState(false);
  const t = totals(run);
  return (
    <li className="border-t border-line first:border-t-0">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-2.5 gap-y-1 py-2 text-left text-[12.5px] hover:bg-sunk/40">
        {open ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
        <span className="w-[118px] shrink-0 text-ink-2">{fmtDate(run.started_at)}</span>
        <Pill tone={tone(run.status)}>{STATUS_LABEL[run.status]}</Pill>
        <span className="text-muted">{TRIGGER_LABEL[run.trigger]}{run.full_refresh ? " · làm mới toàn bộ" : ""}</span>
        <span className="num ml-auto text-muted">đọc {num(t.read)} · thêm {num(t.inserted)} · sửa {num(t.updated)}{run.ms != null ? ` · ${(run.ms / 1000).toFixed(1)} s` : ""}</span>
      </button>
      {open && (
        <div className="pb-3 pl-6">
          {run.error && <ErrorNote>{run.error}</ErrorNote>}
          <RunTables run={run} />
        </div>
      )}
    </li>
  );
}

type SavedInspect = Omit<Inspect, "tables"> & { tables: (SourceTableInfo & { synced: boolean; cursor: string | null })[] };

/** Thêm / bớt bảng, đổi cột mốc: đọc lại danh sách bảng ở nguồn bằng kết nối đã lưu. */
export function TablesEditor({ dbId, onDone }: { dbId: number; onDone: (note: string) => void }) {
  const [info, setInfo] = useState<SavedInspect | null>(null);
  const [picks, setPicks] = useState<Picks>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api<NonNullable<typeof info>>(`/db/${dbId}/source/inspect`).then((r) => {
      setInfo(r);
      setPicks(Object.fromEntries(r.tables.map((t) => [t.name, t.synced ? { on: true, cursor: t.cursor } : { on: false, cursor: t.primary_key.length ? t.suggested_cursor : null }])));
    }).catch((e) => setError(e.message));
  }, [dbId]);
  if (error && !info) return <ErrorNote>{error}</ErrorNote>;
  if (!info) return <p className="inline-flex items-center gap-1.5 text-[12.5px] text-muted"><Loader2 size={14} className="animate-spin" /> Đang đọc danh sách bảng ở nguồn…</p>;
  const synced = new Set(info.tables.filter((t) => t.synced).map((t) => t.name));
  const removing = [...synced].filter((n) => !picks[n]?.on);
  const save = async () => {
    if (removing.length && !window.confirm(`Xóa ${removing.length} bảng khỏi bản sao trong LVDA (${removing.join(", ")})? Bảng ở nguồn không bị đụng tới.`)) return;
    setSaving(true); setError(null);
    try {
      const r = await api<{ added: string[]; removed: string[]; changed: string[] }>(`/db/${dbId}/source/tables`, {
        method: "PUT", body: { tables: info.tables.filter((t) => picks[t.name]?.on).map((t) => ({ name: t.name, cursor: picks[t.name].cursor })) },
      });
      const parts = [r.added.length && `thêm ${r.added.length} bảng`, r.removed.length && `bỏ ${r.removed.length} bảng`, r.changed.length && `đổi cột mốc ${r.changed.length} bảng`].filter(Boolean);
      onDone(parts.length ? `Đã ${parts.join(", ")}.${r.added.length || r.changed.length ? " Đang chép dữ liệu." : ""}` : "Không có thay đổi.");
    } catch (e) { setError(e instanceof Error ? e.message : "Không lưu được."); }
    finally { setSaving(false); }
  };
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-paper p-3">
      <TablePicker tables={info.tables} picks={picks} onChange={setPicks} synced={synced} />
      <ErrorNote>{error}</ErrorNote>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => onDone("")}>Huỷ</Button>
        <Button size="sm" variant="primary" disabled={saving || !Object.values(picks).some((p) => p.on)} onClick={save}>{saving ? "Đang lưu…" : "Lưu thay đổi"}</Button>
      </div>
    </div>
  );
}

/** Đổi user / mật khẩu khi nguồn đổi mật khẩu. LVDA kiểm lại kết nối và quyền chỉ đọc trước khi lưu. */
export function CredentialsEditor({ dbId, masked, onDone }: { dbId: number; masked: string; onDone: (note: string) => void }) {
  const [user, setUser] = useState(masked.split("@")[0]);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<{ message: string; field: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true); setErr(null);
    try { await api(`/db/${dbId}/source/credentials`, { method: "PUT", body: { user: user.trim() || null, password } }); onDone("Đã cập nhật thông tin đăng nhập."); }
    catch (e) {
      const d = e instanceof ApiError ? (e.detail as { field?: string | null } | null) : null;
      setErr({ message: e instanceof Error ? e.message : "Không lưu được.", field: d && typeof d === "object" ? d.field ?? null : null });
    } finally { setSaving(false); }
  };
  const bad = (k: string) => err?.field === k;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-paper p-3 text-[13px]">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1"><span className="font-medium">User</span>
          <input value={user} onChange={(e) => setUser(e.target.value)} className={cx("h-8 rounded-md border bg-surface px-2 font-mono text-[12.5px]", bad("user") ? "border-bad" : "border-line")} />
        </label>
        <div className="flex flex-col gap-1"><label htmlFor="cred-pw" className="font-medium">Mật khẩu mới</label>
          <span className="flex gap-1.5">
            <input id="cred-pw" type={show ? "text" : "password"} value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)}
              className={cx("h-8 w-full rounded-md border bg-surface px-2 font-mono text-[12.5px]", bad("password") ? "border-bad" : "border-line")} />
            <Button size="sm" type="button" onClick={() => setShow(!show)} aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>{show ? <EyeOff size={14} /> : <Eye size={14} />}</Button>
          </span>
        </div>
      </div>
      {err && <span role="alert" className="text-[12.5px] text-bad">{err.message}</span>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => onDone("")}>Huỷ</Button>
        <Button size="sm" variant="primary" disabled={saving || !password} onClick={save}>{saving ? "Đang kiểm tra…" : "Kiểm tra và lưu"}</Button>
      </div>
    </div>
  );
}

const fmtEta = (s: number) => (s < 60 ? `${s} giây` : s < 3600 ? `${Math.round(s / 60)} phút` : `${(s / 3600).toFixed(1)} giờ`);
const ROW_STATE: Record<"waiting" | "running" | "done" | "failed", [string, string]> = {
  waiting: ["Đang chờ", "text-muted"], running: ["Đang chép", "text-accent"], done: ["Xong", "text-good"], failed: ["Lỗi", "text-bad"],
};

/** Tiến độ một lần chép: bảng xong, dòng đã chép, thời gian còn lại ước tính, thanh tiến độ từng bảng. */
export function CopyProgress({ run, title }: { run: SyncRun; title?: React.ReactNode }) {
  const p = progressOf(run);
  const finished = run.status !== "running";
  return (
    <div className="flex flex-col gap-4">
      {title}
      <div className="grid grid-cols-3 gap-4">
        <div><div className="text-[12px] text-muted">Bảng xong</div><div className="num text-[22px] font-medium">{p.done}/{p.rows.length}</div></div>
        <div><div className="text-[12px] text-muted">Dòng đã chép</div><div className="num text-[22px] font-medium">{num(p.read)}</div></div>
        <div><div className="text-[12px] text-muted">Còn lại ước tính</div>
          <div className="text-[22px] font-medium">{finished ? (run.status === "failed" ? "Dừng" : "Xong") : p.eta != null ? fmtEta(p.eta) : "…"}</div></div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-sunk" role="progressbar" aria-label="Tiến độ sao chép" aria-valuenow={finished ? 100 : p.pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={cx("h-full rounded-full transition-[width] duration-500", run.status === "failed" ? "bg-bad" : "bg-accent")} style={{ width: `${finished ? 100 : Math.max(p.pct, 2)}%` }} />
      </div>
      {run.error && <ErrorNote>{run.error}</ErrorNote>}
      {p.rows.length === 0 && !finished && <p className="inline-flex items-center gap-1.5 text-[12.5px] text-muted"><Loader2 size={13} className="animate-spin" /> Đang chuẩn bị danh sách bảng…</p>}
      <ul className="flex flex-col">
        {p.rows.map((r) => {
          const pct = r.state === "done" ? 100 : r.total ? Math.min(100, (r.read / r.total) * 100) : 0;
          return (
            <li key={r.table} className="grid grid-cols-[18px_minmax(0,150px)_1fr_150px_64px] items-center gap-3 border-t border-line py-2 text-[12.5px] first:border-t-0">
              {r.state === "done" ? <CheckCircle2 size={14} className="text-good" /> : r.state === "failed" ? <XCircle size={14} className="text-bad" />
                : r.state === "running" ? <Loader2 size={14} className="animate-spin text-accent" /> : <span className="size-2 justify-self-center rounded-full bg-line-strong" />}
              <span className="truncate font-mono" title={r.error ?? r.table}>{r.table}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-sunk">
                <span className={cx("block h-full rounded-full", r.state === "failed" ? "bg-bad" : r.state === "done" ? "bg-good" : "bg-accent")} style={{ width: `${pct}%` }} />
              </span>
              <span className="num text-right text-muted">{num(r.read)} / {r.exact ? "" : "~"}{num(r.total)}</span>
              <span className={cx("text-right", ROW_STATE[r.state][1])}>{ROW_STATE[r.state][0]}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type Tab = "tables" | "runs" | "settings";

/** Chi tiết một nguồn (trang Nguồn dữ liệu): đầu trang + 3 tab Bảng / Lịch sử đồng bộ / Cài đặt. */
export function SourceDetail({ dbId, canAdmin, onChanged, onDisconnected, onOpenData }: {
  dbId: number; canAdmin: boolean; onChanged: () => void; onDisconnected: () => void; onOpenData: () => void;
}) {
  const { state, error: loadError, reload } = useSource(dbId);
  const [tab, setTab] = useState<Tab>("tables");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<"tables" | "credentials" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [form, setForm] = useState<{ name: string; environment: Environment; schedule: number; lookback: number } | null>(null);
  useEffect(() => { setTab("tables"); setEditing(null); setNote(null); setError(null); setForm(null); }, [dbId]);
  useEffect(() => {
    if (state && !form) setForm({ name: state.name, environment: state.environment, schedule: state.schedule_minutes, lookback: state.lookback_minutes });
  }, [state, form]);
  const wasRunning = useRef(false);
  useEffect(() => { if (wasRunning.current && !state?.running) onChanged(); wasRunning.current = !!state?.running; }, [state?.running, onChanged]);

  if (loadError) return <div className="p-5"><ErrorNote>{loadError}</ErrorNote></div>;
  if (!state || !form) return <div className="p-5 text-[13px] text-muted" aria-busy="true">Đang tải…</div>;

  const call = async (fn: () => Promise<unknown>, fail: string, ok?: string) => {
    setBusy(true); setError(null); setNote(null);
    try { await fn(); reload(); onChanged(); if (ok) setNote(ok); } catch (e) { setError(e instanceof Error ? e.message : fail); } finally { setBusy(false); }
  };
  const run = (full: boolean) => {
    if (full && !window.confirm("Làm mới toàn bộ sẽ chép lại mọi bảng từ đầu (dùng khi nguồn có xóa dòng). Tiếp tục?")) return;
    void call(() => api(`/db/${dbId}/source/sync`, { body: { full } }), "Không chạy được.");
  };
  const done = (msg: string) => { setEditing(null); if (msg) { setNote(msg); onChanged(); } reload(); };
  const disconnect = async () => {
    setBusy(true); setError(null);
    try {
      await api(`/db/${dbId}/source?confirm=${encodeURIComponent(confirmName)}`, { method: "DELETE" });
      setConfirmOpen(false);
      onDisconnected();
    } catch (e) { setError(e instanceof Error ? e.message : "Không ngắt kết nối được."); setBusy(false); }
  };
  const last = state.runs.find((r) => r.status !== "running");
  const drifted = state.tables.filter((t) => t.drift);
  const status = state.running ? "running" : last && last.status !== "ok" ? "error" : state.paused ? "paused" : last ? "ok" : "never";
  const settingsDirty = form.name.trim() !== state.name || form.environment !== state.environment
    || form.schedule !== state.schedule_minutes || form.lookback !== state.lookback_minutes;
  const host = state.dsn_masked.split("@")[1] ?? state.dsn_masked;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-2 border-b border-line px-5 py-4">
        <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
          <span className="rounded bg-sunk px-1 font-mono text-[10.5px]">{state.kind === "postgres" ? "PG" : "MY"}</span>
          {ENV_LABEL[state.environment].toLowerCase()} · {KIND_LABEL[state.kind]}
        </div>
        <h2 className="text-[18px] font-semibold tracking-tight">{state.name}</h2>
        <div className="font-mono text-[12px] text-muted">{host.replace(/:\d+\//, " / ").replace(/:\d+$/, "")} · schema {state.source_schema}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={status === "ok" ? "good" : status === "running" ? "accent" : status === "error" ? "bad" : "neutral"}>
            {status === "running" ? <Loader2 size={12} className="animate-spin" /> : null}
            {status === "ok" ? "Đã đồng bộ" : status === "running" ? "Đang sao chép" : status === "error" ? "Lỗi lần gần nhất" : status === "paused" ? "Lịch tạm dừng" : "Chưa đồng bộ"}
          </Pill>
          {last && !state.running && <span className="text-[12px] text-muted">{timeAgo(last.finished_at ?? last.started_at)}</span>}
          <span className="ml-auto flex gap-1.5">
            <Button size="sm" variant="primary" disabled={busy || !!state.running} onClick={() => run(false)}><RefreshCcw size={13} /> Đồng bộ ngay</Button>
            <Button size="sm" onClick={onOpenData}>Mở dữ liệu</Button>
          </span>
        </div>
      </header>
      <div className="flex gap-4 border-b border-line px-5 text-[13px]" role="tablist">
        {([["tables", `Bảng ${state.tables.length}`], ["runs", "Lịch sử đồng bộ"], ["settings", "Cài đặt"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cx("-mb-px border-b-2 py-2.5", tab === k ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-ink")}>{l}</button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-5">
          <ErrorNote>{error}</ErrorNote>
          {note && <p role="status" className="rounded-md border border-good/30 bg-good-soft px-3 py-2 text-[12.5px] text-good">{note}</p>}
          {state.running && tab !== "settings" && (
            <section className="rounded-lg border border-accent/30 bg-accent-soft/30 p-4">
              <CopyProgress run={state.running} title={<h3 className="text-[13px] font-semibold">{state.running.trigger === "initial" ? "Đang sao chép lần đầu" : "Đang đồng bộ"}</h3>} />
            </section>
          )}

          {tab === "tables" && (editing === "tables" ? <TablesEditor dbId={dbId} onDone={done} /> : <>
            {drifted.length > 0 && !state.running && (
              <div className="flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <span>{drifted.map((t) => t.name).join(", ")}: số dòng bản sao khác nguồn (nguồn có xóa dòng). Bấm “Làm mới toàn bộ” để khớp lại.</span>
              </div>
            )}
            <ul className="flex flex-col">
              {state.tables.map((t) => (
                <li key={t.name} className="grid grid-cols-[18px_1fr_auto_auto] items-center gap-3 border-t border-line py-2 text-[13px] first:border-t-0">
                  {t.last_status === "failed" ? <XCircle size={14} className="text-bad" /> : t.drift ? <AlertTriangle size={14} className="text-warn" />
                    : t.last_synced_at ? <CheckCircle2 size={14} className="text-good" /> : <span className="size-2 justify-self-center rounded-full bg-line-strong" />}
                  <span className="min-w-0">
                    <span className="font-mono">{t.name}</span>
                    <span className="block text-[11.5px] text-muted">{t.mode === "incremental" ? `tăng dần theo ${t.cursor_column}` : "làm mới toàn bộ"}{t.watermark_label ? ` · mốc ${fmtMark(t.watermark_label)}` : ""}</span>
                    {t.last_status === "failed" && <span className="block text-[12px] text-bad">{t.last_error}</span>}
                  </span>
                  <span className={cx("num text-right", t.drift ? "text-warn" : "")} title={t.drift ? `nguồn ${num(t.source_rows)} dòng` : undefined}>{num(t.target_rows)}</span>
                  <span className="w-[86px] text-right text-[12px] text-muted">{t.last_synced_at ? timeAgo(t.last_synced_at) : "chưa"}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              <Button size="sm" disabled={!!state.running} onClick={() => { setEditing("tables"); setNote(null); }}><ListPlus size={14} /> Thêm / bớt bảng</Button>
              <Button size="sm" variant="ghost" disabled={busy || !!state.running} onClick={() => run(true)}>Làm mới toàn bộ</Button>
            </div>
          </>)}

          {tab === "runs" && (state.runs.filter((r) => r.status !== "running").length === 0 ? <p className="text-[12.5px] text-muted">Chưa có lần đồng bộ nào xong.</p>
            : <ul>{state.runs.filter((r) => r.status !== "running").map((r) => <RunRow key={r.id} run={r} />)}</ul>)}

          {tab === "settings" && (
            <div className="flex flex-col gap-5 text-[13px]">
              <section className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1"><span className="font-medium">Tên</span>
                  <input className="h-9 rounded-md border border-line bg-surface px-2.5" value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1"><span className="font-medium">Môi trường</span>
                  <select className="h-9 rounded-md border border-line bg-surface px-2" value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value as Environment })}>
                    {(["prod", "staging", "dev"] as Environment[]).map((v) => <option key={v} value={v}>{ENV_LABEL[v]}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1"><span className="font-medium">Lịch đồng bộ</span>
                  <select className="h-9 rounded-md border border-line bg-surface px-2" value={form.schedule} onChange={(e) => setForm({ ...form, schedule: Number(e.target.value) })}>
                    {SCHEDULES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1"><span className="font-medium">Lùi mốc (phút)</span>
                  <input type="number" min={0} max={1440} className="num h-9 rounded-md border border-line bg-surface px-2.5" value={form.lookback}
                    onChange={(e) => setForm({ ...form, lookback: Math.max(0, Math.min(1440, Number(e.target.value) || 0)) })} />
                </label>
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Button size="sm" variant="primary" disabled={!settingsDirty || !form.name.trim() || busy}
                    onClick={() => call(() => api(`/db/${dbId}/source`, { method: "PUT", body: { name: form.name.trim(), environment: form.environment, schedule_minutes: form.schedule, lookback_minutes: form.lookback } }),
                      "Không lưu được.", "Đã lưu cài đặt.")}>Lưu cài đặt</Button>
                  {state.schedule_minutes > 0 && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => call(() => api(`/db/${dbId}/source/pause`, { method: "PUT", body: { paused: !state.paused } }), "Không đổi được.")}>
                      {state.paused ? <><Play size={14} /> Tiếp tục lịch</> : <><Pause size={14} /> Tạm dừng lịch</>}
                    </Button>
                  )}
                  {state.paused && <Pill tone="warn">Đang tạm dừng</Pill>}
                  {!state.paused && state.next_run_at && <span className="text-[12px] text-muted">lần tới khoảng {fmtDate(state.next_run_at)}</span>}
                </div>
              </section>
              {canAdmin && (
                <section className="flex flex-col gap-2 border-t border-line pt-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">Kết nối</h3>
                    <span className="font-mono text-[12px] text-muted">{state.dsn_masked}</span>
                    {editing !== "credentials" && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { setEditing("credentials"); setNote(null); }}><KeyRound size={14} /> Cập nhật mật khẩu</Button>}
                  </div>
                  {editing === "credentials" && <CredentialsEditor dbId={dbId} masked={state.dsn_masked} onDone={done} />}
                </section>
              )}
              {canAdmin && (
                <section className="flex flex-wrap items-center gap-3 rounded-md border border-bad/30 px-3 py-2.5">
                  <span className="min-w-0 flex-1 text-[12.5px] text-muted"><b className="text-ink">Ngắt kết nối</b>: xóa “{state.name}” khỏi LVDA cùng bản sao, lịch sử và quyền truy cập. Dữ liệu ở nguồn không bị đụng tới.</span>
                  <Button size="sm" variant="danger" disabled={!!state.running} onClick={() => { setConfirmName(""); setConfirmOpen(true); }}><Unplug size={14} /> Ngắt kết nối</Button>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Ngắt kết nối nguồn" width={480}
        footer={<><Button variant="ghost" onClick={() => setConfirmOpen(false)}>Huỷ</Button>
          <Button variant="danger" disabled={confirmName.trim() !== state.name || busy} onClick={disconnect}>Ngắt kết nối và xóa bản sao</Button></>}>
        <div className="flex flex-col gap-3 text-[13px]">
          <p>Database <b>{state.name}</b> sẽ bị xóa khỏi LVDA: {state.tables.length} bảng sao chép, lịch sử đồng bộ, dashboard và quyền của mọi thành viên. Không hoàn tác được.</p>
          <label className="flex flex-col gap-1"><span>Gõ <b>{state.name}</b> để xác nhận</span>
            <input autoFocus value={confirmName} onChange={(e) => setConfirmName(e.target.value)} className="h-9 rounded-md border border-line bg-surface px-2.5" />
          </label>
        </div>
      </Modal>
    </div>
  );
}

/** Dòng trạng thái ở đầu tab Dữ liệu: tiến độ, đồng bộ ngay, thông báo khi xong; quản lý chi tiết ở trang Nguồn dữ liệu. */
export function SourceBar({ dbId, onSynced }: { dbId: number; onSynced: () => void }) {
  const { state, error, reload } = useSource(dbId);
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ tone: "good" | "warn" | "bad"; text: string } | null>(null);
  const running = state?.running ?? null;
  const doneTables = running ? running.tables.filter((t) => t.status !== "running").length : -1;
  // bảng nào chép xong thì tab Dữ liệu tải lại để thấy ngay; lần chạy xong thì báo một dòng rồi tự ẩn
  const prevDone = useRef(doneTables);
  const prevRunning = useRef(!!running);
  useEffect(() => {
    if (doneTables > 0 && doneTables !== prevDone.current) onSynced();
    prevDone.current = doneTables;
  }, [doneTables, onSynced]);
  useEffect(() => {
    if (prevRunning.current && !running && state) {
      onSynced();
      const last = state.runs.find((r) => r.status !== "running");
      if (last) {
        const t = totals(last);
        setToast({ tone: last.status === "ok" ? "good" : last.status === "partial" ? "warn" : "bad",
          text: last.status === "failed" ? `Đồng bộ thất bại: ${last.error ?? "xem chi tiết"}`
            : `Đồng bộ xong · ${last.tables.length} bảng · đọc ${num(t.read)} dòng, thêm ${num(t.inserted)}, sửa ${num(t.updated)}` });
      }
    }
    prevRunning.current = !!running;
  }, [running, state, onSynced]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  if (error) return <div className="border-b border-line bg-paper px-6 py-2"><ErrorNote>{error}</ErrorNote></div>;
  if (!state) return <div className="h-[41px] border-b border-line bg-paper" aria-busy="true" />;
  const last = state.runs.find((r) => r.status !== "running");
  const drift = state.tables.filter((t) => t.drift).length;
  const syncNow = async () => {
    setBusy(true);
    try { await api(`/db/${dbId}/source/sync`, { body: { full: false } }); await reload(); } catch { nav(`/sources?id=${dbId}`); } finally { setBusy(false); }
  };
  const pct = running ? progressOf(running).pct : 0;
  return (
    <>
      <div className="relative border-b border-line bg-paper">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-6 py-2 text-[12.5px]">
          <Database size={14} className="text-muted" />
          <span><b>{KIND_LABEL[state.kind]}</b> <span className="font-mono text-[12px] text-muted">{state.dsn_masked}</span></span>
          {running ? (
            <span className="inline-flex items-center gap-1.5 text-accent"><Loader2 size={13} className="animate-spin" />
              {running.trigger === "initial" ? "Đang chép lần đầu" : "Đang đồng bộ"}{running.current_table ? <> bảng <span className="font-mono">{running.current_table}</span></> : "…"}
              <span className="num text-muted">({Math.max(doneTables, 0)}/{state.tables.length} bảng)</span></span>
          ) : last ? (
            <span className="text-muted">Lần cuối {timeAgo(last.finished_at ?? last.started_at)}: <span className={cx(last.status === "ok" ? "text-good" : last.status === "partial" ? "text-warn" : "text-bad")}>{STATUS_LABEL[last.status].toLowerCase()}</span>
              {" "}· đọc {num(totals(last).read)} dòng</span>
          ) : <span className="text-muted">Chưa đồng bộ</span>}
          <span className="text-muted">· {state.paused ? "lịch đang tạm dừng" : SCHEDULES.find(([v]) => v === state.schedule_minutes)?.[1].toLowerCase()}</span>
          {drift > 0 && !running && <Pill tone="warn">{drift} bảng lệch số dòng</Pill>}
          <span className="ml-auto flex gap-1.5">
            <Button size="sm" onClick={syncNow} disabled={busy || !!running}><RefreshCcw size={13} /> Đồng bộ ngay</Button>
            <Button size="sm" variant="ghost" onClick={() => nav(`/sources?id=${dbId}`)}>Chi tiết</Button>
          </span>
        </div>
        {running && (
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-accent-soft" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Tiến độ đồng bộ">
            <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(pct, 4)}%` }} />
          </div>
        )}
      </div>
      {toast && (
        <div role="status" className={cx("fixed bottom-5 right-5 z-50 flex max-w-[420px] items-start gap-2 rounded-lg border bg-surface px-3.5 py-2.5 text-[13px] shadow-lg",
          toast.tone === "good" ? "border-good/40" : toast.tone === "warn" ? "border-warn/40" : "border-bad/40")}>
          {toast.tone === "good" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-good" /> : <AlertTriangle size={16} className={cx("mt-0.5 shrink-0", toast.tone === "warn" ? "text-warn" : "text-bad")} />}
          <span className="flex-1">{toast.text}</span>
          <button onClick={() => setToast(null)} className="rounded p-0.5 text-muted hover:bg-sunk" aria-label="Đóng thông báo"><X size={14} /></button>
        </div>
      )}
    </>
  );
}
