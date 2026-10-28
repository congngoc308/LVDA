import { CtaBand, PageHero, Section, SectionHead, usePageTitle, VerdictChip } from "../ui";

const STEPS = [
  ["Hiểu câu hỏi", "Nhận ra chỉ số, khoảng thời gian, chiều chia và top N. Câu mơ hồ được hỏi lại bằng vài lựa chọn; câu không có dữ liệu bị từ chối."],
  ["Tìm ngữ cảnh", "Dùng BM25 tìm trong catalog và các truy vấn mẫu đã duyệt để đưa vào prompt."],
  ["Viết SQL", "Model trả về {sql, metric_id, assumptions}. Catalog được bọc trong thẻ <data> và chỉ được đọc như dữ liệu."],
  ["Kiểm", "Chỉ nhận một câu SELECT hoặc WITH. sqlglot tách dấu vân tay lineage, áp 12 luật rồi cho kết luận."],
  ["Sửa", "Nếu kết luận là Đỏ, các phát hiện được gửi lại để model viết lại SQL, tối đa hai vòng."],
  ["Chạy", "SQL chạy bằng role chỉ đọc lvda_reader, tối đa 10 giây. Câu vẫn Đỏ sau hai vòng sửa thì bị giữ lại."],
  ["Đối chiếu", "Kết quả được so với SQL chuẩn của chỉ số. Lệch quá 0,5% thì câu trả lời có cảnh báo và chờ duyệt."],
  ["Trả lời", "Model viết câu trả lời tiếng Việt từ bảng kết quả. Câu nào nêu số không có trong kết quả thì bị loại."],
];

const PRINT = [
  ["Phép đo", "SUM(i.price + i.freight_value)"],
  ["Cột đo", "fct_order_items.price, fct_order_items.freight_value"],
  ["Bộ lọc", "fct_orders.order_status = 'delivered'"],
  ["Join", "fct_orders.order_id = fct_order_items.order_id"],
  ["Cột thời gian", "fct_orders.purchased_at"],
  ["Độ chi tiết", "order"],
];

const RULES: [string, string, "high" | "medium" | "low"][] = [
  ["V01", "Định danh không tồn tại", "high"], ["V02", "Sai cột đo", "high"], ["V03", "Thiếu bộ lọc bắt buộc", "high"],
  ["V04", "Bộ lọc khác định nghĩa", "medium"], ["V05", "Nhân dòng do join", "high"], ["V06", "Sai hàm tổng hợp", "high"],
  ["V07", "Sai khóa thực thể", "high"], ["V08", "Sai cột thời gian", "medium"], ["V09", "Đường join chưa khai báo", "high"],
  ["V10", "Lộ cột nhạy cảm", "medium"], ["V11", "Dùng đối tượng ngừng dùng", "low"], ["V12", "Không phân tích được SQL", "medium"],
];
const NOTES = [["I01", "Có bộ lọc thêm"], ["I02", "Lọc để còn 1 dòng mỗi đơn"], ["I03", "Chưa có định nghĩa để so"], ["I04", "Đọc thẳng bảng raw"], ["I05", "Chỉ số chưa chứng nhận"], ["I06", "LLM suy ra nguồn"]];
const SEV = { high: ["bg-bad-soft text-bad", "cao"], medium: ["bg-warn-soft text-warn", "vừa"], low: ["bg-raised text-ink-2", "thấp"] };

