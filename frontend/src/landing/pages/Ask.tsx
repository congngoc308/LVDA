import { ArrowUp } from "lucide-react";
import { Code, Cta, CtaBand, Feature, Frame, L, PageHero, Section, Shot, usePageTitle, VerdictChip } from "../ui";

/** Ô hỏi vẽ lại bằng HTML: cho thấy LVDA hiểu câu hỏi thế nào trước khi gửi. */
function InterpretMock() {
  return (
    <Frame>
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-3 rounded-xl border border-line-strong bg-sunk p-4">
          <div className="flex-1 text-[15px] text-ink">doanh thu tháng 3/2018</div>
          <span className="grid size-8 place-items-center rounded-lg bg-accent text-on-accent"><ArrowUp size={16} aria-hidden /></span>
        </div>
        <div className="mt-4 space-y-2.5 text-[14px]">
          <div className="flex flex-wrap items-center gap-2"><span className="w-24 text-faint">Chỉ số</span><span className="rounded-md bg-accent-soft px-2 py-0.5 font-medium text-accent">Doanh thu gộp</span><span className="font-mono text-[12.5px] text-faint">gmv · v1</span></div>
          <div className="flex flex-wrap items-center gap-2"><span className="w-24 text-faint">Thời gian</span><span className="rounded-md bg-raised px-2 py-0.5 text-ink-2">01/03/2018 – 31/03/2018</span></div>
          <div className="flex flex-wrap items-center gap-2"><span className="w-24 text-faint">Cũng có thể là</span><span className="rounded-md border border-line-strong px-2 py-0.5 text-ink-2">Doanh thu hàng hóa</span></div>
        </div>
        <p className="mt-4 border-t border-line pt-4 text-[13px] text-faint">"doanh thu" khớp hai chỉ số đã chứng nhận, nên LVDA hỏi lại trước khi viết SQL.</p>
      </div>
    </Frame>
  );
}

function YellowMock() {
  return (
    <Frame glow={false}>
      <div className="p-5 sm:p-6">
        <div className="text-[15px] font-medium">Có bao nhiêu người bán ở bang SP có trên 10 đơn?</div>
        <div className="mt-4 flex flex-wrap items-center gap-2"><VerdictChip v="yellow">Đã kiểm · Vàng</VerdictChip><span className="rounded bg-warn-soft px-1.5 py-px font-mono text-[12px] text-warn">I03</span><span className="text-[13.5px] text-muted">Chưa có định nghĩa để so</span></div>
        <div className="mt-4 rounded-lg bg-sunk p-4 text-[14px] leading-[1.6] text-ink-2">
          Không chỉ số đã chứng nhận nào diễn đạt được điều kiện "trên 10 đơn". Agent tự viết SQL; bộ kiểm chỉ áp các luật chung.
        </div>
        <div className="mt-4 flex items-center gap-2 text-[13.5px] text-muted"><span className="size-1.5 rounded-full bg-warn" aria-hidden />Đã gửi vào hàng đợi duyệt của data engineer</div>
      </div>
    </Frame>
  );
}

export default function AskPage() {
  usePageTitle("Hỏi & kiểm");
  return (
    <>
      <PageHero eyebrow="Hỏi & kiểm" title="Hỏi một con số. Nhận cả phiếu kiểm."
        lead="Hỏi kho dữ liệu bằng tiếng Việt, có dấu hay không dấu đều được. Mỗi câu trả lời là một thẻ: con số, kết luận Xanh, Vàng hoặc Đỏ, giả định, đối chiếu với SQL chuẩn và lịch sử các lần sửa."
        actions={<><Cta to={`${L()}#demo`}>Xem demo</Cta><Cta to={L("cach-hoat-dong")} variant="secondary">Bộ kiểm hoạt động thế nào</Cta></>}>
        <Frame className="mx-auto max-w-[980px]"><Shot name="answer" eager alt="Thẻ trả lời doanh thu theo loại thanh toán năm 2017 với kết luận Đã kiểm · Xanh, bảng bốn loại thanh toán, phiếu kiểm hai lần và đồ thị lineage." /></Frame>
      </PageHero>
      <Section sunk>
        <Feature eyebrow="Trước khi gửi" title="Thấy LVDA hiểu câu hỏi thế nào"
          body="Ô hỏi hiện chỉ số, khoảng thời gian, cách chia nhóm và top N mà LVDA đọc được. Khi một từ khớp nhiều chỉ số, nó đưa các lựa chọn khác để bạn đổi ngay."
          points={["Khớp tên và từ đồng nghĩa của chỉ số, không cần gõ dấu", "Gõ SELECT hoặc WITH là ô chuyển sang chế độ kiểm SQL", "Câu hỏi về dữ liệu không có trong kho bị từ chối, không đoán bừa"]}
          visual={<InterpretMock />} />
      </Section>
      <Section>
        <Feature flip eyebrow="Phiếu kiểm" title="Bốn tab cho mỗi câu trả lời"
          body="Phiếu kiểm ghi lại từng lần thử: model viết gì, luật nào bắt được, sửa ra sao. Bấm vào một lần để xem lineage của chính lần đó."
          points={[<><b className="font-semibold text-ink">Lineage</b>: từ cột raw qua cột mart, phép tính, điều kiện tới kết quả; chỗ sai tô đỏ, bộ lọc thiếu kẻ đứt</>,
            <><b className="font-semibold text-ink">Phát hiện</b>: luật bị vi phạm và ghi chú, kèm mức độ</>,
            <><b className="font-semibold text-ink">SQL</b>: so khác biệt giữa các vòng sửa</>,
            <><b className="font-semibold text-ink">Trace</b>: các bước, token, chi phí, thời gian và request_id</>]}
          visual={<Frame glow={false}><Shot name="answer-red" alt="Lineage của lần 0: ô join fct_payments với fct_orders tô đỏ, ghi join làm nhân dòng, kết quả Không chạy." /></Frame>} />
      </Section>
      <Section sunk>
        <Feature eyebrow="Kiểm SQL của bạn" title="Dán câu SQL đã có để kiểm"
          body="Không cần hỏi qua agent. Dán câu SQL đang dùng trong báo cáo, chọn chỉ số nó định tính, và nhận cùng phiếu kiểm như câu trả lời của agent."
          visual={<Code>{`SELECT o.customer_state,
       COUNT(DISTINCT o.customer_id) AS customers
FROM mart.fct_orders AS o
GROUP BY o.customer_state

-- Đỏ · V07 sai khóa thực thể
-- chỉ số customer_count đếm theo customer_unique_id`}</Code>} />
      </Section>
      <Section>
        <Feature flip eyebrow="Khi không có chỉ số" title="Câu hỏi lạ vẫn được trả lời, nhưng không quá Vàng"
          body="Câu hỏi có điều kiện mà không định nghĩa nào mang theo được trả lời bằng SQL riêng. Kết luận tối đa là Vàng, và câu trả lời vào hàng đợi. Khi được duyệt, nó thành truy vấn mẫu để agent dùng lại."
          visual={<YellowMock />} />
      </Section>
      <CtaBand />
    </>
  );
}
