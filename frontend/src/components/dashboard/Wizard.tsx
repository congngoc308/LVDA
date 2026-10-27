import { AlertTriangle, CheckCircle2, Loader2, Sparkles, Square, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Answers, type CardSpec, type DraftEvent, streamDraft } from "../../dashboard";
import { Button, cx, ErrorNote, Modal } from "../ui";

const DEFAULTS: Answers = { goal: "theo_doi", audience: "phan_tich", cadence: "thang", focus: "" };

const QUESTIONS: { key: "goal" | "audience" | "cadence"; title: string; why: string; options: { v: string; label: string; hint: string }[] }[] = [
  {
    key: "goal", title: "Dashboard này để làm gì?", why: "Quyết định agent chọn chỉ số tổng, chỉ số so sánh hay chỉ số dễ lộ bất thường.",
    options: [
      { v: "theo_doi", label: "Theo dõi sức khỏe kinh doanh", hint: "doanh thu, số đơn, giá trị đơn" },
      { v: "so_sanh", label: "So sánh giữa các nhóm", hint: "theo bang, danh mục, cách thanh toán" },
      { v: "bat_thuong", label: "Phát hiện bất thường", hint: "tỉ lệ hủy, giao trễ, đánh giá thấp" },
    ],
  },
  {
    key: "audience", title: "Ai sẽ xem?", why: "Lãnh đạo cần ít card, số to; người phân tích cần chia nhỏ hơn.",
    options: [
      { v: "lanh_dao", label: "Lãnh đạo", hint: "tối đa 4 card, ưu tiên con số" },
      { v: "phan_tich", label: "Người phân tích", hint: "nhiều chiều chia, bảng chi tiết" },
      { v: "van_hanh", label: "Vận hành", hint: "giao hàng, hủy đơn, người bán" },
    ],
  },
  {
    key: "cadence", title: "Bao lâu xem một lần?", why: "Quyết định khoảng thời gian mặc định của card.",
    options: [
      { v: "ngay", label: "Hằng ngày", hint: "dữ liệu năm gần nhất" },
      { v: "thang", label: "Hằng tháng", hint: "dữ liệu năm gần nhất" },
      { v: "quy", label: "Hằng quý", hint: "toàn bộ dữ liệu" },
    ],
  },
];

type Step = Extract<DraftEvent, { type: "step" }>;
type Phase = "ask" | "run" | "done" | "error";

function StepIcon({ status }: { status: Step["status"] | "running" }) {
  if (status === "running") return <Loader2 size={15} className="animate-spin text-accent" aria-label="Đang chạy" />;
  if (status === "ok") return <CheckCircle2 size={15} className="text-good" aria-label="Xong" />;
  if (status === "warn") return <AlertTriangle size={15} className="text-warn" aria-label="Có cảnh báo" />;
  return <XCircle size={15} className="text-bad" aria-label="Bị loại" />;
}