export default function HowPage() {
  usePageTitle("Cách hoạt động");
  return (
    <>
      <PageHero eyebrow="Cách hoạt động" title="Tám bước LVDA đi qua trước khi trả về một con số"
        lead="Bước kiểm không gọi LLM. Bộ kiểm tách câu SQL thành từng phần và so với định nghĩa chỉ số đã chứng nhận trong YAML." />
      <Section sunk>
        <SectionHead eyebrow="Quy trình" title="Các bước từ câu hỏi tới câu trả lời" />
        <ol className="relative space-y-0 border-l border-line-strong pl-8 sm:ml-4">
          {STEPS.map(([t, b], i) => (
            <li key={t} className="relative pb-8 last:pb-0">
              <span className={`absolute top-0 -left-[45px] grid size-[26px] place-items-center rounded-full border font-mono text-[12px] ${i === 3 ? "border-accent bg-accent text-on-accent" : "border-line-strong bg-surface text-ink-2"}`}>{i + 1}</span>
              <div className="text-[17px] font-semibold">{t}</div>
              <p className="mt-1.5 max-w-[720px] text-[14.5px] leading-[1.65] text-muted">{b}</p>
            </li>
          ))}
        </ol>
      </Section>
      <Section>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <SectionHead className="!mb-0" eyebrow="Dấu vân tay lineage" title="Bộ kiểm so từng phần của câu SQL với định nghĩa"
            lead="sqlglot tìm bảng gốc của từng cột, kể cả cột trong CTE, rồi ghi lại sáu phần dưới đây. Ví dụ là chỉ số gmv v1." />
          <div className="overflow-hidden rounded-2xl border border-line bg-panel">
            <div className="border-b border-line px-5 py-3 text-[13px] text-faint">Doanh thu gộp · gmv v1</div>
            <dl className="divide-y divide-line">
              {PRINT.map(([k, v]) => (
                <div key={k} className="grid gap-1 px-5 py-3 sm:grid-cols-[130px_1fr] sm:gap-4">
                  <dt className="text-[14px] text-muted">{k}</dt><dd className="font-mono text-[13px] break-words text-ink-2">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Section>
      <Section sunk>
        <SectionHead eyebrow="Luật kiểm" title="12 luật và 6 ghi chú"
          lead="Vi phạm một luật làm SQL thành Đỏ hoặc Vàng tùy mức. Ghi chú chỉ hiện trên phiếu kiểm. Engineer bật, tắt và đổi mức từng luật cho mỗi database." />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="overflow-hidden rounded-2xl border border-line bg-panel">
            <table className="w-full text-[14px]">
              <thead className="border-b border-line text-left text-[12.5px] text-faint"><tr><th className="px-5 py-3 font-medium">Luật</th><th className="px-5 py-3 font-medium">Tên</th><th className="px-5 py-3 font-medium">Mức mặc định</th></tr></thead>
              <tbody className="divide-y divide-line">
                {RULES.map(([id, n, s]) => (
                  <tr key={id}><td className="px-5 py-2.5 font-mono text-[13px] text-ink-2">{id}</td><td className="px-5 py-2.5">{n}</td>
                    <td className="px-5 py-2.5"><span className={`rounded px-1.5 py-px text-[12px] font-medium ${SEV[s][0]}`}>{SEV[s][1]}</span></td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-4">
            <div className="overflow-hidden rounded-2xl border border-line bg-panel">
              <div className="border-b border-line px-5 py-3 text-[13px] text-faint">Ghi chú</div>
              <ul className="divide-y divide-line">
                {NOTES.map(([id, n]) => <li key={id} className="flex gap-4 px-5 py-2.5 text-[14px]"><span className="font-mono text-[13px] text-accent">{id}</span>{n}</li>)}
              </ul>
            </div>
            <div className="rounded-2xl border border-line bg-panel p-5">
              <div className="text-[13px] text-faint">Kết luận</div>
              <ul className="mt-3 space-y-3 text-[14px] leading-[1.55] text-ink-2">
                <li className="flex gap-3"><VerdictChip v="green" /><span>Khớp định nghĩa, con số được trả về.</span></li>
                <li className="flex gap-3"><VerdictChip v="yellow" /><span>Lệch nhẹ hoặc chưa có định nghĩa để so.</span></li>
                <li className="flex gap-3"><VerdictChip v="red" /><span>Sai so với định nghĩa, SQL chưa chạy mà được đưa đi sửa.</span></li>
                <li className="flex gap-3"><VerdictChip v="held" /><span>Vẫn Đỏ sau hai vòng sửa, con số bị giữ lại chờ duyệt.</span></li>
              </ul>
            </div>
          </div>
        </div>
      </Section>
      <CtaBand />
    </>
  );
}
