import { CtaBand, GITHUB, PageHero, Section, SectionHead, usePageTitle } from "../ui";

const ROADMAP = [
  ["LLM thật", "Chạy lại toàn bộ đánh giá với model thật, gán nhãn tay cho bản nháp đầu của agent."],
  ["Dữ liệu thật", "Nạp CSV Olist từ Kaggle và đo lại trên phân phối thật."],
  ["CDC", "Đọc WAL hoặc binlog để thấy dòng bị xóa, khi có quyền replication."],
  ["Thêm dialect", "sqlglot đã hỗ trợ; catalog cần thêm bộ đọc cho từng warehouse."],
  ["Dashboard cho người xem", "Cho quyền Xem và hỏi mở dashboard ở chế độ chỉ đọc."],
];

export default function AboutPage() {
  usePageTitle("Về dự án");
  return (
    <>
      <PageHero eyebrow="Về dự án" title="Vì sao làm LVDA"
        lead="Text-to-SQL thường sai theo cách vẫn chạy được: nhầm cột đo, quên bộ lọc nghiệp vụ, join nhân dòng, đếm sai khóa. LVDA thử trả lời một câu hỏi: có thể kiểm những lỗi đó một cách xác định, đủ nhanh để đặt trước mọi câu trả lời không?" />
      <Section sunk>
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHead className="!mb-5" eyebrow="Trạng thái" title="MVP mã nguồn mở" />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Bộ kiểm, vòng tự sửa, đối chiếu, phân quyền, đồng bộ nguồn và bộ đánh giá là thật. Mọi thứ cần LLM chạy trên một model giả lập
              cố ý mắc lỗi, đặt sau cùng giao diện mà một model thật tương thích OpenAI sẽ dùng. Dữ liệu là bộ tổng hợp theo schema Olist.
            </p>
          </div>
          <div>
            <SectionHead className="!mb-5" eyebrow="Nguồn gốc" title="Từ một dự án nhóm" />
            <p className="text-[15.5px] leading-[1.7] text-muted">
              Ý tưởng bộ phân tích SQL và đồ thị lineage bắt nguồn từ dự án nhóm P-116 Lineage AI (VinUni AI20K). LVDA viết lại các ý tưởng đó
              từ đầu và mở rộng thành một agent hoàn chỉnh.
            </p>
            <p className="mt-4 text-[15.5px]"><a href={GITHUB} target="_blank" rel="noreferrer" className="text-accent hover:underline">github.com/congngoc308/LVDA</a></p>
          </div>
        </div>
      </Section>
      <Section>
        <SectionHead eyebrow="Lộ trình" title="Việc tiếp theo" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ROADMAP.map(([t, b]) => (
            <div key={t} className="rounded-xl border border-line bg-surface p-6">
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
