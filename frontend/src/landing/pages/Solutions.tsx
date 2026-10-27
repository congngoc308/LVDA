import { useState } from "react";
import { cx } from "../../components/ui";
import { Code, CtaBand, Frame, L, Cta, PageHero, Points, Section, Shot, usePageTitle, type ShotName } from "../ui";

type Role = { id: string; label: string; pain: string; title: string; points: string[]; shot?: ShotName; alt?: string; code?: string; more: [string, string] };

const ROLES: Role[] = [
  {
    id: "engineer", label: "Data engineer",
    pain: "Mỗi lần ai đó hỏi 'số này lấy từ đâu', bạn phải mở SQL ra đọc lại. Định nghĩa doanh thu nằm rải rác trong mười báo cáo.",
    title: "Định nghĩa một lần, kiểm mọi nơi",
    points: ["Viết chỉ số bằng YAML, chứng nhận và có phiên bản", "Duyệt câu trả lời Vàng, Đỏ trong một hàng đợi; câu duyệt thành truy vấn mẫu", "Thấy trước chỉ số, câu hỏi nào bị ảnh hưởng khi một cột đổi", "Bật tắt và đổi mức độ từng luật cho mỗi database"],
    shot: "metric", alt: "Chi tiết chỉ số Doanh thu gộp với lineage, định nghĩa, SQL chuẩn và dấu vân tay.", more: ["chi-so", "Chỉ số đã chứng nhận"],
  },
  {
    id: "analyst", label: "Người phân tích, quản lý",
    pain: "Bạn cần một con số trước cuộc họp, nhưng không chắc câu trả lời của chatbot có dùng đúng định nghĩa mà phòng tài chính dùng không.",
    title: "Hỏi bằng tiếng Việt, biết con số nào tin được",
    points: ["Mỗi câu trả lời ghi rõ chỉ số, phiên bản và kết luận Xanh, Vàng, Đỏ", "Giả định được liệt kê, không giấu trong SQL", "Báo sai bằng một nút; câu đó vào hàng đợi duyệt", "Cột nhạy cảm tự che với người xem"],
    shot: "answer", alt: "Thẻ trả lời doanh thu theo loại thanh toán năm 2017 với kết luận Xanh.", more: ["hoi-va-kiem", "Hỏi & kiểm"],
  },
  {
    id: "ai", label: "Đội xây agent AI",
    pain: "Agent của bạn viết SQL rất tự tin. Bạn không có cách nào rẻ và ổn định để biết khi nào nó sai, ngoài việc nhờ thêm một LLM khác chấm.",
    title: "Một bộ kiểm xác định cho mọi agent",
    points: ["Năm tool MCP dùng được từ Claude Code, Cursor", "Khoảng 12 ms mỗi lần kiểm, không tốn token", "Phát hiện dạng máy đọc được, đủ cụ thể để agent tự sửa", "CLI trả mã thoát 1 khi Đỏ, đặt được vào CI"],
    code: `# trong Claude Code
> verify_sql(sql="SELECT AVG(p.payment_value) ...", metric_id="aov")

# kết quả, rút gọn
verdict: red
findings:
  - V02 sai cột đo
  - V06 sai hàm tổng hợp`, more: ["tich-hop", "Tích hợp"],
  },
];

export default function SolutionsPage() {
  usePageTitle("Giải pháp theo vai trò");
  const [tab, setTab] = useState(ROLES[0].id);
  const r = ROLES.find((x) => x.id === tab)!;
  return (
    <>
      <PageHero eyebrow="Giải pháp" title="Một lớp kiểm chứng, ba cách dùng"
        lead="Người định nghĩa con số, người hỏi con số, và agent viết SQL đều dùng chung một kho chỉ số và một bộ kiểm." />
      <Section sunk className="!pt-10">
        <div role="tablist" aria-label="Vai trò" className="mb-10 flex flex-wrap gap-2">
          {ROLES.map((x) => (
            <button key={x.id} role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}
              className={cx("h-10 rounded-full border px-4 text-[14.5px] font-medium transition-colors", tab === x.id ? "border-accent bg-accent text-on-accent" : "border-line-strong text-ink-2 hover:bg-hover")}>{x.label}</button>
          ))}
        </div>
        <div role="tabpanel" className="grid items-start gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <div>
            <p className="border-l-2 border-line-strong pl-4 text-[15px] leading-[1.65] text-muted italic">{r.pain}</p>
            <h2 className="mt-8 text-[26px] leading-[1.2] font-semibold tracking-[-0.015em] sm:text-[32px]">{r.title}</h2>
            <Points items={r.points} className="mt-6" />
            <div className="mt-8"><Cta to={L(r.more[0])} variant="text">{r.more[1]}</Cta></div>
          </div>
          <div className="min-w-0">{r.shot ? <Frame><Shot name={r.shot} alt={r.alt!} /></Frame> : <Code>{r.code!}</Code>}</div>
        </div>
      </Section>
      <CtaBand />
    </>
  );
}
