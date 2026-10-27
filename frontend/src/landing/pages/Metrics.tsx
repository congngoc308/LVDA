import { Code, Cta, CtaBand, Feature, Frame, L, PageHero, Points, Section, SectionHead, Shot, usePageTitle } from "../ui";

const YAML = `- id: gmv
  name_vi: Doanh thu gộp
  description: Tổng giá hàng và phí vận chuyển của các đơn đã giao.
  unit: BRL
  synonyms: [doanh thu, doanh thu gộp, doanh số, gmv, revenue]
  status: certified
  grain: order
  entity_key: mart.fct_orders.order_id
  time_column: mart.fct_orders.purchased_at
  canonical_sql: |
    SELECT SUM(i.price + i.freight_value) AS gmv
    FROM mart.fct_order_items AS i
    JOIN mart.fct_orders AS o ON o.order_id = i.order_id
    WHERE o.order_status = 'delivered'
  required_filters:
    - {column: mart.fct_orders.order_status, op: "=", value: delivered}`;

export default function MetricsPage() {
  usePageTitle("Chỉ số đã chứng nhận");
  return (
    <>
      <PageHero eyebrow="Chỉ số đã chứng nhận" title="Một định nghĩa, có người ký, để mọi câu SQL so vào"
        lead="Mỗi chỉ số nói rõ nó được tính từ cột nào, phải lọc gì, join thế nào và theo cột thời gian nào. Bộ kiểm so mọi câu SQL với định nghĩa đó."
        actions={<Cta to={L("cach-hoat-dong")}>Xem dấu vân tay lineage</Cta>}>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <Frame><Shot name="metric" eager alt="Chi tiết chỉ số Doanh thu gộp gmv v1: đã chứng nhận bởi Minh, lineage của chỉ số, định nghĩa, SQL chuẩn và dấu vân tay lineage gồm phép đo, cột đo, nguồn gốc, bộ lọc, join, cột thời gian." /></Frame>
          <Code className="self-start">{YAML}</Code>
        </div>
      </PageHero>
      <Section sunk>
        <SectionHead eyebrow="Vòng đời" title="Từ bản nháp tới chứng nhận, và cả khi cần chứng nhận lại" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            ["Nháp", "Data engineer viết YAML hoặc nhập từ MetricFlow. Chỉ số nháp không được agent và dashboard dùng."],
            ["Chứng nhận", "Người có quyền chứng nhận ký tên. Thẻ chỉ số hiện người ký và ngày."],
            ["Phiên bản", "Sửa định nghĩa tạo phiên bản mới, xem được khác biệt với bản cũ. Câu trả lời ghi rõ phiên bản đã dùng."],
            ["Cần chứng nhận lại", "Lineage của view đổi thì chỉ số bị đánh dấu. Chỉ số ngừng dùng thì agent không chọn nữa và card dùng nó bị từ chối."],
          ].map(([t, b]) => (
            <div key={t} className="rounded-xl border border-line bg-surface p-6">
              <div className="text-[17px] font-semibold">{t}</div>
              <p className="mt-2 text-[14.5px] leading-[1.6] text-muted">{b}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section>
        <Feature eyebrow="Truy vấn mẫu" title="Câu trả lời được duyệt thành ví dụ cho agent"
          body="Hàng đợi duyệt gom câu trả lời Vàng, Đỏ, lệch đối chiếu và câu bị người dùng báo sai. Duyệt một câu là biến nó thành truy vấn mẫu; lần sau agent tìm thấy và dùng lại."
          points={["Xuất toàn bộ chỉ số ra YAML để lưu cùng mã nguồn", "Nhập định nghĩa từ MetricFlow", "Người xem chỉ đọc; chỉ engineer được giao trực tiếp mới chứng nhận"]}
          visual={<div className="rounded-xl border border-line bg-surface p-6"><Points items={[
            "Bộ lọc bắt buộc: order_status = 'delivered'",
            "Khóa thực thể: mart.fct_orders.order_id",
            "Cột thời gian: mart.fct_orders.purchased_at",
            "Giả định: chỉ tính đơn đã giao; gồm giá hàng và phí vận chuyển",
          ]} /></div>} />
      </Section>
      <CtaBand />
    </>
  );
}
