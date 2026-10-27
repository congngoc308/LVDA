import { Database, FlaskConical, LogOut, MessageSquareText, Network, Users } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { api } from "../api";
import { useSession } from "../session";
import { DatabaseSwitcher } from "./DatabaseSwitcher";
import { cx } from "./ui";

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-[26px] place-items-center rounded-md bg-accent font-mono text-[12px] font-medium text-on-accent" aria-hidden>L</div>
      <div className="flex flex-col leading-tight">
        <span className="text-[14px] font-semibold tracking-[0.02em]">LVDA</span>
        <span className={cx("text-[11.5px]", light ? "text-ink-2" : "text-faint")}>Hỏi số, có phiếu kiểm</span>
      </div>
    </div>
  );
}
export function Shell({ children }: { children: ReactNode }) {
  const { user, db, canConnect, logout } = useSession();
  const [pending, setPending] = useState<number | null>(null);
  const [stale, setStale] = useState<number | null>(null);
  const [llm, setLlm] = useState<string | null>(null);
  const eng = db?.role === "engineer";
  const [switcher, setSwitcher] = useState(false);
  // số nguồn đang lỗi: hiện trên ô Database để thấy ngay mà không phải mở trang
  const [sourceErrors, setSourceErrors] = useState<number | null>(null);
  useEffect(() => {
    if (!canConnect) return;
    let alive = true;
    const load = () => api<{ counts: { error: number } }>("/sources").then((r) => alive && setSourceErrors(r.counts.error)).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, [canConnect]);
  useEffect(() => { api<{ llm?: string }>("/health").then((h) => setLlm(h.llm ?? null)).catch(() => {}); }, []);
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
    { to: "/", label: "Hỏi & kiểm", icon: <MessageSquareText size={16} strokeWidth={1.7} />, end: true, also: ["/runs", "/metrics", "/settings"], badge: eng ? stale : null, show: true },
    { to: "/data", label: "Dữ liệu", icon: <Network size={16} strokeWidth={1.7} />, show: true },
    { to: "/eval", label: "Đánh giá", icon: <FlaskConical size={16} strokeWidth={1.7} />, badge: pending, show: eng },
    { to: "/share", label: "Chia sẻ & nhật ký", icon: <Users size={16} strokeWidth={1.7} />, show: eng },
  ];

  const [name, role] = (user?.name ?? "").split(/\s*\(/);
  const [dbName, dbSub] = (db?.name ?? "").split(/\s*·\s*/);
  const mock = !llm || llm === "mock";
  return (
    <div className="flex h-full">
      <aside className="flex w-[232px] shrink-0 flex-col border-r border-line bg-sidebar">
        <div className="flex h-14 shrink-0 items-center border-b border-line px-4"><Logo /></div>
        <div className="flex flex-col gap-1.5 px-3 pb-2 pt-4">
          <span className="px-2 text-[11px] font-medium text-dim">Database</span>
          {/* cho biết đang ở database nào; bấm để mở cửa sổ chọn database (và lối vào trang quản lý nguồn) */}
          <button type="button" onClick={() => setSwitcher(true)} title="Chọn database" aria-haspopup="dialog"
            className={cx("flex items-center gap-2.5 rounded-lg border bg-sunk p-2 text-left hover:border-line-strong",
              pathname.startsWith("/sources") ? "border-accent" : "border-line")}>
            <Database size={16} strokeWidth={1.7} className="shrink-0 text-muted" />
            <span className="flex min-w-0 flex-1 flex-col leading-[1.3]">
              <span className="truncate text-[13px] font-medium">{dbName}</span>
              <span className="truncate text-[11.5px] text-faint">{dbSub ?? (db?.has_source ? "đồng bộ từ nguồn" : "")}</span>
            </span>
            {sourceErrors
              ? <span className="num mr-1 text-[11px] text-warn" title={`${sourceErrors} nguồn đang lỗi`}>{sourceErrors}</span>
              : <span className="mr-1 size-1.5 shrink-0 rounded-full bg-accent" title="Đã kết nối" />}
          </button>
        </div>
        <DatabaseSwitcher open={switcher} onClose={() => setSwitcher(false)} />
        <nav className="flex flex-col gap-px px-3 py-2">
          {items.filter((i) => i.show).map((i) => {
            const on = (p: boolean) => p || !!i.also?.some((x) => pathname.startsWith(x));
            return (
              <NavLink key={i.to} to={i.to} end={i.end}
                className={({ isActive }) => cx("flex h-[34px] items-center gap-2.5 rounded-md px-2 text-[13.5px] transition-colors",
                  on(isActive) ? "bg-accent font-medium text-on-accent" : "text-muted hover:bg-hover hover:text-ink")}>
                {({ isActive }) => (
                  <>
                    {i.icon}<span className="flex-1">{i.label}</span>
                    {!!i.badge && <span className={cx("num text-[11px]", on(isActive) ? "text-on-accent" : "text-warn")}>{i.badge}</span>}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-3 border-t border-line px-4 py-3">
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <span className={cx("size-1.5 rounded-full", mock ? "bg-warn" : "bg-accent")} />LLM: {mock ? "mô phỏng" : llm}
          </div>
          <div className="flex items-center gap-2.5">
            <div className="grid size-7 shrink-0 place-items-center rounded-full bg-edge text-[12px] font-medium" aria-hidden>
              {name.slice(0, 1)}
            </div>
            <div className="flex min-w-0 flex-1 flex-col leading-[1.3]">
              <span className="truncate text-[13px] font-medium">{name}</span>
              <span className="truncate text-[11.5px] text-faint">{role ? `${role.replace(/\)$/, "")} · ` : ""}{user?.email}</span>
            </div>
            <button onClick={logout} className="grid size-7 place-items-center rounded-md text-faint hover:bg-hover hover:text-ink" aria-label="Đăng xuất" title="Đăng xuất"><LogOut size={15} /></button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-hidden bg-paper">{children}</main>
    </div>
  );
}
