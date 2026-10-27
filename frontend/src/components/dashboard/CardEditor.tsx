import { Check, ChevronDown, Plus } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import {
  canCompare, CARD_COLORS, type CardColor, type CardSpec, type Chart, defaultChart, newCardId, type Options, type Period, validCharts,
} from "../../dashboard";
import { Button, cx, Drawer } from "../ui";
import { MetricCard } from "./MetricCard";

const field = "h-[38px] w-full rounded-lg border border-line bg-paper px-3 text-[13px] outline-none focus:border-accent";

/** Biểu tượng nhỏ của từng dạng hiển thị (40×24). */
const CHART_ICON: Record<Chart, ReactNode> = {
  number: <><rect x="4" y="5" width="14" height="6" rx="1.5" fill="currentColor" stroke="none" /><polyline points="4,19 12,16 20,18 28,12 36,14" /></>,
  gauge: <><path d="M6 20 A14 14 0 0 1 34 20" strokeWidth={4} opacity={0.35} /><path d="M6 20 A14 14 0 0 1 26 8" strokeWidth={4} /></>,
  line: <polyline points="3,18 11,12 19,15 27,7 37,10" />,
  area: <><path d="M3 18 L11 12 L19 15 L27 7 L37 10 L37 21 L3 21 Z" fill="currentColor" stroke="none" opacity={0.35} /><polyline points="3,18 11,12 19,15 27,7 37,10" /></>,
  column: <>{[[5, 12, 9], [13, 7, 14], [21, 10, 11], [29, 4, 17]].map(([x, y, h]) => <rect key={x} x={x} y={y} width="5" height={h} rx="1" fill="currentColor" stroke="none" />)}</>,
  cumulative: <><polyline points="3,21 11,18 19,13 27,9 37,3" /><line x1="3" x2="37" y1="21" y2="21" opacity={0.35} /></>,
  heat: <>{[0.25, 0.6, 0.4, 1, 0.7].map((o, i) => <rect key={i} x={3 + i * 7} y="6" width="6" height="12" rx="1" fill="currentColor" stroke="none" opacity={o} />)}</>,
  bar: <>{[30, 22, 13].map((w, i) => <rect key={i} x="4" y={3 + i * 7} width={w} height="4" rx="1" fill="currentColor" stroke="none" />)}</>,
  donut: <><circle cx="20" cy="12" r="8" strokeWidth={4} opacity={0.35} /><circle cx="20" cy="12" r="8" transform="rotate(-90 20 12)" strokeWidth={4} strokeDasharray="30 60" strokeLinecap="butt" /></>,
  stacked: <><rect x="3" y="8" width="15" height="8" rx="1" fill="currentColor" stroke="none" /><rect x="19" y="8" width="10" height="8" fill="currentColor" stroke="none" opacity={0.6} /><rect x="30" y="8" width="7" height="8" rx="1" fill="currentColor" stroke="none" opacity={0.3} /></>,
  table: <><rect x="5" y="3" width="30" height="18" rx="2" /><line x1="5" x2="35" y1="9" y2="9" /><line x1="5" x2="35" y1="15" y2="15" /><line x1="18" x2="18" y1="3" y2="21" /></>,
};

function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return <span className="font-medium">{children}{hint && <span className="font-normal text-faint"> ({hint})</span>}</span>;
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-[2px] rounded-[9px] bg-sunk p-[3px]">
      {options.map(([v, l]) => (
        <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cx("h-[30px] flex-1 rounded-[7px] text-[12.5px]", value === v ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}>{l}</button>
      ))}
    </div>
  );
}

/** Ô chọn mở danh sách bên dưới (thay cho select của trình duyệt); `extra` là phần cuối danh sách, ví dụ lối tạo mới. */
function Picker({ label, value, items, onPick, open, setOpen, extra }: {
  label: string; value: string; items: { v: string; l: string; sub?: string }[]; onPick: (v: string) => void;
  open: boolean; setOpen: (o: boolean) => void; extra?: ReactNode;
}) {
  const current = items.find((i) => i.v === value);
  useEffect(() => {
    if (!open) return;
    // Esc chỉ đóng danh sách, không đóng cả ngăn kéo (listener capture trên window chạy trước listener của Drawer)
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); setOpen(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, setOpen]);
  return (
    <div className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)}
        className={cx("flex h-10 w-full items-center gap-2.5 rounded-[9px] border bg-paper pl-3 pr-2 text-left text-[13px] hover:border-edge", open ? "border-accent" : "border-line")}>
        <span className="min-w-0 flex-1 truncate">{current?.l ?? "Chọn"}</span>
        <span className={cx("grid size-6 shrink-0 place-items-center rounded-[7px] bg-sunk text-muted transition-transform", open && "rotate-180")}><ChevronDown size={14} strokeWidth={2.4} /></span>
      </button>
      {open && <>
        <div className="fixed inset-0 z-[1]" onMouseDown={() => setOpen(false)} />
        <div role="listbox" aria-label={label} className="scroll-thin absolute inset-x-0 top-[calc(100%+6px)] z-[2] max-h-[300px] overflow-y-auto rounded-xl border border-line bg-surface p-[5px] shadow-2xl">
          {items.map((i) => (
            <button key={i.v} type="button" role="option" aria-selected={i.v === value} onClick={() => { onPick(i.v); setOpen(false); }}
              className={cx("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-hover", i.v === value ? "text-accent" : "text-ink")}>
              <span className="min-w-0 flex-1 truncate">{i.l}</span>
              {i.sub && <span className="font-mono text-[11px] text-faint">{i.sub}</span>}
              {i.v === value && <Check size={14} strokeWidth={2.6} className="shrink-0" />}
            </button>
          ))}
          {extra}
        </div>
      </>}
    </div>
  );
}

