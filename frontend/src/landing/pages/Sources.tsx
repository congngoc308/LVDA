import { Code, Cta, CtaBand, Feature, Frame, L, PageHero, Section, SectionHead, Shot, usePageTitle } from "../ui";

const STEPS = [
  ["Nguồn", "Dán chuỗi kết nối postgresql://, mysql:// hoặc JDBC."],
  ["Kiểm tra", "LVDA thử mạng, xác thực, quyền chỉ đọc của role rồi đọc schema."],
  ["Chọn bảng", "Mặc định chọn mọi bảng, kèm gợi ý cột con trỏ và lịch đồng bộ."],
  ["Sao chép lần đầu", "Trang hiện tiến độ. Bạn đóng trang thì việc chép vẫn chạy tiếp."],
];

export default function SourcesPage() {
  usePageTitle("Kết nối nguồn");
  return (
    <>
      <PageHero eyebrow="Kết nối nguồn" title="Kết nối Postgres hoặc MySQL bằng role chỉ đọc"
        lead="LVDA không cần quyền ghi vào nguồn. Bảng được chép về một lần, sau đó đồng bộ tăng dần theo lịch."
        actions={<Cta to={L("bat-dau")}>Thử với database mẫu</Cta>}>
        <Frame><Shot name="connect" eager alt="Bước Kiểm tra khi kết nối database: Mạng, Xác thực PostgreSQL 16.15 user lvda_ro, Role chỉ đọc, Đọc schema 7 bảng khoảng 158.238 dòng; đạt cả 4 bước." /></Frame>
      </PageHero>
      <Section sunk>
        <SectionHead eyebrow="Kết nối database" title="Kết nối gồm bốn bước, bước xong thì thu gọn lại" />
        <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([t, b], i) => (
            <li key={t} className="rounded-2xl border border-line bg-panel p-6">
              <div className="grid size-8 place-items-center rounded-full bg-accent-soft font-mono text-[13px] text-accent">{i + 1}</div>
              <div className="mt-4 text-[17px] font-semibold">{t}</div>
              <p className="mt-2 text-[14.5px] leading-[1.6] text-muted">{b}</p>
            </li>
          ))}
        </ol>
      </Section>
      <Section>
        <Feature eyebrow="Role chỉ đọc" title="LVDA từ chối role có quyền ghi và đưa sẵn SQL tạo role chỉ đọc"
          body="LVDA tự kiểm quyền của role khi kết nối. Chuỗi kết nối được lưu mã hóa và API không trả nó ra."
          points={[<><b className="font-semibold text-ink">PostgreSQL</b>: role không được là superuser, không có quyền replication, CREATE, INSERT, UPDATE, DELETE hay TRUNCATE</>,
            <><b className="font-semibold text-ink">MySQL</b>: SHOW GRANTS chỉ được trả về SELECT và SHOW VIEW</>]}
          visual={<Code>{`-- PostgreSQL: role chỉ đọc cho LVDA
CREATE ROLE lvda_ro LOGIN PASSWORD '…';
GRANT CONNECT ON DATABASE shop TO lvda_ro;
GRANT USAGE ON SCHEMA public TO lvda_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO lvda_ro;`}</Code>} />
      </Section>
      <Section sunk>
        <Feature flip eyebrow="Đồng bộ tăng dần" title="Sau lần chép đầu, LVDA chỉ lấy dòng mới hoặc vừa sửa"
          body="Lần chép đầu dùng COPY, 158 nghìn dòng mất khoảng 8 giây. Các lần sau đọc lùi lại 5 phút để không sót commit đến muộn."
          points={["Lịch chạy: tắt, 15 phút, mỗi giờ hoặc mỗi ngày", "Khi cột hoặc khóa ở nguồn thay đổi, bản chép được dựng lại", "Catalog được quét lại sau mỗi lần đồng bộ"]}
          visual={<div className="rounded-2xl border border-line bg-panel p-6">
            <div className="text-[13px] text-faint">Lần chạy gần nhất của bảng orders</div>
            <div className="mt-4 grid grid-cols-3 gap-4">
              {[["đọc", "1.204"], ["thêm", "37"], ["sửa", "112"]].map(([k, v]) => (
                <div key={k}><div className="num text-[26px] font-medium">{v}</div><div className="text-[13px] text-faint">dòng {k}</div></div>
              ))}
            </div>
            <div className="mt-5 border-t border-line pt-4 font-mono text-[12.5px] leading-[1.8] text-ink-2">
              cursor: updated_at · lookback 5 phút<br />watermark: 10:00:12 → 11:00:07
            </div>
            <p className="mt-3 text-[12.5px] text-faint">Số minh họa; số thật ở Lịch sử đồng bộ.</p>
          </div>} />
      </Section>
      <Section>
        <SectionHead eyebrow="Giới hạn" title="Những gì đồng bộ tăng dần chưa làm được" />
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["Dòng bị xóa ở nguồn", "Đồng bộ tăng dần không thấy dòng đã xóa. Bảng lệch số dòng với nguồn được đánh dấu, chạy Làm mới toàn bộ để khớp lại."],
            ["Con trỏ NULL", "Dòng có cột con trỏ NULL chỉ được chép khi làm mới toàn bộ."],
            ["Không có CDC", "Đọc WAL hay binlog cần quyền replication, Debezium và Kafka, nằm ngoài phạm vi MVP."],
          ].map(([t, b]) => (
            <div key={t} className="rounded-2xl border border-line bg-panel p-6">
              <div className="text-[16.5px] font-semibold">{t}</div>
              <p className="mt-2 text-[14.5px] leading-[1.6] text-muted">{b}</p>
            </div>
          ))}
        </div>
      </Section>
      <CtaBand />
    </>
  );
}
