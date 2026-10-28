import { ArrowRight, Check, ChevronDown } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cx } from "../components/ui";

export const GITHUB = "https://github.com/congngoc308/LVDA";
export const BASE = "/gioi-thieu";
/** Đường dẫn trong landing: L("danh-gia") → /gioi-thieu/danh-gia */
export const L = (p = "") => (p ? `${BASE}/${p}` : BASE);

export function usePageTitle(title: string) {
  useEffect(() => { document.title = `${title} · LVDA`; }, [title]);
}

/** Ảnh chụp thật của app, mỗi chế độ sáng/tối một bản; landing.css ẩn bản không khớp data-theme. */
const SHOTS = {
  answer: [956, 994], "answer-red": [956, 480], column: [1440, 836], catalog: [1280, 836], metric: [780, 900],
  dashboard: [1280, 770], agent: [600, 776], tray: [1440, 836], share: [1040, 335], connect: [1300, 410],
} as const;
export type ShotName = keyof typeof SHOTS;

export function Shot({ name, alt, className, eager = false }: { name: ShotName; alt: string; className?: string; eager?: boolean }) {
  const [w, h] = SHOTS[name];
  const common = { width: w, height: h, alt, loading: eager ? "eager" as const : "lazy" as const, decoding: "async" as const, className: "block h-auto w-full" };
  return (
    <div className={className}>
      <img {...common} src={`/landing/${name}-dark.webp`} className={cx(common.className, "lp-shot-dark")} />
      <img {...common} src={`/landing/${name}-light.webp`} className={cx(common.className, "lp-shot-light")} alt="" aria-hidden />
    </div>
  );
}

/** Khung ảnh sản phẩm: viền mảnh, nền nổi, quầng màu nhấn phía sau. */
export function Frame({ children, className, glow = true }: { children: ReactNode; className?: string; glow?: boolean }) {
  return (
    <div className={cx("relative", className)}>
      {glow && <div aria-hidden className="lp-glow pointer-events-none absolute -inset-x-10 -inset-y-8 -z-10" />}
      <div className="lp-edge rounded-2xl shadow-[0_30px_80px_-40px_rgba(0,0,0,0.55)]">
        <div className="overflow-hidden rounded-[15px] bg-surface">{children}</div>
      </div>
    </div>
  );
}

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mx-auto w-full max-w-[1200px] px-4 sm:px-6", className)}>{children}</div>;
}

