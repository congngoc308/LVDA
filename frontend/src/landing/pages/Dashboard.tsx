import { Cta, CtaBand, Feature, Frame, L, PageHero, Section, SectionHead, Shot, usePageTitle } from "../ui";

const SYSTEM = [
  ["Cần bạn xử lý", "Câu Vàng, Đỏ, bị báo sai"],
  ["Phán quyết 30 ngày", "Tỉ lệ Xanh, Vàng, Đỏ"],
  ["Chỉ số vận hành", "Tự sửa, báo sai, độ trễ"],
  ["Xu hướng theo ngày", "Tỉ lệ Xanh mỗi ngày"],
  ["Từ câu hỏi tới con số", "Số câu ở từng bước: nhận, có SQL, qua kiểm, công bố"],
  ["Lỗi bản nháp đầu", "Bản SQL đầu của model hay vi phạm luật nào"],
];

const LINK_RULES = [
  ["Quyền", "Xem và hỏi hoặc Sửa, không cao hơn quyền của người tạo link."],
  ["Hạn dùng", "1 đến 90 ngày, mặc định 7."],
  ["Số lượt", "Không giới hạn hoặc từ 1 đến 1.000 người."],
  ["Thu hồi", "Link hết hiệu lực và người đã vào qua link bị gỡ quyền."],
  ["Chứng nhận", "Người vào qua link không chứng nhận được chỉ số."],
  ["Nhật ký", "Việc tạo, dùng và thu hồi link đều được ghi vào nhật ký."],
];

export default function DashboardPage() {
  usePageTitle("Dashboard & chia sẻ");
  return (
    <>
      <PageHero eyebrow="Dashboard & chia sẻ" title="Dashboard do agent dựng, con số vẫn được kiểm"
        lead="Bạn trả lời ba câu hỏi, agent đề xuất card từ các chỉ số đã chứng nhận. Người khác vào xem qua link chia sẻ."
        actions={<><Cta to={`${L()}#demo`}>Xem demo</Cta><Cta to={L("bao-mat")} variant="secondary">Phân quyền & nhật ký</Cta></>}>
        <Frame><Shot name="dashboard" eager alt="Dashboard Đánh giá: 4 câu chờ duyệt, phán quyết 30 ngày 87% Xanh, 95,2% câu trả lời Xanh, tự sửa thành công 100%, độ trễ p50 206 ms." /></Frame>
      </PageHero>
      <Section sunk>
        <Feature eyebrow="Tạo bằng AI" title="Agent hỏi ba câu rồi hiện từng bước khi tạo card"
          body="Ba câu hỏi là mục tiêu, người xem và tần suất. Agent cho từng card qua bộ kiểm, card bị loại có ghi lý do."
          points={["Mỗi card ghi chỉ số, phiên bản và kết luận kiểm", "Card mới nằm ở vùng phụ cho tới khi bạn bấm Lưu", "Mỗi lần tạo có request_id riêng"]}
          visual={<Frame className="mx-auto max-w-[520px]"><Shot name="agent" alt="Hộp Tạo card bằng AI: các bước Đọc yêu cầu, Lập kế hoạch card, Kiểm card Doanh thu gộp, Số đơn hàng, Giá trị đơn trung bình, Tỉ lệ giao trễ đều kiểm định Xanh, đưa 6 card vào vùng phụ trong 0,5 giây." /></Frame>} />
      </Section>
      <Section>
        <Feature flip eyebrow="Sửa dashboard" title="Sắp xếp card bằng kéo thả, có hoàn tác"
          body="Kéo card từ vùng phụ hoặc bấm Thêm vào. Card có các cỡ S, M, L, XL; bấm Ctrl+Z để hoàn tác."
          points={["Card không chứa SQL, chỉ lưu chỉ số và chiều chia", "Bộ kiểm chạy lại mỗi lần card hiển thị", "Card dùng chỉ số nháp hoặc đã ngừng dùng bị từ chối"]}
          visual={<Frame><Shot name="tray" alt="Màn sửa dashboard với vùng phụ chứa 6 card do agent tạo." /></Frame>} />
      </Section>
      <Section sunk>
        <SectionHead eyebrow="Card hệ thống" title="Card hệ thống chỉ di chuyển, đổi cỡ hoặc gập lại được" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SYSTEM.map(([t, b]) => (
            <div key={t} className="rounded-2xl border border-line bg-panel p-5">
              <div className="text-[16px] font-semibold">{t}</div>
              <p className="mt-1.5 text-[14px] leading-[1.55] text-muted">{b}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-[13.5px] text-faint">Dashboard dành cho quyền Sửa. Quyền Xem và hỏi dùng Hỏi & kiểm và Dữ liệu.</p>
      </Section>
      <Section id="chia-se">
        <SectionHead eyebrow="Chia sẻ" title="Mời người khác vào database bằng link chia sẻ"
          lead="Quyền được cấp theo từng database. Mỗi link có quyền, hạn dùng và số lượt riêng, và có thể thu hồi." />
        <Frame glow={false}><Shot name="share" alt="Tab Link chia sẻ: chọn quyền Xem và hỏi hoặc Sửa, hết hạn sau 1, 7 hoặc 30 ngày, số lượt dùng; bảng link đang hiệu lực với nút Thu hồi." /></Frame>
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
