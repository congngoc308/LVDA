import { Loader2, Search, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { AnswerCard } from "../components/AnswerCard";
import { Composer, type ComposerHandle } from "../components/Composer";
import { Button, cx, ErrorNote, timeAgo } from "../components/ui";
import { useSession } from "../session";
import type { MetricLite, Run, RunLite } from "../types";
import MetricsPage from "./Metrics";
import SettingsPage from "./Settings";

// câu mẫu theo nhóm; chấm màu chỉ để mắt dễ phân nhóm
const QUESTIONS: [string, string, string][] = [
  ["Doanh thu tháng 3/2018 là bao nhiêu?", "Doanh thu", "var(--color-accent)"],
  ["Doanh thu theo loại thanh toán năm 2017", "Doanh thu", "var(--color-cyan)"],
  ["Số khách hàng theo bang quý 2/2018", "Khách hàng", "var(--color-warn)"],
  ["Tỉ lệ giao trễ theo tháng năm 2018", "Vận hành", "var(--color-bad)"],
  ["Điểm đánh giá trung bình", "Đánh giá", "var(--color-warn)"],
  ["Doanh thu gộp lấy từ đâu?", "Lineage", "var(--color-pink)"],
];
const SQLS = [
  { label: "Join nhân dòng", tag: "FAN-OUT", sql: "SELECT p.payment_type, SUM(i.price + i.freight_value) AS gmv\nFROM mart.fct_order_items i\nJOIN mart.fct_orders o ON o.order_id = i.order_id\nJOIN mart.fct_payments p ON p.order_id = o.order_id\nWHERE o.order_status = 'delivered'\nGROUP BY p.payment_type" },
  { label: "Đếm sai khóa khách", tag: "SAI KHÓA", sql: "SELECT o.customer_state, COUNT(DISTINCT o.customer_id) AS customers\nFROM mart.fct_orders o\nGROUP BY o.customer_state" },
  { label: "Join theo mã vùng", tag: "SAI JOIN", sql: "SELECT g.state, COUNT(*) AS n\nFROM mart.dim_customers c\nJOIN mart.dim_geolocation g ON g.zip_code_prefix = c.zip_code_prefix\nGROUP BY g.state" },
];
const STEPS = ["Hiểu câu hỏi", "Viết SQL", "Kiểm định lineage", "Chạy truy vấn"];

function Pending({ text, initial }: { text: string; initial: string }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 260);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <div className="flex items-start justify-end gap-3 pb-2 pt-4">
        <div className="max-w-[70%] rounded-xl bg-raised px-4 py-3 text-[15px] leading-normal">{text}</div>
        <div className="grid size-8 shrink-0 place-items-center rounded-full bg-raised text-[13px] font-semibold" aria-hidden>{initial}</div>
      </div>
      <div className="flex flex-wrap gap-3 rounded-[14px] border border-dashed border-line-strong bg-surface px-4 py-3.5 text-[12.5px] text-faint">
        {STEPS.map((s, i) => (
          <span key={s} className={cx("inline-flex items-center gap-1.5", i <= step && "text-ink-2")}>
            {i === step ? <Loader2 size={13} className="animate-spin text-accent" /> : <span className={cx("size-1.5 rounded-full", i < step ? "bg-accent" : "bg-line-strong")} />}{s}
          </span>
        ))}
      </div>
    </div>
  );
}

type ConfigSection = "metrics" | "settings";