export function Section({ children, className, sunk = false, id }: { children: ReactNode; className?: string; sunk?: boolean; id?: string }) {
  return (
    <section id={id} className={cx("scroll-mt-16 border-t border-sunk py-16 sm:py-24", sunk && "bg-panel/40", className)}>
      <Container>{children}</Container>
    </section>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mb-3.5 font-mono text-[12px] tracking-[0.1em] text-accent-2 uppercase", className)}>{children}</div>;
}

export function H2({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cx("text-[32px] leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-[44px]", className)}>{children}</h2>;
}

export function Lead({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("mt-4 max-w-[640px] text-[16px] leading-[1.65] text-muted sm:text-[16.5px]", className)}>{children}</p>;
}

export function SectionHead({ eyebrow, title, lead, center = false, className }: { eyebrow?: string; title: ReactNode; lead?: ReactNode; center?: boolean; className?: string }) {
  return (
    <div className={cx("mb-10 sm:mb-12", center && "mx-auto text-center [&_p]:mx-auto", className)}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <H2 className={center ? "mx-auto max-w-[820px]" : "max-w-[820px]"}>{title}</H2>
      {lead && <Lead>{lead}</Lead>}
    </div>
  );
}

type CtaProps = { to: string; children: ReactNode; variant?: "primary" | "secondary" | "text"; className?: string };
/** Nút dạng link; đường dẫn bắt đầu bằng http hoặc là file tĩnh thì mở bằng <a>. */
export function Cta({ to, children, variant = "primary", className }: CtaProps) {
  const cls = cx(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors",
    variant === "primary" && "h-[46px] rounded-full bg-ink px-[22px] text-[15px] font-semibold text-paper hover:bg-ink-2",
    variant === "secondary" && "h-[46px] rounded-full border border-line-strong px-[22px] text-[15px] font-medium text-ink hover:bg-sunk",
    variant === "text" && "font-medium",
    variant === "text" && "text-[14.5px] text-accent hover:text-accent-2",
    className,
  );
  const body = <>{children}{variant !== "secondary" && <ArrowRight size={16} aria-hidden />}</>;
  if (/^https?:/.test(to)) return <a href={to} target="_blank" rel="noreferrer" className={cls}>{body}</a>;
  return <Link to={to} className={cls}>{body}</Link>;
}

/** Đầu trang của mọi trang con: tiêu đề lớn, mô tả, nút, rồi ảnh bên dưới. */
export function PageHero({ eyebrow, title, lead, actions, children }: { eyebrow: string; title: ReactNode; lead: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <section className="relative isolate overflow-hidden pt-16 pb-16 sm:pt-24 sm:pb-24">
      <div aria-hidden className="lp-aura pointer-events-none absolute top-[-260px] left-1/2 -z-10 h-[900px] w-[1400px] -translate-x-1/2" />
      <div aria-hidden className="lp-squares pointer-events-none absolute inset-0 -z-10" />
      <Container>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="max-w-[920px] text-[40px] leading-[1.04] font-semibold tracking-[-0.04em] text-balance sm:text-[60px]">{title}</h1>
        <Lead className="sm:text-[18px]">{lead}</Lead>
        {actions && <div className="mt-8 flex flex-wrap gap-3">{actions}</div>}
        {children && <div className="mt-12 sm:mt-16">{children}</div>}
      </Container>
    </section>
  );
}

export function Points({ items, className }: { items: ReactNode[]; className?: string }) {
  return (
    <ul className={cx("space-y-3", className)}>
      {items.map((it, i) => (
        <li key={i} className="flex gap-3 text-[15px] leading-[1.6] text-ink-2">
          <span className="mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><Check size={11} strokeWidth={3} aria-hidden /></span>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

/** Một khối tính năng: chữ một bên, ảnh một bên; flip đổi bên. */
export function Feature({ eyebrow, title, body, points, visual, flip = false }: { eyebrow?: string; title: ReactNode; body: ReactNode; points?: ReactNode[]; visual: ReactNode; flip?: boolean }) {
  return (
    <div className={cx("grid items-center gap-10 lg:gap-16", flip ? "lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]" : "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]")}>
      <div className={cx(flip && "lg:order-2")}>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h3 className="text-[24px] leading-[1.2] font-semibold tracking-[-0.015em] text-balance sm:text-[30px]">{title}</h3>
        <div className="mt-4 text-[15.5px] leading-[1.65] text-muted">{body}</div>
        {points && <Points items={points} className="mt-6" />}
      </div>
      <div className={cx("min-w-0", flip && "lg:order-1")}>{visual}</div>
    </div>
  );
}

export function Stat({ value, label, note }: { value: ReactNode; label: ReactNode; note?: ReactNode }) {
  return (
    <div className="border-l border-line pl-6">
      <div className="font-mono text-[34px] leading-none font-medium tracking-[-0.03em] text-ink sm:text-[40px]">{value}</div>
      <div className="mt-3 text-[14px] leading-snug text-muted">{label}</div>
      {note && <div className="mt-1 text-[13px] text-faint">{note}</div>}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("lp-lift rounded-2xl border border-line bg-panel p-6", className)}>{children}</div>;
}

/** Thẻ dẫn sang trang khác: cả thẻ bấm được. */
export function LinkCard({ to, icon, title, children }: { to: string; icon?: ReactNode; title: string; children: ReactNode }) {
  return (
    <Link to={to} className="lp-lift group flex flex-col rounded-2xl border border-line bg-panel p-6">
      {icon && <div className="mb-5 text-accent-2">{icon}</div>}
      <div className="text-[17px] font-semibold">{title}</div>
      <div className="mt-2 flex-1 text-[14.5px] leading-[1.6] text-muted">{children}</div>
      <div className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-medium text-accent-2">Xem chi tiết<ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" aria-hidden /></div>
    </Link>
  );
}

export function Code({ children, className }: { children: string; className?: string }) {
  return <pre className={cx("scroll-thin overflow-x-auto rounded-[10px] bg-sunk px-5 py-[18px] font-mono text-[13px] leading-[1.75] text-ink-2", className)}><code>{children}</code></pre>;
}

/** Chip kết luận dùng đúng màu của app: Xanh là màu nhấn xanh dương, luôn kèm chữ. */
export function VerdictChip({ v, children }: { v: "green" | "yellow" | "red" | "held"; children?: ReactNode }) {
  const t = { green: ["bg-good-soft text-good", "Xanh"], yellow: ["bg-warn-soft text-warn", "Vàng"], red: ["bg-bad-soft text-bad", "Đỏ"], held: ["bg-held-soft text-held", "Giữ lại"] }[v];
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-semibold whitespace-nowrap", t[0])}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />{children ?? t[1]}
    </span>
  );
}

export function Faq({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="divide-y divide-line border-y border-line">
      {items.map(([q, a], i) => (
        <details key={q} className="group py-5" open={i === 0}>
          <summary className="flex cursor-pointer list-none items-start justify-between gap-6 text-[16.5px] font-medium [&::-webkit-details-marker]:hidden">
            {q}<ChevronDown size={18} className="mt-1 shrink-0 text-faint transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="mt-3 max-w-[720px] text-[15px] leading-[1.7] text-muted">{a}</div>
        </details>
      ))}
    </div>
  );
}

/** Dải kêu gọi cuối trang, dùng chung mọi trang. */
export function CtaBand({ title = "Chạy thử LVDA trên máy", lead = "Cần Docker. Hai lệnh là có app, dữ liệu mẫu và tài khoản demo." }: { title?: string; lead?: string }) {
  return (
    <section className="pt-10 pb-24 sm:pb-30">
      <Container>
        <div className="lp-cta-bg relative overflow-hidden rounded-3xl border border-line-strong px-6 py-16 text-center sm:px-8 sm:py-20">
          <div className="relative">
            <H2 className="mx-auto max-w-[720px] sm:text-[48px] sm:leading-[1.08]">{title}</H2>
            <Lead className="mx-auto max-w-[540px] sm:text-[17px]">{lead}</Lead>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Cta to={L("bat-dau")}>Chạy thử trên máy</Cta>
              <Cta to={GITHUB} variant="secondary">Xem mã nguồn trên GitHub</Cta>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

/** Dòng ghi chú trung thực về trạng thái MVP, đặt cạnh mọi con số đo trên model giả lập. */
export function MvpNote({ className }: { className?: string }) {
  return (
    <p className={cx("text-[13px] leading-[1.6] text-faint", className)}>
      Đo trên lỗi do dự án tự sinh, dữ liệu tổng hợp theo schema Olist và model giả lập. <Link to={L("danh-gia")} className="text-accent hover:underline">Xem phương pháp và giới hạn</Link>
    </p>
  );
}
