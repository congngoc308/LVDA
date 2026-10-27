import { Check, Copy, Link2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Button, Card, cx, ErrorNote, fmtDate, Pill } from "../components/ui";
import { useSession } from "../session";

interface MemberRow {
  user_id: number; name: string; email: string; role: "viewer" | "engineer"; can_certify: boolean; granted_via: "direct" | "link";
  expires_at: string | null; granted_by_name: string | null; expired: boolean;
}
interface LinkRow { id: number; role: string; expires_at: string; max_uses: number | null; uses: number; created_at: string; created_by_name: string; state: string }

const STATE: Record<string, { label: string; tone: "good" | "neutral" | "bad" | "warn" }> = {
  active: { label: "đang hiệu lực", tone: "good" }, expired: { label: "hết hạn", tone: "neutral" },
  revoked: { label: "đã thu hồi", tone: "bad" }, used_up: { label: "hết lượt", tone: "warn" },
};

function Segmented<T extends string | number>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line-strong bg-sunk p-0.5">
      {options.map(([v, l]) => (
        <button key={String(v)} role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cx("rounded px-2.5 py-1 text-[13px]", value === v ? "bg-surface font-medium shadow-sm" : "text-muted")}>{l}</button>
      ))}
    </div>
  );
}

/** Thành viên và link chia sẻ của database. Nằm trong trang Chia sẻ & nhật ký. */
export function MembersPanel() {
  const { db, user } = useSession();
  const canManage = db?.role === "engineer" && db.granted_via === "direct";
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [role, setRole] = useState<"viewer" | "engineer">("viewer");
  const [days, setDays] = useState(7);
  const [uses, setUses] = useState(0);
  const [created, setCreated] = useState<{ url: string; role: string; expires_at: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showOld, setShowOld] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!db) return;
    api<MemberRow[]>(`/db/${db.id}/members`).then(setMembers).catch((e) => setError(e.message));
    if (canManage) api<LinkRow[]>(`/db/${db.id}/share-links`).then(setLinks).catch(() => {});
  }, [db, canManage]);
  useEffect(load, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); load(); } catch (e) { setError(e instanceof Error ? e.message : "Thao tác thất bại."); }
  };

  const createLink = () => act(async () => {
    const r = await api<{ url: string; role: string; expires_at: string }>(`/db/${db!.id}/share-links`, { body: { role, expires_in_days: days, max_uses: uses || null } });
    setCreated(r); setCopied(false);
  });

  const copy = async () => {
    if (!created) return;
    try { await navigator.clipboard.writeText(created.url); setCopied(true); } catch { /* chọn tay */ }
  };

  return (
    <div className="flex flex-col gap-6">
    <ErrorNote>{error}</ErrorNote>
    {!canManage && <p className="rounded-md bg-sunk px-3 py-2 text-[13px] text-muted">Bạn có quyền engineer qua link nên chỉ xem được danh sách. Quản lý thành viên và link cần engineer được gán trực tiếp.</p>}

    {canManage && (
      <Card className="p-5">
        <h2 className="mb-1 flex items-center gap-2 font-semibold"><Link2 size={17} /> Tạo link chia sẻ</h2>
        <p className="mb-4 text-[13px] text-muted">Người nhận phải đăng nhập để dùng link. Link engineer không có quyền chứng nhận, quản lý thành viên hay tạo link khác.</p>
        <div className="flex flex-wrap items-end gap-5">
          <div><div className="mb-1 text-[12px] text-muted">Quyền</div><Segmented label="Quyền" value={role} onChange={setRole} options={[["viewer", "Xem và hỏi"], ["engineer", "Sửa"]]} /></div>
          <div><div className="mb-1 text-[12px] text-muted">Hết hạn sau</div><Segmented label="Hết hạn" value={days} onChange={setDays} options={[[1, "1 ngày"], [7, "7 ngày"], [30, "30 ngày"]]} /></div>
          <div><div className="mb-1 text-[12px] text-muted">Số lượt dùng</div><Segmented label="Số lượt" value={uses} onChange={setUses} options={[[0, "Không giới hạn"], [1, "1"], [5, "5"]]} /></div>
          <Button variant="primary" onClick={createLink}>Tạo link</Button>
        </div>
        {created && (
          <div className="mt-4 rounded-md border border-good/30 bg-good-soft/60 p-3">
            <div className="mb-1.5 text-[13px] font-medium text-good">Đã tạo link {created.role === "engineer" ? "Sửa" : "Xem"}, hết hạn {fmtDate(created.expires_at)}. Link chỉ hiện một lần.</div>
            <div className="flex items-center gap-2">
              <input readOnly value={created.url} onFocus={(e) => e.target.select()} aria-label="Link chia sẻ"
                className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 font-mono text-[12.5px]" />
              <Button onClick={copy}>{copied ? <><Check size={14} /> Đã chép</> : <><Copy size={14} /> Chép</>}</Button>
            </div>
          </div>
        )}
      </Card>
    )}

    <Card>
      <div className="border-b border-line px-5 py-3 font-semibold">Thành viên <span className="num font-normal text-muted">({members.length})</span></div>
      <table className="w-full text-[13.5px]">
        <thead className="bg-sunk text-left text-[12px] text-muted">
          <tr><th className="px-5 py-2 font-medium">Người dùng</th><th className="px-3 py-2 font-medium">Quyền</th><th className="px-3 py-2 font-medium">Chứng nhận</th>
            <th className="px-3 py-2 font-medium">Cấp qua</th><th className="px-3 py-2 font-medium">Hết hạn</th><th className="px-3 py-2" /></tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const self = m.user_id === user?.id;
            const editable = canManage && !self;
            return (
              <tr key={m.user_id} className={cx("border-t border-line", m.expired && "text-muted")}>
                <td className="px-5 py-2.5"><div className="font-medium">{m.name}{self && <span className="ml-1 text-[12px] font-normal text-muted">(bạn)</span>}</div><div className="text-[12px] text-muted">{m.email}</div></td>
                <td className="px-3 py-2.5">
                  {editable ? (
                    <select value={m.role} aria-label={`Quyền của ${m.name}`} onChange={(e) => act(() => api(`/db/${db!.id}/members/${m.user_id}`, { method: "PATCH", body: { role: e.target.value } }))}
                      className="rounded border border-line bg-surface px-1.5 py-1 text-[13px]">
                      <option value="viewer">viewer</option><option value="engineer">engineer</option>
                    </select>
                  ) : <span className="font-mono text-[12.5px]">{m.role}</span>}
                </td>
                <td className="px-3 py-2.5">
                  {editable && m.role === "engineer" && m.granted_via === "direct" ? (
                    <input type="checkbox" checked={m.can_certify} aria-label={`Quyền chứng nhận của ${m.name}`}
                      onChange={(e) => act(() => api(`/db/${db!.id}/members/${m.user_id}`, { method: "PATCH", body: { can_certify: e.target.checked } }))} />
                  ) : <span className="text-[12.5px]">{m.can_certify ? "có" : "—"}</span>}
                </td>
                <td className="px-3 py-2.5">{m.granted_via === "link" ? <Pill tone="accent">link · {m.granted_by_name}</Pill> : <Pill>trực tiếp</Pill>}</td>
                <td className="px-3 py-2.5 text-[12.5px]">{m.expired ? <Pill tone="bad">đã hết hạn</Pill> : m.expires_at ? fmtDate(m.expires_at) : "—"}</td>
                <td className="px-3 py-2.5 text-right">
                  {editable && <button onClick={() => act(() => api(`/db/${db!.id}/members/${m.user_id}`, { method: "DELETE" }))} className="rounded p-1.5 text-muted hover:bg-bad-soft hover:text-bad" aria-label={`Xóa ${m.name}`} title="Xóa khỏi database"><Trash2 size={15} /></button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>

    {canManage && (
      <Card>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <span className="font-semibold">Link đang hiệu lực <span className="num font-normal text-muted">({links.filter((l) => l.state === "active").length})</span></span>
          {/* link đã thu hồi, hết hạn, hết lượt chỉ để tra cứu: ẩn mặc định cho danh sách gọn */}
          {links.some((l) => l.state !== "active") && (
            <button onClick={() => setShowOld(!showOld)} className="text-[12.5px] text-accent hover:underline">
              {showOld ? "Ẩn link cũ" : `Hiện ${links.filter((l) => l.state !== "active").length} link cũ`}
            </button>
          )}
        </div>
        {links.filter((l) => showOld || l.state === "active").length === 0 ? <p className="px-5 py-6 text-center text-[13px] text-muted">Không có link nào đang hiệu lực.</p> : (
          <table className="w-full text-[13.5px]">
            <thead className="bg-sunk text-left text-[12px] text-muted">
              <tr><th className="px-5 py-2 font-medium">Quyền</th><th className="px-3 py-2 font-medium">Trạng thái</th><th className="px-3 py-2 font-medium">Đã dùng</th>
                <th className="px-3 py-2 font-medium">Hết hạn</th><th className="px-3 py-2 font-medium">Người tạo</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {links.filter((l) => showOld || l.state === "active").map((l) => (
                <tr key={l.id} className="border-t border-line">
                  <td className="px-5 py-2.5 font-mono text-[12.5px]">{l.role}</td>
                  <td className="px-3 py-2.5"><Pill tone={STATE[l.state].tone}>{STATE[l.state].label}</Pill></td>
                  <td className="num px-3 py-2.5">{l.uses}{l.max_uses ? `/${l.max_uses}` : ""}</td>
                  <td className="px-3 py-2.5 text-[12.5px]">{fmtDate(l.expires_at)}</td>
                  <td className="px-3 py-2.5 text-[12.5px]">{l.created_by_name}</td>
                  <td className="px-3 py-2.5 text-right">
                    {l.state === "active" && <Button size="sm" variant="danger" onClick={() => act(() => api(`/db/${db!.id}/share-links/${l.id}`, { method: "DELETE" }))}>Thu hồi</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    )}
    </div>
  );
}
