import { AlertTriangle, Check, CheckCircle2, CircleSlash, Hand, ShieldAlert, X } from "lucide-react";
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Verdict } from "../types";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/** Màn đủ rộng để đặt cột phụ (lịch sử, chi tiết) cạnh nội dung thay vì mở ngăn kéo. */
export function useWide(query = "(min-width: 1280px)") {
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return wide;
}

type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
export function Button({ variant = "secondary", size = "md", className, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  const v = {
    primary: "bg-accent text-on-accent hover:bg-accent-2 disabled:bg-line-strong disabled:text-dim",
    secondary: "bg-transparent text-ink border border-line-strong hover:bg-hover disabled:text-dim",
    ghost: "text-ink-2 hover:bg-hover disabled:text-dim",
    danger: "bg-transparent text-bad border border-bad/40 hover:bg-bad-soft",
  }[variant];
  const s = size === "sm" ? "h-7 px-2.5 text-[12.5px] gap-1.5" : "h-8 px-3 text-[13px] gap-1.5";
  return <button {...rest} className={cx("inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:cursor-not-allowed", v, s, className)} />;
}

export const VERDICT_META: Record<string, { label: string; long: string; cls: string; soft: string; Icon: typeof CheckCircle2 }> = {
  green: { label: "Xanh", long: "Khớp định nghĩa", cls: "text-good border-good", soft: "bg-good-soft text-good", Icon: CheckCircle2 },
  yellow: { label: "Vàng", long: "Cần xem lại", cls: "text-warn border-warn", soft: "bg-warn-soft text-warn", Icon: AlertTriangle },
  red: { label: "Đỏ", long: "Sai cấu trúc", cls: "text-bad border-bad", soft: "bg-bad-soft text-bad", Icon: ShieldAlert },
  blocked: { label: "Chặn", long: "Câu lệnh bị chặn", cls: "text-bad border-bad", soft: "bg-bad-soft text-bad", Icon: CircleSlash },
  held: { label: "Giữ lại", long: "Không công bố số", cls: "text-held border-held", soft: "bg-held-soft text-held", Icon: Hand },
  unchecked: { label: "Chưa kiểm", long: "Chưa kiểm", cls: "text-muted border-line-strong", soft: "bg-raised text-muted", Icon: AlertTriangle },
};

/** Con dấu kiểm định: thành phần nhận diện của LVDA. Luôn có chữ + biểu tượng, không chỉ màu. */
export function VerdictStamp({ verdict, held = false, size = "md" }: { verdict: Verdict | null; held?: boolean; size?: "sm" | "md" }) {
  if (!verdict) return null;
  const meta = VERDICT_META[held ? "held" : verdict] ?? VERDICT_META.unchecked;
  const { Icon } = meta;
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] font-medium",
      size === "sm" ? "h-5 px-1.5 text-[11.5px]" : "h-6 px-[9px] text-[12px]", meta.soft)}>
      {verdict === "green" && !held ? <Check size={size === "sm" ? 10 : 11} strokeWidth={2.8} aria-hidden /> : <Icon size={size === "sm" ? 11 : 12} strokeWidth={2.2} aria-hidden />}
      {size === "md" ? `Đã kiểm · ${meta.label}` : meta.label}
    </span>
  );
}

export function VerdictDot({ verdict }: { verdict: Verdict | null }) {
  const colors: Record<string, string> = { green: "bg-good", yellow: "bg-warn", red: "bg-bad", blocked: "bg-bad" };
  const c = colors[verdict ?? ""] ?? "bg-line-strong";
  return <span className={cx("inline-block size-2 shrink-0 rounded-full", c)} aria-hidden />;
}

export function RuleChip({ rule, severity }: { rule: string; severity: string }) {
  const cls = { high: "bg-bad-soft text-bad", medium: "bg-warn-soft text-warn", low: "bg-raised text-ink-2", info: "bg-accent-soft text-accent" }[severity] ?? "bg-raised";
  return <span className={cx("rounded px-1.5 py-px font-mono text-[11px] font-medium", cls)}>{rule}</span>;
}

export function Pill({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "accent" | "good" | "warn" | "bad" | "held"; className?: string }) {
  const t = { neutral: "bg-raised text-ink-2", accent: "bg-accent-soft text-accent", good: "bg-good-soft text-good", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", held: "bg-held-soft text-held" }[tone];
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium", t, className)}>{children}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-6 py-4">
      <div className="min-w-0">
        <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-balance">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-[13px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-lg border border-line bg-surface", className)}>{children}</div>;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="grid place-items-center px-6 py-16 text-center">
      {icon && <div className="mb-3 text-faint">{icon}</div>}
      <div className="font-medium">{title}</div>
      {children && <div className="mt-1 max-w-md text-muted">{children}</div>}
    </div>
  );
}

export function Drawer({ open, onClose, title, children, width = 560 }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-[rgba(5,6,8,0.6)]" onMouseDown={onClose}>
      <aside data-drawer className="flex h-full max-w-[94vw] flex-col border-l border-line-strong bg-surface" style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0 text-[14px] font-semibold">{title}</div>
          <button className="grid size-[30px] place-items-center rounded-md text-muted hover:bg-line hover:text-ink" onClick={onClose} aria-label="Đóng" title="Đóng"><X size={15} /></button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{children}</div>
      </aside>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, width = 640 }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-label={title} className="flex max-h-[90vh] w-full flex-col rounded-[10px] border border-line-strong bg-surface shadow-2xl" style={{ maxWidth: width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="font-semibold">{title}</div>
          <button className="grid size-[30px] place-items-center rounded-md text-muted hover:bg-line hover:text-ink" onClick={onClose} aria-label="Đóng"><X size={15} /></button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <div role="alert" className="rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-[13px] text-bad">{children}</div>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-[5px] border border-b-2 border-line-strong bg-sunk px-1.5 py-px font-mono text-[11px] text-ink-2">{children}</kbd>;
}

export function timeAgo(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "vừa xong";
  if (d < 3600) return `${Math.floor(d / 60)} phút trước`;
  if (d < 86400) return `${Math.floor(d / 3600)} giờ trước`;
  return new Date(iso).toLocaleDateString("vi-VN");
}

export function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function shortCol(c: string) {
  return c.startsWith("mart.") ? c.slice(5) : c;
}
