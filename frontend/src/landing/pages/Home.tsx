import { ArrowRight, BadgeCheck, Database, GitBranch, Link2, LayoutDashboard, RefreshCcw, ShieldCheck, Terminal, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Card, Code, Container, Cta, CtaBand, Eyebrow, Faq, Frame, GITHUB, L, Lead, MvpNote, Section, SectionHead, Shot, Stat, usePageTitle, VerdictChip,
} from "../ui";

function Hero() {
  return (
    <section className="relative overflow-hidden pt-14 sm:pt-20">
      <div aria-hidden className="lp-grid pointer-events-none absolute inset-0 -z-10" />
      <Container>
        <Link to={`${L()}#demo`} className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface py-1 pr-3 pl-1 text-[13px] text-ink-2 hover:border-accent-line">
          <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">MVP mã nguồn mở</span>
          Xem demo 1 phút 50<ArrowRight size={13} aria-hidden />
        </Link>
        <h1 className="mt-6 max-w-[960px] text-[40px] leading-[1.04] font-semibold tracking-[-0.035em] text-balance sm:text-[64px]">
          Agent dữ liệu kiểm từng con số <span className="text-accent">trước khi trả lời.</span>
        </h1>
        <Lead className="sm:text-[18px]">
          Hỏi kho dữ liệu bằng tiếng Việt. LVDA đối chiếu câu SQL với lineage cột và định nghĩa chỉ số đã chứng nhận,
          rồi trả lời kèm kết luận Xanh, Vàng hoặc Đỏ và bằng chứng. Sai thì tự sửa, vẫn sai thì giữ con số lại.
        </Lead>
        <div className="mt-8 flex flex-wrap gap-3">
          <Cta to={`${L()}#demo`}>Xem demo</Cta>
          <Cta to={L("bat-dau")} variant="secondary">Chạy thử trên máy</Cta>
        </div>
        <div className="relative mt-14 sm:mt-20">
          <Frame className="mx-auto max-w-[980px]"><Shot name="answer" eager alt="Thẻ trả lời của LVDA cho câu hỏi doanh thu theo loại thanh toán năm 2017: con số 499.240,84 BRL, kết luận Đã kiểm · Xanh, phiếu kiểm cho thấy lần 0 Đỏ vì luật V05 rồi lần 1 tự sửa thành Xanh, và đồ thị lineage từ cột raw tới kết quả." /></Frame>
          <div className="pointer-events-none absolute top-[74%] -right-4 hidden rounded-xl border border-line-strong bg-surface/95 px-4 py-3 shadow-xl backdrop-blur xl:block">
            <div className="text-[12px] text-faint">Kiểm trong</div>
            <div className="num text-[26px] font-medium text-ink">17,9 ms</div>
            <div className="text-[12px] text-faint">không gọi LLM</div>
          </div>
        </div>
      </Container>
    </section>
  );
}

function Tier({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-3 text-center font-mono text-[11.5px] tracking-[0.08em] text-faint uppercase">{label}</div>
      {children}
    </div>
  );
}

function Chip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <div className="flex items-center gap-2.5 rounded-lg border border-line bg-surface px-4 py-3 text-[14.5px] text-ink-2"><span className="text-accent">{icon}</span>{children}</div>;
}

