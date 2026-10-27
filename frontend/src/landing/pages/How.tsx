import { CtaBand, PageHero, Section, SectionHead, usePageTitle, VerdictChip } from "../ui";

const STEPS = [
  ["Hiểu câu hỏi", "Khớp chỉ số theo tên và từ đồng nghĩa (không cần dấu), khoảng thời gian, chiều chia, top N. Từ khớp nhiều chỉ số thì đưa lựa chọn khác; dữ liệu không có thì từ chối."],
  ["Tìm", "BM25 trên bảng, cột, mô tả, chỉ số và truy vấn mẫu đã duyệt, để đưa đúng ngữ cảnh vào prompt."],
  ["Viết SQL", "Model trả về {sql, metric_id, assumptions}, thử lại một lần nếu sai schema. Nội dung catalog nằm trong thẻ <data> và không bao giờ được coi là chỉ dẫn."],
  ["Kiểm", "Chặn mọi thứ ngoài một câu SELECT/WITH, rồi phân tích SQL thành dấu vân tay lineage, áp 12 luật và cấu hình luật của database, ra kết luận."],
  ["Sửa", "Chỉ khi Đỏ: các phát hiện dạng máy đọc được gửi lại model, tối đa hai vòng."],
  ["Chạy", "Chạy bằng role lvda_reader, giới hạn 10 giây, giao dịch chỉ đọc. Vẫn Đỏ sau hai vòng thì không chạy, giữ lại và đưa vào hàng đợi."],
  ["Đối chiếu", "Chạy SQL chuẩn của chỉ số với cùng bộ lọc và chiều chia. Lệch quá 0,5% thì cảnh báo và tạo việc cần duyệt."],
  ["Trả lời", "Viết câu trả lời tiếng Việt từ các dòng kết quả. Số nào không có trong kết quả thì câu trả lời bị từ chối."],
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
      <PageHero eyebrow="Cách hoạt động" title="Tám bước, và vì sao con số sai không ra được ngoài"
        lead="Bộ kiểm không hỏi LLM câu SQL có đúng không. Nó tách câu SQL thành từng phần có thể so sánh, đặt cạnh định nghĩa đã chứng nhận, và chỉ ra phần nào lệch." />
      <Section sunk>
        <SectionHead eyebrow="Đời sống một câu hỏi" title="Từ câu hỏi tới câu trả lời" />
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
          <SectionHead className="!mb-0" eyebrow="Dấu vân tay lineage" title="Câu SQL được so theo từng phần"
            lead="Bộ kiểm dùng sqlglot để định danh mọi cột, đi qua từng phạm vi kể cả CTE, rồi ghi lại sáu thứ dưới đây. Khi chứng nhận một chỉ số, dấu vân tay của SQL chuẩn được lưu lại để biết khi nào view thay đổi." />
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
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
          lead="Luật vi phạm làm câu SQL Đỏ hoặc Vàng tùy mức độ; ghi chú không đổi kết luận nhưng hiện trên phiếu. Engineer bật tắt và đổi mức độ từng luật cho mỗi database." />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="overflow-hidden rounded-xl border border-line bg-surface">
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
            <div className="overflow-hidden rounded-xl border border-line bg-surface">
              <div className="border-b border-line px-5 py-3 text-[13px] text-faint">Ghi chú</div>
              <ul className="divide-y divide-line">
                {NOTES.map(([id, n]) => <li key={id} className="flex gap-4 px-5 py-2.5 text-[14px]"><span className="font-mono text-[13px] text-accent">{id}</span>{n}</li>)}
              </ul>
            </div>
            <div className="rounded-xl border border-line bg-surface p-5">
              <div className="text-[13px] text-faint">Kết luận</div>
              <ul className="mt-3 space-y-3 text-[14px] leading-[1.55] text-ink-2">
                <li className="flex gap-3"><VerdictChip v="green" /><span>Khớp định nghĩa, được chạy và công bố.</span></li>
                <li className="flex gap-3"><VerdictChip v="yellow" /><span>Cần xem lại: lệch nhẹ, hoặc không có định nghĩa để so.</span></li>
                <li className="flex gap-3"><VerdictChip v="red" /><span>Sai cấu trúc: không chạy, đưa đi sửa.</span></li>
                <li className="flex gap-3"><VerdictChip v="held" /><span>Vẫn Đỏ sau hai vòng: không công bố số.</span></li>
              </ul>
            </div>
          </div>
        </div>
      </Section>
      <CtaBand />
    </>
  );
}
