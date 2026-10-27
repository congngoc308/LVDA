import { useEffect, useState } from "react";
import { api } from "../api";
import { Card, cx, ErrorNote, fmtDate } from "../components/ui";
import { useSession } from "../session";

interface Event { id: number; action: string; target: string; detail: Record<string, unknown>; request_id: string; created_at: string; actor_name: string | null }

const ACTIONS: Record<string, string> = {
  "link.create": "Tạo link chia sẻ", "link.accept": "Nhận quyền qua link", "link.revoke": "Thu hồi link",
  "member.update": "Đổi quyền thành viên", "member.remove": "Xóa thành viên",
  "metric.save": "Lưu phiên bản chỉ số", "metric.certify": "Chứng nhận chỉ số",
  "review.approve": "Duyệt câu trả lời", "review.edit_approve": "Sửa SQL rồi duyệt", "review.reject": "Từ chối câu trả lời",
};

const GROUPS = [["all", "Tất cả"], ["access", "Chia sẻ & quyền"], ["metric", "Chỉ số"], ["review", "Duyệt"], ["other", "Cài đặt & dữ liệu"]] as const;
type Group = (typeof GROUPS)[number][0];
const groupOf = (action: string): Group =>
  action.startsWith("link.") || action.startsWith("member.") ? "access"
    : action.startsWith("metric.") ? "metric" : action.startsWith("review.") ? "review" : "other";

function detailText(e: Event) {
  const d = e.detail ?? {};
  switch (e.action) {
    case "link.create": return `quyền ${d.role}, hết hạn ${fmtDate(d.expires_at as string)}${d.max_uses ? `, ${d.max_uses} lượt` : ""}`;
    case "link.accept": return `link #${e.target}, quyền ${d.role}`;
    case "link.revoke": return `link #${e.target}, gỡ ${d.members_removed} thành viên`;
    case "member.update": { const to = d.to as { role: string; can_certify: boolean }; return `người dùng #${e.target} → ${to?.role}${to?.can_certify ? ", được chứng nhận" : ""}`; }
    case "member.remove": return `người dùng #${e.target}`;
    case "metric.save": case "metric.certify": return `${e.target} v${d.version}`;
    default: return (d.question as string) ?? e.target;
  }
}

/** Nhật ký chỉ thêm: phân quyền, chứng nhận, duyệt, đổi luật, nạp lại mart. Nằm trong trang Chia sẻ & nhật ký. */
export function AuditPanel() {
  const { db } = useSession();
  const [events, setEvents] = useState<Event[]>([]);
  const [group, setGroup] = useState<Group>("all");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (db) api<Event[]>(`/db/${db.id}/audit`).then(setEvents).catch((e) => setError(e.message)); }, [db]);
  const shown = group === "all" ? events : events.filter((e) => groupOf(e.action) === group);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-5 py-2.5">
        <span className="mr-3 font-semibold">Nhật ký</span>
        {GROUPS.map(([k, label]) => (
          <button key={k} onClick={() => setGroup(k)}
            className={cx("rounded-md px-2.5 py-1 text-[12.5px]", group === k ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-sunk")}>{label}</button>
        ))}
        <span className="ml-auto text-[12px] text-muted">chỉ thêm, không sửa hay xóa được</span>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {shown.length === 0 ? <p className="px-5 py-10 text-center text-muted">Chưa có sự kiện nào.</p> : (
        <div className="scroll-thin max-h-[480px] overflow-y-auto">
          <table className="w-full text-[13.5px]">
            <thead className="sticky top-0 bg-sunk text-left text-[12px] text-muted">
              <tr><th className="px-5 py-2 font-medium">Thời điểm</th><th className="px-3 py-2 font-medium">Người làm</th><th className="px-3 py-2 font-medium">Thao tác</th><th className="px-3 py-2 font-medium">Chi tiết</th><th className="px-3 py-2 font-medium">Request</th></tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id} className="border-t border-line align-top">
                  <td className="num whitespace-nowrap px-5 py-2.5 text-[12.5px] text-muted">{fmtDate(e.created_at)}</td>
                  <td className="px-3 py-2.5">{e.actor_name ?? "—"}</td>
                  <td className="px-3 py-2.5 font-medium">{ACTIONS[e.action] ?? e.action}</td>
                  <td className="px-3 py-2.5 text-ink-2">{detailText(e)}</td>
                  <td className="px-3 py-2.5 font-mono text-[11.5px] text-faint">{e.request_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
