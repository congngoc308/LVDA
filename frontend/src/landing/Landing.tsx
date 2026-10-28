import { ArrowRight, ChevronDown, ExternalLink, Menu, Play, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
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

export const PRODUCT: Item[] = [
  { to: "nen-tang", title: "Nền tảng", desc: "Các phần của LVDA nối với nhau ra sao" },
  { to: "hoi-va-kiem", title: "Hỏi & kiểm", desc: "Câu trả lời nào cũng có phiếu kiểm" },
  { to: "du-lieu-lineage", title: "Dữ liệu & lineage", desc: "Lineage tới từng cột" },
  { to: "chi-so", title: "Chỉ số đã chứng nhận", desc: "YAML có phiên bản và người ký" },
  { to: "dashboard-chia-se", title: "Dashboard & chia sẻ", desc: "Mời cả nhóm bằng một link" },
  { to: "ket-noi-nguon", title: "Kết nối nguồn", desc: "Postgres, MySQL, chỉ đọc" },
];
const ROLES: Item[] = [
  { to: "giai-phap#engineer", title: "Data engineer", desc: "Định nghĩa, chứng nhận và duyệt chỉ số" },
  { to: "giai-phap#analyst", title: "Người phân tích, quản lý", desc: "Hỏi bằng tiếng Việt, xem kết luận từng câu" },
  { to: "giai-phap#ai", title: "Đội xây agent AI", desc: "Gọi verify_sql qua MCP hoặc CLI" },
];
export const RESOURCES: Item[] = [
  { to: "cach-hoat-dong", title: "Cách hoạt động", desc: "Tám bước, 12 luật kiểm" },
  { to: "tich-hop", title: "Tích hợp", desc: "MCP, CLI, LLM tương thích OpenAI" },
  { to: "bao-mat", title: "Bảo mật", desc: "Chỉ đọc, mã hóa, phân quyền, nhật ký" },
  { to: "bat-dau", title: "Bắt đầu", desc: "Chạy trên máy bằng Docker" },
];
const PROJECT: Item[] = [
  { to: "danh-gia", title: "Đánh giá", desc: "Phương pháp, con số và giới hạn" },
  { to: "giai-phap", title: "Giải pháp theo vai trò", desc: "LVDA cho từng vai trò" },
  { to: "du-an", title: "Về dự án", desc: "Làm được gì, chưa làm gì" },
];

/** Thanh menu kiểu Atlan: nhóm có bảng xổ xuống, hoặc link thẳng tới một trang. */
type Tab = { key: string; label: string; to?: string; items?: Item[]; wide?: boolean };
const TABS: Tab[] = [
  { key: "product", label: "Sản phẩm", items: PRODUCT, wide: true },
  { key: "roles", label: "Giải pháp", items: ROLES },
  { key: "eval", label: "Đánh giá", to: "danh-gia" },
  { key: "res", label: "Tài nguyên", items: RESOURCES },
  { key: "about", label: "Dự án", to: "du-an" },
];
const path = (to: string) => L(to.split("#")[0]);
const isActive = (t: Tab, pathname: string) => (t.items ? t.items.some((i) => path(i.to) === pathname) : path(t.to!) === pathname);

function MenuItem({ i }: { i: Item }) {
  return (
    <Link to={L(i.to)} className="block rounded-xl px-3 py-2.5 hover:bg-hover">
      <span className="block text-[14.5px] font-medium text-ink">{i.title}</span>
      <span className="mt-0.5 block text-[13px] leading-snug text-faint">{i.desc}</span>
    </Link>
  );
}

function Panel({ tab }: { tab: Tab }) {
  if (tab.key === "product") {
    return (
      <div className="grid w-[780px] grid-cols-[minmax(0,1fr)_240px] gap-3 p-3">
        <div className="grid grid-cols-2 content-start gap-0.5">{tab.items!.map((i) => <MenuItem key={i.to} i={i} />)}</div>
        <Link to={`${L()}#demo`} className="group flex flex-col overflow-hidden rounded-xl border border-line bg-panel hover:border-accent-line">
          <span className="relative block overflow-hidden">
            <img src="/landing/demo-poster.webp" alt="" className="block aspect-[16/10] w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
            <span className="absolute inset-0 grid place-items-center"><span className="grid size-10 place-items-center rounded-full bg-accent text-on-accent shadow-lg"><Play size={16} fill="currentColor" aria-hidden /></span></span>
          </span>
          <span className="p-3.5">
            <span className="block font-mono text-[11px] tracking-[0.08em] text-accent-2 uppercase">Demo</span>
            <span className="mt-1 block text-[14.5px] font-medium text-ink">Video 5 kịch bản, 2 phút 30</span>
            <span className="mt-2 inline-flex items-center gap-1 text-[13px] text-muted group-hover:text-accent-2">Mở video<ArrowRight size={13} aria-hidden /></span>
          </span>
        </Link>
      </div>
    );
  }
  return (
    <div className="w-[360px] p-2">
      {tab.items!.map((i) => <MenuItem key={i.to} i={i} />)}
      {tab.key === "res" && (
        <a href={GITHUB} target="_blank" rel="noreferrer" className="mt-1 flex items-center justify-between border-t border-line px-3 pt-3 pb-1.5 text-[13.5px] text-muted hover:text-ink">
          Mã nguồn trên GitHub<ExternalLink size={14} aria-hidden />
        </a>
      )}
      {tab.key === "roles" && (
        <Link to={L("giai-phap")} className="mt-1 flex items-center justify-between border-t border-line px-3 pt-3 pb-1.5 text-[13.5px] text-muted hover:text-ink">
          Xem cả ba vai trò<ArrowRight size={14} aria-hidden />
        </Link>
      )}
    </div>
  );
}

function DesktopNav() {
  const [open, setOpen] = useState<string | null>(null);
  const nav = useRef<HTMLElement>(null);
  const { pathname, hash } = useLocation();
  useEffect(() => setOpen(null), [pathname, hash]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!nav.current?.contains(e.target as Node)) setOpen(null); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const cls = (on: boolean) => cx("inline-flex h-9 items-center gap-1 rounded-full px-3.5 text-[14.5px] transition-colors hover:text-ink", on ? "bg-sunk text-ink" : "text-muted");
  return (
    <nav ref={nav} className="ml-6 hidden items-center gap-0.5 lg:flex" aria-label="Mục chính" onMouseLeave={() => setOpen(null)}>
      {TABS.map((t) => {
        const on = isActive(t, pathname);
        if (!t.items) return <Link key={t.key} to={L(t.to)} aria-current={on ? "page" : undefined} className={cls(on)} onMouseEnter={() => setOpen(null)}>{t.label}</Link>;
        const isOpen = open === t.key;
        return (
          <div key={t.key} className="relative" onMouseEnter={() => setOpen(t.key)}>
            <button aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : t.key)} className={cls(on || isOpen)}>
              {t.label}<ChevronDown size={14} className={cx("transition-transform", isOpen && "rotate-180")} aria-hidden />
            </button>
            {isOpen && (
              <div className="absolute top-full left-0 z-50 pt-2">
                <div className="rounded-2xl border border-line-strong bg-surface shadow-[0_24px_60px_-24px_rgba(0,0,0,0.6)]"><Panel tab={t} /></div>
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function MobileNav() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState<string | null>(() => TABS.find((t) => t.items && isActive(t, pathname))?.key ?? null);
  return (
    <div>
      {TABS.map((t) => t.items ? (
        <div key={t.key} className="border-b border-line">
          <button aria-expanded={open === t.key} onClick={() => setOpen(open === t.key ? null : t.key)}
            className="flex w-full items-center justify-between px-1 py-3.5 text-[16px] font-medium">
            {t.label}<ChevronDown size={16} className={cx("text-faint transition-transform", open === t.key && "rotate-180")} aria-hidden />
          </button>
          {open === t.key && <div className="pb-3">{t.items.map((i) => <MenuItem key={i.to} i={i} />)}</div>}
        </div>
      ) : (
        <Link key={t.key} to={L(t.to)} className="block border-b border-line px-1 py-3.5 text-[16px] font-medium text-ink hover:text-ink">{t.label}</Link>
      ))}
    </div>
  );
}

function Header() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname, loc.hash]);
  return (
    <header className="lp-header sticky top-0 z-40 border-b border-ink/[0.06] backdrop-blur-[14px]">
      <Container className="flex h-16 items-center gap-4">
        <Link to={L()} className="flex items-center gap-2.5" aria-label="LVDA, trang chủ giới thiệu">
          <LogoMark size={28} /><span className="text-[16px] font-bold">LVDA</span>
        </Link>
        <DesktopNav />
        <div className="ml-auto flex items-center gap-2.5">
          <ThemeToggle />
          <Link to="/" className="hidden h-9 items-center px-2.5 text-[14.5px] whitespace-nowrap text-ink-2 hover:text-ink sm:inline-flex">Mở app</Link>
          <Link to={`${L()}#demo`} className="hidden h-9 items-center rounded-full bg-accent px-4 text-[14px] font-semibold whitespace-nowrap text-on-accent hover:bg-accent-2 sm:inline-flex">Xem demo</Link>
          <button className="grid size-9 place-items-center rounded-md text-ink-2 hover:bg-hover lg:hidden" onClick={() => setOpen((o) => !o)}
            aria-expanded={open} aria-label={open ? "Đóng menu" : "Mở menu"}>{open ? <X size={18} /> : <Menu size={18} />}</button>
        </div>
      </Container>
      {open && (
        <div className="lp-root scroll-thin max-h-[calc(100dvh-64px)] overflow-y-auto border-t border-line lg:hidden">
          <Container className="py-2">
            <MobileNav />
            <div className="mt-4 mb-2 grid grid-cols-2 gap-2">
              <Link to="/" className="grid h-11 place-items-center rounded-full border border-line-strong text-[15px]">Mở app</Link>
              <Link to={`${L()}#demo`} className="grid h-11 place-items-center rounded-full bg-accent text-[15px] font-semibold text-on-accent">Xem demo</Link>
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
      <div className="mb-3 font-mono text-[11.5px] tracking-[0.08em] text-dim uppercase">{title}</div>
      <ul className="space-y-2">
        {items.map((i) => <li key={i.to}>{/^https?:/.test(i.to)
          ? <a href={i.to} target="_blank" rel="noreferrer" className="text-[14px] text-muted hover:text-ink">{i.title}</a>
          : <Link to={L(i.to)} className="text-[14px] text-muted hover:text-ink">{i.title}</Link>}</li>)}
      </ul>
    </div>
  );
  return (
    <footer className="border-t border-sunk bg-paper">
      <Container className="grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5"><LogoMark size={26} /><span className="text-[15px] font-bold">LVDA</span></div>
          <p className="mt-4 max-w-[300px] text-[14px] leading-[1.6] text-muted">Agent dữ liệu kiểm từng con số trước khi trả lời.</p>
          <p className="mt-4 text-[13px] text-dim">MVP mã nguồn mở · dữ liệu tổng hợp · model giả lập</p>
        </div>
        {col("Sản phẩm", PRODUCT)}
        {col("Tài nguyên", [...RESOURCES, PROJECT[0]])}
        {col("Dự án", [...PROJECT.slice(1), { to: GITHUB, title: "GitHub" }])}
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
    <div className="lp-root flex min-h-full flex-col overflow-x-clip text-ink">
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
