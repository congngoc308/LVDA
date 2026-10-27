import { ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, GripVertical, Inbox, Lock, Pencil, Trash2 } from "lucide-react";
import { type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import {
  addFromTray, type Board, type CardSpec, isSystem, type Options, patchItem, removeCard, shift, type Size, SIZE_CLASS, SIZE_LABEL, toTray,
} from "../../dashboard";
import { cx } from "../ui";
import { MetricCard } from "./MetricCard";
import { SYSTEM_BODIES, type SystemData } from "./SystemCards";

type Apply = (fn: (b: Board) => Board) => void;
const MIME = "application/x-lvda-card";

// card trong vùng phụ kéo vào dashboard bằng kéo thả HTML5; card trên dashboard kéo bằng con trỏ (xem `grab`)
const readDrag = (e: DragEvent) => {
  try { return JSON.parse(e.dataTransfer.getData(MIME)) as { id: string; from: "tray" }; } catch { return null; }
};
const startDrag = (e: DragEvent, id: string) => {
  e.dataTransfer.setData(MIME, JSON.stringify({ id, from: "tray" }));
  e.dataTransfer.effectAllowed = "move";
};
const accepts = (e: DragEvent) => e.dataTransfer.types.includes(MIME);

export function cardSummary(c: CardSpec, options: Options | null) {
  const metric = options?.metrics.find((m) => m.id === c.metric_id)?.name_vi ?? c.metric_id;
  const dim = c.dimension ? `theo ${(options?.dimensions[c.dimension] ?? c.dimension).toLowerCase()}` : "một con số";
  const top = c.top && c.dimension !== "month" ? ` · top ${c.top}` : "";
  return `${metric} · ${dim}${top} · ${options?.periods[c.period] ?? c.period} · ${options?.charts[c.chart] ?? c.chart}`;
}

const Tool = ({ label, onClick, children, disabled, bad }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean; bad?: boolean }) => (
  <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
    className={cx("grid size-[26px] place-items-center rounded-md text-muted hover:bg-hover disabled:opacity-30 disabled:hover:bg-transparent", bad && "hover:bg-bad-soft hover:text-bad")}>{children}</button>
);

interface DragState { id: string; x: number; y: number; ox: number; oy: number; w: number; title: string; overTray: boolean }

/**
 * Lưới 12 cột. Ở chế độ sửa, kéo phần đầu card để đổi chỗ kiểu app di động: các card rút gọn lại, thứ tự đổi ngay
 * khi rê qua, card khác tự lùi chỗ (có hoạt ảnh). Thả lên vùng phụ để cất card; Esc để huỷ. Nút bấm làm được cùng việc.
 * `preview` đổi bản nháp mà chưa ghi lịch sử hoàn tác; `commit` ghi một bước hoàn tác cho cả lần kéo.
 */