function WhereItFits() {
  const layer = [
    { to: "chi-so", title: "Chỉ số đã chứng nhận", body: "Định nghĩa YAML: cột đo, bộ lọc bắt buộc, đường join, cột thời gian. Có phiên bản, người chứng nhận và ngày.", icon: <BadgeCheck size={18} /> },
    { to: "cach-hoat-dong", title: "Bộ kiểm lineage", body: "Phân tích SQL thành dấu vân tay lineage rồi so với định nghĩa. 12 luật, không gọi LLM, khoảng 12 ms.", icon: <GitBranch size={18} /> },
    { to: "hoi-va-kiem", title: "Tự sửa & đối chiếu", body: "Đỏ thì sửa tối đa hai vòng. Số công bố được đối chiếu với SQL chuẩn; vẫn sai thì giữ lại chờ duyệt.", icon: <RefreshCcw size={18} /> },
  ];
  return (
    <Section>
      <SectionHead center eyebrow="LVDA nằm ở đâu" title="Một lớp kiểm chứng giữa model và con số"
        lead="Model viết SQL ở đâu cũng được: trong app, trong Claude Code, hay trong CI. Con số chỉ ra ngoài sau khi đi qua lớp kiểm chứng." />
      <div className="mx-auto max-w-[1000px]">
        <Tier label="Nơi hỏi">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Chip icon={<Users size={17} />}>Web · Hỏi & kiểm</Chip>
            <Chip icon={<Terminal size={17} />}>Claude Code, Cursor (MCP)</Chip>
            <Chip icon={<Terminal size={17} />}>CLI <span className="font-mono text-[13px]">lvda verify</span></Chip>
            <Chip icon={<LayoutDashboard size={17} />}>Dashboard</Chip>
          </div>
        </Tier>
        <div className="lp-link" aria-hidden />
        <div className="rounded-2xl border border-accent-line bg-accent-soft/40 p-4 sm:p-6">
          <div className="mb-4 text-center font-mono text-[11.5px] tracking-[0.08em] text-accent uppercase">Lớp kiểm chứng</div>
          <div className="grid gap-3 md:grid-cols-3">
            {layer.map((b) => (
              <Link key={b.title} to={L(b.to)} className="group rounded-xl border border-line bg-surface p-5 transition-colors hover:border-accent-line">
                <div className="flex items-center gap-2.5 text-[16px] font-semibold"><span className="text-accent">{b.icon}</span>{b.title}</div>
                <p className="mt-2 text-[14px] leading-[1.6] text-muted">{b.body}</p>
              </Link>
            ))}
          </div>
        </div>
        <div className="lp-link" aria-hidden />
        <Tier label="Dữ liệu">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_2fr]">
            <Chip icon={<Database size={17} />}>PostgreSQL</Chip>
            <Chip icon={<Database size={17} />}>MySQL</Chip>
            <div className="flex items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 py-3 font-mono text-[13.5px] text-ink-2">
              raw <ArrowRight size={14} className="text-faint" aria-hidden /> staging <ArrowRight size={14} className="text-faint" aria-hidden /> mart
            </div>
          </div>
        </Tier>
      </div>
    </Section>
  );
}

function Numbers() {
  return (
    <section className="border-y border-line bg-panel py-14">
      <Container>
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <Stat value="142/142" label="SQL sai bị bắt" note="60 lỗi cấy vào và 82 bản nháp đầu của agent" />
          <Stat value="0/60" label="báo nhầm trên SQL đúng" />
          <Stat value="12 ms" label="mỗi lần kiểm, không gọi LLM" note="p95 17 ms" />
          <Stat value="31% → 91%" label="câu trả lời đúng của model nhỏ" note="khi bật bộ kiểm và tự sửa" />
        </div>
        <MvpNote className="mt-8" />
      </Container>
    </section>
  );
}

const MISTAKES = [
  { rule: "V02", title: "Sai cột đo", body: "Doanh thu gộp lấy tiền thanh toán thay vì giá hàng cộng phí vận chuyển.", sql: "SUM(p.payment_value)" },
  { rule: "V03", title: "Thiếu bộ lọc bắt buộc", body: "Quên chỉ tính đơn đã giao, nên đơn hủy cũng thành doanh thu.", sql: "-- thiếu: order_status = 'delivered'" },
  { rule: "V05", title: "Join làm nhân dòng", body: "Một đơn trả góp nhiều lần; join bảng thanh toán làm doanh thu bị cộng nhiều lần.", sql: "JOIN mart.fct_payments p ON …" },
  { rule: "V07", title: "Đếm sai khóa", body: "Một khách có nhiều customer_id. Đếm theo khóa này là đếm thừa khách.", sql: "COUNT(DISTINCT customer_id)" },
];

