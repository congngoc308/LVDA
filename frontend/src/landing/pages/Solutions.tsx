import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { cx } from "../../components/ui";
import { Code, CtaBand, Frame, L, Cta, PageHero, Points, Section, Shot, usePageTitle, type ShotName } from "../ui";

type Role = { id: string; label: string; pain: string; title: string; points: string[]; shot?: ShotName; alt?: string; code?: string; more: [string, string] };

const ROLES: Role[] = [
  {
    id: "engineer", label: "Data engineer",
    pain: "Định nghĩa chỉ số nằm rải rác trong SQL của từng báo cáo, muốn biết số tính từ đâu phải đọc lại code.",
    title: "Chỉ số định nghĩa trong YAML, mọi câu SQL được kiểm theo đó",
    points: ["Chỉ số viết bằng YAML và có phiên bản", "Câu Vàng và Đỏ được gom vào một hàng chờ duyệt", "Lineage cột chỉ ra chỉ số bị ảnh hưởng khi cột đổi"],
    shot: "metric", alt: "Chi tiết chỉ số Doanh thu gộp với lineage, định nghĩa, SQL chuẩn và dấu vân tay.", more: ["chi-so", "Chỉ số đã chứng nhận"],
  },
  {
    id: "analyst", label: "Người phân tích, quản lý",
    pain: "Chatbot đưa ra con số cho cuộc họp nhưng không cho biết nó tính theo định nghĩa nào.",
    title: "Hỏi bằng tiếng Việt, mỗi con số kèm kết luận kiểm",
    points: ["Mỗi câu trả lời có kết luận Xanh, Vàng hoặc Đỏ", "Các giả định được ghi ngay trên thẻ trả lời", "Thấy số sai thì đánh dấu sai để gửi duyệt"],
    shot: "answer", alt: "Thẻ trả lời doanh thu theo loại thanh toán năm 2017 với kết luận Xanh.", more: ["hoi-va-kiem", "Hỏi & kiểm"],
  },
  {
    id: "ai", label: "Đội xây agent AI",
    pain: "SQL do agent viết vẫn chạy dù ra số sai, và thường chỉ có một LLM khác chấm lại.",
    title: "Bộ kiểm tất định gọi được từ agent qua MCP hoặc CLI",
    points: ["Năm tool MCP dùng được trong Claude Code và Cursor", "Mỗi lần kiểm mất khoảng 12 ms và không gọi LLM", "Lệnh lvda verify trả mã thoát 1 khi kết quả Đỏ, nên chạy được trong CI"],
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
  // menu trên cùng link tới #engineer, #analyst, #ai để mở đúng vai trò
  const { hash } = useLocation();
  const fromHash = () => ROLES.find((x) => x.id === hash.slice(1))?.id;
  const [tab, setTab] = useState(() => fromHash() ?? ROLES[0].id);
  useEffect(() => { const h = fromHash(); if (h) setTab(h); }, [hash]);
  const r = ROLES.find((x) => x.id === tab)!;
  return (
    <>
      <PageHero eyebrow="Giải pháp" title="Cách từng vai trò dùng LVDA"
        lead="Người định nghĩa chỉ số, người hỏi số liệu và agent viết SQL đều đi qua cùng một bộ kiểm." />
      <Section id={tab} sunk className="!pt-10">
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
