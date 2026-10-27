import { BadgeCheck, Cable, Database, LayoutDashboard, MessageSquareText, Share2 } from "lucide-react";
import { Cta, CtaBand, Frame, L, LinkCard, PageHero, Section, SectionHead, Shot, usePageTitle } from "../ui";

const PARTS = [
  { to: "hoi-va-kiem", icon: <MessageSquareText size={19} />, title: "Hỏi & kiểm", body: "Một ô cho câu hỏi và câu SQL. Câu trả lời nào cũng là một thẻ có con số, kết luận, giả định và phiếu kiểm." },
  { to: "du-lieu-lineage", icon: <Database size={19} />, title: "Dữ liệu & lineage", body: "Catalog dựng cho hàng trăm bảng: tìm kiếm có xếp hạng, canvas lineage tới từng cột, độ tin cậy và tác động." },
  { to: "chi-so", icon: <BadgeCheck size={19} />, title: "Chỉ số đã chứng nhận", body: "Định nghĩa YAML làm chuẩn để so: cột đo, bộ lọc bắt buộc, join, cột thời gian. Có phiên bản và người ký." },
  { to: "dashboard-chia-se", icon: <LayoutDashboard size={19} />, title: "Dashboard", body: "Agent dựng card từ chỉ số đã chứng nhận. Card không lưu SQL nên được kiểm lại mỗi lần mở." },
  { to: "dashboard-chia-se", icon: <Share2 size={19} />, title: "Chia sẻ & nhật ký", body: "Quyền theo từng database, link mời có hạn dùng và số lượt, nhật ký chỉ ghi thêm." },
  { to: "ket-noi-nguon", icon: <Cable size={19} />, title: "Kết nối nguồn", body: "Nối Postgres, MySQL bằng role chỉ đọc. Đồng bộ tăng dần, catalog tự cập nhật sau mỗi lần chạy." },
];

const FLOW = ["Hiểu câu hỏi", "Tìm bảng & chỉ số", "Viết SQL", "Kiểm lineage", "Tự sửa ≤ 2 vòng", "Chạy", "Đối chiếu SQL chuẩn", "Trả lời"];

export default function PlatformPage() {
  usePageTitle("Nền tảng");
  return (
    <>
      <PageHero eyebrow="Nền tảng" title="Một lớp kiểm chứng giữa model và con số"
        lead="LVDA gồm sáu phần dùng chung một kho chỉ số đã chứng nhận và một bộ kiểm lineage. Hỏi trong app, gọi qua MCP hay chạy trong CI đều qua cùng một chỗ kiểm."
        actions={<><Cta to={L("cach-hoat-dong")}>Xem cách hoạt động</Cta><Cta to={L("bat-dau")} variant="secondary">Chạy thử trên máy</Cta></>}>
        <Frame><Shot name="column" eager alt="Canvas lineage của bảng mart.fct_orders: cột gmv được chọn, đường đi từ raw.order_items qua stg_order_items tới gmv sáng lên, khung bên phải hiện độ tin cậy 98% Xanh trên 40 câu hỏi." /></Frame>
      </PageHero>
      <Section sunk>
        <SectionHead eyebrow="Các phần" title="Sáu phần, một nguồn sự thật" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PARTS.map((p) => <LinkCard key={p.title} to={L(p.to)} icon={p.icon} title={p.title}>{p.body}</LinkCard>)}
        </div>
      </Section>
      <Section>
        <SectionHead eyebrow="Đời sống một câu hỏi" title="Tám bước, bước thứ tư quyết định con số có ra ngoài không"
          lead="Bộ kiểm đứng giữa bước viết SQL và bước chạy. Câu SQL Đỏ không được chạy; sau hai vòng sửa vẫn Đỏ thì câu trả lời bị giữ lại." />
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FLOW.map((s, i) => (
            <li key={s} className={i === 3 ? "rounded-xl border border-accent-line bg-accent-soft/50 p-5" : "rounded-xl border border-line bg-surface p-5"}>
              <div className="font-mono text-[12.5px] text-accent">{String(i + 1).padStart(2, "0")}</div>
              <div className="mt-2 text-[16px] font-semibold">{s}</div>
            </li>
          ))}
        </ol>
        <div className="mt-8"><Cta to={L("cach-hoat-dong")} variant="text">Chi tiết từng bước và 12 luật kiểm</Cta></div>
      </Section>
      <CtaBand />
    </>
  );
}
