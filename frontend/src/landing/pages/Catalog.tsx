import { Cta, CtaBand, Feature, Frame, L, PageHero, Section, Shot, Stat, usePageTitle } from "../ui";

export default function CatalogPage() {
  usePageTitle("Dữ liệu & lineage");
  return (
    <>
      <PageHero eyebrow="Dữ liệu & lineage" title="Biết mỗi con số đi qua những cột nào"
        lead="Catalog đọc định nghĩa view ngay trong database, dựng lineage tới từng cột và gắn vào đó những gì agent đã làm: câu hỏi nào dùng cột này, bao nhiêu câu Xanh, lỗi nào đã bị chặn."
        actions={<Cta to={L("bat-dau")}>Chạy thử trên máy</Cta>}>
        <Frame><Shot name="column" eager alt="Canvas lineage của mart.fct_orders với cột gmv được chọn; khung bên phải: độ tin cậy 98%, đã chặn 18 câu SQL sai, mô tả cột." /></Frame>
      </PageHero>
      <section className="border-y border-line bg-panel py-14">
        <div className="mx-auto grid max-w-[1200px] gap-8 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          <Stat value="500" label="bảng trong kho mẫu doanh nghiệp" note="10 miền nghiệp vụ, 4.081 cột" />
          <Stat value="300/300" label="view parse được lineage" />
          <Stat value="1,4 s" label="crawl và dựng lineage cả kho" />
          <Stat value="~100 ms" label="tìm trên mọi bảng và cột" />
        </div>
      </section>
      <Section>
        <Feature eyebrow="Trang đầu" title="Không bắt bạn cuộn qua 500 bảng"
          body="Trang đầu chỉ đưa những bảng đáng xem: vừa mở gần đây, agent hay dùng, đứng sau chỉ số đã chứng nhận, và các miền nghiệp vụ kèm số bảng PII, mô tả chờ duyệt và bảng ngừng dùng."
          points={["Tìm theo tên, mô tả, gõ không dấu cũng được", "Kết quả xếp theo mức agent đã dùng", "Mỗi trang kết quả chỉ vài KB"]}
          visual={<Frame><Shot name="catalog" alt="Trang Dữ liệu: 26 bảng, 151 cột, 5 miền nghiệp vụ, 179 lượt agent dùng; danh sách bảng agent hay dùng và bảng trong chỉ số đã chứng nhận." /></Frame>} />
      </Section>
      <Section sunk>
        <Feature flip eyebrow="Canvas lineage" title="Bấm một cột, thấy cả đường đi của nó"
          body="Mỗi bảng là một nút có các cột bên trong, xếp theo làn nguồn, trung gian, mart, chỉ số. Bấm một cột là đường đi từ raw tới chỉ số sáng lên. Mỗi bảng hiện tối đa 14 bảng lân cận, phần còn lại gói vào 'xem tất cả'."
          points={[<><b className="font-semibold text-ink">Độ tin cậy</b>: câu hỏi đã dùng cột, tỉ lệ Xanh, số câu bị giữ, lỗi bộ kiểm đã chặn, chỉ số đã chứng nhận kèm người và ngày</>,
            <><b className="font-semibold text-ink">Tác động</b>: bảng, cột, chỉ số, truy vấn mẫu và câu hỏi cũ sẽ bị ảnh hưởng nếu cột này đổi</>]}
          visual={<Frame><Shot name="column" alt="Cột gmv được chọn trên canvas lineage, đường từ raw.order_items.price và freight_value sáng lên." /></Frame>} />
      </Section>
      <Section>
        <div className="grid gap-8 md:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface p-7">
            <div className="text-[19px] font-semibold">AI viết nháp, người duyệt</div>
            <p className="mt-3 text-[15px] leading-[1.65] text-muted">Bảng và cột chưa có mô tả được AI viết nháp. Data engineer sửa và duyệt ngay trong khung chi tiết; mô tả chờ duyệt được đếm theo từng miền.</p>
          </div>
          <div className="rounded-xl border border-line bg-surface p-7">
            <div className="text-[19px] font-semibold">Nạp lại warehouse, biết chỉ số nào bị ảnh hưởng</div>
            <p className="mt-3 text-[15px] leading-[1.65] text-muted">Khi định nghĩa view thay đổi, nút "Nạp lại warehouse" crawl lại và đánh dấu những chỉ số có lineage đổi là cần chứng nhận lại.</p>
          </div>
        </div>
      </Section>
      <CtaBand />
    </>
  );
}
