import { ChevronDown, Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { LogoMark, ThemeToggle } from "../components/Shell";
import { cx } from "../components/ui";
import "./landing.css";
import { Container, GITHUB, L } from "./ui";
import HomePage from "./pages/Home";
import PlatformPage from "./pages/Platform";
import AskPage from "./pages/Ask";
import CatalogPage from "./pages/Catalog";
import MetricsPage from "./pages/Metrics";
import DashboardPage from "./pages/Dashboard";
import SourcesPage from "./pages/Sources";
import SolutionsPage from "./pages/Solutions";
import EvaluationPage from "./pages/Evaluation";
import HowPage from "./pages/How";
import IntegrationsPage from "./pages/Integrations";
import SecurityPage from "./pages/Security";
import StartPage from "./pages/Start";
import AboutPage from "./pages/About";

type Item = { to: string; title: string; desc: string };
type Group = { label: string; to?: string; items?: Item[] };

export const PRODUCT: Item[] = [
  { to: "nen-tang", title: "Nền tảng", desc: "Lớp kiểm chứng giữa model và con số" },
  { to: "hoi-va-kiem", title: "Hỏi & kiểm", desc: "Hỏi bằng tiếng Việt, câu trả lời nào cũng có phiếu kiểm" },
  { to: "du-lieu-lineage", title: "Dữ liệu & lineage", desc: "Catalog cho hàng trăm bảng, lineage tới từng cột" },
  { to: "chi-so", title: "Chỉ số đã chứng nhận", desc: "Định nghĩa YAML có phiên bản, người chứng nhận và ngày" },
  { to: "dashboard-chia-se", title: "Dashboard & chia sẻ", desc: "Agent dựng card, mời cả nhóm bằng một link" },
  { to: "ket-noi-nguon", title: "Kết nối nguồn", desc: "Postgres, MySQL qua role chỉ đọc, đồng bộ tăng dần" },
];
export const RESOURCES: Item[] = [
  { to: "cach-hoat-dong", title: "Cách hoạt động", desc: "Tám bước của một câu hỏi và 12 luật kiểm" },
  { to: "tich-hop", title: "Tích hợp", desc: "MCP, CLI, Postgres, MySQL, LLM tương thích OpenAI" },
  { to: "bao-mat", title: "Bảo mật", desc: "Chỉ đọc, mã hóa, phân quyền, nhật ký" },
  { to: "bat-dau", title: "Bắt đầu", desc: "Chạy trên máy trong vài phút" },
];
const MENU: Group[] = [
  { label: "Sản phẩm", items: PRODUCT },
  { label: "Giải pháp", to: "giai-phap" },
  { label: "Đánh giá", to: "danh-gia" },
  { label: "Tài nguyên", items: RESOURCES },
  { label: "Dự án", to: "du-an" },
];

function Dropdown({ group }: { group: Group }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const active = group.items!.some((i) => loc.pathname === L(i.to));
  return (
    <div ref={box} className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className={cx("inline-flex h-9 items-center gap-1 rounded-md px-3 text-[14.5px] hover:text-ink", active || open ? "text-ink" : "text-muted")}>
        {group.label}<ChevronDown size={14} className={cx("transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="absolute top-full left-0 z-50 pt-2">
          <div className={cx("grid gap-1 rounded-xl border border-line-strong bg-surface p-2 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.5)]", group.items!.length > 4 ? "w-[620px] grid-cols-2" : "w-[340px]")}>
            {group.items!.map((i) => (
              <Link key={i.to} to={L(i.to)} className="rounded-lg px-3 py-2.5 hover:bg-hover">
                <div className="text-[14.5px] font-medium text-ink">{i.title}</div>
                <div className="mt-0.5 text-[13px] leading-snug text-faint">{i.desc}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Header() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const top = "inline-flex h-9 items-center rounded-md px-3 text-[14.5px]";
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/85 backdrop-blur-md">
      <Container className="flex h-16 items-center gap-4">
        <Link to={L()} className="flex items-center gap-2.5" aria-label="LVDA, trang chủ giới thiệu">
          <LogoMark size={30} /><span className="text-[16px] font-bold tracking-[0.01em]">LVDA</span>
        </Link>
        <nav className="ml-4 hidden items-center lg:flex" aria-label="Mục chính">
          {MENU.map((g) => g.items ? <Dropdown key={g.label} group={g} /> : (
            <NavLink key={g.label} to={L(g.to)} className={({ isActive }) => cx(top, isActive ? "text-ink" : "text-muted hover:text-ink")}>{g.label}</NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Link to="/" className="hidden h-9 items-center rounded-md px-3 text-[14.5px] text-ink-2 hover:bg-hover sm:inline-flex">Mở app</Link>
          <Link to={`${L()}#demo`} className="hidden h-9 items-center rounded-lg bg-accent px-4 text-[14.5px] font-medium text-on-accent hover:bg-accent-2 sm:inline-flex">Xem demo</Link>
          <button className="grid size-9 place-items-center rounded-md text-ink-2 hover:bg-hover lg:hidden" onClick={() => setOpen((o) => !o)}
            aria-expanded={open} aria-label={open ? "Đóng menu" : "Mở menu"}>{open ? <X size={18} /> : <Menu size={18} />}</button>
        </div>
      </Container>
      {open && (
        <div className="scroll-thin max-h-[calc(100dvh-64px)] overflow-y-auto border-t border-line bg-paper lg:hidden">
          <Container className="py-4">
            {MENU.map((g) => g.items ? (
              <div key={g.label} className="py-2">
                <div className="px-1 pb-1 font-mono text-[11.5px] tracking-[0.08em] text-faint uppercase">{g.label}</div>
                {g.items.map((i) => <Link key={i.to} to={L(i.to)} className="block rounded-md px-1 py-2 text-[15.5px] text-ink-2 hover:text-ink">{i.title}</Link>)}
              </div>
            ) : <Link key={g.label} to={L(g.to)} className="block rounded-md px-1 py-2.5 text-[15.5px] text-ink-2 hover:text-ink">{g.label}</Link>)}
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-4">
              <Link to="/" className="grid h-11 place-items-center rounded-lg border border-line-strong text-[15px]">Mở app</Link>
              <Link to={`${L()}#demo`} className="grid h-11 place-items-center rounded-lg bg-accent text-[15px] font-medium text-on-accent">Xem demo</Link>
            </div>
          </Container>
        </div>
      )}
    </header>
  );
}

function Footer() {
  const col = (title: string, items: { to: string; title: string }[]) => (
    <div>
      <div className="mb-3 font-mono text-[11.5px] tracking-[0.08em] text-faint uppercase">{title}</div>
      <ul className="space-y-2">
        {items.map((i) => <li key={i.to}>{/^https?:/.test(i.to)
          ? <a href={i.to} target="_blank" rel="noreferrer" className="text-[14px] text-muted hover:text-ink">{i.title}</a>
          : <Link to={L(i.to)} className="text-[14px] text-muted hover:text-ink">{i.title}</Link>}</li>)}
      </ul>
    </div>
  );
  return (
    <footer className="border-t border-line bg-panel">
      <Container className="grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5"><LogoMark size={28} /><span className="text-[15px] font-bold">LVDA</span></div>
          <p className="mt-4 max-w-[300px] text-[14px] leading-[1.6] text-muted">Lineage-Verified Data Agent. Agent dữ liệu kiểm từng con số theo lineage trước khi trả lời.</p>
          <p className="mt-4 text-[13px] text-faint">MVP mã nguồn mở · dữ liệu tổng hợp · model giả lập</p>
        </div>
        {col("Sản phẩm", PRODUCT)}
        {col("Tài nguyên", [...RESOURCES, { to: "danh-gia", title: "Đánh giá" }])}
        {col("Dự án", [{ to: "giai-phap", title: "Giải pháp theo vai trò" }, { to: "du-an", title: "Về dự án" }, { to: GITHUB, title: "GitHub" }])}
      </Container>
    </footer>
  );
}

/** Cuộn lên đầu khi đổi trang; có #id thì cuộn tới khối đó. */
function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) { requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView()); return; }
    window.scrollTo({ top: 0, behavior: "instant" }); // trang mới thì nhảy thẳng lên đầu, không cuộn mượt
  }, [pathname, hash]);
  return null;
}

export default function Landing() {
  return (
    <div className="flex min-h-full flex-col overflow-x-clip bg-paper text-ink">
      <ScrollManager />
      <a href="#noi-dung" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">Bỏ qua menu</a>
      <Header />
      <main id="noi-dung" className="flex-1">
        <Routes>
          <Route index element={<HomePage />} />
          <Route path="nen-tang" element={<PlatformPage />} />
          <Route path="hoi-va-kiem" element={<AskPage />} />
          <Route path="du-lieu-lineage" element={<CatalogPage />} />
          <Route path="chi-so" element={<MetricsPage />} />
          <Route path="dashboard-chia-se" element={<DashboardPage />} />
          <Route path="ket-noi-nguon" element={<SourcesPage />} />
          <Route path="giai-phap" element={<SolutionsPage />} />
          <Route path="danh-gia" element={<EvaluationPage />} />
          <Route path="cach-hoat-dong" element={<HowPage />} />
          <Route path="tich-hop" element={<IntegrationsPage />} />
          <Route path="bao-mat" element={<SecurityPage />} />
          <Route path="bat-dau" element={<StartPage />} />
          <Route path="du-an" element={<AboutPage />} />
          <Route path="*" element={<Navigate to={L()} replace />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
