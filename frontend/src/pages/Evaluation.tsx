import { Inbox, LayoutDashboard, Search, Sparkles, Undo2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { BoardGrid, Tray } from "../components/dashboard/Board";
import { CardEditor } from "../components/dashboard/CardEditor";
import type { Stats, SystemData } from "../components/dashboard/SystemCards";
import { Wizard } from "../components/dashboard/Wizard";
import { EvalReport, type Latest } from "../components/EvalReport";
import { Button, cx, Drawer, ErrorNote, PageHeader, Pill, timeAgo , useWide } from "../components/ui";
import { type Board, type BoardRes, type CardSpec, type Options, upsertCard } from "../dashboard";
import { useSession } from "../session";
import type { RunLite } from "../types";
import ReviewsPage from "./Reviews";

const plain = (b: Board): Board => ({ layout: b.layout, cards: b.cards, tray: b.tray });
const same = (a: Board, b: Board) => JSON.stringify(plain(a)) === JSON.stringify(plain(b));

/** Đánh giá: dashboard gồm card hệ thống (khóa, chỉ di chuyển/đổi cỡ/thu gọn) và card chỉ số do người dùng hoặc AI tạo. */
export default function EvaluationPage() {
  const { db } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const wide = useWide();

  const [stats, setStats] = useState<Stats | null>(null);
  const [latest, setLatest] = useState<Latest | null>(null);
  const [queue, setQueue] = useState<RunLite[]>([]);
  const [saved, setSaved] = useState<BoardRes | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [traceId, setTraceId] = useState("");

  // chế độ sửa: draft là bản nháp, history để hoàn tác; không có gì lên server cho tới khi Lưu
  const [draft, setDraft] = useState<Board | null>(null);
  const [history, setHistory] = useState<Board[]>([]);
  const draftRef = useRef<Board | null>(null);
  const [saving, setSaving] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [editing, setEditing] = useState<CardSpec | "new" | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);

  const queueParam = params.get("queue");
  const reportOpen = params.has("report");

  const load = useCallback(() => {
    if (!db) return;
    api<Stats>(`/db/${db.id}/stats?days=30`).then(setStats).catch((e) => setError(e.message));
    api<Latest>(`/db/${db.id}/eval`).then(setLatest).catch(() => {});
    api<RunLite[]>(`/db/${db.id}/reviews?status=pending`).then(setQueue).catch(() => {});
  }, [db]);
  useEffect(load, [load]);
  useEffect(() => {
    window.addEventListener("lvda:reviews-changed", load);
    return () => window.removeEventListener("lvda:reviews-changed", load);
  }, [load]);
  useEffect(() => {
    if (!db) return;
    setSaved(null); setDraft(null); draftRef.current = null; setHistory([]);
    api<BoardRes>(`/db/${db.id}/dashboards/eval`).then(setSaved).catch((e) => setError(e.message));
    api<Options>(`/db/${db.id}/dashboards/options`).then(setOptions).catch(() => {});
  }, [db]);

  const editMode = draft !== null;
  const dirty = !!draft && !!saved && !same(draft, saved);

  const setBoard = (next: Board | null) => { draftRef.current = next; setDraft(next); };
  const apply = useCallback((fn: (b: Board) => Board) => {
    const cur = draftRef.current;
    if (!cur) return;
    const next = fn(cur);
    if (next === cur) return;
    setHistory((h) => [...h.slice(-49), cur]);
    setBoard(next);
  }, []);
  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.length) return h;
      setBoard(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }, []);

  const startEdit = () => { if (saved) { setBoard(plain(saved)); setHistory([]); } };
  const cancel = () => {
    if (dirty && !window.confirm("Bỏ các thay đổi chưa lưu?")) return;
    setBoard(null); setHistory([]); setTrayOpen(false);
  };
  const save = async () => {
    if (!db || !draft) return;
    setSaving(true); setError(null);
    try {
      const res = await api<BoardRes>(`/db/${db.id}/dashboards/eval`, { method: "PUT", body: plain(draft) });
      setSaved(res); setBoard(null); setHistory([]); setTrayOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Không lưu được dashboard."); }
    finally { setSaving(false); }
  };

  useEffect(() => {
    if (!editMode) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !/INPUT|TEXTAREA|SELECT/.test(el.tagName)) { e.preventDefault(); undo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editMode, undo]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const openWizard = () => { if (!editMode) startEdit(); setWizard(true); };
  const openTrace = async (e: FormEvent) => {
    e.preventDefault();
    if (!db) return;
    setError(null);
    try {
      const r = await api<{ id: number }>(`/db/${db.id}/trace/${encodeURIComponent(traceId.trim())}`);
      navigate(`/runs/${r.id}`);
    } catch (err) { setError(err instanceof Error ? err.message : "Không tìm thấy."); }
  };

  const sys: SystemData = {
    stats, latest, queue,
    openQueue: (runId) => setParams({ queue: runId ?? "1" }),
    openReport: () => setParams({ report: "1" }),
  };
  const sysTitles = Object.fromEntries((saved?.system ?? []).map((s) => [s.id, s.title]));
  const board = draft ?? saved;
  const trayProps = {
    dbId: db?.id ?? 0, options, apply, onEdit: (c: CardSpec) => setEditing(c),
    onWizard: () => setWizard(true), onNew: () => setEditing("new" as const),
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Đánh giá"
        subtitle={editMode ? "Đang sửa dashboard. Card có ổ khóa là card hệ thống: chỉ di chuyển, đổi cỡ, thu gọn."
          : <>Agent trả lời đáng tin tới đâu, sai ở chỗ nào, và những chỉ số bạn muốn theo dõi.
            {saved?.updated_at && <span className="text-faint"> · Lưu {timeAgo(saved.updated_at)}{saved.updated_by_name ? ` bởi ${saved.updated_by_name}` : ""}</span>}</>}
        actions={editMode ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {dirty && <Pill tone="warn">Chưa lưu</Pill>}
            <Button onClick={undo} disabled={!history.length} title="Hoàn tác (Ctrl+Z)"><Undo2 size={15} /> Hoàn tác</Button>
            <Button onClick={() => setWizard(true)}><Sparkles size={15} /> Tạo card bằng AI</Button>
            {!wide && <Button onClick={() => setTrayOpen(true)}><Inbox size={15} /> Vùng phụ <span className="num">({draft.tray.length})</span></Button>}
            <Button variant="ghost" onClick={cancel}>Huỷ</Button>
            <Button variant="primary" onClick={save} disabled={saving || !dirty}>{saving ? "Đang lưu…" : "Lưu"}</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <form onSubmit={openTrace} className="flex items-center gap-1.5">
              <input value={traceId} onChange={(e) => setTraceId(e.target.value)} placeholder="Tra request_id" aria-label="Tra trace theo request_id"
                className="num h-9 w-[180px] rounded-md border border-line bg-surface px-2.5 text-[13px]" />
              <Button type="submit" disabled={!traceId.trim()} aria-label="Mở trace"><Search size={15} /></Button>
            </form>
            <Button onClick={startEdit} disabled={!saved}><LayoutDashboard size={15} /> Sửa dashboard</Button>
          </div>
        )} />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className={cx("mx-auto flex flex-col gap-4 p-4 md:p-8", editMode && wide ? "max-w-[1480px]" : "max-w-[1120px]")}>
          <ErrorNote>{error}</ErrorNote>
          {!board ? (
            <div className="grid grid-cols-12 gap-4" aria-busy="true">
              {[12, 12, 8, 4].map((w, i) => <div key={i} className={cx("h-[140px] animate-pulse rounded-lg bg-sunk", w === 12 ? "col-span-12" : w === 8 ? "col-span-12 lg:col-span-8" : "col-span-12 lg:col-span-4")} />)}
            </div>
          ) : (
            <div className={cx("grid gap-5", editMode && wide && "grid-cols-[minmax(0,1fr)_340px] items-start")}>
              <BoardGrid board={board} edit={editMode} dbId={db?.id ?? 0} options={options} sys={sys} sysTitles={sysTitles}
                apply={apply} onEdit={(c) => setEditing(c)} hasTray={board.tray.length > 0} onOpenWizard={openWizard} />
              {editMode && wide && (
                <aside className="scroll-thin sticky top-0 max-h-[calc(100vh-180px)] overflow-y-auto">
                  <Tray board={draft} drawer={false} {...trayProps} />
                </aside>
              )}
            </div>
          )}
        </div>
      </div>

      {editMode && !wide && (
        <Drawer open={trayOpen} onClose={() => setTrayOpen(false)} width={440} title={<>Vùng phụ <span className="num font-normal text-muted">({draft.tray.length})</span></>}>
          <Tray board={draft} drawer {...trayProps} onAdded={() => setTrayOpen(false)}
            onWizard={() => { setTrayOpen(false); setWizard(true); }} onNew={() => { setTrayOpen(false); setEditing("new"); }} />
        </Drawer>
      )}
      {db && (
        <Wizard open={wizard} dbId={db.id} onClose={() => { setWizard(false); if (!wide && draftRef.current?.tray.length) setTrayOpen(true); }}
          onCards={(cards) => apply((b) => [...cards].reverse().reduce(upsertCard, b))} />
      )}
      {db && <CardEditor dbId={db.id} options={options} card={editing} onClose={() => setEditing(null)}
        onApply={(c) => { apply((b) => upsertCard(b, c)); setEditing(null); }} />}

      <Drawer open={queueParam !== null} onClose={() => setParams({})} width={1180} title="Hàng đợi duyệt">
        <ReviewsPage embedded initialId={queueParam && queueParam !== "1" ? queueParam : undefined} />
      </Drawer>
      <Drawer open={reportOpen} onClose={() => setParams({})} width={1100} title="Báo cáo đánh giá chi tiết">
        <EvalReport onChanged={load} />
      </Drawer>
    </div>
  );
}
