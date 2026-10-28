import { CtaBand, GITHUB, PageHero, Section, SectionHead, usePageTitle } from "../ui";

const ROADMAP = [
  ["LLM thật", "Chạy lại bộ đánh giá với LLM thật thay cho model giả lập."],
  ["Dữ liệu thật", "Đo lại trên bộ CSV Olist thật từ Kaggle."],
  ["CDC", "Đọc WAL hoặc binlog để thấy dòng bị xóa."],
  ["Thêm dialect", "sqlglot đã hỗ trợ nhiều dialect, catalog cần thêm bộ đọc cho từng loại."],
  ["Dashboard cho người xem", "Người có quyền Xem và hỏi mở được dashboard ở chế độ chỉ đọc."],
];

export default function AboutPage() {
  usePageTitle("Về dự án");
  return (
    <>
      <PageHero eyebrow="Về dự án" title="Vì sao làm LVDA"
        lead="Câu SQL do LLM viết thường vẫn chạy dù cho ra số sai. LVDA thử bắt các lỗi đó bằng một bộ kiểm tất định, đủ nhanh để chạy trên mọi câu trả lời." />
      <Section sunk>
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHead className="!mb-5" eyebrow="Trạng thái" title="MVP mã nguồn mở" />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Bộ kiểm, vòng tự sửa, phân quyền và đồng bộ dữ liệu chạy thật. Phần LLM dùng một model giả lập, cố ý viết SQL sai.
              Dữ liệu là bộ tổng hợp theo schema Olist.
            </p>
          </div>
          <div>
            <SectionHead className="!mb-5" eyebrow="Nguồn gốc" title="Bắt đầu từ một dự án nhóm" />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Ý tưởng bắt nguồn từ P-116 Lineage AI (VinUni AI20K). LVDA viết lại từ đầu thành một agent riêng.
            </p>
            <p className="mt-4 text-[15.5px]"><a href={GITHUB} target="_blank" rel="noreferrer" className="text-accent hover:underline">github.com/congngoc308/LVDA</a></p>
          </div>
        </div>
      </Section>
      <Section>
        <SectionHead eyebrow="Lộ trình" title="Việc tiếp theo" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ROADMAP.map(([t, b]) => (
            <div key={t} className="rounded-2xl border border-line bg-panel p-6">
              <div className="text-[17px] font-semibold">{t}</div>
              <p className="mt-2 text-[14.5px] leading-[1.6] text-muted">{b}</p>
            </div>
          ))}
        </div>
      </Section>
      <CtaBand />
    </>
  );
}
