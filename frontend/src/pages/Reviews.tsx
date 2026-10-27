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

  const load = useCallback(() => {
    if (db) api<RunLite[]>(`/db/${db.id}/reviews?status=${tab}`).then(setList).catch((e) => setError(e.message));
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

  return (
    <div className="flex h-full flex-col">
      {embedded
        ? <p className="border-b border-line bg-sunk px-5 py-2 text-[12.5px] text-muted">Câu được duyệt thành truy vấn mẫu: lần sau hỏi đúng câu đó, agent dùng luôn SQL đã duyệt (vẫn qua kiểm định).</p>
        : <PageHeader title="Duyệt câu trả lời"
            subtitle="Câu Vàng, Đỏ và câu bị người dùng báo sai. Câu được duyệt thành truy vấn mẫu: lần sau hỏi giống hệt, agent dùng luôn SQL đã duyệt." />}
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[340px] shrink-0 flex-col border-r border-line bg-surface">
          <div className="flex gap-1 border-b border-line px-3 py-2" role="tablist">
            {TABS.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={cx("rounded-md px-2.5 py-1 text-[13px]", tab === k ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-sunk")}>{label}</button>
            ))}
          </div>
          <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">
            {list.length === 0 && <li className="px-3 py-10 text-center text-[13px] text-muted">Không có mục nào.</li>}
            {list.map((r) => (
              <li key={r.id}>
                <button onClick={() => open(r.id)} className={cx("flex w-full gap-2 rounded-md px-2.5 py-2 text-left hover:bg-sunk", sel?.id === r.id && "bg-accent-soft")}>
                  <span className="mt-1.5"><VerdictDot verdict={r.status === "held" ? "red" : r.final_verdict} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-[13px]">{r.question}</span>
                    <span className="text-[11.5px] text-muted">{r.user_name} · {timeAgo(r.created_at)}{r.status === "held" ? " · bị giữ lại" : ""}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="scroll-thin min-w-0 flex-1 overflow-y-auto p-6">
          {!sel ? <Empty icon={<ClipboardCheck size={28} />} title="Chọn một câu để duyệt">Xem phiếu kiểm, các lần thử và quyết định.</Empty> : (
            <div className="mx-auto flex max-w-[880px] flex-col gap-4">
              <div className="flex justify-end">
                <Button size="sm" onClick={() => navigate(`/runs/${sel.id}`)}>Mở trong Hỏi & kiểm</Button>
              </div>
              <AnswerCard run={sel} />
              {tab === "pending" && (
                <div className="rounded-lg border border-line bg-surface p-4">
                  <div className="mb-3 font-medium">Quyết định</div>
                  {mode === "edit" && (
                    <textarea value={sql} onChange={(e) => setSql(e.target.value)} spellCheck={false} aria-label="SQL đã sửa"
                      className="mb-3 h-52 w-full rounded-md border border-line-strong bg-sunk p-3 font-mono text-[12.5px] outline-none focus:border-accent" />
                  )}
                  {mode === "reject" && (
                    <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Lý do từ chối (bắt buộc)" aria-label="Lý do"
                      className="mb-3 h-20 w-full rounded-md border border-line-strong p-2.5 outline-none focus:border-accent" />
                  )}
                  <ErrorNote>{error}</ErrorNote>
                  {findings.length > 0 && <div className="mt-2"><FindingsList findings={findings} compact /></div>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {mode === "none" && <>
                      <Button variant="primary" disabled={busy || sel.status === "held"} onClick={() => decide("approve")} title={sel.status === "held" ? "Câu bị giữ lại vì còn lỗi; hãy sửa SQL rồi duyệt" : undefined}><Check size={15} /> Duyệt nguyên</Button>
                      <Button onClick={() => setMode("edit")}><PencilLine size={15} /> Sửa SQL rồi duyệt</Button>
                      <Button variant="danger" onClick={() => setMode("reject")}><X size={15} /> Từ chối</Button>
                    </>}
                    {mode === "edit" && <><Button variant="primary" disabled={busy} onClick={() => decide("edit_approve")}>Kiểm và duyệt</Button><Button onClick={() => setMode("none")}>Hủy</Button></>}
                    {mode === "reject" && <><Button variant="danger" disabled={busy || !reason.trim()} onClick={() => decide("reject")}>Xác nhận từ chối</Button><Button onClick={() => setMode("none")}>Hủy</Button></>}
                  </div>
                </div>
              )}
              {sel.reviews.length > 0 && (
                <div className="text-[13px] text-muted">
                  {sel.reviews.map((r, i) => <div key={i}>{r.reviewer} · {r.decision === "reject" ? "từ chối" : "duyệt"}{r.reason ? `: ${r.reason}` : ""}</div>)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
