import { Cta, CtaBand, Feature, Frame, L, PageHero, Section, SectionHead, Shot, usePageTitle } from "../ui";

const SYSTEM = [
  ["Cần bạn xử lý", "Câu Vàng, Đỏ, lệch đối chiếu, câu bị báo sai; mở thẳng hàng đợi duyệt"],
  ["Phán quyết 30 ngày", "Tỉ lệ Xanh, Vàng, Đỏ và bị giữ lại"],
  ["Chỉ số vận hành", "Tỉ lệ Xanh, tự sửa thành công, người dùng báo sai, độ trễ"],
  ["Xu hướng theo ngày", "Kết luận theo ngày cùng tỉ lệ Xanh"],
  ["Từ câu hỏi tới con số", "Bao nhiêu câu nhận được, có SQL, qua kiểm, được công bố"],
  ["Lỗi bản nháp đầu", "Model hay sai ở luật nào trước khi tự sửa"],
];

const LINK_RULES = [
  ["Quyền", "Xem và hỏi, hoặc Sửa. Không bao giờ cao hơn quyền của người tạo link."],
  ["Hạn dùng", "1 đến 90 ngày, mặc định 7 ngày."],
  ["Số lượt", "Không giới hạn, hoặc tối đa 1 đến 1.000 người."],
  ["Thu hồi", "Link ngừng chạy và mọi người đã vào bằng link đó bị gỡ khỏi database."],
  ["Chứng nhận", "Người vào qua link không chứng nhận được chỉ số, dù có quyền Sửa."],
  ["Nhật ký", "Tạo, dùng, thu hồi link đều được ghi, lọc theo nhóm truy cập, chỉ số, duyệt, cấu hình, dữ liệu."],
];

export default function DashboardPage() {
  usePageTitle("Dashboard & chia sẻ");
  return (
    <>
      <PageHero eyebrow="Dashboard & chia sẻ" title="Dashboard do agent dựng, con số vẫn được kiểm"
        lead="Trả lời ba câu hỏi, agent đề xuất card từ chỉ số đã chứng nhận. Bạn kéo card vào dashboard, lưu, rồi mời cả nhóm bằng một link."
        actions={<><Cta to={`${L()}#demo`}>Xem demo</Cta><Cta to={L("bao-mat")} variant="secondary">Phân quyền & nhật ký</Cta></>}>
        <Frame><Shot name="dashboard" eager alt="Dashboard Đánh giá: card Cần bạn xử lý với 4 câu chờ duyệt, card Phán quyết 30 ngày 87% Xanh, chỉ số vận hành 95,2% câu trả lời Xanh, tự sửa thành công 100%, độ trễ p50 206 ms." /></Frame>
      </PageHero>
      <Section sunk>
        <Feature eyebrow="Tạo bằng AI" title="Ba câu hỏi, rồi xem agent làm từng bước"
          body="Agent hỏi mục tiêu, người xem và tần suất, có thể thêm trọng tâm hoặc bỏ qua để dùng mặc định. Sau đó nó hiện từng bước: đọc yêu cầu, lập kế hoạch, kiểm từng card với kho chỉ số và bộ kiểm. Card bị loại có ghi lý do."
          points={["Mỗi card ghi chỉ số, phiên bản, kết luận và thời gian chạy", "Kết quả vào vùng phụ, chưa lưu cho tới khi bấm Lưu", "Mỗi lần tạo có request_id để tra lại"]}
          visual={<Frame className="mx-auto max-w-[520px]"><Shot name="agent" alt="Hộp Tạo card bằng AI: các bước Đọc yêu cầu, Lập kế hoạch card, Kiểm card Doanh thu gộp, Số đơn hàng, Giá trị đơn trung bình, Tỉ lệ giao trễ đều kiểm định Xanh, đưa 6 card vào vùng phụ trong 0,5 giây." /></Frame>} />
      </Section>
      <Section>
        <Feature flip eyebrow="Sửa dashboard" title="Kéo thả, hoàn tác, chỉ lưu khi bạn muốn"
          body="Card đi từ vùng phụ vào dashboard bằng kéo thả hoặc nút Thêm vào. Mũi tên, cỡ S M L XL, thu gọn, sửa, trả về vùng phụ và xóa đều làm được không cần kéo. Ctrl+Z để hoàn tác, Hủy để bỏ hết."
          points={["Card không chứa SQL: chỉ lưu chỉ số, chiều chia, khoảng thời gian, kiểu biểu đồ, top N", "Mỗi lần hiển thị, server dựng lại SQL chuẩn và cho bộ kiểm chạy lại", "Chỉ số nháp, cũ hay ngừng dùng bị từ chối"]}
          visual={<Frame><Shot name="tray" alt="Màn sửa dashboard với vùng phụ chứa 6 card do agent tạo." /></Frame>} />
      </Section>
      <Section sunk>
        <SectionHead eyebrow="Card hệ thống" title="Sáu card luôn có, không ai xóa được"
          lead="Card hệ thống chỉ di chuyển, đổi cỡ và thu gọn. Báo cáo chi tiết giữ các kết quả kỹ thuật: bộ kiểm theo từng luật, so với LLM chấm, so sánh theo model." />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SYSTEM.map(([t, b]) => (
            <div key={t} className="rounded-xl border border-line bg-surface p-5">
              <div className="text-[16px] font-semibold">{t}</div>
              <p className="mt-1.5 text-[14px] leading-[1.55] text-muted">{b}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-[13.5px] text-faint">Dashboard dành cho thành viên có quyền Sửa. Người có quyền Xem và hỏi dùng Hỏi & kiểm và Dữ liệu.</p>
      </Section>
      <Section id="chia-se">
        <SectionHead eyebrow="Chia sẻ" title="Mời cả nhóm bằng một link, thu hồi bằng một nút"
          lead="Quyền được cấp theo từng database. Link mời có hạn dùng và số lượt, nên gửi vào nhóm chat cũng không lo link sống mãi." />
        <Frame glow={false}><Shot name="share" alt="Tab Link chia sẻ: chọn quyền Xem và hỏi hoặc Sửa, hết hạn sau 1, 7 hoặc 30 ngày, số lượt dùng, nút Tạo link; bảng link đang hiệu lực với nút Thu hồi." /></Frame>
        <dl className="mt-10 grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {LINK_RULES.map(([t, b]) => (
            <div key={t} className="border-t border-line pt-4">
              <dt className="text-[15.5px] font-semibold">{t}</dt>
              <dd className="mt-1.5 text-[14.5px] leading-[1.6] text-muted">{b}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <CtaBand />
    </>
  );
}
