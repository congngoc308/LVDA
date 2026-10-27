import { ArrowLeft, ArrowRight, ChevronsDownUp, ChevronsUpDown, GripVertical, Inbox, Lock, Pencil, Plus, Sparkles, Trash2, Undo2 } from "lucide-react";
import { type DragEvent, type ReactNode, useState } from "react";
import {
  addFromTray, type Board, type CardSpec, isSystem, moveBefore, type Options, patchItem, removeCard, shift, type Size, SIZE_CLASS, SIZE_LABEL, toTray,
} from "../../dashboard";
import { Button, cx } from "../ui";
import { MetricCard } from "./MetricCard";
import { SYSTEM_BODIES, type SystemData } from "./SystemCards";

type Apply = (fn: (b: Board) => Board) => void;
const MIME = "application/x-lvda-card";

const readDrag = (e: DragEvent) => {
  try { return JSON.parse(e.dataTransfer.getData(MIME)) as { id: string; from: "board" | "tray" }; } catch { return null; }
};
const startDrag = (e: DragEvent, id: string, from: "board" | "tray") => {
  e.dataTransfer.setData(MIME, JSON.stringify({ id, from }));
  e.dataTransfer.effectAllowed = "move";
};
const accepts = (e: DragEvent) => e.dataTransfer.types.includes(MIME);

export function cardSummary(c: CardSpec, options: Options | null) {
  const metric = options?.metrics.find((m) => m.id === c.metric_id)?.name_vi ?? c.metric_id;
  const dim = c.dimension ? `theo ${(options?.dimensions[c.dimension] ?? c.dimension).toLowerCase()}` : "một con số";
  const top = c.top && c.dimension !== "month" ? ` · top ${c.top}` : "";
  return `${metric} · ${dim}${top} · ${options?.periods[c.period] ?? c.period} · ${options?.charts[c.chart] ?? c.chart}`;
}

const IconBtn = ({ label, onClick, children, disabled, tone }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean; tone?: "bad" }) => (
  <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
    className={cx("grid size-7 place-items-center rounded text-muted hover:bg-sunk disabled:opacity-30", tone === "bad" && "hover:text-bad")}>{children}</button>
);

