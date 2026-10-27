import { Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { cx, fmtDay, Segmented } from "../components/ui";

export interface MemberRow {
  user_id: number; name: string; email: string; role: "viewer" | "engineer"; can_certify: boolean; granted_via: "direct" | "link";
  expires_at: string | null; granted_by_name: string | null; expired: boolean;
}
export interface LinkRow { id: number; role: string; expires_at: string; max_uses: number | null; uses: number; created_at: string; created_by_name: string; state: string }

const STATE: Record<string, [string, string]> = {
  active: ["đang hiệu lực", "text-accent"], expired: ["hết hạn", "text-faint"], revoked: ["đã thu hồi", "text-bad"], used_up: ["hết lượt", "text-warn"],
};
const firstName = (n: string | null) => (n ?? "—").split(/\s*\(/)[0];

function Th({ children, first = false }: { children?: string; first?: boolean }) {
  return <th className={cx("whitespace-nowrap px-3 py-2.5 text-left text-[12px] font-normal text-faint", first && "pl-[18px]")}>{children}</th>;
}

/** Thành viên của database: quyền, quyền chứng nhận, cấp qua đâu và hạn. Sửa được khi bạn là engineer gán trực tiếp. */
export function MembersTable({ members, canManage, selfId, act, dbId }: {
  members: MemberRow[]; canManage: boolean; selfId?: number; dbId: number; act: (fn: () => Promise<unknown>) => void;
}) {
  const patch = (m: MemberRow, body: Record<string, unknown>) => act(() => api(`/db/${dbId}/members/${m.user_id}`, { method: "PATCH", body }));
  return (
    <div className="overflow-x-auto rounded-[10px] border border-line bg-surface">
      <table className="w-full border-collapse text-[13.5px]">
        <thead><tr className="border-b border-line"><Th first>Người dùng</Th><Th>Quyền</Th><Th>Chứng nhận</Th><Th>Cấp qua</Th><th className="w-10" /></tr></thead>
        <tbody>
          {members.map((m) => {
            const self = m.user_id === selfId;
            const editable = canManage && !self && !m.expired;
            const eng = m.role === "engineer";
            return (
              <tr key={m.user_id} className={cx("border-t border-line-soft first:border-t-0", m.expired && "opacity-55")}>
                <td className="py-3 pl-[18px] pr-3">
                  <div className="flex items-center gap-3">
                    <span className={cx("grid size-8 shrink-0 place-items-center rounded-full text-[12.5px] font-semibold", eng ? "bg-accent-soft/70 text-accent-2" : "bg-line text-ink-2")} aria-hidden>{m.name.slice(0, 1)}</span>
                    <span className="flex min-w-0 flex-col gap-px">
                      <span className="whitespace-nowrap font-medium">{m.name}{self && <span className="text-[12px] font-normal text-dim"> (bạn)</span>}</span>
                      <span className="text-[12px] text-faint">{m.email}</span>
                    </span>
                  </div>
                </td>
                <td className="p-3">
                  {editable ? <Segmented size="sm" mono label={`Quyền của ${m.name}`} value={m.role} onChange={(role) => patch(m, { role })} options={[["viewer", "viewer"], ["engineer", "engineer"]]} />
                    : <span className="font-mono text-[12.5px] text-ink-2">{m.role}</span>}
                </td>
                <td className="p-3">
                  {editable && eng && m.granted_via === "direct" ? (
                    <button role="switch" aria-checked={m.can_certify} aria-label={`Quyền chứng nhận của ${m.name}`} title="Quyền chứng nhận"
                      onClick={() => patch(m, { can_certify: !m.can_certify })}
                      className={cx("flex h-4 w-7 rounded-full p-[2px]", m.can_certify ? "justify-end bg-accent" : "justify-start bg-line-strong")}>
                      <span className="size-3 rounded-full bg-ink" />
                    </button>
                  ) : <span className="text-[12.5px] text-faint">{m.can_certify ? "có" : "—"}</span>}
                </td>
                <td className="p-3">
                  <span className="flex flex-col gap-0.5 whitespace-nowrap text-[12.5px]">
                    <span className={m.granted_via === "link" ? "text-accent-2" : "text-muted"}>{m.granted_via === "link" ? `link · ${firstName(m.granted_by_name)}` : "trực tiếp"}</span>
                    <span className={cx("text-[12px]", m.expired ? "text-bad" : "text-muted")}>
                      {m.expired ? `đã hết hạn ${fmtDay(m.expires_at!)}` : m.expires_at ? `hết hạn ${fmtDay(m.expires_at)}` : "không hết hạn"}
                    </span>
                  </span>
                </td>
                <td className="w-10 py-3 pl-1 pr-3 text-right">
                  {editable && (
                    <button onClick={() => act(() => api(`/db/${dbId}/members/${m.user_id}`, { method: "DELETE" }))} title="Xóa khỏi database" aria-label={`Xóa ${m.name}`}
                      className="inline-grid size-7 place-items-center rounded-md text-dim hover:bg-bad-soft hover:text-bad"><Trash2 size={14} /></button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {members.length === 0 && <div className="py-10 text-center text-[13px] text-faint">Chưa có thành viên nào.</div>}
    </div>
  );
}

/** Tạo link chia sẻ (hiện link một lần) và danh sách link; link cũ (thu hồi, hết hạn, hết lượt) ẩn mặc định. */
export function LinksPanel({ links, dbId, act }: { links: LinkRow[]; dbId: number; act: (fn: () => Promise<unknown>) => void }) {
  const [role, setRole] = useState<"viewer" | "engineer">("viewer");
  const [days, setDays] = useState(7);
  const [uses, setUses] = useState(0);
  const [created, setCreated] = useState<{ url: string; role: string; expires_at: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showOld, setShowOld] = useState(false);
  const active = links.filter((l) => l.state === "active");
  const old = links.length - active.length;
  const shown = showOld ? links : active;

  const create = () => act(async () => {
    const r = await api<{ url: string; role: string; expires_at: string }>(`/db/${dbId}/share-links`, { body: { role, expires_in_days: days, max_uses: uses || null } });
    setCreated(r); setCopied(false);
  });
  const copy = async () => {
    if (!created) return;
    try { await navigator.clipboard.writeText(created.url); setCopied(true); } catch { /* trình duyệt chặn: chọn tay trong ô */ }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 rounded-[10px] border border-line bg-surface p-5">
        <div className="flex flex-col gap-1">
          <span className="text-[15px] font-semibold">Tạo link chia sẻ</span>
          <span className="text-[12.5px] leading-[1.6] text-faint">Người nhận phải đăng nhập để dùng link. Link engineer không có quyền chứng nhận, quản lý thành viên hay tạo link khác.</span>
        </div>
        <div className="flex flex-wrap items-end gap-5">
          <div className="flex flex-col gap-1.5"><span className="text-[12px] text-faint">Quyền</span>
            <Segmented label="Quyền" value={role} onChange={setRole} options={[["viewer", "Xem và hỏi"], ["engineer", "Sửa"]]} /></div>
          <div className="flex flex-col gap-1.5"><span className="text-[12px] text-faint">Hết hạn sau</span>
            <Segmented label="Hết hạn sau" value={days} onChange={setDays} options={[[1, "1 ngày"], [7, "7 ngày"], [30, "30 ngày"]]} /></div>
          <div className="flex flex-col gap-1.5"><span className="text-[12px] text-faint">Số lượt dùng</span>
            <Segmented label="Số lượt dùng" value={uses} onChange={setUses} options={[[0, "Không giới hạn"], [1, "1"], [5, "5"]]} /></div>
          <button onClick={create} className="h-9 whitespace-nowrap rounded-[7px] bg-accent px-[18px] text-[13px] font-medium text-on-accent hover:bg-accent-2">Tạo link</button>
        </div>
        {created && (
          <div className="flex flex-col gap-2 rounded-lg border border-accent-line bg-info-soft p-3.5">
            <span className="text-[13px] text-ink">Đã tạo link {created.role === "engineer" ? "Sửa" : "Xem"}, hết hạn {fmtDay(created.expires_at)}. Link chỉ hiện một lần.</span>
            <div className="flex gap-2">
              <input readOnly value={created.url} onFocus={(e) => e.target.select()} aria-label="Link chia sẻ"
                className="h-[34px] min-w-0 flex-1 rounded-md border border-line-strong bg-paper px-2.5 font-mono text-[12.5px] text-ink-2 outline-none" />
              <button onClick={copy} className="h-[34px] whitespace-nowrap rounded-md border border-edge bg-surface px-3.5 text-[13px] text-ink hover:bg-hover">{copied ? "Đã chép" : "Chép"}</button>
            </div>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-[10px] border border-line bg-surface">
        <div className="flex flex-wrap items-baseline gap-2.5 border-b border-line px-[18px] py-3.5">
          <span className="whitespace-nowrap text-[14px] font-semibold">Link đang hiệu lực</span>
          <span className="font-mono text-[12px] text-dim">{active.length}</span>
          <span className="flex-1" />
          {old > 0 && <button onClick={() => setShowOld(!showOld)} className="whitespace-nowrap text-[12.5px] text-accent-2 hover:underline">{showOld ? "Ẩn link cũ" : `Hiện ${old} link cũ`}</button>}
        </div>
        {shown.length === 0 ? <div className="p-7 text-center text-[13px] text-faint">Không có link nào đang hiệu lực.</div> : (
          <table className="w-full border-collapse text-[13.5px]">
            <thead><tr><Th first>Link</Th><Th>Quyền</Th><Th>Trạng thái</Th><Th>Đã dùng</Th><Th>Hết hạn</Th><th /></tr></thead>
            <tbody>
              {shown.map((l) => {
                const [label, color] = STATE[l.state] ?? [l.state, "text-faint"];
                return (
                  <tr key={l.id} className="border-t border-line-soft">
                    <td className="py-3 pl-[18px] pr-3 font-mono text-[12.5px] text-faint">#{l.id}</td>
                    <td className="p-3 font-mono text-[12.5px]">{l.role}</td>
                    <td className="whitespace-nowrap p-3"><span className={cx("inline-flex items-center gap-1.5 text-[12.5px]", color)}><span className="size-1.5 rounded-full bg-current" />{label}</span></td>
                    <td className="p-3 font-mono text-[12.5px]">{l.uses}{l.max_uses ? `/${l.max_uses}` : ""}</td>
                    <td className="p-3">
                      <span className="flex flex-col gap-0.5 whitespace-nowrap text-[12.5px]"><span className="text-ink-2">{fmtDay(l.expires_at)}</span><span className="text-[12px] text-faint">tạo bởi {firstName(l.created_by_name)}</span></span>
                    </td>
                    <td className="py-3 pl-3 pr-[18px] text-right">
                      {l.state === "active" && (
                        <button onClick={() => act(() => api(`/db/${dbId}/share-links/${l.id}`, { method: "DELETE" }))}
                          className="h-7 whitespace-nowrap rounded-md border border-bad/50 px-3 text-[12.5px] text-bad hover:bg-bad-soft/60">Thu hồi</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
