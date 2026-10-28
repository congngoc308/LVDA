import { Cta, CtaBand, Feature, Frame, L, PageHero, Section, Shot, Stat, usePageTitle } from "../ui";

export default function CatalogPage() {
  usePageTitle("Dữ liệu & lineage");
  return (
    <>
      <PageHero eyebrow="Dữ liệu & lineage" title="Biết mỗi con số đi qua những cột nào"
        lead="LVDA parse định nghĩa view để dựng lineage tới từng cột. Mỗi cột có tỉ lệ câu Xanh và số SQL sai đã chặn."
        actions={<Cta to={L("bat-dau")}>Chạy thử trên máy</Cta>}>
        <Frame><Shot name="column" eager alt="Canvas lineage của mart.fct_orders với cột gmv được chọn; khung bên phải: độ tin cậy 98%, đã chặn 18 câu SQL sai, mô tả cột." /></Frame>
      </PageHero>
      <section className="border-y border-line bg-panel py-14">
        <div className="mx-auto grid max-w-[1200px] gap-8 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          <Stat value="500" label="bảng trong kho mẫu doanh nghiệp" note="10 miền nghiệp vụ, 4.081 cột" />
          <Stat value="300/300" label="view parse được lineage" />
          <Stat value="1,4 s" label="để crawl và dựng lineage cho cả kho" />
          <Stat value="~100 ms" label="cho một lần tìm trên toàn bộ bảng và cột" />
        </div>
      </section>
      <Section>
        <Feature eyebrow="Trang đầu" title="Trang đầu chỉ hiện những bảng hay được dùng"
          body="Bạn thấy bảng vừa xem, bảng agent dùng nhiều nhất và bảng đứng sau chỉ số đã chứng nhận."
          points={["Tìm theo tên hoặc mô tả, gõ không dấu cũng được", "Kết quả xếp theo mức agent đã dùng"]}
          visual={<Frame><Shot name="catalog" alt="Trang Dữ liệu: 26 bảng, 151 cột, 5 miền nghiệp vụ, 179 lượt agent dùng; danh sách bảng agent hay dùng và bảng trong chỉ số đã chứng nhận." /></Frame>} />
      </Section>
      <Section sunk>
        <Feature flip eyebrow="Canvas lineage" title="Canvas tô sáng đường đi của cột bạn chọn"
          body="Chọn một cột, đường từ bảng raw qua staging, mart tới chỉ số sáng lên."
          points={[<><b className="font-semibold text-ink">Độ tin cậy</b>: tỉ lệ câu Xanh và số lỗi bộ kiểm đã bắt</>,
            <><b className="font-semibold text-ink">Tác động</b>: bảng, chỉ số và truy vấn mẫu bị ảnh hưởng khi cột đổi</>]}
          visual={<Frame><Shot name="column" alt="Cột gmv được chọn trên canvas lineage, đường từ raw.order_items.price và freight_value sáng lên." /></Frame>} />
      </Section>
      <Section>
        <div className="grid gap-8 md:grid-cols-2">
          <div className="rounded-2xl border border-line bg-panel p-7">
            <div className="text-[19px] font-semibold">Mô tả cột do AI viết nháp</div>
            <p className="mt-3 text-[15px] leading-[1.65] text-muted">Data engineer sửa và duyệt bản nháp trước khi dùng.</p>
          </div>
          <div className="rounded-2xl border border-line bg-panel p-7">
            <div className="text-[19px] font-semibold">Nạp lại warehouse</div>
            <p className="mt-3 text-[15px] leading-[1.65] text-muted">LVDA crawl lại các view. Chỉ số có lineage thay đổi bị đánh dấu cần chứng nhận lại.</p>
          </div>
        </div>
      </Section>
      <CtaBand />
    </>
  );
}