/** Cấu hình agent nằm trong tab Hỏi & kiểm: chỉ số (định nghĩa chuẩn để kiểm) và, với engineer, luật, mô hình, giới hạn, truy vấn mẫu. */
function AgentConfig({ open, section, engineer, onSection, onClose }: {
  open: boolean; section: ConfigSection; engineer: boolean; onSection: (s: ConfigSection) => void; onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    // đang mở một hộp thoại (sửa YAML, chi tiết chỉ số) thì Esc để hộp thoại đó tự đóng
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector("[role=dialog], [data-drawer]") && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  const tabs: [ConfigSection, string][] = [["metrics", "Chỉ số"], ...(engineer ? [["settings", "Luật, mô hình & giới hạn"] as [ConfigSection, string]] : [])];
  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <div className="absolute inset-0 bg-[rgba(5,6,8,0.6)]" onClick={onClose} />
      <div role="region" aria-label="Cấu hình agent" className="relative grid h-full w-[min(1000px,94vw)] grid-rows-[auto_minmax(0,1fr)] border-l border-line-strong bg-surface">
        <div className="flex items-end gap-6 border-b border-line pl-7 pr-4">
          <span className="whitespace-nowrap pb-4 pt-[18px] text-[14px] font-semibold">Cấu hình agent</span>
          <div className="flex min-w-0 flex-1 gap-1" role="tablist">
            {tabs.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={section === k} onClick={() => onSection(k)}
                className={cx("h-11 whitespace-nowrap px-2.5 text-[13px]", section === k ? "text-ink shadow-[inset_0_-2px_0_var(--color-accent)]" : "text-faint hover:text-ink-2")}>{label}</button>
            ))}
          </div>
          <button onClick={onClose} title="Đóng" aria-label="Đóng" className="mb-3 grid size-[30px] shrink-0 place-items-center rounded-md text-muted hover:bg-line hover:text-ink"><X size={15} /></button>
        </div>
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          {!engineer && <p className="border-b border-line bg-sunk px-7 py-2 text-[12.5px] text-faint">Bạn có quyền xem. Sửa định nghĩa chỉ số cần engineer.</p>}
          <div className="min-h-0 flex-1">{section === "settings" && engineer ? <SettingsPage /> : <MetricsPage />}</div>
        </div>
      </div>
    </div>
  );
}