/** Hỏi tối đa 3 câu, rồi cho agent chạy và hiện từng bước nó làm. Kết quả chỉ vào vùng phụ, không tự lưu. */
export function Wizard({ open, dbId, onClose, onCards }: { open: boolean; dbId: number; onClose: () => void; onCards: (cards: CardSpec[]) => void }) {
  const [phase, setPhase] = useState<Phase>("ask");
  const [q, setQ] = useState(0);
  const [answers, setAnswers] = useState<Answers>(DEFAULTS);
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState<{ id: string; label: string } | null>(null);
  const [result, setResult] = useState<{ cards: number; request_id: string; ms: number } | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) { setPhase("ask"); setQ(0); setSteps([]); setResult(null); setError(null); setRunning(null); setRequestId(null); }
    return () => abort.current?.abort();
  }, [open]);

  const run = async (a: Answers) => {
    setAnswers(a); setPhase("run"); setSteps([]); setError(null); setResult(null);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      await streamDraft(dbId, a, (e) => {
        if (e.type === "start") setRequestId(e.request_id);
        else if (e.type === "running") setRunning({ id: e.id, label: e.label });
        else if (e.type === "step") { setRunning(null); setSteps((s) => [...s, e]); }
        else if (e.type === "done") { onCards(e.cards); setResult({ cards: e.cards.length, request_id: e.request_id, ms: e.ms }); setPhase("done"); }
        else if (e.type === "error") { setError(e.message); setPhase("error"); }
      }, ctl.signal);
    } catch (err) {
      setRunning(null);
      if (ctl.signal.aborted) { setError("Đã dừng. Không có card nào được thêm."); setPhase("error"); }
      else { setError(err instanceof Error ? err.message : "Agent không chạy được."); setPhase("error"); }
    }
  };

  const cur = QUESTIONS[q];
  const footer = phase === "ask" ? (
    <>
      <Button variant="ghost" className="mr-auto" onClick={() => run({ ...DEFAULTS, focus: answers.focus })}>Bỏ qua, dùng mặc định</Button>
      {q > 0 && <Button onClick={() => setQ(q - 1)}>Quay lại</Button>}
      {q < QUESTIONS.length - 1
        ? <Button variant="primary" onClick={() => setQ(q + 1)}>Tiếp</Button>
        : <Button variant="primary" onClick={() => run(answers)}><Sparkles size={15} /> Tạo card</Button>}
    </>
  ) : phase === "run" ? (
    <Button onClick={() => abort.current?.abort()}><Square size={13} /> Dừng</Button>
  ) : phase === "error" ? (
    <><Button onClick={onClose}>Đóng</Button><Button variant="primary" onClick={() => run(answers)}>Chạy lại</Button></>
  ) : (
    <><Button onClick={() => { setPhase("ask"); setQ(0); }}>Tạo thêm</Button><Button variant="primary" onClick={onClose}>Xem trong vùng phụ</Button></>
  );

  return (
    <Modal open={open} onClose={() => { abort.current?.abort(); onClose(); }} title="Tạo card bằng AI" width={620} footer={footer}>
      {phase === "ask" ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <span className="num">Câu {q + 1}/{QUESTIONS.length}</span>
            <span className="flex flex-1 gap-1">{QUESTIONS.map((_, i) => <span key={i} className={cx("h-1 flex-1 rounded-full", i <= q ? "bg-accent" : "bg-sunk")} />)}</span>
          </div>
          <div>
            <h3 className="text-[15px] font-semibold">{cur.title}</h3>
            <p className="mt-0.5 text-[12.5px] text-muted">Vì sao hỏi: {cur.why}</p>
          </div>
          <div role="radiogroup" aria-label={cur.title} className="flex flex-col gap-2">
            {cur.options.map((o) => {
              const on = answers[cur.key] === o.v;
              return (
                <button key={o.v} role="radio" aria-checked={on} onClick={() => setAnswers({ ...answers, [cur.key]: o.v })}
                  className={cx("flex items-start gap-3 rounded-md border px-3 py-2.5 text-left", on ? "border-accent bg-accent-soft" : "border-line hover:bg-sunk/60")}>
                  <span className={cx("mt-1 grid size-3.5 shrink-0 place-items-center rounded-full border", on ? "border-accent" : "border-line-strong")}>
                    {on && <span className="size-2 rounded-full bg-accent" />}
                  </span>
                  <span><span className="block text-[13.5px] font-medium">{o.label}</span><span className="block text-[12px] text-muted">{o.hint}</span></span>
                </button>
              );
            })}
          </div>
          {q === QUESTIONS.length - 1 && (
            <label className="flex flex-col gap-1 text-[13px]">
              <span className="font-medium">Muốn chú ý chỉ số nào? <span className="font-normal text-muted">(không bắt buộc)</span></span>
              <input value={answers.focus} maxLength={200} onChange={(e) => setAnswers({ ...answers, focus: e.target.value })}
                placeholder="vd: tỉ lệ hủy, doanh thu theo bang" className="h-9 rounded-md border border-line bg-surface px-2.5" />
            </label>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] text-muted">
            Agent chỉ chọn chỉ số đã chứng nhận; mỗi card được dựng lại từ định nghĩa chuẩn và chạy qua bộ kiểm định trước khi vào vùng phụ.
            {" "}Không có gì được lưu vào dashboard cho tới khi bạn bấm Lưu.
          </p>
          <ol className="flex flex-col gap-1.5" aria-live="polite">
            {steps.map((s, i) => (
              <li key={i} className="rounded-md border border-line px-3 py-2">
                <div className="flex items-center gap-2 text-[13px]">
                  <StepIcon status={s.status} />
                  <span className="min-w-0 flex-1 font-medium">{s.label}</span>
                  <span className="num shrink-0 text-[11.5px] text-muted">{s.ms} ms</span>
                </div>
                <p className={cx("ml-[23px] mt-0.5 text-[12.5px]", s.status === "fail" ? "text-bad" : "text-muted")}>{s.detail}</p>
                {s.assumptions?.length ? (
                  <ul className="ml-[23px] mt-1 list-disc pl-4 text-[12px] text-muted">{s.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
                ) : null}
              </li>
            ))}
            {running && (
              <li className="flex items-center gap-2 rounded-md border border-dashed border-line px-3 py-2 text-[13px] text-muted">
                <StepIcon status="running" /> {running.label}…
              </li>
            )}
          </ol>
          <ErrorNote>{error}</ErrorNote>
          {result && (
            <div className="rounded-md border border-good/30 bg-good-soft px-3 py-2 text-[13px] text-good">
              Đã thêm {result.cards} card vào vùng phụ trong {(result.ms / 1000).toFixed(1)} giây.
            </div>
          )}
          {requestId && <p className="num text-[11.5px] text-muted">request_id {requestId}</p>}
        </div>
      )}
    </Modal>
  );
}
