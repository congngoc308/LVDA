import { ChevronDown, LogOut, Moon, SlidersHorizontal, Sun } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useSession } from "../session";
import { useTheme } from "../theme";
import { DatabaseSwitcher } from "./DatabaseSwitcher";
import { cx } from "./ui";

/** Dấu logo: vân tay dạng vòm, đầu đường vân là nút dữ liệu, kèm huy hiệu tích xanh (lineage đã kiểm). */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 72 72" width={size} height={size} className="shrink-0" aria-hidden>
      <rect width="72" height="72" rx="16" fill="#1E3A5F" />
      <g transform="translate(34 34) scale(0.5)">
        <g fill="none" stroke="#FFFFFF" strokeWidth="5.5" strokeLinecap="round">
          <path d="M-10 16 V0 A10 10 0 0 1 10 0 V8" />
          <path d="M-20 30 V0 A20 20 0 0 1 20 0 V18" />
          <path d="M-30 40 V0 A30 30 0 0 1 30 0 V4" />
          <path d="M-40 32 V0 A40 40 0 0 1 38 -12.5" />
          <path d="M-50 22 V0 A50 50 0 0 1 36 -34.7" />
        </g>
        <g fill="#FFFFFF">
          <circle cx="-50" cy="22" r="6.5" /><circle cx="-20" cy="30" r="6.5" /><circle cx="36" cy="-34.7" r="6.5" /><circle cx="30" cy="4" r="6.5" />
        </g>
        <circle cx="40" cy="42" r="24" fill="#1E3A5F" />
        <circle cx="40" cy="42" r="19" fill="#22C55E" />
        <path d="M31 42 l6 6 l12 -13" fill="none" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={32} />
      <span className={cx("text-[16px] font-bold tracking-[0.01em]", light && "text-ink")}>LVDA</span>
    </div>
  );
}
/** Nút đổi chế độ sáng/tối; lựa chọn được nhớ trên trình duyệt này. */
export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const label = theme === "dark" ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối";
  return (
    <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="grid size-7 place-items-center rounded-md text-faint hover:bg-hover hover:text-ink"
      aria-label={label} title={label}>{theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}</button>
  );
}

