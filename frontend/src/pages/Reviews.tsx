import { Check, ClipboardCheck, PencilLine, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";
import { AnswerCard } from "../components/AnswerCard";
import { FindingsList } from "../components/Evidence";
import { Button, cx, Empty, ErrorNote, PageHeader, timeAgo, VerdictDot } from "../components/ui";
import { useSession } from "../session";
import type { Finding, Run, RunLite } from "../types";

const TABS = [["pending", "Chờ duyệt"], ["approved", "Đã duyệt"], ["rejected", "Đã từ chối"]] as const;

/** `embedded`: nằm trong drawer của trang Đánh giá nên bỏ tiêu đề trang. `initialId`: mở sẵn một câu. */
export default function ReviewsPage({ embedded = false, initialId }: { embedded?: boolean; initialId?: string }) {
  const { db } = useSession();
  const navigate = useNavigate();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("pending");
  const [list, setList] = useState<RunLite[]>([]);
  const [sel, setSel] = useState<Run | null>(null);
  const [mode, setMode] = useState<"none" | "edit" | "reject">("none");
  const [sql, setSql] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [busy, setBusy] = useState(false);

  const [counts, setCounts] = useState<Record<string, number>>({});
  const load = useCallback(() => {
    if (!db) return;
    api<RunLite[]>(`/db/${db.id}/reviews?status=${tab}`).then(setList).catch((e) => setError(e.message));
    Promise.all(TABS.map(([k]) => api<RunLite[]>(`/db/${db.id}/reviews?status=${k}`).then((r) => [k, r.length] as const)))
      .then((xs) => setCounts(Object.fromEntries(xs))).catch(() => {});
  }, [db, tab]);
  useEffect(() => { load(); setSel(null); }, [load]);

  const open = async (id: string) => {
    if (!db) return;
    setMode("none"); setError(null); setFindings([]);
    const r = await api<Run>(`/db/${db.id}/runs/${id}`);
    setSel(r); setSql(r.final_sql ?? ""); setReason("");
  };

  const decide = async (decision: "approve" | "edit_approve" | "reject") => {
    if (!db || !sel) return;
    setBusy(true); setError(null); setFindings([]);
    try {
      await api<Run>(`/db/${db.id}/reviews/${sel.id}`, { body: { decision, edited_sql: decision === "edit_approve" ? sql : null, reason: reason || null } });
      wantFirst.current = embedded;
      setSel(null); load();
      window.dispatchEvent(new Event("lvda:reviews-changed"));
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        const v = (e.detail as { verification?: { findings: Finding[] } })?.verification;
        if (v) setFindings(v.findings);
      }
    } finally { setBusy(false); }
  };

  useEffect(() => { if (initialId) open(initialId); }, [initialId, db]);
  // trong drawer: mở sẵn câu đầu tiên, và duyệt xong một câu thì tự sang câu kế
  const wantFirst = useRef(embedded && !initialId);
  useEffect(() => {
    if (wantFirst.current && list[0]) { wantFirst.current = false; open(list[0].id); }
  }, [list]); // `open` chỉ đọc db, không cần theo dõi

  const decideBar = sel && tab === "pending" && (
    <div className={cx("border-t border-line bg-surface", embedded ? "px-7 py-3.5" : "rounded-xl border p-4")}>
      <div className="mx-auto flex max-w-[820px] flex-col gap-2.5">
        {mode === "edit" && (
          <textarea value={sql} onChange={(e) => setSql(e.target.value)} spellCheck={false} aria-label="SQL đã sửa"
            className="h-[180px] w-full resize-y rounded-[10px] border border-line bg-paper p-3 font-mono text-[12.5px] leading-relaxed outline-none focus:border-accent" />
        )}
        {mode === "reject" && (
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lý do từ chối (bắt buộc)" aria-label="Lý do"
            className="h-[72px] w-full resize-y rounded-[10px] border border-line bg-paper px-3 py-2.5 outline-none focus:border-accent" />
        )}
        <ErrorNote>{error}</ErrorNote>
        {findings.length > 0 && <FindingsList findings={findings} compact />}
        <div className="flex flex-wrap items-center gap-2">
          {mode === "none" && <>
            <span className="mr-auto text-[13px] font-semibold">Quyết định</span>
            {sel.status === "held" && <span className="text-[12px] text-held">Câu bị giữ lại: sửa SQL rồi mới duyệt được</span>}
            <Button variant="danger" onClick={() => setMode("reject")} className="h-[34px] rounded-lg px-3.5"><X size={15} /> Từ chối</Button>
            <Button onClick={() => setMode("edit")} className="h-[34px] rounded-lg px-3.5"><PencilLine size={15} /> Sửa SQL rồi duyệt</Button>
            <Button variant="primary" disabled={busy || sel.status === "held"} onClick={() => decide("approve")} className="h-[34px] rounded-lg px-4 font-semibold"
              title={sel.status === "held" ? "Câu bị giữ lại vì còn lỗi; hãy sửa SQL rồi duyệt" : undefined}><Check size={15} /> Duyệt nguyên</Button>
          </>}
          {mode === "edit" && <>
            <span className="mr-auto text-[12.5px] text-muted">SQL đã sửa sẽ chạy lại qua bộ kiểm định trước khi duyệt.</span>
            <Button onClick={() => setMode("none")} className="h-[34px] rounded-lg px-3.5">Hủy</Button>
            <Button variant="primary" disabled={busy} onClick={() => decide("edit_approve")} className="h-[34px] rounded-lg px-4 font-semibold">Kiểm và duyệt</Button>
          </>}
          {mode === "reject" && <>
            <span className="mr-auto" />
            <Button onClick={() => setMode("none")} className="h-[34px] rounded-lg px-3.5">Hủy</Button>
            <button disabled={busy || !reason.trim()} onClick={() => decide("reject")}
              className="h-[34px] rounded-lg bg-bad px-4 text-[13px] font-semibold text-on-accent disabled:opacity-40">Xác nhận từ chối</button>
          </>}
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      {!embedded && <PageHeader title="Duyệt câu trả lời" />}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[320px] shrink-0 flex-col border-r border-line bg-surface">
          <div className="p-3">
            <div className="flex gap-[2px] rounded-[9px] bg-sunk p-[3px]" role="tablist">
              {TABS.map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={cx("flex h-[30px] flex-1 items-center justify-center gap-1.5 rounded-[7px] text-[12.5px]", tab === k ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}>
                  {label}<span className="font-mono text-[11px] text-faint">{counts[k] ?? ""}</span>
                </button>
              ))}
            </div>
          </div>
          <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2">
            {list.length === 0 && <li className="px-3 py-10 text-center text-[13px] text-faint">Không có mục nào.</li>}
            {list.map((r) => (
              <li key={r.id}>
                <button onClick={() => open(r.id)} className={cx("relative flex w-full gap-2.5 rounded-lg py-2.5 pl-3.5 pr-2.5 text-left hover:bg-hover", sel?.id === r.id && "bg-accent-soft")}>
                  <span className={cx("absolute bottom-2.5 left-1 top-2.5 w-[2px] rounded-sm", sel?.id === r.id ? "bg-accent" : "bg-transparent")} />
                  <span className="mt-1.5"><VerdictDot verdict={r.status === "held" ? "red" : r.final_verdict} /></span>
                  <span className="min-w-0 flex-1">
                    <span className={cx("line-clamp-2 text-[13px] leading-[1.45]", r.input_kind === "sql" && "font-mono")}>{r.question.replace(/\s+/g, " ")}</span>
                    <span className="mt-[3px] block text-[11.5px] text-faint">{r.user_name} · {timeAgo(r.created_at)}{r.status === "held" ? " · bị giữ lại" : ""}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex min-w-0 flex-1 flex-col bg-paper">
          {!sel ? <div className="grid flex-1 place-items-center"><Empty icon={<ClipboardCheck size={28} />} title="Chọn một câu để duyệt">Xem phiếu kiểm, các lần thử và quyết định.</Empty></div> : <>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-7 py-6">
              <div className="mx-auto flex max-w-[820px] flex-col gap-4">
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => navigate(`/runs/${sel.id}`)}>Mở trong Hỏi &amp; kiểm</Button>
                </div>
                <AnswerCard run={sel} />
                {sel.reviews.length > 0 && (
                  <div className="flex flex-col items-end text-[12px] text-muted">
                    {sel.reviews.map((r, i) => <span key={i}>{r.reviewer} · {r.decision === "reject" ? "từ chối" : "duyệt"}{r.reason ? `: ${r.reason}` : ""}</span>)}
                  </div>
                )}
                {!embedded && decideBar}
              </div>
            </div>
            {embedded && decideBar}
          </>}
        </div>
      </div>
    </div>
  );
}
