import { useState } from "react";
import { fmtDay, Segmented } from "../components/ui";

export interface AuditEvent { id: number; action: string; target: string; detail: Record<string, unknown>; request_id: string; created_at: string; actor_name: string | null }

const ACTIONS: Record<string, string> = {
  "link.create": "Tạo link chia sẻ", "link.accept": "Nhận quyền qua link", "link.revoke": "Thu hồi link",
  "member.update": "Đổi quyền thành viên", "member.remove": "Xóa thành viên",
  "metric.save": "Lưu phiên bản chỉ số", "metric.certify": "Chứng nhận chỉ số", "metric.deprecate": "Ngừng dùng chỉ số", "metric.import": "Nhập chỉ số",
  "review.approve": "Duyệt câu trả lời", "review.edit_approve": "Sửa SQL rồi duyệt", "review.reject": "Từ chối câu trả lời",
  "settings.rules": "Đổi mức độ luật", "settings.llm": "Đổi cấu hình LLM", "mart.reload": "Nạp lại warehouse",
  "description.edit": "Sửa mô tả", "description.approve": "Duyệt mô tả", "dashboard.save": "Lưu dashboard", "dashboard.draft": "Agent soạn dashboard",
  "source.create": "Kết nối nguồn", "source.sync": "Đồng bộ nguồn", "source.settings": "Đổi cài đặt đồng bộ", "source.tables": "Đổi bảng đồng bộ",
  "source.credentials": "Cập nhật mật khẩu nguồn", "source.pause": "Tạm dừng lịch đồng bộ", "source.resume": "Tiếp tục lịch đồng bộ", "source.disconnect": "Ngắt kết nối nguồn",
};

const GROUPS: [Group, string][] = [["all", "Tất cả"], ["access", "Chia sẻ & quyền"], ["metric", "Chỉ số"], ["review", "Duyệt"], ["other", "Cài đặt & dữ liệu"]];
type Group = "all" | "access" | "metric" | "review" | "other";
const groupOf = (action: string): Exclude<Group, "all"> =>
  action.startsWith("link.") || action.startsWith("member.") ? "access"
    : action.startsWith("metric.") ? "metric" : action.startsWith("review.") ? "review" : "other";
// vạch màu cạnh tên thao tác, theo nhóm
const GROUP_COLOR: Record<Exclude<Group, "all">, string> = {
  access: "var(--color-accent)", metric: "var(--color-teal)", review: "var(--color-warn)", other: "var(--color-dim)",
};

function detailText(e: AuditEvent, names: Map<number, string>) {
  const d = e.detail ?? {};
  const who = names.get(Number(e.target)) ?? `người dùng #${e.target}`;
  switch (e.action) {
    case "link.create": return `quyền ${d.role}, hết hạn ${fmtDay(d.expires_at as string)}${d.max_uses ? `, ${d.max_uses} lượt` : ""}`;
    case "link.accept": return `link #${e.target}, quyền ${d.role}`;
    case "link.revoke": return `link #${e.target}, gỡ ${d.members_removed} thành viên`;
    case "member.update": { const to = d.to as { role: string; can_certify: boolean }; return `${who} → ${to?.role}${to?.can_certify ? ", được chứng nhận" : ""}`; }
    case "member.remove": return who;
    case "metric.save": case "metric.certify": return `${e.target} v${d.version}`;
    case "mart.reload": {
      const stale = (d.stale as string[] | undefined) ?? [];
      return `khóa ${d.keys_ok ? "đều duy nhất" : "có trùng"}${stale.length ? `, ${stale.length} chỉ số cần chứng nhận lại` : ""}`;
    }
    case "description.approve": return `${e.target}: ${d.count} mô tả`;
    case "source.sync": return e.target === "full" ? "làm mới toàn bộ" : "tăng dần";
    case "settings.rules": return "luật kiểm định";
    case "dashboard.save": case "dashboard.draft": return "dashboard của tab Đánh giá";
    default: return (d.question as string) ?? e.target;
  }
}

/** Nhật ký chỉ thêm: phân quyền, chứng nhận, duyệt, đổi luật, nạp lại mart; lọc theo nhóm. */
export function AuditTable({ events, names }: { events: AuditEvent[]; names: Map<number, string> }) {
  const [group, setGroup] = useState<Group>("all");
  const shown = group === "all" ? events : events.filter((e) => groupOf(e.action) === group);
  return (
    <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-[18px] py-3">
        <Segmented label="Nhóm thao tác" value={group} onChange={setGroup} options={GROUPS} />
        <span className="flex-1" />
        <span className="whitespace-nowrap text-[12px] text-dim">Chỉ thêm, không sửa hay xóa được</span>
      </div>
      <div className="scroll-thin max-h-[560px] overflow-auto">
        {shown.length === 0 ? <div className="p-10 text-center text-[13px] text-faint">Chưa có sự kiện nào.</div> : (
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr className="sticky top-0 bg-surface">
                {["Thời điểm", "Người làm", "Thao tác", "Chi tiết"].map((h, i) => (
                  <th key={h} className={i === 0 ? "whitespace-nowrap py-2.5 pl-[18px] pr-3 text-left text-[12px] font-normal text-faint" : "whitespace-nowrap px-3 py-2.5 text-left text-[12px] font-normal text-faint"}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id} className="border-t border-line-soft align-top">
                  <td className="whitespace-nowrap py-[11px] pl-[18px] pr-3">
                    <span className="flex flex-col gap-0.5 font-mono"><span className="text-[12px] text-muted">{fmtDay(e.created_at, true)}</span><span className="text-[11px] text-dim">{e.request_id}</span></span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-[11px]">{e.actor_name?.split(/\s*\(/)[0] ?? "—"}</td>
                  <td className="whitespace-nowrap px-3 py-[11px]">
                    <span className="inline-flex items-center gap-2 font-medium"><span className="h-3.5 w-[3px] rounded-sm" style={{ background: GROUP_COLOR[groupOf(e.action)] }} />{ACTIONS[e.action] ?? e.action}</span>
                  </td>
                  <td className="py-[11px] pl-3 pr-[18px] leading-normal text-muted">{detailText(e, names)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
