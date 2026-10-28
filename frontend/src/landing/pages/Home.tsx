import { ArrowRight, BadgeCheck, ChevronDown, Database, GitBranch, LayoutDashboard, Link2, Play, RefreshCcw, ShieldCheck, Terminal, Users } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cx } from "../../components/ui";
import { Container, Cta, CtaBand, Eyebrow, GITHUB, L, Shot, usePageTitle, type ShotName } from "../ui";

/** Tiêu đề khối của trang chủ: to hơn H2 dùng chung một chút. */
function Head({ eyebrow, title, lead, center, tone }: { eyebrow: string; title: ReactNode; lead?: ReactNode; center?: boolean; tone?: "bad" }) {
  return (
    <div className={cx("max-w-[760px]", center && "mx-auto text-center")}>
      <Eyebrow className={tone === "bad" ? "text-bad" : undefined}>{eyebrow}</Eyebrow>
      <h2 className="text-[32px] leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-[44px]">{title}</h2>
      {lead && <p className={cx("mt-4 max-w-[620px] text-[16.5px] leading-[1.65] text-muted", center && "mx-auto")}>{lead}</p>}
    </div>
  );
}

function Band({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return <section id={id} className={cx("relative scroll-mt-16 border-t border-sunk py-24", className)}>{children}</section>;
}

function Hero() {
  return (
    <section className="relative isolate pt-16 sm:pt-24">
      <div aria-hidden className="lp-aura pointer-events-none absolute top-[-200px] left-1/2 -z-10 h-[900px] w-[1400px] -translate-x-1/2" />
      <div aria-hidden className="lp-squares pointer-events-none absolute inset-0 -z-10" />
      <Container className="text-center">
        <Link to={`${L()}#demo`} className="inline-flex items-center gap-2.5 rounded-full border border-line-strong bg-surface/70 py-[5px] pr-3.5 pl-1.5 text-[13px] whitespace-nowrap text-ink-2 hover:border-edge-hover">
          <span className="inline-flex gap-[3px]" aria-hidden>
            <span className="size-2 rounded-full bg-good" /><span className="size-2 rounded-full bg-warn" /><span className="size-2 rounded-full bg-bad" />
          </span>
          MVP mã nguồn mở, có video demo 2:30
        </Link>
        <h1 className="mx-auto mt-7 max-w-[980px] text-[44px] leading-[1.02] font-semibold tracking-[-0.04em] text-balance sm:text-[76px]">
          Agent dữ liệu kiểm từng con số <span className="text-accent-2">trước khi trả lời</span>
        </h1>
        <p className="mx-auto mt-6 max-w-[620px] text-[18px] leading-[1.65] text-pretty text-muted">
          Bạn hỏi bằng tiếng Việt, agent viết SQL. Trước khi chạy, LVDA so câu SQL đó với định nghĩa chỉ số đã chứng nhận và lineage cột.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Cta to={`${L()}#demo`}>Xem demo</Cta>
          <Cta to={L("bat-dau")} variant="secondary">Chạy thử trên máy</Cta>
        </div>
        <div className="mx-auto mt-20 max-w-[1040px] [perspective:2200px]">
          <div className="lp-hero-edge origin-top rounded-[18px] p-2 [transform:rotateX(10deg)]">
            <div className="lp-fade overflow-hidden rounded-xl bg-surface">
              <Shot name="answer" eager alt="Thẻ trả lời của LVDA cho câu hỏi doanh thu theo loại thanh toán năm 2017: con số 499.240,84 BRL, kết luận Đã kiểm · Xanh, phiếu kiểm cho thấy lần 0 Đỏ vì luật V05 rồi lần 1 tự sửa thành Xanh, và đồ thị lineage từ cột raw tới kết quả." />
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

function Numbers() {
  const n: [ReactNode, string][] = [
    [<>142<span className="text-dim">/142</span></>, "SQL sai bị bắt"],
    [<>0<span className="text-dim">/60</span></>, "báo nhầm trên SQL đúng"],
    [<>12<span className="text-dim"> ms</span></>, "mỗi lần kiểm, không gọi LLM"],
    [<span className="text-accent-2">91%</span>, "câu trả lời đúng, trước đó 31%"],
  ];
  return (
    <section className="pt-6 pb-22">
      <Container>
        <div className="grid grid-cols-2 md:grid-cols-4">
          {n.map(([v, l]) => (
            <div key={l} className="border-l border-line p-6">
              <div className="font-mono text-[32px] font-medium tracking-[-0.03em] sm:text-[40px]">{v}</div>
              <div className="mt-2 text-[14px] text-muted">{l}</div>
            </div>
          ))}
        </div>
        <p className="mt-4.5 ml-6 text-[12.5px] text-dim">Đo trên dữ liệu tổng hợp và model giả lập. <Link to={L("danh-gia")} className="text-accent-2 hover:underline">Phương pháp</Link></p>
      </Container>
    </section>
  );
}

const MISTAKES = [
  { rule: "V02", title: "Sai cột đo", sql: "SUM(p.payment_value)" },
  { rule: "V03", title: "Thiếu bộ lọc bắt buộc", sql: "-- thiếu: order_status = 'delivered'" },
  { rule: "V05", title: "Join làm nhân dòng", sql: "JOIN mart.fct_payments p ON …" },
  { rule: "V07", title: "Đếm sai khóa", sql: "COUNT(DISTINCT customer_id)" },
];

function Problem() {
  return (
    <Band id="van-de" className="overflow-hidden">
      <div aria-hidden className="lp-blob-red pointer-events-none absolute top-0 -left-[200px] h-[600px] w-[700px]" />
      <Container className="relative grid items-center gap-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          <Eyebrow className="text-bad">Vấn đề</Eyebrow>
          <h2 className="text-[32px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[48px]">SQL sai vẫn chạy được và vẫn ra số</h2>
          <p className="mt-4.5 text-[16.5px] leading-[1.65] text-muted">Con số trông hợp lý, nhưng câu SQL có thể đã lấy nhầm cột, quên lọc đơn đã giao hoặc join làm nhân dòng.</p>
          <div className="mt-8 font-mono text-[56px] leading-none font-medium tracking-[-0.03em] text-bad">80<span className="text-[28px] text-dim"> / 116</span></div>
          <p className="mt-2.5 max-w-[420px] text-[14.5px] leading-[1.6] text-ink-2">câu model nhỏ trả lời sai <b className="font-semibold text-ink">mà không có cảnh báo nào</b>, khi chưa bật bộ kiểm.</p>
        </div>
        <ul className="divide-y divide-sunk overflow-hidden rounded-2xl border border-line bg-paper">
          {MISTAKES.map((m) => (
            <li key={m.rule} className="grid grid-cols-[64px_minmax(0,1fr)] gap-4 px-5.5 py-5">
              <span className="pt-0.5 font-mono text-[13px] text-bad">{m.rule}</span>
              <div>
                <div className="text-[15.5px] font-semibold">{m.title}</div>
                <div className="mt-2 truncate font-mono text-[12.5px] text-ink-2">{m.sql}</div>
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </Band>
  );
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <div className="flex items-center gap-2.5 rounded-[10px] border border-line px-3.5 py-3"><span className="text-accent-2">{icon}</span>{children}</div>;
}

function WhereItFits() {
  const layer = [
    { icon: <BadgeCheck size={18} />, title: "Chỉ số đã chứng nhận", body: "YAML có phiên bản và người ký.", to: "chi-so" },
    { icon: <GitBranch size={18} />, title: "Bộ kiểm lineage", body: "12 luật, khoảng 12 ms, không gọi LLM.", to: "cach-hoat-dong" },
    { icon: <RefreshCcw size={18} />, title: "Tự sửa", body: "Đỏ thì sửa tối đa 2 vòng, vẫn Đỏ thì giữ con số lại.", to: "hoi-va-kiem" },
  ];
  const tier = "lp-lift rounded-2xl border border-line bg-panel p-6";
  const label = "font-mono text-[11.5px] tracking-[0.08em] uppercase";
  return (
    <Band>
      <Container>
        <div className="mb-14"><Head center eyebrow="Kiến trúc" title="Bộ kiểm nằm giữa chỗ viết SQL và chỗ chạy SQL" lead="SQL có thể đến từ app, từ Claude Code qua MCP hoặc từ CLI. Câu nào cũng qua cùng một bộ kiểm trước khi chạy." /></div>
        <div className="grid items-stretch gap-4 md:grid-cols-3">
          <div className={tier}>
            <div className={cx(label, "text-faint")}>SQL đến từ</div>
            <div className="mt-4.5 flex flex-col gap-2 text-[14.5px] text-ink-2">
              <Row icon={<Users size={16} />}>Web · Hỏi & kiểm</Row>
              <Row icon={<Terminal size={16} />}>Claude Code, Cursor (MCP)</Row>
              <Row icon={<Terminal size={16} />}>CLI <span className="font-mono text-[13px]">lvda verify</span></Row>
              <Row icon={<LayoutDashboard size={16} />}>Dashboard</Row>
            </div>
          </div>
          <div className="lp-edge-strong rounded-2xl">
            <div className="h-full rounded-[15px] lp-layer p-6">
              <div className={cx(label, "text-accent-2")}>LVDA</div>
              <div className="mt-4.5 flex flex-col gap-4.5">
                {layer.map((b) => (
                  <Link key={b.title} to={L(b.to)} className="group flex gap-3 text-ink hover:text-ink">
                    <span className="mt-0.5 shrink-0 text-accent-2">{b.icon}</span>
                    <span>
                      <span className="block text-[15.5px] font-semibold group-hover:underline">{b.title}</span>
                      <span className="mt-1 block text-[13.5px] leading-[1.55] text-muted">{b.body}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <div className={tier}>
            <div className={cx(label, "text-faint")}>Kho dữ liệu</div>
            <div className="mt-4.5 flex flex-col gap-2 text-[14.5px] text-ink-2">
              <Row icon={<Database size={16} />}>PostgreSQL</Row>
              <Row icon={<Database size={16} />}>MySQL</Row>
              <div className="flex items-center gap-2 rounded-[10px] border border-line px-3.5 py-3 font-mono text-[13px]">
                raw <ArrowRight size={13} className="text-faint" aria-hidden /> staging <ArrowRight size={13} className="text-faint" aria-hidden /> mart
              </div>
            </div>
          </div>
        </div>
      </Container>
    </Band>
  );
}

type V = "green" | "yellow" | "red";
const VC: Record<V, { label: string; cls: string; dot: string }> = {
  green: { label: "Xanh", cls: "bg-good-soft text-good", dot: "bg-good" },
  yellow: { label: "Vàng", cls: "bg-warn-soft text-warn", dot: "bg-warn" },
  red: { label: "Đỏ", cls: "bg-bad-soft text-bad", dot: "bg-bad" },
};
const QS: { q: string; wrote: string; rule: string; first: V; then: V; thenText: ReactNode }[] = [
  { q: "Doanh thu theo loại thanh toán năm 2017", wrote: "Join fct_payments, không lọc lần trả", rule: "V05 · nhân dòng", first: "red", then: "green", thenText: <>sau khi thêm <span className="font-mono">payment_sequential = 1</span></> },
  { q: "Giá trị đơn trung bình là bao nhiêu?", wrote: "AVG(p.payment_value)", rule: "V02 · V06 sai cột đo", first: "red", then: "green", thenText: "sau một vòng tự sửa" },
  { q: "Có bao nhiêu người bán ở bang SP có trên 10 đơn?", wrote: "SQL riêng, không chỉ số nào diễn đạt được", rule: "I03 · chưa có định nghĩa để so", first: "yellow", then: "yellow", thenText: "chờ duyệt" },
];

function Chip({ v }: { v: V }) {
  return <span className={cx("inline-flex h-[26px] items-center gap-1.5 rounded-md px-2.5 text-[13px] font-semibold", VC[v].cls)}><span className="size-1.5 rounded-full bg-current" aria-hidden />{VC[v].label}</span>;
}

function Checks() {
  const [q, setQ] = useState(0);
  const a = QS[q];
  const step = (n: string, label: string, body: ReactNode, last = false) => (
    <div className={cx("grid grid-cols-[28px_minmax(0,1fr)] gap-3.5 px-6 py-4.5", last ? "bg-paper" : "border-b border-sunk")}>
      <span className="pt-0.5 font-mono text-[12px] text-dim">{n}</span>
      <div><div className="text-[13px] text-faint">{label}</div><div className="mt-1.5">{body}</div></div>
    </div>
  );
  return (
    <Band id="phieu-kiem">
      <Container>
        <div className="mb-12"><Head eyebrow="Phiếu kiểm" title="Mỗi câu trả lời kèm một phiếu kiểm" lead="Bộ kiểm tách câu SQL thành cột đo, bộ lọc, join và cột thời gian, rồi so từng phần với định nghĩa. Ba câu hỏi dưới đây lấy từ bộ thử." /></div>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
          <div className="flex flex-col gap-2.5" role="tablist" aria-label="Câu hỏi mẫu">
            <div className="mb-0.5 font-mono text-[11.5px] tracking-[0.08em] text-dim uppercase">Chọn một câu hỏi</div>
            {QS.map((x, i) => (
              <button key={x.q} role="tab" aria-selected={i === q} onClick={() => setQ(i)}
                className={cx("flex w-full items-start gap-3.5 rounded-xl border px-4.5 py-4 text-left transition-colors",
                  i === q ? "border-accent-line bg-surface" : "border-line hover:border-edge-hover")}>
                <span className={cx("mt-0.5 shrink-0 font-mono text-[12px]", i === q ? "text-accent-2" : "text-dim")}>0{i + 1}</span>
                <span className="flex-1 text-[15.5px] leading-[1.45] font-medium">{x.q}</span>
                <span className={cx("mt-1.5 size-[9px] shrink-0 rounded-full shadow-[0_0_12px_currentColor]", VC[x.then].dot, VC[x.then].cls.split(" ")[1])} aria-hidden />
              </button>
            ))}
          </div>
          <div role="tabpanel" className="overflow-hidden rounded-2xl border border-line-strong bg-panel">
            <div className="border-b border-line px-6 py-5.5">
              <div className="text-[12.5px] text-faint">Câu hỏi</div>
              <div className="mt-1 text-[20px] font-semibold tracking-[-0.01em]">{a.q}</div>
            </div>
            {step("01", "Model viết", <span className="inline-block rounded-md bg-sunk px-2.5 py-1.5 font-mono text-[13px] text-ink-2">{a.wrote}</span>)}
            {step("02", "Luật bắt được", <span className={cx("font-mono text-[14px] font-medium", VC[a.first].cls.split(" ")[1])}>{a.rule}</span>)}
            {step("03", "Lần đầu", <Chip v={a.first} />)}
            {step("04", "Kết quả công bố", <div className="flex flex-wrap items-center gap-2.5 text-[14.5px] text-ink-2"><Chip v={a.then} />{a.thenText}</div>, true)}
          </div>
        </div>
      </Container>
    </Band>
  );
}

const STEPS: { title: string; body: string; stat: string; shot: ShotName; alt: string; to: string }[] = [
  { title: "Kết nối", body: "Postgres hoặc MySQL qua role chỉ đọc, đồng bộ tăng dần.", stat: "158 nghìn dòng trong khoảng 8 giây", shot: "connect", alt: "Màn kết nối database", to: "ket-noi-nguon" },
  { title: "Lập catalog", body: "Dựng lineage tới từng cột.", stat: "500 bảng crawl trong 1,4 giây", shot: "column", alt: "Canvas lineage theo cột", to: "du-lieu-lineage" },
  { title: "Chứng nhận", body: "Định nghĩa chỉ số bằng YAML và ký duyệt.", stat: "Mỗi chỉ số có phiên bản và người ký", shot: "metric", alt: "Định nghĩa chỉ số đã chứng nhận", to: "chi-so" },
  { title: "Hỏi và kiểm", body: "Mọi câu SQL qua bộ kiểm trước khi chạy.", stat: "p95 17 ms mỗi lần kiểm", shot: "answer", alt: "Thẻ trả lời kèm phiếu kiểm", to: "hoi-va-kiem" },
];

/** Khối cao 320vh, phần trong dính lại. Trái: trục dọc, đường nối sáng dần theo lúc cuộn.
 *  Phải: ảnh xếp chồng, ảnh bước hiện tại ở trên, bước đã qua bay lên và mờ đi. */
function Pipeline() {
  const sec = useRef<HTMLElement>(null);
  const [prog, setProg] = useState(0);
  useEffect(() => {
    const on = () => {
      const el = sec.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const span = Math.max(1, r.height - window.innerHeight);
      setProg(Math.min(1, Math.max(0, -r.top / span)));
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on); window.removeEventListener("resize", on); };
  }, []);
  const step = Math.min(3, Math.floor(prog * 4));
  const go = (i: number) => {
    const el = sec.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const span = Math.max(1, r.height - window.innerHeight);
    window.scrollTo({ top: window.scrollY + r.top + (span * (i + 0.5)) / 4, behavior: "smooth" });
  };
  // ảnh thứ i so với bước hiện tại: đã qua thì bay lên mờ đi, chưa tới thì lùi sau và tối lại
  const card = (i: number) => {
    const o = i - step;
    if (o < 0) return { transform: "translateX(-50%) translateY(-40px) scale(1.04)", opacity: 0, zIndex: 10, filter: "blur(4px)" };
    return { transform: `translateX(-50%) translateY(${-o * 16}px) scale(${1 - o * 0.05})`, opacity: o === 0 ? 1 : Math.max(0, 0.55 - o * 0.15), zIndex: 9 - o };
  };
  const shot = "absolute top-0 left-1/2 block h-auto max-h-full w-auto max-w-full origin-top rounded-[15px] border border-line-strong bg-surface transition-[transform,opacity,filter] duration-700 ease-[cubic-bezier(.2,.8,.2,1)]";
  return (
    <section id="quy-trinh" ref={sec} className="relative h-[320vh] scroll-mt-16 border-t border-sunk">
      <div className="sticky top-16 flex h-[calc(100dvh-64px)] overflow-clip py-7">
        <div aria-hidden className="lp-blob-blue pointer-events-none absolute top-20 -right-[200px] h-[700px] w-[800px]" />
        <Container className="relative flex h-full flex-col">
          <div className="mb-5">
            <Eyebrow>Quy trình</Eyebrow>
            <h2 className="text-[28px] leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-[34px]">Từ database nguồn tới câu trả lời đã kiểm</h2>
          </div>
          <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-x-14 gap-y-7 min-[860px]:grid-cols-[minmax(0,4fr)_minmax(0,7fr)] min-[860px]:grid-rows-1">
            <ol className="flex flex-col gap-1.5 self-center" aria-label="Các bước">
              {STEPS.map((x, i) => {
                const f = Math.min(1, Math.max(0, prog * 4 - i));
                const on = i === step;
                return (
                  <li key={x.title}>
                    <button onClick={() => go(i)} aria-current={on ? "step" : undefined}
                      className="relative grid w-full grid-cols-[32px_minmax(0,1fr)] items-start gap-4.5 py-2 text-left">
                      <span aria-hidden className="absolute top-11 -bottom-0.5 left-[15px] w-0.5 overflow-hidden rounded-sm bg-line">
                        <span className="block w-full bg-gradient-to-b from-accent to-accent-2 transition-[height] duration-200 ease-linear" style={{ height: `${f * 100}%` }} />
                      </span>
                      <span aria-hidden className="absolute left-2.5 -mt-1.5 size-3 rounded-full bg-[#b3d0ff] shadow-[0_0_0_5px_oklch(0.6_0.15_255/0.25),0_0_24px_4px_oklch(0.7_0.15_255/0.7)] transition-[top,opacity] duration-200 ease-linear"
                        style={{ top: `calc(44px + (100% - 46px) * ${f})`, opacity: on ? 1 : 0 }} />
                      <span className={cx("relative grid size-8 place-items-center rounded-full border font-mono text-[12px] transition-all duration-300",
                        on ? "border-accent-2 bg-accent text-on-accent" : i < step ? "border-accent-line bg-good-soft text-ink" : "border-line-strong bg-panel text-dim")}>0{i + 1}</span>
                      <span className="block pt-1">
                        <span className={cx("block font-semibold tracking-[-0.015em] transition-[font-size,color] duration-300",
                          on ? "text-[22px] text-ink sm:text-[24px]" : i < step ? "text-[17px] text-muted" : "text-[17px] text-dim")}>{x.title}</span>
                        <span className={cx("block overflow-hidden transition-[max-height,opacity] duration-500", on ? "max-h-[200px] opacity-100" : "max-h-0 opacity-0")}>
                          <span className="mt-2 block text-[15.5px] leading-[1.6] text-muted">{x.body}</span>
                          <span className="mt-3.5 mb-2.5 inline-flex items-center gap-2 rounded-lg border border-accent-line bg-accent-soft/50 px-3 py-[7px] font-mono text-[12.5px] text-accent-2">{x.stat}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <div className="relative h-full min-h-[240px] pt-[30px]" aria-live="polite">
              <div className="relative h-full">
                {STEPS.map((x, i) => (
                  <Fragment key={x.shot}>
                    <img src={`/landing/${x.shot}-dark.webp`} alt={i === step ? x.alt : ""} aria-hidden={i !== step} decoding="async" className={cx(shot, "lp-shot-dark", i > step && "lp-back")} style={card(i)} />
                    <img src={`/landing/${x.shot}-light.webp`} alt="" aria-hidden decoding="async" className={cx(shot, "lp-shot-light", i > step && "lp-back")} style={card(i)} />
                  </Fragment>
                ))}
              </div>
            </div>
          </div>
        </Container>
      </div>
    </section>
  );
}

/** Ảnh lấp góc phải dưới của thẻ bento, bo góc trên trái. */
function Peek({ name, alt, wide, h }: { name: ShotName; alt: string; wide?: string; h?: string }) {
  return (
    <div className={cx("mt-5 ml-6 overflow-hidden rounded-tl-[10px] border-t border-l border-line-strong", h)}>
      <Shot name={name} alt={alt} className={cx(wide, "[&_img]:max-w-none", !wide && "[&_img]:max-w-full")} />
    </div>
  );
}

function Together() {
  const card = "lp-lift overflow-hidden rounded-[18px] border border-line bg-panel";
  const t = (title: string, body: string) => <><div className="text-[18px] font-semibold">{title}</div><div className="mt-1.5 text-[14px] leading-[1.55] text-muted">{body}</div></>;
  return (
    <Band id="san-pham">
      <Container>
        <div className="mb-10"><Head eyebrow="Dashboard và chia sẻ" title="Dashboard dựng từ chỉ số đã chứng nhận" lead="Card chỉ lưu tham số của chỉ số, không lưu SQL, nên mỗi lần mở đều được kiểm lại." /></div>
        <div className="grid gap-4 md:grid-cols-6">
          <Link to={L("dashboard-chia-se")} className={cx(card, "text-ink hover:text-ink md:col-span-4")}>
            <div className="px-6 pt-6">{t("Agent đề xuất card", "Bạn chọn card nào kéo vào dashboard.")}</div>
            <Peek name="tray" alt="Màn sửa dashboard với khay card do agent tạo" />
          </Link>
          <div className={cx(card, "flex flex-col p-6 md:col-span-2")}>
            <ShieldCheck size={20} className="text-accent-2" aria-hidden />
            <div className="mt-3">{t("Kiểm lại mỗi lần mở", "Server dựng SQL chuẩn từ phiên bản chỉ số hiện tại.")}</div>
          </div>
          <Link to={L("dashboard-chia-se")} className={cx(card, "text-ink hover:text-ink md:col-span-3")}>
            <div className="px-6 pt-6"><Link2 size={20} className="text-accent-2" aria-hidden /><div className="mt-3">{t("Link mời", "Hạn dùng 1 đến 90 ngày, thu hồi lúc nào cũng được.")}</div></div>
            <Peek name="share" alt="Tạo link chia sẻ" wide="[&_img]:w-[130%]" />
          </Link>
          <Link to={L("danh-gia")} className={cx(card, "text-ink hover:text-ink md:col-span-3")}>
            <div className="px-6 pt-6">{t("Trang Đánh giá", "Kết luận 30 ngày gần nhất và hàng đợi chờ duyệt.")}</div>
            <Peek name="dashboard" alt="Dashboard đánh giá" wide="[&_img]:w-[150%]" h="h-[200px]" />
          </Link>
        </div>
      </Container>
    </Band>
  );
}

// Mốc (giây) trong /landing/demo.mp4, đo theo lúc phụ đề đổi; quay lại video thì đo lại
const SCENES = [
  { k: "KB-1", start: 12, title: "Câu trả lời Xanh", desc: "Hỏi chỉ số đã chứng nhận." },
  { k: "KB-2", start: 26, title: "Tự sửa cột đo sai", desc: "Đỏ thành Xanh sau một vòng sửa." },
  { k: "KB-3", start: 58, title: "Bắt join nhân dòng", desc: "Số bị cộng nhiều lần, báo Đỏ." },
  { k: "KB-4", start: 85, title: "Câu hỏi chưa có chỉ số", desc: "Mức Vàng, chờ duyệt." },
  { k: "KB-5", start: 104.5, title: "Kiểm SQL qua MCP", desc: "Gọi verify_sql từ client khác." },
  { k: "EVAL", start: 121, title: "Kết quả đánh giá", desc: "142/142 bắt được, 0/60 báo nhầm." },
];
const SCENES_END = 147; // sau đó là thẻ kết

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function Demo() {
  const video = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [chain, setChain] = useState(true);
  // kịch bản vừa bấm: tắt "phát liên tiếp" thì dừng ở cuối kịch bản này
  const picked = useRef<number | null>(null);
  let current = -1;
  SCENES.forEach((s, i) => { if (time >= s.start && time < SCENES_END) current = i; });
  const end = (i: number) => SCENES[i + 1]?.start ?? SCENES_END;

  const play = (i: number) => {
    const v = video.current;
    if (!v) return;
    picked.current = i;
    v.currentTime = SCENES[i].start;
    setTime(SCENES[i].start);
    void v.play().catch(() => {});
  };
  const onTime = () => {
    const v = video.current;
    if (!v) return;
    setTime(v.currentTime);
    const p = picked.current;
    // timeupdate ~4 lần/giây nên dừng sớm một chút và lùi về ngay trước mốc, để vẫn sáng kịch bản vừa xem
    if (!chain && p !== null && v.currentTime >= end(p) - 0.3) {
      picked.current = null;
      v.pause();
      v.currentTime = end(p) - 0.2;
      setTime(end(p) - 0.2);
    }
  };
  // người xem tự tua ra ngoài kịch bản đã chọn thì thôi không dừng nữa
  const onSeeked = () => {
    const v = video.current, p = picked.current;
    if (v && p !== null && (v.currentTime < SCENES[p].start - 0.5 || v.currentTime >= end(p))) picked.current = null;
  };
  const cur = SCENES[Math.max(0, current)];

  return (
    <Band id="demo">
      <Container>
        <div className="mb-10"><Head eyebrow="Demo" title="Video demo: 5 kịch bản, 2 phút 30 giây" /></div>
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
          <div className="order-2 flex flex-col gap-3 lg:order-1">
            <ol className="flex flex-col gap-1" aria-label="Các kịch bản trong video">
              {SCENES.map((s, i) => {
                const on = i === current;
                const pct = time <= s.start ? 0 : Math.min(100, ((time - s.start) / (end(i) - s.start)) * 100);
                return (
                  <li key={s.k}>
                    <button onClick={() => play(i)} aria-current={on ? "step" : undefined}
                      className={cx("group relative flex w-full gap-3.5 overflow-hidden rounded-[10px] border px-3.5 py-3 text-left transition-colors",
                        on ? "border-accent-line bg-accent-soft/60" : "border-transparent hover:border-edge-hover")}>
                      <span className={cx("shrink-0 self-start rounded-md px-1.5 py-0.5 font-mono text-[12px] font-medium", on ? "bg-accent text-on-accent" : "bg-good-soft text-accent-2")}>{s.k}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex justify-between gap-3">
                          <span className="text-[15px] font-semibold">{s.title}</span>
                          <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[12px] text-faint group-hover:text-accent-2"><Play size={11} aria-hidden />{mmss(s.start)}</span>
                        </span>
                        <span className="mt-0.5 block text-[13.5px] leading-[1.5] text-muted">{s.desc}</span>
                      </span>
                      {pct > 0 && <span aria-hidden className="absolute bottom-0 left-0 h-0.5 bg-accent transition-[width] duration-200" style={{ width: `${pct}%` }} />}
                    </button>
                  </li>
                );
              })}
            </ol>
            <label className="inline-flex cursor-pointer items-center gap-2.5 self-start px-3.5 text-[13.5px] text-ink-2">
              <input type="checkbox" checked={chain} onChange={(e) => setChain(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
              Phát liên tiếp các kịch bản
            </label>
          </div>
          <div className="lp-edge order-1 rounded-2xl lg:order-2">
            <div className="relative overflow-hidden rounded-[15px] bg-sunk">
              <video ref={video} className="block aspect-[16/10] w-full" controls preload="metadata" poster="/landing/demo-poster.webp" src="/landing/demo.mp4"
                onTimeUpdate={onTime} onSeeked={onSeeked} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
                aria-label="Video demo LVDA, năm kịch bản KB-1 đến KB-5 và kết quả đánh giá" />
              {!playing && (
                <div className="pointer-events-none absolute top-4 left-4 flex items-center gap-2.5 rounded-[10px] bg-[rgb(12_13_21/0.82)] px-3.5 py-2.5 text-[#ecedf5] backdrop-blur-sm">
                  <span className="rounded-md bg-[#5b9bff] px-1.5 py-0.5 font-mono text-[12px] font-medium text-[#06142e]">{cur.k}</span>
                  <span className="text-[14px] font-medium">{cur.title}</span>
                  <span className="font-mono text-[12px] text-[#888daa]">{mmss(cur.start)}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </Container>
    </Band>
  );
}

function Beliefs() {
  const items: [string, string, string][] = [
    ["bg-good", "Con số Đỏ không được trả về", "Sau 2 vòng sửa vẫn Đỏ thì câu trả lời vào hàng đợi chờ duyệt."],
    ["bg-warn", "Kiểm bằng luật tất định", "Cùng một câu SQL luôn ra cùng kết luận. LLM chấm thì mỗi lần chạy một khác."],
    ["bg-bad", "Quyền tối thiểu", "Kết nối bằng role chỉ đọc. Link mời không cấp được quyền chứng nhận chỉ số."],
  ];
  return (
    <Band>
      <Container>
        <div className="mb-12"><Head eyebrow="Nguyên tắc" title="Ba quy tắc thiết kế" /></div>
        <div className="grid gap-4 md:grid-cols-3">
          {items.map(([bar, t, b]) => (
            <div key={t} className="lp-lift rounded-2xl border border-line bg-panel p-7">
              <span aria-hidden className={cx("block h-[3px] w-7 rounded-sm", bar)} />
              <div className="mt-5 text-[19px] leading-[1.3] font-semibold">{t}</div>
              <p className="mt-2.5 text-[14.5px] leading-[1.65] text-muted">{b}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 grid items-center gap-8 rounded-2xl border border-line bg-paper p-6 sm:p-8 md:grid-cols-2">
          <div>
            <h3 className="text-[22px] leading-[1.25] font-semibold">Tự chạy lại các con số trên trang này</h3>
            <p className="mt-2.5 text-[14.5px] leading-[1.65] text-muted">Hai lệnh dưới đây chạy test và tái tạo các số trong EVAL.md.</p>
          </div>
          <pre className="scroll-thin overflow-x-auto rounded-[10px] bg-sunk px-5 py-4.5 font-mono text-[13px] leading-[1.75] text-ink-2"><code>
            <span className="text-accent-2">make check</span>{"   "}<span className="text-dim"># ruff + mypy + 285 test, ngưỡng phủ 80%</span>{"\n"}
            <span className="text-accent-2">make eval</span>{"    "}<span className="text-dim"># tái tạo mọi số trong EVAL.md</span>{"\n\n"}
            <span className="text-dim"># Windows không có make</span>{"\n"}
            .\scripts\eval.ps1
          </code></pre>
        </div>
      </Container>
    </Band>
  );
}

const FAQ: [string, ReactNode][] = [
  ["LVDA khác text-to-SQL ở đâu?", "Text-to-SQL coi câu SQL chạy được là xong. LVDA kiểm thêm câu đó có khớp định nghĩa chỉ số không, sai thì sửa hoặc giữ con số lại."],
  ["Bộ kiểm có gọi LLM không?", "Không. Phân tích bằng sqlglot, khoảng 12 ms, không tốn token."],
  ["Không có chỉ số phù hợp thì sao?", "Kết luận tối đa là Vàng và chờ data engineer duyệt."],
  ["Dùng LLM thật được không?", "Có client tương thích OpenAI, bật bằng biến môi trường. Chưa thử với endpoint thật."],
  ["LVDA có ghi vào database của tôi không?", "Không. Chỉ nhận role chỉ đọc, dữ liệu chép vào kho riêng của LVDA."],
  ["Dùng trong Claude Code thế nào?", <>Thêm máy chủ MCP bằng một lệnh, rồi gọi <span className="font-mono text-ink-2">verify_sql</span>. Xem <Link to={L("tich-hop")} className="text-accent-2 hover:underline">Tích hợp</Link>.</>],
];

function Questions() {
  const [open, setOpen] = useState(0);
  return (
    <Band id="faq">
      <Container className="grid gap-12 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
        <div>
          <Eyebrow>Hỏi đáp</Eyebrow>
          <h2 className="text-[32px] leading-[1.1] font-semibold tracking-[-0.03em] sm:text-[44px]">Câu hỏi thường gặp</h2>
          <p className="mt-4 text-[15px] text-muted">Câu khác thì mở issue trên <a href={GITHUB} target="_blank" rel="noreferrer" className="text-accent-2 hover:underline">GitHub</a>.</p>
        </div>
        <div className="border-t border-line">
          {FAQ.map(([q, a], i) => (
            <div key={q} className="border-b border-line">
              <button aria-expanded={i === open} onClick={() => setOpen(i === open ? -1 : i)}
                className="flex w-full items-start justify-between gap-6 py-5 text-left text-[16.5px] leading-[1.4] font-medium">
                <span>{q}</span>
                <ChevronDown size={18} className={cx("mt-0.5 shrink-0 text-faint transition-transform", i === open && "rotate-180")} aria-hidden />
              </button>
              {i === open && <p className="max-w-[720px] pb-5.5 text-[15px] leading-[1.7] text-muted">{a}</p>}
            </div>
          ))}
        </div>
      </Container>
    </Band>
  );
}

export default function HomePage() {
  usePageTitle("Agent dữ liệu kiểm từng con số");
  return (
    <>
      <Hero />
      <Numbers />
      <Problem />
      <WhereItFits />
      <Checks />
      <Pipeline />
      <Together />
      <Demo />
      <Beliefs />
      <Questions />
      <CtaBand />
    </>
  );
}
