import { ChevronRight, History, Loader2, Search, SlidersHorizontal, SquarePen, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { AnswerCard } from "../components/AnswerCard";
import { Composer, type ComposerHandle } from "../components/Composer";
import { Button, cx, Drawer, ErrorNote, timeAgo, useWide } from "../components/ui";
import { useSession } from "../session";
import type { MetricLite, Run, RunLite } from "../types";
import MetricsPage from "./Metrics";
import SettingsPage from "./Settings";

// mỗi câu mẫu một chấm màu, chỉ để mắt dễ bám dòng
const QUESTIONS: [string, string][] = [
  ["Doanh thu tháng 3/2018 là bao nhiêu?", "var(--color-accent)"],
  ["Doanh thu theo loại thanh toán năm 2017", "var(--color-cyan)"],
  ["Số khách hàng theo bang quý 2/2018", "var(--color-warn)"],
  ["Tỉ lệ giao trễ theo tháng năm 2018", "oklch(0.74 0.17 25)"],
  ["Điểm đánh giá trung bình", "var(--color-warn)"],
  ["Doanh thu gộp lấy từ đâu?", "var(--color-pink)"],
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
    <div className="flex flex-col gap-4" aria-live="polite">
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-[10px_10px_2px_10px] bg-raised px-3.5 py-2.5 text-[15px] leading-normal">{text}</div>
      </div>
      <div className="flex flex-wrap gap-3 rounded-[10px] border border-dashed border-line-strong bg-surface px-4 py-3.5 text-[12.5px] text-faint">
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
  const { db } = useSession();
  const { runId, metricId } = useParams();
  const { pathname } = useLocation();
  const nav = useNavigate();
  const eng = db?.role === "engineer";
  // /metrics… và /settings mở panel cấu hình ngay trên màn hình hỏi, phiên hỏi vẫn giữ nguyên bên dưới
  const configOpen = pathname.startsWith("/metrics") || pathname.startsWith("/settings");
  const configSection: ConfigSection = pathname.startsWith("/settings") && eng ? "settings" : "metrics";
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

  // đang chờ thì cuộn xuống ô chờ; có câu trả lời mới thì cuộn tới ĐẦU câu hỏi để thấy ngay con dấu và con số
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
  const stale = metrics.filter((m) => m.status === "stale").length;

  const [histQuery, setHistQuery] = useState("");
  const [histHidden, setHistHidden] = useState(false);
  const wide = useWide();
  const showHistory = wide && !histHidden;
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
  const historyList = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 pb-1 pt-3">
        <label className="flex h-8 items-center gap-2 rounded-md border border-line px-2.5 focus-within:border-accent">
          <Search size={13} className="text-dim" />
          <input value={histQuery} onChange={(e) => setHistQuery(e.target.value)} placeholder="Tìm câu hỏi" aria-label="Tìm câu hỏi đã hỏi"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none focus-visible:outline-none" />
        </label>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-1.5 pb-4 pt-1">
        {groups.length === 0 && <p className="px-3 py-6 text-center text-[12.5px] text-dim">{histQuery ? "Không có câu nào khớp." : "Chưa có câu hỏi nào."}</p>}
        {groups.map((g) => (
          <div key={g.label} className="mt-3 flex flex-col">
            <span className="px-3 pb-1.5 pt-0.5 text-[11px] text-dim">{g.label}</span>
            {g.items.map((h) => (
              <button key={h.id} onClick={() => { setHistoryOpen(false); nav(`/runs/${h.id}`); }}
                className={cx("flex flex-col gap-[3px] rounded-md px-3 py-2 text-left hover:bg-[#181a28]", runId === h.id && "bg-hover")}>
                <span className={cx("line-clamp-2 text-pretty text-[13px] leading-[1.4] text-ink-2", h.input_kind === "sql" && "font-mono text-[12px]")}>{h.question}</span>
                <span className="flex items-center gap-2 text-[11.5px]">
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
  const newSession = () => { setHistoryOpen(false); nav("/"); setFeed([]); setContext(null); };
  const closeConfig = useCallback(() => nav(metricId ? "/metrics" : "/"), [nav, metricId]);

  return (
    <div className="flex h-full">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3 text-[13px] text-faint">
            <button onClick={newSession} className="whitespace-nowrap text-[17px] font-semibold tracking-[-0.01em] text-ink">Hỏi &amp; kiểm</button>
            {catalogOnly && <span className="truncate">Database này chỉ để duyệt danh mục và lineage</span>}
            {stale > 0 && <button onClick={() => nav("/metrics")} className="whitespace-nowrap rounded-full bg-bad-soft px-2 py-0.5 text-[12px] text-bad hover:underline">{stale} chỉ số cần chứng nhận lại</button>}
          </div>
          {!catalogOnly && (
            <button onClick={() => nav("/metrics")} className="flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-edge px-3 text-[13px] hover:bg-hover">
              <SlidersHorizontal size={14} /> Chỉ số &amp; cấu hình
            </button>
          )}
          {!showHistory && (
            <button onClick={() => (wide ? setHistHidden(false) : setHistoryOpen(true))} title="Lịch sử" aria-label="Mở lịch sử"
              className="grid size-8 shrink-0 place-items-center rounded-md border border-line-strong text-muted hover:bg-hover hover:text-ink">
              <History size={15} />
            </button>
          )}
        </header>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {catalogOnly && (
            <div className="mx-auto flex max-w-[920px] flex-col gap-3 px-8 pb-10 pt-16">
              <h1 className="text-[28px] font-semibold leading-[1.3] tracking-[-0.015em]">{db?.name}</h1>
              <p className="max-w-[680px] text-[14.5px] leading-[1.7] text-muted">
                Database này chưa có chỉ số chuẩn nên agent chưa hỏi và kiểm được. Bạn vẫn xem được toàn bộ danh mục và lineage của nó.
              </p>
              <div className="mt-2"><Button variant="primary" onClick={() => nav("/data")}>Mở danh mục dữ liệu</Button></div>
            </div>
          )}
          {empty && !catalogOnly && (
            <div className="mx-auto flex max-w-[920px] flex-col gap-10 px-8 pb-10 pt-16">
              <div className="flex flex-col gap-3">
                <h1 className="text-balance text-[28px] font-semibold leading-[1.3] tracking-[-0.015em]">
                  Hỏi một con số. <span className="text-accent">Mỗi câu trả lời đi kèm phiếu kiểm.</span>
                </h1>
                <p className="max-w-[680px] text-pretty text-[14.5px] leading-[1.7] text-muted">
                  Agent viết SQL trên {db?.name}. Trước khi chạy, bộ kiểm định so lineage của câu SQL với định nghĩa chỉ số đã chứng nhận:
                  cột đo, bộ lọc, đường join, cột thời gian. Sai thì tự sửa, vẫn sai thì giữ lại không công bố.
                </p>
              </div>
              <div className="grid gap-8 [grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr))]">
                <section className="flex min-w-0 flex-col">
                  <div className="flex items-baseline gap-2 border-b border-line pb-2.5">
                    <h2 className="text-[13px] font-semibold text-accent">Hỏi số liệu</h2>
                    <span className="ml-auto text-[12px] text-dim">Chọn để điền</span>
                  </div>
                  {QUESTIONS.map(([q, c]) => (
                    <button key={q} onClick={() => composer.current?.fill(q)}
                      className="group flex items-center gap-3 border-b border-[#191b27] py-[11px] text-left text-[14px] text-ink-2 hover:text-white">
                      <span className="size-2 shrink-0 rounded-[2px]" style={{ background: c }} aria-hidden />
                      <span className="flex-1">{q}</span>
                      <span className="text-[13px] text-[#44485f] group-hover:text-accent" aria-hidden>→</span>
                    </button>
                  ))}
                </section>
                <section className="flex min-w-0 flex-col">
                  <div className="flex items-baseline gap-2 border-b border-line pb-2.5">
                    <h2 className="text-[13px] font-semibold text-cyan">Dán SQL để kiểm</h2>
                    <span className="ml-auto text-[12px] text-dim">Lỗi thường gặp</span>
                  </div>
                  {SQLS.map((s) => (
                    <button key={s.label} onClick={() => composer.current?.fill(s.sql)}
                      className="flex w-full min-w-0 flex-col gap-1.5 overflow-hidden border-b border-[#191b27] py-3 text-left hover:bg-surface">
                      <span className="flex w-full items-center gap-2">
                        <span className="flex-1 text-[14px] text-ink">{s.label}</span>
                        <span className="whitespace-nowrap rounded bg-bad-solid px-[7px] py-0.5 font-mono text-[11px] font-medium text-[#ffe3dc]">{s.tag}</span>
                      </span>
                      <code className="block w-full truncate font-mono text-[12px] text-faint">{s.sql.split("\n")[0]}</code>
                    </button>
                  ))}
                </section>
              </div>
            </div>
          )}
          {(feed.length > 0 || pending || error) && (
            <div className="mx-auto flex max-w-[880px] flex-col gap-8 px-8 pb-10 pt-7">
              {feed.map((r) => (
                <div key={r.id} id={`run-${r.id}`} className="scroll-mt-4">
                  <AnswerCard run={r} bubble onChange={replace}
                    onAskWith={(q, metricId) => ask(q, { simulate: true, metricId })}
                    onFollowUp={(run) => { setContext(run); composer.current?.focus(); }} />
                </div>
              ))}
              {pending && <Pending text={pending} />}
              <ErrorNote>{error}</ErrorNote>
              <div ref={bottom} />
            </div>
          )}
        </div>
        {!catalogOnly && (
          <div className="shrink-0 px-8 pb-5">
            <div className="mx-auto max-w-[856px]">
              <Composer ref={composer} onSubmit={ask} busy={!!pending} context={context} clearContext={() => setContext(null)} metrics={metrics.filter((m) => m.status === "certified")} />
            </div>
          </div>
        )}
      </section>

      {showHistory && (
        <aside className="flex w-[296px] shrink-0 flex-col border-l border-line" aria-label="Lịch sử của bạn">
          <div className="flex h-14 shrink-0 items-center gap-1.5 border-b border-line pl-[18px] pr-2.5">
            <h2 className="flex-1 whitespace-nowrap text-[13.5px] font-medium">Lịch sử</h2>
            <button onClick={newSession} title="Phiên mới" aria-label="Phiên mới" className="grid size-7 place-items-center rounded-md border border-line-strong hover:bg-hover">
              <SquarePen size={14} />
            </button>
            <button onClick={() => setHistHidden(true)} title="Ẩn lịch sử" aria-label="Ẩn lịch sử" className="grid size-7 place-items-center rounded-md text-dim hover:bg-hover hover:text-ink">
              <ChevronRight size={14} />
            </button>
          </div>
          {historyList}
        </aside>
      )}
      <Drawer open={historyOpen} onClose={() => setHistoryOpen(false)} width={320}
        title={<span className="flex items-center gap-3">Lịch sử <button className="text-[12px] font-normal text-accent hover:text-accent-2" onClick={newSession}>Phiên mới</button></span>}>
        <div className="flex h-full flex-col">{historyList}</div>
      </Drawer>

      <AgentConfig open={configOpen} section={configSection} engineer={!!eng} onClose={closeConfig}
        onSection={(s) => nav(s === "settings" ? "/settings" : "/metrics")} />
    </div>
  );
}
