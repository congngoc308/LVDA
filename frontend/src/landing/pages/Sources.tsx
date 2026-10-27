import { Code, Cta, CtaBand, Feature, Frame, L, PageHero, Section, SectionHead, Shot, usePageTitle } from "../ui";

const STEPS = [
  ["Nguồn", "Dán chuỗi postgresql://, mysql:// hoặc JDBC; LVDA tách ra host, cổng, database, user, mật khẩu. Tham số như sslmode được giữ."],
  ["Kiểm tra", "Mạng, xác thực, role chỉ đọc, đọc được schema. Bước đầu tiên hỏng thì dừng, lỗi chỉ đúng vào ô gây ra nó."],
  ["Chọn bảng", "Mặc định chọn mọi bảng đọc được, gợi ý cột con trỏ và lịch mỗi giờ. Chỉ nhắc những bảng cần bạn quyết."],
  ["Sao chép lần đầu", "Số bảng xong, số dòng đã chép, thời gian còn lại theo tốc độ đo được. Đóng trang cũng không sao."],
];

export default function SourcesPage() {
  usePageTitle("Kết nối nguồn");
  return (
    <>
      <PageHero eyebrow="Kết nối nguồn" title="Nối database của bạn mà không trao quyền ghi"
        lead="LVDA kết nối Postgres hoặc MySQL bằng một role chỉ đọc, kiểm quyền trước khi nhận, rồi chép các bảng bạn chọn vào kho riêng và đồng bộ tăng dần theo lịch."
        actions={<Cta to={L("bat-dau")}>Thử với database mẫu</Cta>}>
        <Frame><Shot name="connect" eager alt="Bước Kiểm tra khi kết nối database: Mạng, Xác thực PostgreSQL 16.15 user lvda_ro, Role chỉ đọc, Đọc schema 7 bảng khoảng 158.238 dòng; đạt cả 4 bước." /></Frame>
      </PageHero>
      <Section sunk>
        <SectionHead eyebrow="Kết nối database" title="Bốn bước, bước nào xong thì gọn lại" />
        <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([t, b], i) => (
            <li key={t} className="rounded-xl border border-line bg-surface p-6">
              <div className="grid size-8 place-items-center rounded-full bg-accent-soft font-mono text-[13px] text-accent">{i + 1}</div>
              <div className="mt-4 text-[17px] font-semibold">{t}</div>
              <p className="mt-2 text-[14.5px] leading-[1.6] text-muted">{b}</p>
            </li>
          ))}
        </ol>
      </Section>
      <Section>
        <Feature eyebrow="Role chỉ đọc" title="Role có quyền ghi bị từ chối, kèm SQL để tạo role đúng"
          body="LVDA không tin lời hứa 'chỉ đọc'. Nó tự kiểm quyền của role và từ chối nếu thấy bất kỳ quyền ghi nào. Phiên làm việc cũng chạy ở chế độ chỉ đọc; chuỗi kết nối được mã hóa và API không bao giờ trả lại."
          points={[<><b className="font-semibold text-ink">PostgreSQL</b>: không superuser, replication, CREATEROLE, CREATEDB; không CREATE trên database hay schema; không INSERT, UPDATE, DELETE, TRUNCATE</>,
            <><b className="font-semibold text-ink">MySQL</b>: SHOW GRANTS chỉ được có SELECT và SHOW VIEW</>]}
          visual={<Code>{`-- PostgreSQL: role chỉ đọc cho LVDA
CREATE ROLE lvda_ro LOGIN PASSWORD '…';
GRANT CONNECT ON DATABASE shop TO lvda_ro;
GRANT USAGE ON SCHEMA public TO lvda_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO lvda_ro;`}</Code>} />
      </Section>
      <Section sunk>
        <Feature flip eyebrow="Đồng bộ tăng dần" title="Lần đầu chép hết, sau đó chỉ lấy dòng mới hoặc vừa sửa"
          body="Lần đầu và làm mới toàn bộ dùng COPY: 158 nghìn dòng trong khoảng 8 giây. Các lần sau chỉ đọc dòng có con trỏ từ mốc lần trước trừ 5 phút lùi lại, để giao dịch commit muộn không bị sót. Dòng không đổi thì không ghi lại."
          points={["Lịch: tắt, 15 phút, mỗi giờ, mỗi ngày", "Mỗi lần chạy ghi số dòng đọc, thêm, sửa và mốc trước, sau", "Cột hay khóa ở nguồn đổi thì bản chép được dựng lại", "Sau mỗi lần chạy, catalog crawl lại: grain từ khóa chính, join từ khóa ngoại, mô tả từ comment"]}
          visual={<div className="rounded-xl border border-line bg-surface p-6">
            <div className="text-[13px] text-faint">Lần chạy gần nhất · orders</div>
            <div className="mt-4 grid grid-cols-3 gap-4">
              {[["đọc", "1.204"], ["thêm", "37"], ["sửa", "112"]].map(([k, v]) => (
                <div key={k}><div className="num text-[26px] font-medium">{v}</div><div className="text-[13px] text-faint">dòng {k}</div></div>
              ))}
            </div>
            <div className="mt-5 border-t border-line pt-4 font-mono text-[12.5px] leading-[1.8] text-ink-2">
              cursor: updated_at · lookback 5 phút<br />watermark: 10:00:12 → 11:00:07
            </div>
            <p className="mt-3 text-[12.5px] text-faint">Minh họa định dạng; số liệu thật hiện trong Lịch sử đồng bộ.</p>
          </div>} />
      </Section>
      <Section>
        <SectionHead eyebrow="Giới hạn" title="Những gì đồng bộ tăng dần chưa làm được" />
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["Dòng bị xóa ở nguồn", "Không được thấy. LVDA so số dòng sau mỗi lần chạy và đánh dấu bảng có bản chép nhiều dòng hơn nguồn; Làm mới toàn bộ sẽ sửa."],
            ["Con trỏ NULL", "Dòng có cột con trỏ NULL chỉ về khi làm mới toàn bộ. Bảng không có con trỏ được làm mới toàn bộ mỗi lần."],
            ["Không có CDC", "Đọc WAL hay binlog sẽ bỏ được hai giới hạn trên, nhưng cần quyền replication và hạ tầng Debezium, Kafka; nằm ngoài MVP."],
          ].map(([t, b]) => (
            <div key={t} className="rounded-xl border border-line bg-surface p-6">
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
