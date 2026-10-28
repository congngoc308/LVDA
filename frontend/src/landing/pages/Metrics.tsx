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
      <PageHero eyebrow="Chỉ số đã chứng nhận" title="Mỗi chỉ số có một định nghĩa YAML do người có quyền ký"
        lead="Định nghĩa ghi cột đo, bộ lọc bắt buộc, join và cột thời gian. Bộ kiểm so từng câu SQL với các phần này."
        actions={<Cta to={L("cach-hoat-dong")}>Xem dấu vân tay lineage</Cta>}>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <Frame><Shot name="metric" eager alt="Chi tiết chỉ số Doanh thu gộp gmv v1: đã chứng nhận bởi Minh, lineage của chỉ số, định nghĩa, SQL chuẩn và dấu vân tay lineage gồm phép đo, cột đo, nguồn gốc, bộ lọc, join, cột thời gian." /></Frame>
          <Code className="self-start">{YAML}</Code>
        </div>
      </PageHero>
      <Section sunk>
        <SectionHead eyebrow="Vòng đời" title="Các trạng thái của một chỉ số" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            ["Nháp", "Viết bằng YAML hoặc nhập từ MetricFlow. Agent chưa dùng."],
            ["Chứng nhận", "Người có quyền ký duyệt, thẻ chỉ số hiện ngày ký."],
            ["Phiên bản", "Mỗi lần sửa tạo bản mới, câu trả lời ghi rõ đã dùng bản nào."],
            ["Cần chứng nhận lại", "Lineage của view bên dưới đổi thì chỉ số bị đánh dấu."],
          ].map(([t, b]) => (
            <div key={t} className="rounded-2xl border border-line bg-panel p-6">
              <div className="text-[17px] font-semibold">{t}</div>
              <p className="mt-2 text-[14.5px] leading-[1.6] text-muted">{b}</p>
            </div>
          ))}
        </div>
      </Section>
      <Section>
        <Feature eyebrow="Truy vấn mẫu" title="Câu trả lời đã duyệt thành ví dụ cho agent"
          body="Câu Vàng, câu Đỏ và câu bị báo sai vào hàng đợi duyệt. Duyệt xong, câu đó thành truy vấn mẫu."
          points={["Xuất được YAML để lưu cùng mã nguồn", "Chỉ engineer được giao quyền mới chứng nhận được"]}
          visual={<div className="rounded-2xl border border-line bg-panel p-6"><Points items={[
            "Bộ lọc bắt buộc: order_status = 'delivered'",
            "Khóa thực thể: mart.fct_orders.order_id",
            "Cột thời gian: mart.fct_orders.purchased_at",
          ]} /></div>} />
      </Section>
      <CtaBand />
    </>
  );
}
