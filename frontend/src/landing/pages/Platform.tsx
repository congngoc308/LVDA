import { BadgeCheck, Cable, Database, LayoutDashboard, MessageSquareText, Share2 } from "lucide-react";
import { Cta, CtaBand, Frame, L, LinkCard, PageHero, Section, SectionHead, Shot, usePageTitle } from "../ui";

const PARTS = [
  { to: "hoi-va-kiem", icon: <MessageSquareText size={19} />, title: "Hỏi & kiểm", body: "Hỏi bằng tiếng Việt hoặc dán SQL, câu trả lời kèm phiếu kiểm." },
  { to: "du-lieu-lineage", icon: <Database size={19} />, title: "Dữ liệu & lineage", body: "Lineage tới từng cột, đã chạy trên kho mẫu 500 bảng." },
  { to: "chi-so", icon: <BadgeCheck size={19} />, title: "Chỉ số đã chứng nhận", body: "Định nghĩa viết bằng YAML, có phiên bản và người ký." },
  { to: "dashboard-chia-se", icon: <LayoutDashboard size={19} />, title: "Dashboard", body: "Card chỉ lưu tham số, mỗi lần mở server dựng lại SQL và kiểm." },
  { to: "dashboard-chia-se", icon: <Share2 size={19} />, title: "Chia sẻ & nhật ký", body: "Phân quyền theo từng database, nhật ký chỉ ghi thêm." },
  { to: "ket-noi-nguon", icon: <Cable size={19} />, title: "Kết nối nguồn", body: "Nối Postgres hoặc MySQL bằng role chỉ đọc, đồng bộ tăng dần." },
];

const FLOW = ["Hiểu câu hỏi", "Tìm bảng & chỉ số", "Viết SQL", "Kiểm lineage", "Tự sửa tối đa 2 vòng", "Chạy", "Đối chiếu SQL chuẩn", "Trả lời"];

export default function PlatformPage() {
  usePageTitle("Nền tảng");
  return (
    <>
      <PageHero eyebrow="Nền tảng" title="LVDA kiểm SQL do model viết trước khi trả con số"
        lead="SQL gửi từ app, MCP hay CI đều qua cùng bộ kiểm 12 luật."
        actions={<><Cta to={L("cach-hoat-dong")}>Xem cách hoạt động</Cta><Cta to={L("bat-dau")} variant="secondary">Chạy thử trên máy</Cta></>}>
        <Frame><Shot name="column" eager alt="Canvas lineage của mart.fct_orders: cột gmv được chọn, đường từ raw.order_items qua stg_order_items sáng lên, khung bên phải hiện độ tin cậy 98% Xanh trên 40 câu hỏi." /></Frame>
      </PageHero>
      <Section sunk>
        <SectionHead eyebrow="Các phần" title="Sáu phần chính của nền tảng" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PARTS.map((p) => <LinkCard key={p.title} to={L(p.to)} icon={p.icon} title={p.title}>{p.body}</LinkCard>)}
        </div>
      </Section>
      <Section>
        <SectionHead eyebrow="Quy trình" title="Một câu hỏi đi qua tám bước, bộ kiểm nằm ở bước 4"
          lead="SQL bị kết luận Đỏ thì không được chạy. Agent tự sửa tối đa hai vòng, vẫn Đỏ thì câu trả lời bị giữ lại." />
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FLOW.map((s, i) => (
            <li key={s} className={i === 3 ? "rounded-2xl border border-accent-line bg-accent-soft/50 p-5" : "rounded-2xl border border-line bg-panel p-5"}>
              <div className="font-mono text-[12.5px] text-accent">{String(i + 1).padStart(2, "0")}</div>
              <div className="mt-2 text-[16px] font-semibold">{s}</div>
            </li>
          ))}
        </ol>
        <div className="mt-8"><Cta to={L("cach-hoat-dong")} variant="text">Xem 12 luật kiểm</Cta></div>
      </Section>
      <CtaBand />
    </>
  );
}