export default function Workbench() {
  const { db, user } = useSession();
  const { runId, metricId } = useParams();
  const { pathname, state } = useLocation();
  const nav = useNavigate();
  const eng = db?.role === "engineer";
  // /metrics… và /settings mở panel cấu hình ngay trên màn hình hỏi, phiên hỏi vẫn giữ nguyên bên dưới
  const configOpen = pathname.startsWith("/metrics") || pathname.startsWith("/settings");
  const configSection: ConfigSection = pathname.startsWith("/settings") && eng ? "settings" : "metrics";
  const [feed, setFeed] = useState<Run[]>([]);
  // "Phiên mới": mở một cuộc hội thoại trống (không quay về trang đầu)
  const [fresh, setFresh] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<RunLite[]>([]);
  const [context, setContext] = useState<Run | null>(null);
  const [metrics, setMetrics] = useState<MetricLite[]>([]);
  const composer = useRef<ComposerHandle>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const loadHistory = useCallback(() => {
    if (db) api<RunLite[]>(`/db/${db.id}/runs?limit=40`).then(setHistory).catch(() => {});
  }, [db]);

  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => { if (db) api<MetricLite[]>(`/db/${db.id}/metrics`).then(setMetrics).catch(() => {}); }, [db, configOpen]);
  useEffect(() => {
    if (!db || !runId) return;
    api<Run>(`/db/${db.id}/runs/${runId}`).then((r) => setFeed([r])).catch((e) => setError(e.message));
  }, [db, runId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === "/" && tag !== "TEXTAREA" && tag !== "INPUT" && tag !== "SELECT") { e.preventDefault(); composer.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // đang chờ thì cuộn xuống ô chờ; có câu trả lời mới thì cuộn tới ĐẦU câu hỏi để thấy ngay con dấu và con số
  const lastId = feed.at(-1)?.id;
  useEffect(() => { if (pending) bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [pending]);
  useEffect(() => { if (lastId) document.getElementById(`run-${lastId}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [lastId]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const histBox = useRef<HTMLDivElement>(null);
  // ô lịch sử thả xuống: bấm ra ngoài hoặc Esc thì đóng
  useEffect(() => {
    if (!historyOpen) return;
    const onDown = (e: MouseEvent) => !histBox.current?.contains(e.target as Node) && setHistoryOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setHistoryOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [historyOpen]);
  const catalogOnly = !!db?.catalog_only;

  const ask = async (text: string, opts: { simulate: boolean; metricId: string | null }) => {
    if (!db) return;
    setError(null);
    setPending(text.length > 140 ? text.slice(0, 140) + "…" : text);
    if (runId) { nav("/", { replace: true }); setFeed([]); }
    try {
      const run = await api<Run>(`/db/${db.id}/ask`, {
        body: { question: text, simulate_mistakes: opts.simulate, context_run_id: context?.id ?? null, metric_id: opts.metricId },
      });
      setFeed((f) => [...f, run]);
      if (run.metric && run.input_kind === "question") setContext(null);
      loadHistory();
      window.dispatchEvent(new Event("lvda:reviews-changed"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không gửi được câu hỏi.");
    } finally {
      setPending(null);
    }
  };

  const replace = (r: Run) => setFeed((f) => f.map((x) => (x.id === r.id ? r : x)));
  const empty = feed.length === 0 && !pending && !fresh;

  const [histQuery, setHistQuery] = useState("");
  const valueTone = (h: RunLite) => (h.status === "held" || h.final_verdict === "red" ? "text-bad" : h.final_verdict === "yellow" ? "text-warn" : h.final_verdict === "green" ? "text-accent" : "text-faint");
  const today = new Date().toDateString();
  const groups: { label: string; items: RunLite[] }[] = [];
  for (const h of history) {
    if (histQuery && !h.question.toLowerCase().includes(histQuery.trim().toLowerCase())) continue;
    const d = new Date(h.created_at);
    const label = d.toDateString() === today ? "Hôm nay" : d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
    const g = groups.find((x) => x.label === label) ?? (groups.push({ label, items: [] }), groups[groups.length - 1]);
    g.items.push(h);
  }
  // trang đầu: mỗi câu hỏi một thẻ (lần gần nhất), 8 thẻ, "xem tất cả" mở hết ngay tại chỗ
  const distinct = history.filter((h, i) => history.findIndex((x) => x.question.trim() === h.question.trim()) === i);
  const recent = showAll ? distinct : distinct.slice(0, 8);
  const historyList = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-1 pb-1 pt-1">
        <label className="flex h-8 items-center gap-2 rounded-md border border-line px-2.5 focus-within:border-accent">
          <Search size={13} className="text-dim" />
          <input value={histQuery} onChange={(e) => setHistQuery(e.target.value)} placeholder="Tìm câu hỏi" aria-label="Tìm câu hỏi đã hỏi"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none focus-visible:outline-none" />
        </label>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-1 pt-1">
        {groups.length === 0 && <p className="px-3 py-6 text-center text-[12.5px] text-dim">{histQuery ? "Không có câu nào khớp." : "Chưa có câu hỏi nào."}</p>}
        {groups.map((g) => (
          <div key={g.label} className="mt-3 flex flex-col">
            <span className="px-2.5 pb-1.5 pt-0.5 text-[11px] text-dim">{g.label}</span>
            {g.items.map((h) => (
              <button key={h.id} onClick={() => { setHistoryOpen(false); nav(`/runs/${h.id}`); }}
                className={cx("flex flex-col gap-1 rounded-lg p-2.5 text-left hover:bg-hover", runId === h.id && "bg-hover")}>
                <span className={cx("line-clamp-2 text-pretty text-[13px] leading-[1.4] text-ink", h.input_kind === "sql" && "font-mono text-[12px]")}>{h.question}</span>
                <span className="flex items-center gap-2 text-[11px]">
                  <span className={cx("truncate font-mono", valueTone(h))}>{h.headline ?? (h.status === "held" ? "giữ lại" : "—")}</span>
                  <span className="flex-1" />
                  <span className="shrink-0 text-dim">{g.label === "Hôm nay" ? timeAgo(h.created_at) : new Date(h.created_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</span>
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
  const newSession = () => {
    setHistoryOpen(false); setFeed([]); setContext(null); setError(null); setFresh(true);
    if (runId) nav("/");
    setTimeout(() => composer.current?.focus(), 0);
  };
  // logo và tab Hỏi & kiểm gửi kèm state.home: luôn về trang đầu, kể cả khi đang ở "/"
  const homeTick = (state as { home?: number } | null)?.home;
  useEffect(() => {
    if (!homeTick) return;
    setFeed([]); setContext(null); setError(null); setFresh(false); setShowAll(false); setHistoryOpen(false);
  }, [homeTick]);
  const closeConfig = useCallback(() => nav(metricId ? "/metrics" : "/"), [nav, metricId]);
  const composerEl = (
    <Composer ref={composer} onSubmit={ask} busy={!!pending} context={context} clearContext={() => setContext(null)}
      metrics={metrics.filter((m) => m.status === "certified")} followUp={feed.length > 0} />
  );
  // thanh trên cùng của phiên: câu đang xem, chấm màu theo phán quyết của câu trả lời mới nhất
  const latest = feed.at(-1);
  const current = pending ?? latest?.question.split("\n")[0] ?? "Phiên mới";
  const dot = pending ? "animate-pulse bg-accent ring-accent/15"
    : latest?.status === "held" || latest?.final_verdict === "red" || latest?.final_verdict === "blocked" ? "bg-bad ring-bad/15"
    : latest?.final_verdict === "yellow" ? "bg-warn ring-warn/15" : "bg-accent ring-accent/15";
  const card = "rounded-xl border border-line bg-surface text-left transition-colors hover:border-edge hover:bg-hover-soft";
  const SectionHead = ({ title, aside }: { title: ReactNode; aside?: ReactNode }) => (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h2 className="whitespace-nowrap text-[16px] font-semibold">{title}</h2>
      {aside && <span className="text-[12px] text-faint">{aside}</span>}
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {catalogOnly && (
          <div className="mx-auto flex max-w-[1320px] flex-col gap-3 px-8 pb-10 pt-12">
            <h1 className="text-[28px] font-bold leading-[1.25]">{db?.name}</h1>
            <p className="max-w-[680px] text-[14px] leading-[1.7] text-muted">
              Database này chưa có chỉ số chuẩn nên agent chưa hỏi và kiểm được. Bạn vẫn xem được toàn bộ danh mục và lineage của nó.
            </p>
            <div className="mt-2"><Button variant="primary" onClick={() => nav("/data")}>Mở danh mục dữ liệu</Button></div>
          </div>
        )}

        {empty && !catalogOnly && (
          <div className="mx-auto flex max-w-[1320px] flex-col gap-9 px-4 pb-14 pt-10 md:px-8">
            <section className="grid items-end gap-8 [grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr))]">
              <div className="flex flex-col gap-3">
                <h1 className="text-pretty text-[32px] font-bold leading-[1.2]">
                  Hỏi một con số. <span className="text-accent">Mỗi câu trả lời đi kèm phiếu kiểm.</span>
                </h1>
                <p className="max-w-[620px] text-pretty text-[14px] leading-[1.7] text-muted">
                  Agent viết SQL trên {db?.name}. Trước khi chạy, bộ kiểm định so lineage của câu SQL với định nghĩa chỉ số đã chứng nhận:
                  cột đo, bộ lọc, đường join, cột thời gian. Sai thì tự sửa, vẫn sai thì giữ lại không công bố.
                </p>
              </div>
              {composerEl}
            </section>

            <section className="flex flex-col gap-4">
              <SectionHead title={<>Hỏi số liệu <span className="font-normal text-dim">({QUESTIONS.length})</span></>} />
              <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
                {QUESTIONS.map(([q, kind, c]) => (
                  <button key={q} onClick={() => composer.current?.fill(q)} className={cx(card, "group flex min-h-[112px] flex-col gap-[18px] p-[18px]")}>
                    <span className="flex items-center gap-2 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.04em] text-faint">
                      <span className="size-2 rounded-[2px]" style={{ background: c }} aria-hidden />{kind}
                    </span>
                    <span className="flex-1 text-pretty text-[15px] font-medium leading-[1.45]">{q}</span>
                    <span className="text-[12px] text-accent opacity-80 group-hover:opacity-100">Điền câu hỏi →</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="flex flex-col gap-4">
              <SectionHead title={<>Dán SQL để kiểm <span className="font-normal text-dim">· Lỗi thường gặp</span></>} />
              <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
                {SQLS.map((x) => (
                  <button key={x.label} onClick={() => composer.current?.fill(x.sql)} className={cx(card, "flex min-w-0 flex-col gap-3.5 p-[18px]")}>
                    <span className="flex w-full items-center justify-between gap-2.5">
                      <span className="text-[15px] font-medium">{x.label}</span>
                      <span className="whitespace-nowrap rounded-[5px] border border-bad/40 bg-bad-soft px-[7px] py-[3px] font-mono text-[11px] font-semibold text-bad">{x.tag}</span>
                    </span>
                    <code className="block w-full truncate rounded-lg border border-line-soft bg-paper px-3 py-2.5 font-mono text-[12px] leading-[1.6] text-muted">{x.sql.split("\n")[0]}</code>
                  </button>
                ))}
              </div>
            </section>

            {recent.length > 0 && (
              <section className="flex flex-col gap-3.5">
                <SectionHead title="Lịch sử" aside={distinct.length > 8 && <button onClick={() => setShowAll(!showAll)} className="text-accent hover:text-accent-2">{showAll ? "thu gọn" : `xem tất cả ${distinct.length}`}</button>} />
                <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
                  {recent.map((h) => (
                    <button key={h.id} onClick={() => nav(`/runs/${h.id}`)} className={cx(card, "flex flex-col gap-2.5 px-4 py-3.5")}>
                      <span className={cx("line-clamp-2 text-pretty text-[14px] leading-[1.45]", h.input_kind === "sql" && "font-mono text-[12.5px]")}>{h.question}</span>
                      <span className="mt-auto flex justify-between gap-2 text-[12px] text-dim">
                        <span className={cx("truncate font-mono font-medium", valueTone(h))}>{h.headline ?? (h.status === "held" ? "giữ lại" : "—")}</span>
                        <span className="whitespace-nowrap">{timeAgo(h.created_at)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {(!empty || error) && (
          <div className="mx-auto flex max-w-[1020px] flex-col px-4 md:px-8">
            <div className="sticky top-0 z-10 -mx-4 flex items-center justify-between gap-4 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
              <div className="flex min-w-0 items-center gap-3">
                <span className={cx("size-2 shrink-0 rounded-full ring-4", dot)} aria-hidden />
                <span className="min-w-0 truncate text-[14px] font-medium" title={current}>{current}</span>
              </div>
              <div ref={histBox} className="relative flex shrink-0 items-center gap-1 rounded-[10px] border border-line-strong bg-surface p-[3px]">
                <button onClick={() => setHistoryOpen(!historyOpen)} aria-expanded={historyOpen} aria-haspopup="dialog"
                  className={cx("flex items-center gap-2 rounded-[7px] px-3 py-[7px] text-[13px] font-medium", historyOpen ? "bg-hover text-accent" : "text-ink-2 hover:text-ink")}>
                  Lịch sử <span className="font-mono text-[11px] text-faint">{history.length}</span>
                </button>
                <button onClick={newSession} className="rounded-[7px] bg-accent px-3 py-[7px] text-[13px] font-semibold text-on-accent hover:bg-accent-2">Phiên mới</button>
                {historyOpen && (
                  <div role="dialog" aria-label="Lịch sử câu hỏi"
                    className="absolute right-0 top-[calc(100%+10px)] z-20 flex max-h-[min(560px,70vh)] w-[360px] max-w-[calc(100vw-32px)] flex-col rounded-xl border border-line-strong bg-surface p-2 shadow-[0_12px_32px_rgba(0,0,0,0.4)]">
                    {historyList}
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-8 pb-10">
              {feed.map((r) => (
                <div key={r.id} id={`run-${r.id}`} className="scroll-mt-16">
                  <AnswerCard run={r} bubble onChange={replace}
                    onAskWith={(q, metricId) => ask(q, { simulate: true, metricId })}
                    onFollowUp={(run) => { setContext(run); composer.current?.focus(); }} />
                </div>
              ))}
              {pending && <Pending text={pending} initial={(user?.name ?? "?").slice(0, 1)} />}
              <ErrorNote>{error}</ErrorNote>
              <div ref={bottom} />
            </div>
          </div>
        )}
      </div>
      {!catalogOnly && !empty && (
        <div className="shrink-0 pb-5 pt-3">
          <div className="mx-auto max-w-[1020px] px-4 md:px-8">{composerEl}</div>
        </div>
      )}

      <AgentConfig open={configOpen} section={configSection} engineer={!!eng} onClose={closeConfig}
        onSection={(sec) => nav(sec === "settings" ? "/settings" : "/metrics")} />
    </div>
  );
}
