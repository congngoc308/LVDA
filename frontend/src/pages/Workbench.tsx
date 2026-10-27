import { ArrowRight, BookMarked, ChevronRight, Code2, History, Loader2, MessageSquareText, Plus, Search, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { AnswerCard } from "../components/AnswerCard";
import { Composer, type ComposerHandle } from "../components/Composer";
import { Button, cx, Drawer, ErrorNote, timeAgo, useWide, VerdictDot } from "../components/ui";
import { useSession } from "../session";
import type { MetricLite, Run, RunLite } from "../types";
import MetricsPage from "./Metrics";
import SettingsPage from "./Settings";

const QUESTIONS = [
  "Doanh thu tháng 3/2018 là bao nhiêu?",
  "Doanh thu theo loại thanh toán năm 2017",
  "Số khách hàng theo bang quý 2/2018",
  "Tỉ lệ giao trễ theo tháng năm 2018",
  "Điểm đánh giá trung bình",
  "Doanh thu gộp lấy từ đâu?",
];
const SQLS = [
  { label: "Join nhân dòng", tag: "FAN-OUT", sql: "SELECT p.payment_type, SUM(i.price + i.freight_value) AS gmv\nFROM mart.fct_order_items i\nJOIN mart.fct_orders o ON o.order_id = i.order_id\nJOIN mart.fct_payments p ON p.order_id = o.order_id\nWHERE o.order_status = 'delivered'\nGROUP BY p.payment_type" },
  { label: "Đếm sai khóa khách", tag: "SAI KHÓA", sql: "SELECT o.customer_state, COUNT(DISTINCT o.customer_id) AS customers\nFROM mart.fct_orders o\nGROUP BY o.customer_state" },
  { label: "Join theo mã vùng", tag: "SAI JOIN", sql: "SELECT g.state, COUNT(*) AS n\nFROM mart.dim_customers c\nJOIN mart.dim_geolocation g ON g.zip_code_prefix = c.zip_code_prefix\nGROUP BY g.state" },
];
const STEPS = ["Hiểu câu hỏi", "Viết SQL", "Kiểm định lineage", "Chạy truy vấn"];

function Pending({ text }: { text: string }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 260);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="rounded-lg border border-dashed border-line-strong bg-surface px-5 py-4" aria-live="polite">
      <p className="font-medium">{text}</p>
      <div className="mt-2 flex flex-wrap gap-3 text-[12.5px] text-muted">
        {STEPS.map((s, i) => (
          <span key={s} className={cx("inline-flex items-center gap-1.5", i <= step && "text-ink-2")}>
            {i === step ? <Loader2 size={13} className="animate-spin" /> : <span className={cx("size-1.5 rounded-full", i < step ? "bg-good" : "bg-line-strong")} />}{s}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Cấu hình agent nằm trong tab Hỏi & kiểm: chỉ số (định nghĩa chuẩn để kiểm) và, với engineer, luật, mô hình, truy vấn mẫu. */
function AgentConfig({ section, engineer, onSection }: { section: "metrics" | "settings"; engineer: boolean; onSection: (s: "metrics" | "settings") => void }) {
  const items = [
    { key: "metrics" as const, label: "Chỉ số", sub: "định nghĩa chuẩn mà bộ kiểm định so", Icon: BookMarked },
    ...(engineer ? [{ key: "settings" as const, label: "Luật, mô hình & truy vấn mẫu", sub: "mức độ từng luật, model, giới hạn", Icon: SlidersHorizontal }] : []),
  ];
  // viewer chỉ có một mục: bỏ menu, dành chỗ cho bảng chỉ số
  if (!engineer) return (
    <div className="flex h-full flex-col">
      <p className="border-b border-line bg-sunk px-5 py-2 text-[12.5px] text-muted">Bạn có quyền xem. Sửa định nghĩa chỉ số cần engineer.</p>
      <div className="min-h-0 flex-1"><MetricsPage /></div>
    </div>
  );
  return (
    <div className="flex h-full">
      <nav className="w-[230px] shrink-0 border-r border-line bg-sunk/50 p-2" aria-label="Mục cấu hình">
        {items.map((i) => (
          <button key={i.key} onClick={() => onSection(i.key)} aria-current={section === i.key ? "page" : undefined}
            className={cx("flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left", section === i.key ? "bg-surface shadow-sm" : "hover:bg-surface/70")}>
            <i.Icon size={15} className={cx("mt-0.5 shrink-0", section === i.key ? "text-accent" : "text-muted")} />
            <span><span className={cx("block text-[13px]", section === i.key && "font-medium")}>{i.label}</span><span className="block text-[11.5px] text-muted">{i.sub}</span></span>
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1">{section === "settings" ? <SettingsPage /> : <MetricsPage />}</div>
    </div>
  );
}

export default function Workbench() {
  const { db } = useSession();
  const { runId, metricId } = useParams();
  const { pathname } = useLocation();
  const nav = useNavigate();
  const eng = db?.role === "engineer";
  // /metrics… và /settings mở panel cấu hình ngay trên màn hình hỏi, phiên hỏi vẫn giữ nguyên bên dưới
  const configOpen = pathname.startsWith("/metrics") || pathname.startsWith("/settings");
  const configSection = pathname.startsWith("/settings") && eng ? "settings" : "metrics";
  const [feed, setFeed] = useState<Run[]>([]);
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

  // đang chờ thì cuộn xuống ô chờ; có câu trả lời mới thì cuộn tới ĐẦU thẻ để thấy ngay con dấu và con số
  const lastId = feed.at(-1)?.id;
  useEffect(() => { if (pending) bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [pending]);
  useEffect(() => { if (lastId) document.getElementById(`run-${lastId}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [lastId]);
  const [historyOpen, setHistoryOpen] = useState(false);
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
  const empty = feed.length === 0 && !pending;
  const certified = metrics.filter((m) => m.status === "certified").length;
  const stale = metrics.filter((m) => m.status === "stale").length;

  const [histQuery, setHistQuery] = useState("");
  const [histHidden, setHistHidden] = useState(false);
  const wide = useWide();
  const showHistory = wide && !histHidden;
  const valueTone = (h: RunLite) => (h.status === "held" || h.final_verdict === "red" ? "text-bad" : h.final_verdict === "yellow" ? "text-warn" : h.final_verdict === "green" ? "text-good" : "text-ink-2");
  const today = new Date().toDateString();
  const groups: { label: string; items: RunLite[] }[] = [];
  for (const h of history) {
    if (histQuery && !h.question.toLowerCase().includes(histQuery.trim().toLowerCase())) continue;
    const d = new Date(h.created_at);
    const label = d.toDateString() === today ? "HÔM NAY" : d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
    const g = groups.find((x) => x.label === label) ?? (groups.push({ label, items: [] }), groups[groups.length - 1]);
    g.items.push(h);
  }
  const historyList = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3.5 pb-1.5 pt-3">
        <label className="flex h-[34px] items-center gap-2 rounded-lg border border-line bg-paper px-2.5 focus-within:border-accent">
          <Search size={14} className="text-faint" />
          <input value={histQuery} onChange={(e) => setHistQuery(e.target.value)} placeholder="Tìm câu hỏi…" aria-label="Tìm câu hỏi đã hỏi"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none focus-visible:outline-none" />
        </label>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-1">
        {groups.length === 0 && <p className="px-3 py-6 text-center text-[12.5px] text-faint">{histQuery ? "Không có câu nào khớp." : "Chưa có câu hỏi nào."}</p>}
        {groups.map((g) => (
          <div key={g.label} className="mt-2.5 flex flex-col gap-px">
            <span className="px-3 pb-1.5 pt-1 font-mono text-[10.5px] font-medium tracking-[0.12em] text-faint">{g.label}</span>
            {g.items.map((h) => (
              <button key={h.id} onClick={() => { setHistoryOpen(false); nav(`/runs/${h.id}`); }}
                className={cx("flex gap-2.5 rounded-lg px-3 py-[9px] text-left hover:bg-[#151c29]", runId === h.id && "bg-[#151d2c] shadow-[inset_0_0_0_1px_#26324a]")}>
                <span className="mt-[7px]"><VerdictDot verdict={h.status === "held" ? "red" : h.final_verdict} /></span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className={cx("line-clamp-2 text-[13.5px] leading-snug text-ink-2", h.input_kind === "sql" && "font-mono text-[12px]")}>{h.question}</span>
                  <span className="flex items-center gap-2 text-[11.5px] text-faint">
                    {h.headline && <span className={cx("truncate font-mono text-[12px] font-medium", valueTone(h))}>{h.headline}</span>}
                    <span className="flex-1" />
                    <span className="shrink-0 font-mono">{g.label === "HÔM NAY" ? timeAgo(h.created_at) : new Date(h.created_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
  const newSession = () => { setHistoryOpen(false); nav("/"); setFeed([]); setContext(null); };

  return (
    <div className="flex h-full">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[60px] shrink-0 items-center gap-3.5 border-b border-line bg-[rgba(10,14,21,0.6)] px-7 text-[12.5px] backdrop-blur-md">
          {catalogOnly ? <span className="text-faint">Database này chỉ để duyệt danh mục và lineage</span> : (
            <span className="text-faint">Agent kiểm theo <b className="num font-medium text-ink-2">{certified}/{metrics.length}</b> chỉ số đã chứng nhận</span>
          )}
          {stale > 0 && <button onClick={() => nav("/metrics")} className="rounded-full bg-bad-soft px-2 py-0.5 text-bad hover:underline">{stale} chỉ số cần chứng nhận lại</button>}
          <span className="ml-auto flex items-center gap-2">
            {!catalogOnly && (
              <button onClick={() => nav("/metrics")} className="flex h-[34px] items-center gap-2 rounded-lg border border-[#263045] bg-[#121825] px-3 text-[13px] font-medium text-ink transition-colors hover:border-[#3a4864] hover:bg-[#161d2b]">
                <SlidersHorizontal size={15} /> Chỉ số & cấu hình
              </button>
            )}
            {!showHistory && (
              <button onClick={() => (wide ? setHistHidden(false) : setHistoryOpen(true))} title="Lịch sử" aria-label="Mở lịch sử"
                className="grid size-[34px] place-items-center rounded-lg border border-[#263045] bg-[#121825] text-muted hover:border-[#3a4864] hover:text-ink">
                <History size={16} />
              </button>
            )}
          </span>
        </header>        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[980px] flex-col gap-4 px-8 pb-10 pt-[52px]">
            {catalogOnly && (
              <div className="pt-6">
                <h1 className="text-[22px] font-semibold tracking-tight">{db?.name}</h1>
                <p className="mt-1.5 max-w-2xl text-muted">
                  Database này chưa có chỉ số chuẩn nên agent chưa hỏi và kiểm được. Bạn vẫn xem được toàn bộ danh mục và lineage của nó.
                </p>
                <div className="mt-4 flex gap-2">
                  <Button variant="primary" onClick={() => nav("/data")}>Mở danh mục dữ liệu</Button>
                </div>
              </div>
            )}
            {empty && !catalogOnly && (
              <div className="flex flex-col gap-8 pt-6">
                <div className="flex flex-col gap-3.5">
                  <h1 className="text-balance text-[34px] font-bold leading-[1.2] tracking-[-0.02em] text-[#f3f5f9]">
                    Hỏi một con số. <span className="lv-gradient-text">Mỗi câu trả lời đi kèm phiếu kiểm.</span>
                  </h1>
                  <p className="max-w-[740px] text-pretty text-[15px] leading-[1.7] text-muted">
                    Agent viết SQL trên {db?.name}. Trước khi chạy, bộ kiểm định so lineage của câu SQL với định nghĩa chỉ số đã chứng nhận:
                    cột đo, bộ lọc, đường join, cột thời gian. Sai thì tự sửa, vẫn sai thì giữ lại không công bố.
                  </p>
                </div>
                <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr))]">
                  <section className="flex min-w-0 flex-col rounded-[14px] border border-line bg-[rgba(17,23,35,0.85)] p-2 backdrop-blur-sm">
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <MessageSquareText size={15} className="text-accent" />
                      <span className="font-mono text-[11.5px] font-medium tracking-[0.1em] text-ink-2">HỎI SỐ LIỆU</span>
                      <span className="ml-auto text-[12px] text-faint">Chọn để điền</span>
                    </div>
                    {QUESTIONS.map((q, i) => (
                      <button key={q} onClick={() => composer.current?.fill(q)}
                        className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] text-ink-2 transition-colors hover:bg-[#182031] hover:text-white">
                        <span className="w-4 shrink-0 font-mono text-[11px] text-faint">0{i + 1}</span>
                        <span className="flex-1">{q}</span>
                        <ArrowRight size={14} className="text-[#4a5670] group-hover:text-accent" />
                      </button>
                    ))}
                  </section>
                  <section className="flex min-w-0 flex-col rounded-[14px] border border-line bg-[rgba(17,23,35,0.85)] p-2 backdrop-blur-sm">
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <Code2 size={15} className="text-accent" />
                      <span className="font-mono text-[11.5px] font-medium tracking-[0.1em] text-ink-2">DÁN SQL ĐỂ KIỂM</span>
                      <span className="ml-auto text-[12px] text-faint">Lỗi thường gặp</span>
                    </div>
                    <div className="flex flex-col gap-2 px-1 pb-1.5 pt-0.5">
                      {SQLS.map((s) => (
                        <button key={s.label} onClick={() => composer.current?.fill(s.sql)}
                          className="flex w-full min-w-0 flex-col gap-2 overflow-hidden rounded-[10px] border border-[#202939] bg-[#0e131d] px-3.5 py-3 text-left transition-colors hover:border-[oklch(0.5_0.1_235)] hover:bg-[#111826]">
                          <span className="flex w-full items-center gap-2">
                            <span className="flex-1 text-[14px] font-semibold text-ink">{s.label}</span>
                            <span className="whitespace-nowrap rounded-[5px] bg-bad-soft px-[7px] py-0.5 font-mono text-[10.5px] font-medium text-bad">{s.tag}</span>
                          </span>
                          <code className="block w-full truncate font-mono text-[12px] text-faint">
                            <span className="text-[oklch(0.78_0.13_300)]">SELECT</span>{s.sql.split("\n")[0].replace(/^SELECT/, "")}
                          </code>
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
            )}            {feed.map((r) => (
              <div key={r.id} id={`run-${r.id}`} className="scroll-mt-4">
                <AnswerCard run={r} onChange={replace}
                  onAskWith={(q, metricId) => ask(q, { simulate: true, metricId })}
                  onFollowUp={(run) => { setContext(run); composer.current?.focus(); }} />
              </div>
            ))}
            {pending && <Pending text={pending} />}
            <ErrorNote>{error}</ErrorNote>
            <div ref={bottom} />
          </div>
        </div>
        {!catalogOnly && (
          <div className="shrink-0 bg-[linear-gradient(to_bottom,rgba(10,14,21,0),#0a0e15_35%)] px-8 pb-[22px] pt-2">
            <div className="mx-auto max-w-[980px]">
              <Composer ref={composer} onSubmit={ask} busy={!!pending} context={context} clearContext={() => setContext(null)} metrics={metrics.filter((m) => m.status === "certified")} />
            </div>
          </div>
        )}
      </section>

      {showHistory && (
        <aside className="flex w-[316px] shrink-0 flex-col border-l border-line bg-sidebar" aria-label="Lịch sử của bạn">
          <div className="flex h-[60px] shrink-0 items-center gap-2 border-b border-line pl-5 pr-3.5">
            <h2 className="flex-1 whitespace-nowrap text-[14px] font-semibold">Lịch sử của bạn</h2>
            <button onClick={newSession} className="flex h-[30px] items-center gap-1.5 rounded-[7px] border border-[oklch(0.4_0.08_235)] bg-[oklch(0.25_0.05_240)] px-2.5 text-[12.5px] font-medium text-[oklch(0.88_0.08_235)] hover:bg-[oklch(0.29_0.06_240)]">
              <Plus size={13} strokeWidth={2.4} /> Phiên mới
            </button>
            <button onClick={() => setHistHidden(true)} title="Ẩn lịch sử" aria-label="Ẩn lịch sử" className="grid size-[30px] place-items-center rounded-[7px] text-faint hover:bg-[#182030] hover:text-ink">
              <ChevronRight size={15} />
            </button>
          </div>
          {historyList}
        </aside>
      )}      <Drawer open={historyOpen} onClose={() => setHistoryOpen(false)} width={340}
        title={<span className="flex items-center gap-3">Lịch sử của bạn <button className="text-[12px] font-normal text-accent hover:underline" onClick={newSession}>Phiên mới</button></span>}>
        <div className="flex h-full flex-col pt-2">{historyList}</div>
      </Drawer>

      <Drawer open={configOpen} width={1180} title="Cấu hình agent"
        // đang mở chi tiết một chỉ số thì Esc chỉ đóng chi tiết, không đóng cả panel
        onClose={() => nav(metricId ? "/metrics" : "/")}>
        <AgentConfig section={configSection} engineer={!!eng} onSection={(s) => nav(s === "settings" ? "/settings" : "/metrics")} />
      </Drawer>
    </div>
  );
}
