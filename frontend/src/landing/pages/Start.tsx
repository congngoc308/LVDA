import { Link } from "react-router-dom";
import { Code, Cta, GITHUB, L, PageHero, Section, SectionHead, usePageTitle } from "../ui";

const ACCOUNTS = [
  ["engineer@lvda.dev", "Engineer", "Chứng nhận chỉ số, duyệt, quản lý thành viên và cấu hình"],
  ["analyst@lvda.dev", "Người xem", "Hỏi, kiểm SQL, xem dữ liệu; cột PII bị che"],
  ["guest@lvda.dev", "Chưa có quyền", "Để thử link mời"],
];

const TRY = [
  "Doanh thu theo loại thanh toán năm 2017",
  "Giá trị đơn trung bình là bao nhiêu?",
  "Số khách hàng theo bang quý 2/2018",
  "Có bao nhiêu người bán ở bang SP có trên 10 đơn?",
  "Doanh thu gộp lấy từ đâu?",
];

export default function StartPage() {
  usePageTitle("Bắt đầu");
  return (
    <>
      <PageHero eyebrow="Bắt đầu" title="Chạy LVDA trên máy bằng Docker"
        lead="Bạn cần Docker Desktop. Lần chạy đầu, LVDA tự nạp dữ liệu Olist tổng hợp, một kho 500 bảng và một shop Postgres mẫu."
        actions={<><Cta to="/">Mở app</Cta><Cta to={GITHUB} variant="secondary">Mã nguồn trên GitHub</Cta></>} />
      <Section sunk>
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHead className="!mb-6" eyebrow="1. Khởi động" title="Dựng stack bằng Docker Compose" />
            <Code>{`docker compose up -d --build
# db :5460 · api :8020 · web :5179 · Postgres mẫu :5461

docker compose --profile mysql up -d
# tùy chọn: MySQL mẫu :3307`}</Code>
            <p className="mt-4 text-[14px] text-muted">Sau đó mở <span className="font-mono text-ink-2">http://localhost:5179</span>. Cả ba tài khoản mẫu dùng chung mật khẩu <span className="font-mono text-ink-2">lvda1234</span>.</p>
          </div>
          <div>
            <SectionHead className="!mb-6" eyebrow="2. Đăng nhập" title="Ba tài khoản mẫu" />
            <div className="divide-y divide-line rounded-2xl border border-line bg-panel">
              {ACCOUNTS.map(([e, r, d]) => (
                <div key={e} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[13.5px] text-ink">{e}</span><span className="rounded-full bg-raised px-2 py-0.5 text-[12px] text-ink-2">{r}</span></div>
                  <div className="mt-1 text-[14px] text-muted">{d}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>
      <Section>
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHead className="!mb-6" eyebrow="3. Hỏi thử" title="Năm câu hỏi cho ra đủ các loại kết luận" />
            <ol className="space-y-2.5">
              {TRY.map((q, i) => <li key={q} className="flex gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-[15px]"><span className="font-mono text-[13px] text-accent">{i + 1}</span>{q}</li>)}
            </ol>
          </div>
          <div>
            <SectionHead className="!mb-6" eyebrow="4. Thử thêm" title="Đồng bộ lại dữ liệu và tạo lại số đánh giá" />
            <div className="space-y-5">
              <div><div className="mb-2 text-[14px] font-medium">Đổi dữ liệu shop mẫu rồi đồng bộ</div>
                <Code>{`docker compose exec api python -m lvda.demo_source
# --kind mysql cho MySQL mẫu`}</Code></div>
              <div><div className="mb-2 text-[14px] font-medium">Tái tạo mọi số đánh giá</div><Code>{`make eval`}</Code></div>
              <p className="text-[14px] text-muted">Cách cài môi trường dev (Python 3.11, Node 20+) có trong README; cách nối MCP có ở trang <Link to={L("tich-hop")} className="text-accent hover:underline">Tích hợp</Link>.</p>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
