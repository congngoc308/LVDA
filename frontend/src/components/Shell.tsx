import { ChevronsUpDown, Database, FlaskConical, LogOut, MessageSquareText, Network, Users } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { api } from "../api";
import { useSession } from "../session";
import { cx } from "./ui";

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-[11px]">
      <div className="relative grid size-[34px] place-items-center rounded-[9px] bg-[linear-gradient(140deg,oklch(0.72_0.14_235),oklch(0.62_0.15_270))] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08),0_6px_18px_-6px_oklch(0.62_0.15_250/0.7)]" aria-hidden>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M4 6h16M4 12h10M4 18h7" /></svg>
        <span className="absolute -bottom-[3px] -right-[3px] size-3 rounded-full border-2 border-sidebar bg-good" />
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-[15px] font-bold tracking-[0.06em]">LVDA</span>
        <span className={cx("text-[12px]", light ? "text-ink-2" : "text-faint")}>Hỏi số, có phiếu kiểm</span>
      </div>
    </div>
  );
}
export function Shell({ children }: { children: ReactNode }) {
  const { user, db, databases, canConnect, selectDb, logout } = useSession();
  const [pending, setPending] = useState<number | null>(null);
  const [stale, setStale] = useState<number | null>(null);
  const eng = db?.role === "engineer";
  // số nguồn đang lỗi: hiện trên mục Nguồn dữ liệu để thấy ngay mà không phải mở trang
  const [sourceErrors, setSourceErrors] = useState<number | null>(null);
  useEffect(() => {
    if (!canConnect) return;
    let alive = true;
    const load = () => api<{ counts: { error: number } }>("/sources").then((r) => alive && setSourceErrors(r.counts.error)).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [canConnect]);
  const { pathname } = useLocation();

  useEffect(() => {
    if (!db) return;
    let alive = true;
    const load = () => api<{ pending_reviews: number | null; stale_metrics: number }>(`/db/${db.id}/overview`)
      .then((o) => { if (alive) { setPending(o.pending_reviews); setStale(o.stale_metrics); } }).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    window.addEventListener("lvda:reviews-changed", load);
    return () => { alive = false; clearInterval(t); window.removeEventListener("lvda:reviews-changed", load); };
  }, [db]);

  // `also`: đường dẫn khác vẫn thuộc mục này (cấu hình agent và lần hỏi cũ nằm trong Hỏi & kiểm)
  const items: { to: string; label: string; icon: ReactNode; end?: boolean; also?: string[]; badge?: number | null; show: boolean }[] = [
    { to: "/", label: "Hỏi & kiểm", icon: <MessageSquareText size={17} />, end: true, also: ["/runs", "/metrics", "/settings"], badge: eng ? stale : null, show: true },
    { to: "/data", label: "Dữ liệu", icon: <Network size={17} />, show: true },
    { to: "/sources", label: "Nguồn dữ liệu", icon: <Database size={17} />, badge: sourceErrors, show: canConnect },
    { to: "/eval", label: "Đánh giá", icon: <FlaskConical size={17} />, badge: pending, show: eng },
    { to: "/share", label: "Chia sẻ & nhật ký", icon: <Users size={17} />, show: eng },
  ];

  const [name, role] = (user?.name ?? "").split(/\s*\(/);
  const [dbName, dbSub] = (db?.name ?? "").split(/\s*·\s*/);
  return (
    <div className="flex h-full">
      <aside className="flex w-[248px] shrink-0 flex-col border-r border-line bg-sidebar">
        <div className="px-[18px] py-[18px]"><Logo /></div>
        <div className="flex flex-col gap-2 px-3.5 pb-3.5 pt-0.5">
          <label htmlFor="db-select" className="px-1 font-mono text-[10.5px] font-medium tracking-[0.12em] text-faint">DATABASE</label>
          {/* thẻ database: select gốc phủ trong suốt lên trên để giữ bàn phím và trình đọc màn hình */}
          <div className="relative flex items-center gap-2.5 rounded-[10px] border border-line bg-[#0f141e] px-2.5 py-[9px] focus-within:border-accent hover:border-line-strong">
            <span className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-[oklch(0.3_0.06_235)] text-[oklch(0.82_0.11_235)]"><Database size={14} /></span>
            <span className="flex min-w-0 flex-1 flex-col leading-snug">
              <span className="truncate text-[13px] font-semibold">{dbName}</span>
              <span className="truncate text-[12px] text-faint">{dbSub ?? (db?.has_source ? "đồng bộ từ nguồn" : "")}</span>
            </span>
            <span className="lv-live mr-1 size-[7px] shrink-0 rounded-full bg-good" title="Đã kết nối" />
            <ChevronsUpDown size={14} className="shrink-0 text-faint" />
            <select id="db-select" value={db?.id} onChange={(e) => selectDb(Number(e.target.value))}
              className="absolute inset-0 cursor-pointer opacity-0" aria-label="Database đang dùng">
              {databases.filter((d) => !d.expired).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          {db && (
            <div className="flex flex-wrap items-center gap-1 px-1 text-[11.5px] text-faint">
              <span className={cx("rounded px-1.5 py-px font-mono text-[10.5px] font-medium", eng ? "bg-accent-soft text-accent" : "bg-sunk text-ink-2")}>{eng ? "engineer" : "viewer"}</span>
              {db.granted_via === "link" && <span>· qua link</span>}
              {db.expires_at && <span>· hết hạn {new Date(db.expires_at).toLocaleDateString("vi-VN")}</span>}
            </div>
          )}
        </div>
        <nav className="flex flex-col gap-0.5 border-t border-[#161d29] px-2.5 pb-1 pt-3">
          {items.filter((i) => i.show).map((i) => {
            const on = (p: boolean) => p || !!i.also?.some((x) => pathname.startsWith(x));
            return (
              <NavLink key={i.to} to={i.to} end={i.end}
                className={({ isActive }) => cx("flex items-center gap-[11px] rounded-lg px-2.5 py-[9px] text-[14px] transition-colors",
                  on(isActive) ? "bg-accent-soft font-semibold text-[oklch(0.9_0.07_235)] shadow-[inset_2px_0_0_oklch(0.75_0.13_235),inset_0_0_0_1px_oklch(0.35_0.07_240)]"
                    : "text-muted hover:bg-[#151c29] hover:text-ink")}>
                {i.icon}<span className="flex-1">{i.label}</span>
                {!!i.badge && <span className="num grid h-5 min-w-5 place-items-center rounded-[10px] bg-warn-soft px-1.5 text-[11px] font-semibold text-warn">{i.badge}</span>}
              </NavLink>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-[#161d29] px-3.5 py-3">
          <div className="flex items-center gap-2.5 p-0.5">
            <div className="grid size-[34px] place-items-center rounded-full bg-[oklch(0.32_0.07_270)] text-[13px] font-semibold text-[oklch(0.88_0.08_270)]" aria-hidden>
              {name.slice(0, 1)}
            </div>
            <div className="flex min-w-0 flex-1 flex-col leading-snug">
              <span className="truncate text-[13px] font-semibold">{name}</span>
              <span className="truncate text-[11.5px] text-faint">{role ? `${role.replace(/\)$/, "")} · ` : ""}{user?.email}</span>
            </div>
            <button onClick={logout} className="grid size-[30px] place-items-center rounded-[7px] text-faint hover:bg-[#182030] hover:text-ink" aria-label="Đăng xuất" title="Đăng xuất"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>
      <main className="lv-canvas min-w-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}