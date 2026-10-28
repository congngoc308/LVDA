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
        <p className="mt-4 border-t border-line pt-4 text-[13px] text-faint">"doanh thu" khớp với hai chỉ số nên LVDA hỏi lại bạn.</p>
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
          Không có chỉ số nào khớp với "trên 10 đơn", nên bộ kiểm chỉ áp các luật chung.
        </div>
        <div className="mt-4 flex items-center gap-2 text-[13.5px] text-muted"><span className="size-1.5 rounded-full bg-warn" aria-hidden />Đã gửi vào hàng đợi duyệt</div>
      </div>
    </Frame>
  );
}

export default function AskPage() {
  usePageTitle("Hỏi & kiểm");
  return (
    <>
      <PageHero eyebrow="Hỏi & kiểm" title="Mỗi câu trả lời kèm phiếu kiểm và lineage"
        lead="Bạn hỏi bằng tiếng Việt, LVDA trả con số kèm kết luận Xanh, Vàng hoặc Đỏ."
        actions={<><Cta to={`${L()}#demo`}>Xem demo</Cta><Cta to={L("cach-hoat-dong")} variant="secondary">Bộ kiểm hoạt động thế nào</Cta></>}>
        <Frame className="mx-auto max-w-[980px]"><Shot name="answer" eager alt="Thẻ trả lời doanh thu theo loại thanh toán năm 2017 với kết luận Đã kiểm · Xanh, bảng bốn loại thanh toán, phiếu kiểm hai lần và đồ thị lineage." /></Frame>
      </PageHero>
      <Section sunk>
        <Feature eyebrow="Trước khi gửi" title="Ô hỏi cho biết LVDA hiểu câu hỏi ra sao"
          body="Trước khi gửi, bạn thấy chỉ số và khoảng thời gian LVDA nhận ra, cùng các chỉ số gần nghĩa để chọn lại."
          points={["Nhận từ đồng nghĩa khai trong YAML, gõ không dấu cũng được", "Câu bắt đầu bằng SELECT hoặc WITH được kiểm như SQL", "Câu hỏi về dữ liệu không có trong kho bị từ chối"]}
          visual={<InterpretMock />} />
      </Section>
      <Section>
        <Feature flip eyebrow="Phiếu kiểm" title="Phiếu kiểm có bốn tab"
          body="Lineage, Phát hiện, SQL và Trace, xem riêng cho từng lần thử."
          points={[<><b className="font-semibold text-ink">Lineage</b>: nút gây lỗi được tô đỏ</>,
            <><b className="font-semibold text-ink">SQL</b>: so sánh SQL giữa các vòng sửa</>,
            <><b className="font-semibold text-ink">Trace</b>: các bước, token, chi phí và request_id</>]}
          visual={<Frame glow={false}><Shot name="answer-red" alt="Lineage của lần 0: ô join fct_payments với fct_orders tô đỏ, ghi join làm nhân dòng, kết quả Không chạy." /></Frame>} />
      </Section>
      <Section sunk>
        <Feature eyebrow="Kiểm SQL của bạn" title="Dán câu SQL đã có để kiểm"
          body="Bạn dán SQL lấy từ báo cáo có sẵn và nhận phiếu kiểm giống SQL do agent viết."
          visual={<Code>{`SELECT o.customer_state,
       COUNT(DISTINCT o.customer_id) AS customers
FROM mart.fct_orders AS o
GROUP BY o.customer_state

-- Đỏ · V07 sai khóa thực thể
-- chỉ số customer_count đếm theo customer_unique_id`}</Code>} />
      </Section>
      <Section>
        <Feature flip eyebrow="Khi không có chỉ số" title="Câu hỏi chưa có chỉ số vẫn được trả lời, cao nhất là Vàng"
          body="Agent tự viết SQL rồi gửi câu trả lời vào hàng đợi duyệt. Được duyệt thì câu đó thành truy vấn mẫu."
          visual={<YellowMock />} />
      </Section>
      <CtaBand />
    </>
  );
}
