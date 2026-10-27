import { Database, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { SourceDetail } from "../components/SyncPanel";
import { Button, cx, Drawer, ErrorNote, timeAgo , useWide } from "../components/ui";
import { useSession } from "../session";
import { ENV_LABEL, type SourceList, type SourceListItem, STATUS_DOT, SOURCE_STATUS_LABEL } from "../sources";

type Filter = "all" | "error" | "running" | "stale";
const FILTERS: [Filter, string][] = [["all", "Tất cả"], ["error", "Lỗi"], ["running", "Đang sao chép"], ["stale", "Dữ liệu cũ"]];
const GROUPS = ["prod", "staging", "dev", "builtin"] as const;

/** Số dòng gọn: 5,72 tr · 940 N · 120. */
function compact(n: number | null) {
  if (n == null) return "—";
  if (n >= 1e6) return `${(n / 1e6).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} tr`;
  if (n >= 1e3) return `${Math.round(n / 1e3).toLocaleString("vi-VN")} N`;
  return n.toLocaleString("vi-VN");
}

function SyncCell({ s }: { s: SourceListItem }) {
  if (s.status === "running") return <span className="text-accent">Đang chép {s.progress ? `${s.progress.done}/${s.progress.total}` : "…"}</span>;
  if (s.status === "error") return <span className="text-bad" title={s.error ?? undefined}>Lỗi{s.last_at ? ` · ${timeAgo(s.last_at)}` : ""}</span>;
  if (s.status === "builtin") return <span className="text-muted">Có sẵn</span>;
  if (s.status === "never") return <span className="text-muted">Chưa đồng bộ</span>;
  if (s.status === "paused") return <span className="text-muted">Tạm dừng{s.last_ok_at ? ` · ${timeAgo(s.last_ok_at)}` : ""}</span>;
  return <span className={s.status === "stale" ? "text-warn" : "text-good"}>{s.last_ok_at ? timeAgo(s.last_ok_at) : "—"}</span>;
}

/** Nguồn dữ liệu: mọi database bạn quản lý, nhóm theo môi trường, lọc nhanh nguồn lỗi / đang chép / dữ liệu cũ; chi tiết bên phải. */
export default function SourcesPage() {
  const { canConnect, databases, refresh, selectDb } = useSession();
  const nav = useNavigate();
  const wide = useWide();
  const [params, setParams] = useSearchParams();
  const selected = params.get("id") ? Number(params.get("id")) : null;
  const [list, setList] = useState<SourceList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(() => {
    api<SourceList>("/sources").then((r) => { setList(r); setError(null); }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { if (canConnect) load(); }, [canConnect, load]);
  const anyRunning = !!list?.counts.running;
  useEffect(() => {
    if (!canConnect) return;
    const t = setInterval(load, anyRunning ? 2000 : 30000);
    return () => clearInterval(t);
  }, [canConnect, load, anyRunning]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (list?.items ?? []).filter((i) => (filter === "all" || i.status === filter)
      && (!s || [i.name, i.host, i.database ?? ""].some((v) => v.toLowerCase().includes(s))));
  }, [list, q, filter]);
  const item = list?.items.find((i) => i.id === selected) ?? null;
  const select = (id: number | null) => setParams(id ? { id: String(id) } : {});
  const openData = (id: number) => { selectDb(id); nav("/data"); };
  const synced = (list?.items ?? []).filter((i) => i.status !== "builtin").length;

  if (!canConnect) return <div className="p-8 text-muted">Chỉ engineer mới quản lý nguồn dữ liệu.</div>;

  const detail = item && (item.status === "builtin" ? (
    <div className="flex flex-col gap-3 p-5">
      <div className="text-[11.5px] text-muted">{ENV_LABEL.builtin}</div>
      <h2 className="text-[18px] font-semibold tracking-tight">{item.name}</h2>
      <p className="text-[13px] text-muted">Database này nằm sẵn trong kho của LVDA ({item.tables} bảng), không đồng bộ từ nguồn ngoài nên không có lịch, lịch sử hay cài đặt kết nối.</p>
      <Button className="self-start" onClick={() => openData(item.id)}>Mở dữ liệu</Button>
    </div>
  ) : (
    <SourceDetail key={item.id} dbId={item.id} canAdmin={databases.find((d) => d.id === item.id)?.granted_via === "direct"}
      onChanged={load} onOpenData={() => openData(item.id)}
      onDisconnected={async () => { select(null); await refresh(); load(); }} />
  ));

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-paper px-6 py-4">
        <h1 className="text-[20px] font-semibold tracking-tight">Nguồn dữ liệu</h1>
        <span className="num rounded-full bg-sunk px-2 text-[12px] text-muted">{list?.counts.all ?? "…"}</span>
        <Button variant="primary" className="ml-auto" onClick={() => nav("/sources/connect")}><Plus size={15} /> Kết nối database</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper px-6 py-2.5">
        <label className="relative w-full max-w-[320px]">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên, host, database…" aria-label="Tìm nguồn"
            className="h-8 w-full rounded-md border border-line bg-surface pl-8 pr-2 text-[13px]" />
        </label>
        <div role="tablist" aria-label="Lọc theo trạng thái" className="flex rounded-md border border-line p-0.5">
          {FILTERS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
              className={cx("rounded px-2.5 py-1 text-[12.5px]", filter === k ? "bg-sunk font-medium text-ink" : "text-muted hover:text-ink")}>
              {l} <span className={cx("num", k === "error" && list?.counts.error ? "text-bad" : "")}>{list ? list.counts[k] : ""}</span>
            </button>
          ))}
        </div>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className={cx("grid min-h-0 flex-1", wide && "grid-cols-[minmax(0,1fr)_440px]")}>
        <div className="scroll-thin min-h-0 overflow-y-auto">
          {!list ? <div className="flex flex-col gap-1.5 p-6">{[0, 1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-sunk" />)}</div> : (
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10 bg-paper text-left text-[11.5px] uppercase tracking-wide text-muted">
                <tr><th className="w-11 py-2 pl-6" /><th className="py-2 pr-3 font-medium">Tên</th><th className="hidden px-3 py-2 font-medium md:table-cell">Host</th>
                  <th className="px-3 py-2 text-right font-medium">Bảng</th><th className="px-3 py-2 text-right font-medium">Dòng</th><th className="px-3 py-2 pr-6 font-medium">Đồng bộ</th></tr>
              </thead>
              {GROUPS.map((g) => {
                const rows = shown.filter((i) => i.environment === g);
                if (!rows.length) return null;
                return (
                  <tbody key={g}>
                    <tr><td colSpan={6} className="px-6 pb-1 pt-4 text-[11.5px] font-semibold uppercase tracking-wider text-muted">{ENV_LABEL[g]} · {rows.length}</td></tr>
                    {rows.map((s) => (
                      <tr key={s.id} onClick={() => select(s.id)} aria-selected={s.id === selected}
                        className={cx("cursor-pointer border-t border-line hover:bg-sunk/50", s.id === selected && "bg-accent-soft/50 shadow-[inset_3px_0_0_var(--color-accent)]")}>
                        <td className="py-2.5 pl-6"><span className={cx("block size-2 rounded-full", STATUS_DOT[s.status])} title={SOURCE_STATUS_LABEL[s.status]} /></td>
                        <td className="py-2.5 pr-3">
                          <button className="text-left font-medium hover:text-accent" onClick={(e) => { e.stopPropagation(); select(s.id); }}>{s.name}</button>
                          <span className="ml-1.5 rounded bg-sunk px-1 font-mono text-[10.5px] text-muted">{s.kind === "postgres" ? "PG" : "MY"}</span>
                        </td>
                        <td className="hidden px-3 py-2.5 font-mono text-[12px] text-muted md:table-cell">{s.host}{s.database ? <span className="text-faint"> / {s.database}</span> : null}</td>
                        <td className="num px-3 py-2.5 text-right">{s.tables}</td>
                        <td className="num px-3 py-2.5 text-right text-muted">{compact(s.rows)}</td>
                        <td className="px-3 py-2.5 pr-6 text-[12.5px]"><SyncCell s={s} /></td>
                      </tr>
                    ))}
                  </tbody>
                );
              })}
              {shown.length === 0 && <tbody><tr><td colSpan={6} className="px-6 py-10 text-center text-[13px] text-muted">Không có nguồn nào khớp bộ lọc.</td></tr></tbody>}
            </table>
          )}
          {list && synced === 0 && filter === "all" && !q && (
            <div className="m-6 flex flex-col items-start gap-2 rounded-lg border border-dashed border-line-strong p-5">
              <Database size={20} className="text-faint" />
              <h2 className="font-semibold">Chưa có nguồn nào được đồng bộ</h2>
              <p className="max-w-xl text-[13px] text-muted">Kết nối một Postgres hoặc MySQL bằng role chỉ đọc. LVDA chép các bảng bạn chọn vào kho riêng, rồi mỗi lần chỉ lấy dòng mới hoặc vừa sửa theo cột updated_at.</p>
              <Button variant="primary" onClick={() => nav("/sources/connect")}><Plus size={15} /> Kết nối database</Button>
            </div>
          )}
        </div>
        {wide && (
          <aside className="min-h-0 border-l border-line bg-surface" aria-label="Chi tiết nguồn">
            {detail ?? <div className="grid h-full place-items-center px-8 text-center text-[13px] text-muted">Chọn một nguồn để xem bảng, lịch sử đồng bộ và cài đặt.</div>}
          </aside>
        )}
      </div>
      {!wide && <Drawer open={!!item} onClose={() => select(null)} width={560} title={item?.name ?? ""}>{detail}</Drawer>}
    </div>
  );
}