/** Lưới 12 cột. Ở chế độ sửa mỗi card có thanh công cụ; kéo thả và nút bấm làm cùng một việc. */
export function BoardGrid({ board, edit, dbId, options, sys, sysTitles, apply, onEdit, hasTray, onOpenWizard }: {
  board: Board; edit: boolean; dbId: number; options: Options | null; sys: SystemData; sysTitles: Record<string, string>;
  apply: Apply; onEdit: (c: CardSpec) => void; hasTray: boolean; onOpenWizard: () => void;
}) {
  const [over, setOver] = useState<string | null>(null);
  const cards = new Map(board.cards.map((c) => [c.id, c]));
  const userCount = board.cards.length;

  const drop = (e: DragEvent, beforeId: string | null) => {
    e.preventDefault();
    setOver(null);
    const d = readDrag(e);
    if (!d || d.id === beforeId) return;
    apply((b) => (d.from === "tray" ? addFromTray(b, d.id, beforeId) : moveBefore(b, d.id, beforeId)));
  };
  const dragOver = (e: DragEvent, key: string) => {
    if (!edit || !accepts(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (over !== key) setOver(key);
  };

  return (
    <div className="grid grid-cols-12 gap-4">
      {board.layout.map((item, idx) => {
        const sysCard = isSystem(item.id);
        const spec = cards.get(item.id);
        if (!sysCard && !spec) return null;
        const title = sysCard ? sysTitles[item.id] ?? item.id : spec!.title;
        const Body = sysCard ? SYSTEM_BODIES[item.id] : null;
        return (
          <section key={item.id} aria-label={title}
            className={cx(SIZE_CLASS[item.size], "relative flex flex-col rounded-lg border bg-surface transition-shadow",
              sysCard && item.id === "sys:queue" && sys.queue.length > 0 ? "border-warn/50" : "border-line",
              edit && "shadow-[0_0_0_1px_var(--color-line)]")}
            onDragOver={(e) => dragOver(e, item.id)} onDragLeave={() => over === item.id && setOver(null)} onDrop={(e) => drop(e, item.id)}>
            {over === item.id && <span className="pointer-events-none absolute -left-2.5 top-2 bottom-2 w-1 rounded-full bg-accent" aria-hidden />}
            <header className={cx("flex items-center gap-1.5 px-4 pt-3", item.collapsed ? "pb-3" : "pb-2")}>
              {edit && (
                <span draggable onDragStart={(e) => startDrag(e, item.id, "board")} onDragEnd={() => setOver(null)}
                  className="-ml-2 cursor-grab text-faint active:cursor-grabbing" title="Kéo để đổi chỗ"><GripVertical size={16} /></span>
              )}
              <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{title}</h3>
              {sysCard && edit && <span className="inline-flex items-center gap-1 text-[11.5px] text-muted" title="Card hệ thống: chỉ di chuyển, đổi cỡ, thu gọn"><Lock size={12} /> Hệ thống</span>}
              {!sysCard && !edit && spec?.why && <span className="hidden max-w-[50%] truncate text-[11.5px] text-muted md:inline" title={spec.why}>{spec.why}</span>}
            </header>
            {edit && (
              <div className="mx-3 mb-2 flex flex-wrap items-center gap-0.5 rounded-md bg-sunk/70 px-1 py-0.5">
                <IconBtn label="Lên trước" disabled={idx === 0} onClick={() => apply((b) => shift(b, item.id, -1))}><ArrowLeft size={14} /></IconBtn>
                <IconBtn label="Ra sau" disabled={idx === board.layout.length - 1} onClick={() => apply((b) => shift(b, item.id, 1))}><ArrowRight size={14} /></IconBtn>
                <select aria-label="Cỡ card" value={item.size} onChange={(e) => apply((b) => patchItem(b, item.id, { size: e.target.value as Size }))}
                  className="h-7 rounded bg-transparent px-1 text-[12px] text-ink-2 hover:bg-sunk">
                  {(Object.keys(SIZE_LABEL) as Size[]).map((s) => <option key={s} value={s}>{SIZE_LABEL[s]}</option>)}
                </select>
                <IconBtn label={item.collapsed ? "Mở rộng" : "Thu gọn"} onClick={() => apply((b) => patchItem(b, item.id, { collapsed: !item.collapsed }))}>
                  {item.collapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />}
                </IconBtn>
                {!sysCard && <>
                  <span className="mx-1 h-4 w-px bg-line" />
                  <IconBtn label="Sửa card" onClick={() => onEdit(spec!)}><Pencil size={13} /></IconBtn>
                  <IconBtn label="Về vùng phụ" onClick={() => apply((b) => toTray(b, item.id))}><Undo2 size={14} /></IconBtn>
                  <IconBtn label="Xóa card" tone="bad" onClick={() => apply((b) => removeCard(b, item.id))}><Trash2 size={13} /></IconBtn>
                </>}
              </div>
            )}
            {!item.collapsed && (
              <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
                {Body ? <Body {...sys} /> : <MetricCard dbId={dbId} spec={spec!} dimLabel={spec!.dimension ? options?.dimensions[spec!.dimension] : undefined} />}
              </div>
            )}
          </section>
        );
      })}

      {edit ? (
        <div onDragOver={(e) => dragOver(e, "end")} onDragLeave={() => over === "end" && setOver(null)} onDrop={(e) => drop(e, null)}
          className={cx("col-span-12 grid min-h-[72px] place-items-center rounded-lg border-2 border-dashed text-[12.5px] text-muted",
            over === "end" ? "border-accent bg-accent-soft text-accent" : "border-line")}>
          {hasTray ? "Thả card vào đây để thêm vào cuối dashboard" : "Vùng phụ đang trống. Tạo card bằng AI hoặc thêm thủ công."}
        </div>
      ) : userCount === 0 && (
        <button onClick={onOpenWizard} className="col-span-12 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-line py-6 text-[13px] text-muted hover:border-accent hover:text-accent">
          <Sparkles size={15} /> Thêm card của riêng bạn: bấm để AI gợi ý theo vài câu hỏi
        </button>
      )}
    </div>
  );
}

/** Vùng phụ: card AI vừa sinh (hoặc tạo tay) chờ đưa vào dashboard. Cột bên phải ở màn rộng, ngăn kéo ở màn nhỏ. */
export function Tray({ board, dbId, options, apply, onEdit, onWizard, onNew, drawer, onAdded }: {
  board: Board; dbId: number; options: Options | null; apply: Apply; onEdit: (c: CardSpec) => void;
  onWizard: () => void; onNew: () => void; drawer: boolean; onAdded?: () => void;
}) {
  const [over, setOver] = useState(false);
  const tray = board.tray;
  return (
    <div className={cx("flex flex-col gap-3", !drawer && "rounded-lg border bg-surface p-3", !drawer && (over ? "border-accent bg-accent-soft/40" : "border-line"), drawer && "p-4")}
      onDragOver={(e) => { if (drawer || !accepts(e)) return; e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false);
        const d = readDrag(e);
        if (d?.from === "board" && !isSystem(d.id)) apply((b) => toTray(b, d.id));
      }}>
      {!drawer && (
        <div className="flex items-center gap-2">
          <Inbox size={15} className="text-muted" />
          <h2 className="flex-1 text-[13.5px] font-semibold">Vùng phụ <span className="num font-normal text-muted">({tray.length})</span></h2>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="primary" onClick={onWizard}><Sparkles size={14} /> Tạo bằng AI</Button>
        <Button size="sm" onClick={onNew}><Plus size={14} /> Thêm thủ công</Button>
        {tray.length > 1 && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { apply((b) => b.tray.reduce((acc, c) => addFromTray(acc, c.id), b)); onAdded?.(); }}>
            Thêm tất cả
          </Button>
        )}
      </div>
      {tray.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-muted">
          {drawer ? "Chưa có card nào." : "Chưa có card nào. Kéo một card của bạn từ dashboard vào đây để cất tạm."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tray.map((c) => (
            <li key={c.id} draggable={!drawer} onDragStart={(e) => startDrag(e, c.id, "tray")}
              className={cx("rounded-md border border-line bg-surface p-3", !drawer && "cursor-grab active:cursor-grabbing")}>
              <div className="flex items-start gap-1.5">
                {!drawer && <GripVertical size={14} className="mt-0.5 shrink-0 text-faint" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold">{c.title}</div>
                  <div className="text-[11.5px] text-muted">{cardSummary(c, options)}</div>
                </div>
              </div>
              {c.why && <p className="mt-1.5 text-[12px] text-ink-2">Vì sao: {c.why}</p>}
              <div className="mt-2 rounded border border-line/70 p-2"><MetricCard dbId={dbId} spec={c} compact dimLabel={c.dimension ? options?.dimensions[c.dimension] : undefined} /></div>
              <div className="mt-2 flex flex-wrap gap-1">
                <Button size="sm" onClick={() => apply((b) => addFromTray(b, c.id))} title="Thêm vào cuối dashboard"><Plus size={13} /> Thêm vào</Button>
                <Button size="sm" variant="ghost" onClick={() => onEdit(c)}><Pencil size={13} /> Sửa</Button>
                <Button size="sm" variant="ghost" className="ml-auto hover:text-bad" onClick={() => apply((b) => removeCard(b, c.id))}><Trash2 size={13} /> Bỏ</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