/** Menu tài khoản ở góc phải: vai trò, trạng thái LLM, giao diện sáng/tối, đăng xuất. */
function UserMenu({ llm }: { llm: string | null }) {
  const { user, db, logout } = useSession();
  const [theme, setTheme] = useTheme();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", away); window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("mousedown", away); window.removeEventListener("keydown", esc); };
  }, [open]);
  const [name, role] = (user?.name ?? "").split(/\s*\(/);
  const mock = !llm || llm === "mock";
  const item = "flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-ink-2 hover:bg-hover hover:text-ink";
  return (
    <div ref={box} className="relative">
      <button onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}
        className="flex h-9 items-center gap-2 rounded-lg pl-1 pr-1.5 hover:bg-hover">
        <span className="grid size-[30px] place-items-center rounded-full bg-edge text-[13px] font-semibold" aria-hidden>{name.slice(0, 1)}</span>
        <span className="hidden text-[13px] font-semibold lg:inline">{name}</span>
        <ChevronDown size={14} className="text-faint" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-[calc(100%+6px)] z-40 w-[260px] rounded-xl border border-line bg-surface p-1.5 shadow-2xl">
          <div className="flex flex-col gap-0.5 px-2.5 pb-2.5 pt-2">
            <span className="text-[13.5px] font-semibold">{name}</span>
            <span className="truncate text-[12px] text-faint">{role ? `${role.replace(/\)$/, "")} · ` : ""}{user?.email}</span>
            {db && <span className="text-[12px] text-faint">Quyền trên {db.name.split(/\s*·\s*/)[0]}: <span className="font-mono text-ink-2">{db.role}</span></span>}
          </div>
          <div className="flex items-center gap-2 border-y border-line px-2.5 py-2 text-[12px] text-muted">
            <span className={cx("size-1.5 rounded-full", mock ? "bg-warn" : "bg-accent")} />LLM: {mock ? "mô phỏng" : llm}
          </div>
          <div className="pt-1.5">
            <button role="menuitem" className={item} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}{theme === "dark" ? "Giao diện sáng" : "Giao diện tối"}
            </button>
            <button role="menuitem" className={item} onClick={logout}><LogOut size={15} />Đăng xuất</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { db, canConnect } = useSession();
  const nav = useNavigate();
  const [pending, setPending] = useState<number | null>(null);
  const [stale, setStale] = useState<number | null>(null);
  const [llm, setLlm] = useState<string | null>(null);
  const eng = db?.role === "engineer";
  const [switcher, setSwitcher] = useState(false);
  // số nguồn đang lỗi: hiện trên ô database để thấy ngay mà không phải mở trang
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

  // `also`: đường dẫn khác vẫn thuộc mục này (lần hỏi cũ nằm trong Hỏi & kiểm)
  const items: { to: string; label: string; end?: boolean; also?: string[]; badge?: number | null; show: boolean }[] = [
    { to: "/", label: "Hỏi & kiểm", end: true, also: ["/runs", "/metrics", "/settings"], badge: eng ? stale : null, show: true },
    { to: "/eval", label: "Đánh giá", badge: pending, show: eng },
    { to: "/data", label: "Dữ liệu", show: true },
    { to: "/share", label: "Chia sẻ & nhật ký", show: eng },
  ];

  const [dbName, dbSub] = (db?.name ?? "").split(/\s*·\s*/);
  const configOpen = pathname.startsWith("/metrics") || pathname.startsWith("/settings");
  return (
    <div className="flex h-full flex-col">
      <header className="z-20 flex h-16 shrink-0 items-center gap-5 whitespace-nowrap border-b border-line bg-sidebar px-4 md:px-6">
        <button onClick={() => nav("/", { state: { home: Date.now() } })} className="shrink-0" aria-label="Về Hỏi & kiểm"><span className="hidden sm:block"><Logo /></span><span className="sm:hidden"><LogoMark size={32} /></span></button>
        <nav className="scrollbar-none flex h-full min-w-0 flex-1 items-stretch gap-1 overflow-x-auto" aria-label="Mục chính">
          {items.filter((i) => i.show).map((i) => {
            const on = (p: boolean) => p || !!i.also?.some((x) => pathname.startsWith(x));
            return (
              <NavLink key={i.to} to={i.to} end={i.end}
                onClick={i.to === "/" ? (e) => { e.preventDefault(); nav("/", { state: { home: Date.now() } }); } : undefined}
                className={({ isActive }) => cx("flex items-center gap-2 border-b-2 px-3.5 text-[14px] font-medium transition-colors",
                  on(isActive) ? "border-accent text-ink" : "border-transparent text-faint hover:text-ink")}>
                {i.label}
                {!!i.badge && <span className="rounded bg-warn-soft px-1.5 py-px font-mono text-[11px] font-semibold text-warn">{i.badge}</span>}
              </NavLink>
            );
          })}
        </nav>
        <div className="flex shrink-0 items-center gap-2.5">
          {/* cho biết đang ở database nào; bấm để mở cửa sổ chọn database (và lối vào trang quản lý nguồn) */}
          <button type="button" onClick={() => setSwitcher(true)} aria-haspopup="dialog" title={`${db?.name ?? ""} · bấm để đổi database`}
            className={cx("flex h-9 max-w-[220px] items-center gap-2 rounded-lg border bg-surface px-3 hover:border-edge",
              pathname.startsWith("/sources") ? "border-accent" : "border-line")}>
            {sourceErrors
              ? <span className="font-mono text-[11px] text-warn" title={`${sourceErrors} nguồn đang lỗi`}>{sourceErrors}</span>
              : <span className="size-[7px] shrink-0 rounded-full bg-accent" />}
            <span className="truncate text-[13px] font-semibold">{dbName}</span>
            {dbSub && <span className="hidden truncate text-[12px] text-faint xl:inline">{dbSub}</span>}
          </button>
          {db && !db.catalog_only && (
            <button onClick={() => nav("/metrics")} title="Chỉ số & cấu hình agent"
              className={cx("hidden h-9 items-center gap-2 rounded-lg border bg-surface px-3 text-[13px] font-medium hover:bg-hover md:flex", configOpen ? "border-accent" : "border-line")}>
              <SlidersHorizontal size={14} /> Chỉ số &amp; cấu hình
            </button>
          )}
          <span className="h-6 w-px bg-line" />
          <UserMenu llm={llm} />
        </div>
      </header>
      <DatabaseSwitcher open={switcher} onClose={() => setSwitcher(false)} />
      <main className="min-h-0 flex-1 overflow-hidden bg-paper">{children}</main>
    </div>
  );
}