/** Sửa (hoặc tạo tay) một card: chỉ chọn trong chỉ số đã chứng nhận và chiều chia mà chỉ số đó hỗ trợ.
 *  `onNewMetric`: chỉ số cần chưa có thì mở màn hình thêm chỉ số của tab Hỏi & kiểm. */
export function CardEditor({ dbId, options, card, onClose, onApply, onNewMetric }: {
  dbId: number; options: Options | null; card: CardSpec | "new" | null; onClose: () => void; onApply: (c: CardSpec) => void; onNewMetric: () => void;
}) {
  const [draft, setDraft] = useState<CardSpec | null>(null);
  const [menu, setMenu] = useState<"metric" | "dim" | null>(null);

  useEffect(() => {
    setMenu(null);
    if (card === null || !options) { setDraft(null); return; }
    if (card !== "new") { setDraft(card); return; }
    const m = options.metrics[0];
    setDraft({ id: newCardId(), kind: "metric", title: m?.name_vi ?? "", metric_id: m?.id ?? "", dimension: null, period: "2018", chart: "number", top: null, why: null, color: "blue" });
  }, [card, options]);

  if (card === null) return null;
  if (!draft || !options) return <Drawer open onClose={onClose} width={500} title="Card"><p className="p-5 text-[13px] text-muted">Đang tải danh sách chỉ số…</p></Drawer>;

  const metric = options.metrics.find((m) => m.id === draft.metric_id);
  const dims = metric?.dimensions ?? [];
  const charts = validCharts(draft.dimension, metric);
  const set = (patch: Partial<CardSpec>) => setDraft({ ...draft, ...patch });
  const fitChart = (d: string | null, m = metric) => (validCharts(d, m).includes(draft.chart) ? draft.chart : defaultChart(d));
  const setDim = (d: string | null) => set({ dimension: d, chart: fitChart(d), top: d && d !== "month" ? draft.top ?? 10 : null });
  const setMetric = (id: string) => {
    const m = options.metrics.find((x) => x.id === id);
    const keepTitle = draft.title && draft.title !== metric?.name_vi;
    const d = draft.dimension && m?.dimensions.includes(draft.dimension) ? draft.dimension : null;
    set({ metric_id: id, title: keepTitle ? draft.title : m?.name_vi ?? id, dimension: d, chart: fitChart(d, m), top: d && d !== "month" ? draft.top ?? 10 : null });
  };
  const ok = draft.title.trim().length > 0 && !!metric;
  const grouped = !!draft.dimension && draft.dimension !== "month";
  const compareOk = canCompare(draft);

  return (
    <Drawer open onClose={onClose} width={500} title={card === "new" ? "Thêm card thủ công" : "Sửa card"}
      footer={<><Button onClick={onClose}>Huỷ</Button><Button variant="primary" disabled={!ok} onClick={() => onApply({ ...draft, title: draft.title.trim(), compare: compareOk && !!draft.compare })}>Áp dụng</Button></>}>
      <div className="flex flex-col gap-[18px] p-5">
        <div className="rounded-xl bg-paper p-4">
          <div className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.04em] text-faint">Xem trước</div>
          {metric ? <MetricCard dbId={dbId} spec={draft} dimLabel={draft.dimension ? options.dimensions[draft.dimension] : undefined} />
            : <p className="text-[13px] text-muted">Chọn một chỉ số.</p>}
        </div>

        <label className="flex flex-col gap-1.5 text-[13px]"><Label>Tiêu đề</Label>
          <input className={field} value={draft.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} />
        </label>

        <div className="flex flex-col gap-1.5 text-[13px]"><Label hint="chỉ chỉ số đã chứng nhận">Chỉ số</Label>
          <Picker label="Chỉ số" value={draft.metric_id} open={menu === "metric"} setOpen={(o) => setMenu(o ? "metric" : null)} onPick={setMetric}
            items={options.metrics.map((m) => ({ v: m.id, l: m.name_vi, sub: m.id }))}
            extra={
              <div className="mt-[5px] border-t border-line pt-[5px]">
                <button type="button" onClick={() => { setMenu(null); onNewMetric(); }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-hover">
                  <span className="grid size-[18px] shrink-0 place-items-center rounded-[5px] bg-accent-soft text-accent"><Plus size={12} strokeWidth={2.6} /></span>
                  <span className="text-[13px] font-medium text-accent">Thêm chỉ số mới</span>
                </button>
              </div>
            } />
        </div>

        <div className={cx("grid gap-3", grouped && "grid-cols-[minmax(0,1fr)_110px]")}>
          <div className="flex flex-col gap-1.5 text-[13px]"><Label>Chia theo</Label>
            <Picker label="Chia theo" value={draft.dimension ?? ""} open={menu === "dim"} setOpen={(o) => setMenu(o ? "dim" : null)} onPick={(v) => setDim(v || null)}
              items={[{ v: "", l: "Không chia (một con số)" }, ...dims.map((d) => ({ v: d, l: options.dimensions[d] ?? d }))]} />
          </div>
          {grouped && (
            <label className="flex flex-col gap-1.5 text-[13px]"><Label>Lấy top</Label>
              <input type="number" min={1} max={30} className={field} value={draft.top ?? 10}
                onChange={(e) => set({ top: Math.min(30, Math.max(1, Number(e.target.value) || 1)) })} />
            </label>
          )}
        </div>

        <div className="flex flex-col gap-1.5 text-[13px]"><Label>Thời gian</Label>
          <Seg label="Thời gian" value={draft.period} onChange={(p: Period) => set({ period: p })} options={(Object.keys(options.periods) as Period[]).map((p) => [p, options.periods[p]])} />
        </div>

        <div className="flex flex-col gap-1.5 text-[13px]"><Label>Dạng hiển thị</Label>
          <div role="radiogroup" aria-label="Dạng hiển thị" className="grid grid-cols-4 gap-2">
            {charts.map((c) => (
              <button key={c} role="radio" aria-checked={draft.chart === c} onClick={() => set({ chart: c })}
                className={cx("flex min-w-0 flex-col items-center gap-1.5 rounded-[10px] border-[1.5px] px-1.5 pb-2 pt-2.5 text-center text-[11.5px] leading-tight",
                  draft.chart === c ? "border-accent bg-accent-soft text-ink" : "border-line bg-paper text-muted hover:border-edge")}>
                <svg viewBox="0 0 40 24" width={40} height={24} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{CHART_ICON[c]}</svg>
                {options.charts[c] ?? c}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 text-[13px]"><Label>Màu</Label>
          <div role="radiogroup" aria-label="Màu" className="flex gap-2.5">
            {(Object.keys(CARD_COLORS) as CardColor[]).map((k) => (
              <button key={k} role="radio" aria-checked={(draft.color ?? "blue") === k} onClick={() => set({ color: k })} title={CARD_COLORS[k].label} aria-label={CARD_COLORS[k].label}
                className={cx("size-7 rounded-full border-2 p-0.5", (draft.color ?? "blue") === k ? "border-ink" : "border-transparent")}>
                <span className="block size-full rounded-full" style={{ background: CARD_COLORS[k].css }} />
              </button>
            ))}
          </div>
        </div>

        {grouped && (
          <div className="flex flex-col gap-1.5 text-[13px]"><Label>Sắp xếp</Label>
            <Seg label="Sắp xếp" value={draft.sort ?? "desc"} onChange={(v) => set({ sort: v })} options={[["desc", "Lớn → nhỏ"], ["asc", "Nhỏ → lớn"]]} />
          </div>
        )}

        {compareOk ? (
          <button role="switch" aria-checked={!!draft.compare} onClick={() => set({ compare: !draft.compare })}
            className="flex w-full items-center gap-3 rounded-[10px] border border-line bg-paper px-3 py-2.5 text-left">
            <span className="min-w-0 flex-1 text-[13px] font-medium">So với cùng kỳ năm trước</span>
            <span className={cx("relative block h-5 w-[34px] shrink-0 rounded-full transition-colors", draft.compare ? "bg-accent" : "bg-edge")}>
              <span className={cx("absolute top-0.5 block size-4 rounded-full bg-surface shadow transition-[left]", draft.compare ? "left-4" : "left-0.5")} />
            </span>
          </button>
        ) : (
          <p className="text-[12px] text-faint">So với cùng kỳ năm trước: {draft.period !== "2018" ? "chỉ có khi chọn Năm 2018 (so với cùng kỳ 2017)." : "chỉ có với số lớn hoặc chia theo tháng."}</p>
        )}
      </div>
    </Drawer>
  );
}