function Problem() {
  return (
    <Section>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          <Eyebrow>Vấn đề</Eyebrow>
          <h2 className="text-[30px] leading-[1.12] font-semibold tracking-[-0.02em] sm:text-[42px]">SQL sai mà vẫn chạy.</h2>
          <Lead>
            Câu trả lời sai nguy hiểm nhất là câu trông có vẻ đúng. Model viết một câu SQL chạy được, ra một con số gọn gàng,
            và không ai biết nó đã lấy nhầm cột hay quên một bộ lọc.
          </Lead>
          <div className="mt-8 rounded-xl border border-bad/30 bg-bad-soft/50 p-5">
            <div className="num text-[34px] font-medium text-bad">80 / 116</div>
            <p className="mt-1 text-[14.5px] leading-[1.6] text-ink-2">câu hỏi model nhỏ trả lời sai <b className="font-semibold">mà không có cảnh báo nào</b>, khi chưa có bộ kiểm. Bật bộ kiểm và tự sửa: còn 1.</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {MISTAKES.map((m) => (
            <Card key={m.rule} className="flex flex-col">
              <div className="flex items-center justify-between">
                <div className="text-[16px] font-semibold">{m.title}</div>
                <span className="rounded bg-bad-soft px-1.5 py-px font-mono text-[12px] font-medium text-bad">{m.rule}</span>
              </div>
              <p className="mt-2 flex-1 text-[14px] leading-[1.6] text-muted">{m.body}</p>
              <div className="mt-4 truncate rounded-md bg-sunk px-3 py-2 font-mono text-[12.5px] text-ink-2">{m.sql}</div>
            </Card>
          ))}
        </div>
      </div>
    </Section>
  );
}

const SEEN: { q: string; wrote: string; rule: string; first: "red" | "yellow"; then: ReactNode }[] = [
  { q: "Doanh thu theo loại thanh toán năm 2017", wrote: "Join fct_payments, không lọc lần trả", rule: "V05 · nhân dòng", first: "red", then: <><VerdictChip v="green" /> sau khi thêm <span className="font-mono">payment_sequential = 1</span></> },
  { q: "Giá trị đơn trung bình là bao nhiêu?", wrote: "AVG(p.payment_value)", rule: "V02 sai cột đo · V06 sai hàm tổng hợp", first: "red", then: <><VerdictChip v="green" /> sau một vòng tự sửa</> },
  { q: "Có bao nhiêu người bán ở bang SP có trên 10 đơn?", wrote: "SQL riêng, không chỉ số nào diễn đạt được", rule: "I03 · chưa có định nghĩa để so", first: "yellow", then: <>Giữ ở <VerdictChip v="yellow" />, vào hàng đợi cho data engineer duyệt</> },
];

