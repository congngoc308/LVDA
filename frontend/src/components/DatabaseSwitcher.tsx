import { Plus, Search, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useSession } from "../session";
import { type SourceList, type SourceListItem, STATUS_DOT, SOURCE_STATUS_LABEL } from "../sources";
import type { DatabaseRef } from "../types";
import { Button, cx, Modal, Pill, timeAgo } from "./ui";

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("vi-VN");

function Row({ d, current, dot, meta, onOpen }: { d: DatabaseRef; current: boolean; dot: string; meta: ReactNode; onOpen: () => void }) {
  return (
    <li className={cx("flex items-center gap-3 border-t border-line py-2.5 first:border-t-0", d.expired && "opacity-60")}>
      <span className={cx("size-2 shrink-0 rounded-full", dot)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium">{d.name}</span>
          {current && <Pill tone="accent">Đang dùng</Pill>}
        </div>
        <div className="truncate text-[12px] text-muted">{meta}</div>
      </div>
      <Button size="sm" disabled={d.expired} onClick={onOpen}>Mở dữ liệu</Button>
    </li>
  );
}

/** Cửa sổ chọn database, mở từ ô Database trên sidebar. "Của bạn": database bạn là engineer, kèm trạng thái đồng bộ;
 *  "Được chia sẻ": database bạn là viewer, kèm người chia sẻ và hạn. Quản lý nguồn vẫn ở trang /sources. */
export function DatabaseSwitcher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { databases, db, canConnect, selectDb } = useSession();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Map<number, SourceListItem>>(new Map());
  useEffect(() => {
    if (!open) return;
    setQ("");
    if (canConnect) api<SourceList>("/sources").then((r) => setStatus(new Map(r.items.map((i) => [i.id, i])))).catch(() => {});
  }, [open, canConnect]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return databases.filter((d) => !s || d.name.toLowerCase().includes(s));
  }, [databases, q]);
  const mine = shown.filter((d) => d.role === "engineer");
  const shared = shown.filter((d) => d.role === "viewer");
  const openData = (id: number) => { selectDb(id); onClose(); nav("/data"); };
  const go = (to: string) => { onClose(); nav(to); };
  const expiry = (d: DatabaseRef) => d.expired ? `đã hết hạn ${fmtDay(d.expires_at!)}` : d.expires_at ? `hết hạn ${fmtDay(d.expires_at)}` : "không thời hạn";

  return (
    <Modal open={open} onClose={onClose} title="Chọn database" width={560}
      footer={canConnect ? <>
        <Button variant="ghost" onClick={() => go("/sources")}><Settings2 size={14} /> Quản lý nguồn</Button>
        <Button variant="primary" onClick={() => go("/sources/connect")}><Plus size={15} /> Kết nối database</Button>
      </> : undefined}>
      <div className="flex flex-col gap-4">
        <label className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm database…" aria-label="Tìm database"
            className="h-8 w-full rounded-md border border-line bg-surface pl-8 pr-2 text-[13px]" />
        </label>
        {mine.length > 0 && (
          <section>
            <h3 className="mb-1 text-[11.5px] font-semibold uppercase tracking-wider text-muted">Của bạn · {mine.length}</h3>
            <ul>
              {mine.map((d) => {
                const s = status.get(d.id);
                const meta = s ? <span className={s.status === "error" ? "text-bad" : undefined}>
                  {SOURCE_STATUS_LABEL[s.status]}{s.last_ok_at && s.status !== "builtin" ? ` · ${timeAgo(s.last_ok_at)}` : ""}</span>
                  : d.has_source ? "Đồng bộ từ nguồn" : "Có sẵn trong LVDA";
                return <Row key={d.id} d={d} current={d.id === db?.id} dot={s ? STATUS_DOT[s.status] : "bg-line-strong"} meta={meta} onOpen={() => openData(d.id)} />;
              })}
            </ul>
          </section>
        )}
        {shared.length > 0 && (
          <section>
            <h3 className="mb-1 text-[11.5px] font-semibold uppercase tracking-wider text-muted">Được chia sẻ · {shared.length}</h3>
            <ul>
              {shared.map((d) => (
                <Row key={d.id} d={d} current={d.id === db?.id} dot="border border-line-strong"
                  meta={<>{d.granted_by_name ? `Chia sẻ bởi ${d.granted_by_name.split(/\s*\(/)[0]}` : "Được cấp trực tiếp"} · {expiry(d)}</>} onOpen={() => openData(d.id)} />
              ))}
            </ul>
          </section>
        )}
        {shown.length === 0 && <p className="py-6 text-center text-[13px] text-muted">Không có database nào khớp.</p>}
      </div>
    </Modal>
  );
}