export function BoardGrid({ board, edit, dbId, options, sys, sysTitles, apply, preview, commit, onEdit, hasTray, onOpenWizard }: {
  board: Board; edit: boolean; dbId: number; options: Options | null; sys: SystemData; sysTitles: Record<string, string>;
  apply: Apply; preview: (b: Board) => void; commit: (start: Board) => void; onEdit: (c: CardSpec) => void; hasTray: boolean; onOpenWizard: () => void;
}) {
  const [over, setOver] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const live = useRef(board);
  live.current = board;
  const cards = new Map(board.cards.map((c) => [c.id, c]));

  // FLIP: card đổi chỗ thì trượt từ chỗ cũ sang chỗ mới thay vì nhảy
  const pos = useRef(new Map<string, { l: number; t: number }>());
  useLayoutEffect(() => {
    const els = [...(grid.current?.querySelectorAll<HTMLElement>("section[data-card-id]") ?? [])];
    const next = new Map(els.map((el) => [el.dataset.cardId!, { l: el.offsetLeft, t: el.offsetTop }]));
    if (edit) els.forEach((el) => {
      const a = pos.current.get(el.dataset.cardId!), b = next.get(el.dataset.cardId!)!;
      if (!a || (Math.abs(a.l - b.l) < 1 && Math.abs(a.t - b.t) < 1)) return;
      el.animate([{ transform: `translate(${a.l - b.l}px, ${a.t - b.t}px)` }, { transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.7,.3,1)" });
    });
    pos.current = next;
  });

  const reorderAt = (x: number, y: number, id: string) => {
    const g = grid.current;
    if (!g) return;
    const box = g.getBoundingClientRect();
    for (const el of g.querySelectorAll<HTMLElement>("section[data-card-id]")) {
      const cid = el.dataset.cardId!;
      if (cid === id) continue;
      const l = box.left + el.offsetLeft, t = box.top + el.offsetTop, w = el.offsetWidth, h = el.offsetHeight;
      if (x < l || x > l + w || y < t || y > t + h) continue;
      const after = w > box.width * 0.75 ? y > t + h / 2 : x > l + w / 2;
      const b = live.current, rest = b.layout.filter((i) => i.id !== id), i = rest.findIndex((q) => q.id === cid);
      const at = after ? i + 1 : i;
      const layout = [...rest.slice(0, at), b.layout.find((q) => q.id === id)!, ...rest.slice(at)];
      if (layout.some((q, k) => q.id !== b.layout[k].id)) preview({ ...b, layout });
      return;
    }
  };

  const grab = (e: ReactPointerEvent<HTMLElement>, id: string, title: string) => {
    if (!edit || e.button !== 0 || (e.target as HTMLElement).closest("button,select,input")) return;
    e.preventDefault();
    const sec = e.currentTarget.closest("section")!, r = sec.getBoundingClientRect();
    const scroller = sec.closest<HTMLElement>("[data-scroller]");
    const start = live.current, sx = e.clientX, sy = e.clientY;
    const base = { id, ox: Math.min(sx - r.left, 200), oy: Math.min(sy - r.top, 22), w: Math.min(r.width, 320), title };
    let moved = false, last: PointerEvent | null = null, timer = 0, overTray = false;
    const begin = () => {
      moved = true;
      document.body.style.userSelect = "none"; document.body.style.cursor = "grabbing";
      setDrag({ ...base, x: sx, y: sy, overTray: false });
      // các card rút gọn làm trang ngắn lại: cuộn để card đang kéo vẫn nằm dưới con trỏ
      requestAnimationFrame(() => {
        const ph = grid.current?.querySelector<HTMLElement>(`section[data-card-id="${id}"]`);
        if (ph && scroller) scroller.scrollTop += ph.getBoundingClientRect().top - (sy - base.oy);
      });
      timer = window.setInterval(() => {
        if (!last || !scroller) return;
        const b = scroller.getBoundingClientRect(), y = last.clientY;
        const v = y < b.top + 70 ? -(b.top + 70 - y) / 4 : y > b.bottom - 70 ? (y - (b.bottom - 70)) / 4 : 0;
        if (v) { scroller.scrollTop += v; reorderAt(last.clientX, last.clientY, id); }
      }, 16);
    };
    const move = (ev: PointerEvent) => {
      if (!moved) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return; begin(); }
      last = ev;
      const tray = document.querySelector("[data-tray]")?.getBoundingClientRect();
      overTray = !!tray && !isSystem(id) && ev.clientX >= tray.left && ev.clientX <= tray.right && ev.clientY >= tray.top && ev.clientY <= tray.bottom;
      setDrag({ ...base, x: ev.clientX, y: ev.clientY, overTray });
      if (!overTray) reorderAt(ev.clientX, ev.clientY, id);
    };
    const finish = (cancel: boolean) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("keydown", key, true);
      clearInterval(timer);
      document.body.style.userSelect = ""; document.body.style.cursor = "";
      if (!moved) return;
      setDrag(null);
      if (cancel) { preview(start); return; }
      if (overTray) preview(toTray(live.current, id));
      commit(start);
    };
    const up = () => finish(false);
    const key = (ev: KeyboardEvent) => { if (ev.key === "Escape") { ev.stopPropagation(); finish(true); } };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("keydown", key, true);
  };

  const drop = (e: DragEvent, beforeId: string | null) => {
    e.preventDefault();
    setOver(null);
    const d = readDrag(e);
    if (d) apply((b) => addFromTray(b, d.id, beforeId));
  };
  const dragOver = (e: DragEvent, key: string) => {
    if (!edit || !accepts(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (over !== key) setOver(key);
  };

  return (
    <>
      <div ref={grid} className="relative grid grid-cols-12 gap-4">
        {board.layout.map((item, idx) => {
          const sysCard = isSystem(item.id);
          const spec = cards.get(item.id);
          if (!sysCard && !spec) return null;
          const Body = sysCard ? SYSTEM_BODIES[item.id] : null;
          if (sysCard && !Body) return null;
          const title = sysCard ? sysTitles[item.id] ?? item.id : spec!.title;
          const open = !item.collapsed && !drag;
          const alert = item.id === "sys:attention" && sys.queue.length > 0;
          return (
            <section key={item.id} aria-label={title} data-card-id={item.id}
              className={cx(SIZE_CLASS[item.size], "relative flex flex-col rounded-xl border bg-surface",
                alert ? "border-warn/45" : edit ? "border-dashed border-edge" : "border-line")}
              onDragOver={(e) => dragOver(e, item.id)} onDragLeave={() => over === item.id && setOver(null)} onDrop={(e) => drop(e, item.id)}>
              {over === item.id && <span className="pointer-events-none absolute -left-2.5 bottom-2.5 top-2.5 w-[3px] rounded-full bg-accent" aria-hidden />}
              {drag?.id === item.id && <span className="pointer-events-none absolute -inset-px z-[2] rounded-xl border-2 border-dashed border-accent bg-[color-mix(in_oklch,var(--color-accent)_10%,var(--color-paper))]" aria-hidden />}
              <header onPointerDown={(e) => grab(e, item.id, title)}
                className={cx("flex min-h-11 touch-none flex-wrap items-center gap-2 pl-[18px] pr-3 pt-2.5", edit && "cursor-grab")}>
                {edit && <span title="Kéo để đổi chỗ" className="-ml-2 flex text-faint"><GripVertical size={16} /></span>}
                <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{title}</h3>
                {drag && <span className="flex h-5 items-center rounded-full bg-sunk px-2 text-[11px] text-faint">{SIZE_LABEL[item.size]}</span>}
                {!sysCard && !edit && !drag && spec?.why && <span title={spec.why} className="hidden max-w-[45%] truncate pr-1.5 text-[11.5px] text-faint md:inline">{spec.why}</span>}
                {edit && !drag && (
                  <div className="-ml-2 flex basis-full flex-wrap items-center gap-0.5 rounded-lg bg-sunk p-1">
                    {sysCard && <span title="Card hệ thống: chỉ di chuyển, đổi cỡ, thu gọn" className="ml-1 mr-auto inline-flex items-center gap-1 whitespace-nowrap text-[11px] text-faint"><Lock size={12} /> Hệ thống</span>}
                    <Tool label="Lên trước" disabled={idx === 0} onClick={() => apply((b) => shift(b, item.id, -1))}><ChevronLeft size={14} /></Tool>
                    <Tool label="Ra sau" disabled={idx === board.layout.length - 1} onClick={() => apply((b) => shift(b, item.id, 1))}><ChevronRight size={14} /></Tool>
                    <span role="radiogroup" aria-label="Cỡ card" className="inline-flex gap-px rounded-[7px] bg-sunk p-0.5">
                      {(Object.keys(SIZE_LABEL) as Size[]).map((s) => (
                        <button key={s} role="radio" aria-checked={item.size === s} title={SIZE_LABEL[s]} onClick={() => apply((b) => patchItem(b, item.id, { size: s }))}
                          className={cx("h-[22px] min-w-6 rounded-[5px] px-[5px] font-mono text-[10.5px]", item.size === s ? "bg-hover text-ink" : "text-faint hover:text-ink-2")}>{s.toUpperCase()}</button>
                      ))}
                    </span>
                    <Tool label={item.collapsed ? "Mở rộng" : "Thu gọn"} onClick={() => apply((b) => patchItem(b, item.id, { collapsed: !item.collapsed }))}>
                      {item.collapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
                    </Tool>
                    {!sysCard && <>
                      <Tool label="Sửa card" onClick={() => onEdit(spec!)}><Pencil size={13} /></Tool>
                      <Tool label="Về vùng phụ" onClick={() => apply((b) => toTray(b, item.id))}><Inbox size={14} /></Tool>
                      <Tool label="Xóa card" bad onClick={() => apply((b) => removeCard(b, item.id))}><Trash2 size={13} /></Tool>
                    </>}
                  </div>
                )}
              </header>
              {open ? (
                <div className="flex min-h-0 flex-1 flex-col px-[18px] pb-[18px] pt-2.5">
                  {Body ? <Body {...sys} /> : <MetricCard dbId={dbId} spec={spec!} dimLabel={spec!.dimension ? options?.dimensions[spec!.dimension] : undefined} />}
                </div>
              ) : <div className="h-2.5" />}
            </section>
          );
        })}

        {edit ? (
          <div onDragOver={(e) => dragOver(e, "end")} onDragLeave={() => over === "end" && setOver(null)} onDrop={(e) => drop(e, null)}
            className={cx("col-span-12 grid min-h-16 place-items-center rounded-xl border-[1.5px] border-dashed text-[12.5px]",
              over === "end" ? "border-accent bg-accent-soft text-accent" : "border-edge text-faint")}>
            {hasTray ? "Thả card vào đây để thêm vào cuối dashboard" : "Vùng phụ đang trống. Tạo card bằng AI hoặc thêm thủ công."}
          </div>
        ) : board.cards.length === 0 && (
          <button onClick={onOpenWizard} className="col-span-12 flex items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-edge py-[22px] text-[13px] text-muted hover:border-accent hover:text-accent">
            + Thêm card chỉ số của riêng bạn: AI gợi ý theo vài câu hỏi
          </button>
        )}
      </div>

      {drag && <>
        <div className={cx("pointer-events-none fixed z-[60] flex -rotate-[1.5deg] scale-[1.03] items-center gap-2.5 rounded-xl border-[1.5px] bg-surface px-4 py-3 shadow-2xl",
          drag.overTray ? "border-warn" : "border-accent")} style={{ left: drag.x - drag.ox, top: drag.y - drag.oy, width: drag.w }}>
          <GripVertical size={16} className="shrink-0 text-faint" />
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{drag.title}</span>
        </div>
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex h-[34px] -translate-x-1/2 items-center whitespace-nowrap rounded-full bg-ink px-4 text-[12.5px] font-medium text-paper shadow-2xl">
          {drag.overTray ? "Thả để cất card vào vùng phụ" : "Thả để đặt card · Esc để huỷ"}
        </div>
      </>}
    </>
  );
}

/** Vùng phụ: card AI vừa sinh (hoặc tạo tay) chờ đưa vào dashboard. Cột bên phải ở màn rộng, ngăn kéo ở màn nhỏ. */
export function Tray({ board, dbId, options, apply, onEdit, onWizard, onNew, drawer, onAdded }: {
  board: Board; dbId: number; options: Options | null; apply: Apply; onEdit: (c: CardSpec) => void;
  onWizard: () => void; onNew: () => void; drawer: boolean; onAdded?: () => void;
}) {
  const tray = board.tray;
  return (
    <div data-tray={drawer ? undefined : "1"} className={cx("flex flex-col gap-3", drawer ? "p-4" : "rounded-xl border border-line bg-surface p-3.5")}>
      {!drawer && <>
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-[13.5px] font-semibold">Vùng phụ</h2>
          <span className="grid h-5 min-w-[22px] place-items-center rounded-full bg-sunk px-[7px] font-mono text-[11px] text-muted">{tray.length}</span>
        </div>
      </>}
      <div className="grid grid-cols-2 gap-1.5">
        <button onClick={onWizard} className="h-8 rounded-lg bg-accent text-[12.5px] font-semibold text-on-accent hover:bg-accent-2">Tạo bằng AI</button>
        <button onClick={onNew} className="h-8 rounded-lg border border-line text-[12.5px] font-medium hover:bg-hover">Thêm thủ công</button>
      </div>
      {tray.length > 1 && (
        <button onClick={() => { apply((b) => b.tray.reduce((acc, c) => addFromTray(acc, c.id), b)); onAdded?.(); }}
          className="h-7 rounded-lg text-[12.5px] text-accent hover:bg-accent-soft">Thêm tất cả vào dashboard</button>
      )}
      {tray.length === 0 ? (
        <div className="rounded-[10px] border-[1.5px] border-dashed border-edge px-3 py-[22px] text-center text-[12.5px] text-faint">
          {drawer ? "Chưa có card nào." : "Chưa có card nào. Kéo một card của bạn từ dashboard vào đây để cất tạm."}
        </div>
      ) : tray.map((c) => (
        <div key={c.id} draggable={!drawer} onDragStart={(e) => startDrag(e, c.id)}
          className={cx("flex flex-col gap-2 rounded-[10px] border border-line bg-paper p-3", !drawer && "cursor-grab active:cursor-grabbing")}>
          <div>
            <div className="truncate text-[13px] font-semibold">{c.title}</div>
            <div className="mt-0.5 text-[11.5px] text-faint">{cardSummary(c, options)}</div>
          </div>
          {c.why && <div className="text-[12px] text-ink-2">{c.why}</div>}
          <div className="rounded-lg bg-surface p-2.5"><MetricCard dbId={dbId} spec={c} compact dimLabel={c.dimension ? options?.dimensions[c.dimension] : undefined} /></div>
          <div className="flex gap-1">
            <button onClick={() => { apply((b) => addFromTray(b, c.id)); onAdded?.(); }} className="h-7 rounded-[7px] border border-line bg-surface px-2.5 text-[12px] font-medium hover:bg-hover">+ Thêm vào</button>
            <button onClick={() => onEdit(c)} className="h-7 rounded-[7px] px-2.5 text-[12px] text-ink-2 hover:bg-hover">Sửa</button>
            <button onClick={() => apply((b) => removeCard(b, c.id))} className="ml-auto h-7 rounded-[7px] px-2.5 text-[12px] text-muted hover:bg-bad-soft hover:text-bad">Bỏ</button>
          </div>
        </div>
      ))}
    </div>
  );
}