function WhatItSees() {
  return (
    <Section sunk>
      <SectionHead eyebrow="LVDA thấy gì" title="Mỗi câu trả lời kèm một phiếu kiểm"
        lead="Bộ kiểm không đoán SQL đúng hay sai. Nó tách câu SQL thành cột đo, bộ lọc, join, cột thời gian và độ chi tiết, rồi so từng phần với định nghĩa đã chứng nhận." />
      <div className="scroll-thin overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[820px] text-left text-[14px]">
          <thead className="border-b border-line text-[12.5px] text-faint">
            <tr><th className="px-5 py-3 font-medium">Câu hỏi</th><th className="px-5 py-3 font-medium">Model viết</th><th className="px-5 py-3 font-medium">Luật bắt được</th><th className="px-5 py-3 font-medium">Lần đầu</th><th className="px-5 py-3 font-medium">Kết quả công bố</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {SEEN.map((r) => (
              <tr key={r.q} className="align-top">
                <td className="px-5 py-4 font-medium text-ink">{r.q}</td>
                <td className="px-5 py-4 font-mono text-[13px] text-ink-2">{r.wrote}</td>
                <td className="px-5 py-4 font-mono text-[13px] text-ink-2">{r.rule}</td>
                <td className="px-5 py-4"><VerdictChip v={r.first} /></td>
                <td className="px-5 py-4 leading-[1.9] text-ink-2 [&>span]:align-middle">{r.then}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-12 grid items-center gap-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <div>
          <h3 className="text-[22px] font-semibold tracking-[-0.01em]">Chỗ sai được tô đỏ ngay trên lineage</h3>
          <p className="mt-3 text-[15px] leading-[1.65] text-muted">
            Đây là phiếu kiểm lần 0 của câu hỏi đầu tiên trong bảng. Ô join <span className="font-mono text-ink-2">fct_payments ⋈ fct_orders</span> bị
            đánh dấu "join làm nhân dòng", nên con số không được chạy. Lần 1 agent thêm bộ lọc lần trả đầu tiên và phiếu chuyển Xanh.
          </p>
        </div>
        <Frame glow={false}><Shot name="answer-red" alt="Tab Lineage của phiếu kiểm lần 0: ô join fct_payments với fct_orders tô đỏ với nhãn join làm nhân dòng, kết quả ghi Không chạy, lần 0, Đỏ." /></Frame>
      </div>
    </Section>
  );
}

const SCENES = [
  ["KB-1", "Câu trả lời Xanh", "Hỏi một chỉ số đã chứng nhận, đọc phiếu kiểm và lineage."],
  ["KB-2", "Tự sửa cột đo sai", "Bản nháp đầu dùng nhầm cột, bộ kiểm báo Đỏ, agent sửa thành Xanh."],
  ["KB-3", "Bắt join nhân dòng", "Join bảng con làm số bị cộng nhiều lần; con số bị chặn."],
  ["KB-4", "Câu hỏi chưa có chỉ số", "Trả lời ở mức Vàng và gửi vào hàng đợi duyệt."],
  ["KB-5", "Kiểm SQL qua MCP", "Gọi verify_sql từ Claude Code trên chính câu SQL đó."],
];

function Demo() {
  return (
    <Section id="demo">
      <SectionHead eyebrow="Xem nó làm việc" title="Năm kịch bản trong 1 phút 50 giây" />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <Frame>
          <video className="block aspect-[16/10] w-full bg-sunk" controls preload="metadata" poster="/landing/demo-poster.webp" src="/landing/demo.mp4" aria-label="Video demo LVDA, năm kịch bản KB-1 đến KB-5" />
        </Frame>
        <ol className="space-y-5">
          {SCENES.map(([k, t, d]) => (
            <li key={k} className="flex gap-4">
              <span className="mt-0.5 shrink-0 self-start rounded-md bg-accent-soft px-1.5 py-0.5 font-mono text-[12px] font-medium text-accent">{k}</span>
              <div><div className="text-[15.5px] font-semibold">{t}</div><div className="mt-1 text-[14px] leading-[1.55] text-muted">{d}</div></div>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}

const STEPS = [
  { n: "01", title: "Kết nối", body: "Nối Postgres hoặc MySQL bằng role chỉ đọc. LVDA kiểm quyền trước khi nhận, rồi đồng bộ tăng dần theo cột updated_at.", stat: "158 nghìn dòng trong khoảng 8 giây", to: "ket-noi-nguon" },
  { n: "02", title: "Lập catalog", body: "Đọc định nghĩa view, dựng lineage tới từng cột. AI viết nháp mô tả cho bảng và cột, người duyệt.", stat: "500 bảng crawl trong 1,4 giây", to: "du-lieu-lineage" },
  { n: "03", title: "Chứng nhận", body: "Data engineer định nghĩa chỉ số bằng YAML và chứng nhận. Câu trả lời được duyệt thành truy vấn mẫu cho agent.", stat: "Mỗi chỉ số có phiên bản và người ký", to: "chi-so" },
  { n: "04", title: "Trả lời có kiểm chứng", body: "Mọi câu SQL qua bộ kiểm. Đỏ thì tự sửa, Vàng thì chờ duyệt. Agent khác dùng cùng bộ kiểm qua MCP.", stat: "p95 17 ms mỗi lần kiểm", to: "hoi-va-kiem" },
];

function Pipeline() {
  return (
    <Section sunk>
      <SectionHead eyebrow="Quy trình" title="Từ database thô tới con số có người chịu trách nhiệm"
        lead="Bốn bước, mỗi bước để lại dấu vết: ai kết nối, ai chứng nhận, câu nào đã được kiểm và kết luận ra sao." />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s) => (
          <Link key={s.n} to={L(s.to)} className="group flex flex-col rounded-xl border border-line bg-surface p-6 transition-colors hover:border-accent-line">
            <div className="font-mono text-[13px] text-accent">{s.n}</div>
            <div className="mt-3 text-[19px] font-semibold">{s.title}</div>
            <p className="mt-2 flex-1 text-[14px] leading-[1.6] text-muted">{s.body}</p>
            <div className="mt-5 border-t border-line pt-4 text-[13.5px] font-medium text-ink-2">{s.stat}</div>
          </Link>
        ))}
      </div>
    </Section>
  );
}

function Together() {
  return (
    <Section>
      <SectionHead eyebrow="Cùng làm việc" title="Cả nhóm nhìn cùng một con số"
        lead="Dashboard do agent dựng nhưng không chứa SQL tự viết. Mời người khác vào bằng một link có hạn dùng." />
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <LayoutDashboard size={20} className="text-accent" />
          <div className="mt-4 text-[17px] font-semibold">Dashboard do agent dựng</div>
          <p className="mt-2 text-[14.5px] leading-[1.6] text-muted">Trả lời ba câu: mục tiêu, người xem, tần suất. Agent hiện từng bước nó làm và bỏ card vào vùng phụ để bạn kéo vào.</p>
        </Card>
        <Card>
          <ShieldCheck size={20} className="text-accent" />
          <div className="mt-4 text-[17px] font-semibold">Card tự kiểm lại mỗi lần mở</div>
          <p className="mt-2 text-[14.5px] leading-[1.6] text-muted">Card chỉ lưu tham số của một chỉ số đã chứng nhận. Server dựng lại SQL chuẩn và kiểm lại; chỉ số nháp hay ngừng dùng bị từ chối.</p>
        </Card>
        <Card>
          <Link2 size={20} className="text-accent" />
          <div className="mt-4 text-[17px] font-semibold">Mời bằng một link</div>
          <p className="mt-2 text-[14.5px] leading-[1.6] text-muted">Chọn quyền, hạn dùng 1 đến 90 ngày và số lượt. Thu hồi link là gỡ luôn mọi người đã vào bằng nó.</p>
        </Card>
      </div>
      <Frame className="mt-12"><Shot name="tray" alt="Màn sửa dashboard: các card hệ thống có ổ khóa bên trái, vùng phụ bên phải chứa card Doanh thu gộp, Số đơn hàng, Giá trị đơn trung bình do agent tạo, mỗi card có nút Thêm vào." /></Frame>
      <div className="mt-6 text-center"><Cta to={L("dashboard-chia-se")} variant="text">Xem dashboard và chia sẻ</Cta></div>
    </Section>
  );
}

function SelfCheck() {
  const ci = ["gitleaks", "ruff", "mypy", "bootstrap", "278 test", "eval"];
  return (
    <Section sunk>
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <Eyebrow>Tự kiểm lại được</Eyebrow>
          <h2 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.02em] sm:text-[38px]">Không có huy hiệu. Có lệnh để bạn tự chạy.</h2>
          <Lead>Mọi con số trên trang này tái tạo được bằng một lệnh. CI chạy cùng lệnh đó trên mỗi pull request và đính kèm báo cáo.</Lead>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {ci.map((c, i) => (
              <span key={c} className="inline-flex items-center gap-2">
                <span className="rounded-md border border-line-strong bg-surface px-2.5 py-1 font-mono text-[12.5px] text-ink-2">{c}</span>
                {i < ci.length - 1 && <ArrowRight size={13} className="text-faint" aria-hidden />}
              </span>
            ))}
          </div>
        </div>
        <Code>{`make check   # ruff + mypy + 278 test, ngưỡng phủ 80% cho bộ kiểm
make eval    # tái tạo mọi số trong EVAL.md

# Windows không có make
.\\scripts\\eval.ps1`}</Code>
      </div>
    </Section>
  );
}

function Beliefs() {
  const items = [
    ["Con số chưa kiểm thì không công bố.", "Đỏ sau hai vòng sửa thì con số bị giữ lại và vào hàng đợi. Người hỏi thấy lý do, không thấy một con số sai."],
    ["Kiểm bằng luật, không nhờ LLM chấm.", "Một LLM chấm điểm chỉ cho cùng kết luận trong 48–75% số lần chạy lại. Bộ kiểm lineage luôn cho cùng kết luận và nói được vì sao."],
    ["Mời rộng, quyền hẹp.", "Kết nối bằng role chỉ đọc. Link chia sẻ không cấp quyền cao hơn người mời và không bao giờ chứng nhận được chỉ số. Mọi thao tác vào nhật ký."],
  ];
  return (
    <Section>
      <SectionHead eyebrow="Điều chúng tôi tin" title="Ba nguyên tắc thiết kế" />
      <div className="grid gap-8 md:grid-cols-3">
        {items.map(([t, b], i) => (
          <div key={t} className="border-t border-line-strong pt-6">
            <div className="font-mono text-[13px] text-accent">0{i + 1}</div>
            <div className="mt-3 text-[19px] leading-snug font-semibold">{t}</div>
            <p className="mt-3 text-[14.5px] leading-[1.65] text-muted">{b}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

const FAQ: [string, ReactNode][] = [
  ["LVDA khác text-to-SQL thông thường ở đâu?", "Text-to-SQL dừng ở chỗ câu SQL chạy được. LVDA kiểm câu SQL đó có khớp định nghĩa chỉ số đã chứng nhận không: đúng cột đo, đủ bộ lọc, join không nhân dòng, đúng cột thời gian. Sai thì tự sửa hoặc giữ con số lại."],
  ["Câu hỏi không có chỉ số nào phù hợp thì sao?", "Agent viết SQL riêng, bộ kiểm chỉ áp các luật chung vì không có định nghĩa để so. Kết luận tối đa là Vàng và câu trả lời vào hàng đợi để data engineer duyệt. Câu hỏi về dữ liệu không có trong kho bị từ chối."],
  ["Bộ kiểm có gọi LLM không?", "Không. Bộ kiểm phân tích SQL bằng sqlglot và so với định nghĩa, khoảng 12 ms mỗi lần, không tốn token. LLM chỉ dùng để viết SQL, sửa và diễn đạt câu trả lời."],
  ["Dùng LLM thật được không?", "Có client tương thích OpenAI (OpenRouter, Ollama, vLLM), bật bằng biến môi trường. Bản MVP chạy trên model giả lập cố ý mắc lỗi; client thật chưa được thử với endpoint thật."],
  ["Kết nối database của tôi thế nào? LVDA có ghi gì vào đó không?", "Dán chuỗi kết nối của một role chỉ đọc. LVDA kiểm quyền trước khi nhận và từ chối role có quyền ghi. Dữ liệu được chép vào kho riêng của LVDA; database nguồn không bị đụng tới."],
  ["Dòng bị xóa ở nguồn có được cập nhật không?", "Đồng bộ tăng dần không thấy dòng bị xóa. Sau mỗi lần chạy LVDA so số dòng và đánh dấu bảng bị lệch; bấm Làm mới toàn bộ để sửa."],
  ["Dashboard có sai khi chỉ số thay đổi không?", "Card không lưu SQL. Mỗi lần mở, server dựng lại SQL chuẩn từ phiên bản chỉ số hiện tại và kiểm lại, card hiện kết luận và phiên bản."],
  ["Người được mời bằng link làm được gì?", "Quyền Xem và hỏi: hỏi, kiểm SQL, xem chỉ số và dữ liệu, cột nhạy cảm bị che. Quyền Sửa: thêm sửa chỉ số, dashboard và cấu hình. Không link nào chứng nhận được chỉ số."],
  ["Dùng LVDA trong Claude Code như thế nào?", <>Thêm máy chủ MCP của LVDA bằng một lệnh, rồi gọi <span className="font-mono text-ink-2">verify_sql</span> hay <span className="font-mono text-ink-2">run_certified_metric</span>. Xem <Link to={L("tich-hop")} className="text-accent hover:underline">Tích hợp</Link>.</>],
  ["500 bảng có chạy nhanh không?", "Trên Docker máy cá nhân: crawl và dựng lineage cho 500 bảng mất 1,4 giây, tìm kiếm khoảng 100 ms, mở lineage một bảng khoảng 60 ms."],
];

export default function HomePage() {
  usePageTitle("Agent dữ liệu kiểm từng con số");
  return (
    <>
      <Hero />
      <WhereItFits />
      <Numbers />
      <Problem />
      <WhatItSees />
      <Demo />
      <Pipeline />
      <Together />
      <SelfCheck />
      <Beliefs />
      <Section sunk>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
          <div>
            <Eyebrow>Câu hỏi thường gặp</Eyebrow>
            <h2 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.02em] sm:text-[38px]">Hỏi trước khi chạy thử</h2>
            <p className="mt-4 text-[15px] text-muted">Chưa thấy câu của bạn? Mở issue trên <a href={GITHUB} target="_blank" rel="noreferrer" className="text-accent hover:underline">GitHub</a>.</p>
          </div>
          <Faq items={FAQ} />
        </div>
      </Section>
      <CtaBand />
    </>
  );
}
