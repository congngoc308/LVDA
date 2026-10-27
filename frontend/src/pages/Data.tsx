import { ArrowLeft, BadgeCheck, Clock, Flame, Layers, RefreshCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { AssetPanel } from "../components/data/AssetPanel";
import { SearchBox } from "../components/data/SearchBox";
import { SourceBar } from "../components/SyncPanel";
import { LineageCanvas, layerLabel, type Sel } from "../components/LineageCanvas";
import { Button, cx, ErrorNote, Pill } from "../components/ui";
import { pushRecent, recentTables, tablePath, type Brief, type Home, type LineageRes, type SearchRes } from "../explore";
import { useSession } from "../session";

interface Reload { views: number; keys_ok: boolean; stale_metrics: { id: string; name_vi: string }[]; disabled_queries: unknown[] }

/** Một dòng bảng trong danh sách: tên, lớp, miền, mô tả, mức dùng và các dấu hiệu cần chú ý. */
function TableRow({ b, maxLayer }: { b: Brief; maxLayer: number }) {
  return (
    <Link to={tablePath(b.name)} className="flex items-start gap-3 rounded-md border border-line bg-surface px-3 py-2 hover:border-line-strong hover:bg-sunk/40">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cx("font-mono text-[13px]", b.deprecated && "text-faint line-through")}>{b.name}</span>
          <span className="rounded bg-sunk px-1.5 text-[11px] text-ink-2">{layerLabel(b.layer, maxLayer)}</span>
          {b.pii > 0 && <span className="rounded bg-warn-soft px-1 text-[10.5px] text-warn">PII</span>}
          {b.drafts > 0 && <span className="text-[11px] text-warn">{b.drafts} mô tả chờ duyệt</span>}
        </div>
        {b.description && <div className="line-clamp-1 text-[12px] text-muted">{b.description}</div>}
      </div>
      <div className="shrink-0 text-right text-[11.5px] text-muted">
        <div>{b.domain_label}</div>
        {b.uses > 0 && <div className="text-ink-2">{b.uses} câu hỏi</div>}
      </div>
    </Link>
  );
}

/** Trang chủ: không liệt kê 500 bảng, chỉ đưa ra lối vào (vừa xem, hay dùng, trong chỉ số, theo miền). */
function HomeView({ home, recent }: { home: Home; recent: string[] }) {
  const nav = useNavigate();
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-6 p-6">
        <p className="text-[13px] text-muted">
          <b className="num text-ink">{home.tables.toLocaleString("vi-VN")}</b> bảng · <b className="num text-ink">{home.columns.toLocaleString("vi-VN")}</b> cột ·{" "}
          {home.domains.length} miền · {home.max_layer + 1} lớp. Tìm theo tên hoặc mô tả, hoặc bắt đầu từ một miền.
        </p>
        {recent.length > 0 && (
          <section>
            <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-medium"><Clock size={14} className="text-faint" /> Vừa xem</h2>
            <div className="flex flex-wrap gap-1.5">{recent.map((n) => (
              <Link key={n} to={tablePath(n)} className="rounded-full border border-line bg-surface px-2.5 py-0.5 font-mono text-[12px] hover:border-accent hover:text-accent">{n}</Link>
            ))}</div>
          </section>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <section>
            <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-medium"><Flame size={14} className="text-faint" /> Agent hay dùng</h2>
            {home.popular.length === 0 ? <p className="rounded-md border border-dashed border-line px-3 py-4 text-[12.5px] text-muted">Chưa có câu hỏi nào dùng bảng của database này.</p>
              : <div className="flex flex-col gap-1.5">{home.popular.map((b) => <TableRow key={b.name} b={b} maxLayer={home.max_layer} />)}</div>}
          </section>
          <section>
            <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-medium"><BadgeCheck size={14} className="text-faint" /> Nằm trong chỉ số đã chứng nhận</h2>
            {home.certified.length === 0 ? <p className="rounded-md border border-dashed border-line px-3 py-4 text-[12.5px] text-muted">Database này chưa có chỉ số đã chứng nhận.</p>
              : <div className="flex flex-col gap-1.5">{home.certified.map((b) => <TableRow key={b.name} b={b} maxLayer={home.max_layer} />)}</div>}
          </section>
        </div>
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-medium"><Layers size={14} className="text-faint" /> Miền nghiệp vụ</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {home.domains.map((d) => (
              <button key={d.key} onClick={() => nav(`/data?domain=${d.key}`)} className="rounded-lg border border-line bg-surface p-3 text-left hover:border-line-strong hover:bg-sunk/40">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{d.label}</span>
                  <span className="num text-[12px] text-muted">{d.tables} bảng</span>
                </div>
                {/* phân bố bảng theo lớp: nguồn → mart */}
                <div className="mt-2 flex h-1.5 gap-[2px] overflow-hidden rounded-full" aria-label={Object.entries(d.layers).map(([l, n]) => `${layerLabel(Number(l), home.max_layer)} ${n}`).join(", ")}>
                  {Object.entries(d.layers).map(([l, n]) => (
                    <span key={l} style={{ flexGrow: n, opacity: 0.35 + 0.65 * (Number(l) / Math.max(home.max_layer, 1)) }} className="bg-accent" />
                  ))}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-2 text-[11.5px] text-muted">
                  {Object.entries(d.layers).map(([l, n]) => <span key={l}>{layerLabel(Number(l), home.max_layer)} {n}</span>)}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {d.uses > 0 && <Pill>{d.uses} lượt agent dùng</Pill>}
                  {d.pii > 0 && <Pill tone="warn">{d.pii} bảng có PII</Pill>}
                  {d.drafts > 0 && <Pill tone="warn">{d.drafts} mô tả chờ duyệt</Pill>}
                  {d.deprecated > 0 && <Pill tone="bad">{d.deprecated} ngừng dùng</Pill>}
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

const TAGS: [string, string][] = [["pii", "Có PII"], ["draft", "Mô tả chờ duyệt"], ["deprecated", "Ngừng dùng"]];
const PAGE = 50;

/** Danh sách theo miền hoặc theo từ khóa, lọc theo lớp và thẻ, tải từng trang. */
function ListView({ dbId, home, domain, q }: { dbId: number; home: Home; domain: string | null; q: string | null }) {
  const [layer, setLayer] = useState<number | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [res, setRes] = useState<SearchRes | null>(null);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { setLimit(PAGE); }, [domain, q, layer, tags]);
  useEffect(() => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (q) p.set("q", q);
    if (domain) p.set("domain", domain);
    if (layer !== null) p.set("layer", String(layer));
    tags.forEach((t) => p.append("tag", t));
    api<SearchRes>(`/db/${dbId}/explore/search?${p}`).then(setRes).catch(() => {});
  }, [dbId, domain, q, layer, tags, limit]);
  const label = domain ? home.domains.find((d) => d.key === domain)?.label ?? domain : `Kết quả cho “${q}”`;
  const items = res?.items ?? [];

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-3 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/data" className="inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink"><ArrowLeft size={14} /> Dữ liệu</Link>
          <h2 className="text-[16px] font-semibold">{label}</h2>
          <span className="num text-[12.5px] text-muted">{res?.total ?? "…"} {q ? "kết quả" : "bảng"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {[null, ...Array.from({ length: home.max_layer + 1 }, (_, i) => i)].map((l) => (
            <button key={String(l)} onClick={() => setLayer(l)} aria-pressed={layer === l}
              className={cx("rounded-full px-2.5 py-0.5 text-[12px]", layer === l ? "bg-accent text-on-accent" : "bg-sunk text-ink-2 hover:bg-line")}>
              {l === null ? "Mọi lớp" : layerLabel(l, home.max_layer)}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-line" />
          {TAGS.map(([k, l]) => (
            <button key={k} aria-pressed={tags.includes(k)} onClick={() => setTags((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]))}
              className={cx("rounded-full border px-2 py-0.5 text-[12px]", tags.includes(k) ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:border-line-strong")}>{l}</button>
          ))}
        </div>
        {!res ? <div className="flex flex-col gap-1.5">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-12 animate-pulse rounded-md bg-sunk" />)}</div> : (
          <div className="flex flex-col gap-1.5">
            {items.length === 0 && <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-[13px] text-muted">Không có bảng nào khớp bộ lọc.</p>}
            {items.map((i) => i.kind === "table" ? <TableRow key={i.name} b={i} maxLayer={home.max_layer} /> : (
              <Link key={`${i.name}.${i.column}`} to={`${tablePath(i.name)}?col=${encodeURIComponent(i.column)}`}
                className="flex items-start gap-3 rounded-md border border-line bg-surface px-3 py-2 hover:border-line-strong hover:bg-sunk/40">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[13px]">{i.column}</span><span className="font-mono text-[11.5px] text-muted">trong {i.name}</span>
                    {i.pii && <span className="rounded bg-warn-soft px-1 text-[10.5px] text-warn">PII</span>}
                  </div>
                  {i.description && <div className="line-clamp-1 text-[12px] text-muted">{i.description}</div>}
                </div>
                <div className="shrink-0 text-[11.5px] text-muted">{i.domain_label}</div>
              </Link>
            ))}
            {res.total > items.length && <Button className="self-center" onClick={() => setLimit(limit + PAGE)}>Xem thêm {Math.min(PAGE, res.total - items.length)} bảng</Button>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Lineage quanh một bảng: canvas vùng lân cận + panel chi tiết. */
function FocusView({ dbId, eng, focus, colParam, onMissing }: {
  dbId: number; eng: boolean; focus: string; colParam: string | null; onMissing: () => void;
}) {
  const [centers, setCenters] = useState<string[]>([focus]);
  const [full, setFull] = useState<string[]>([]);
  const [data, setData] = useState<LineageRes | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCenters([focus]); setFull([]); setData(null);
    setSel(colParam ? { kind: "column", table: focus, column: colParam } : null);
  }, [dbId, focus, colParam]);
  // bảng không có trong database này (URL cũ, vừa đổi database, gõ sai) → báo và quay về trang chủ Dữ liệu
  const found = !!data?.tables.some((t) => t.name === focus);
  useEffect(() => {
    if (!data) return;
    if (found) pushRecent(dbId, focus);
    else onMissing();
  }, [data, found, dbId, focus, onMissing]);
  // chọn một cột thì kéo trọn đường đi của nó (nguồn → mart) vào vùng xem, kể cả bảng cách nhiều bước
  const trace = sel?.kind === "column" ? `${sel.table}.${sel.column}` : "";
  useEffect(() => {
    setError(null);
    const p = new URLSearchParams({ centers: centers.join(","), full: full.join(",") });
    if (trace) p.set("trace", trace);
    api<LineageRes>(`/db/${dbId}/explore/lineage?${p}`).then(setData).catch((e) => setError(e.message));
  }, [dbId, centers, full, trace]);

  const onSelect = useCallback((s: Sel) => setSel(s), []);
  const onExpand = useCallback((k: string) => setCenters((c) => (c.includes(k) ? c : [...c, k])), []);
  const onShowAll = useCallback((k: string) => setFull((f) => (f.includes(k) ? f : [...f, k])), []);
  const metricName = useMemo(() => {
    if (sel?.kind !== "metric" || !data) return undefined;
    for (const t of data.tables) for (const c of t.columns) for (const m of c.metrics) if (m.id === sel.id) return m.name_vi;
    return undefined;
  }, [sel, data]);

  return (
    <div className="flex h-full min-h-0">
      <div className="relative min-w-0 flex-1 bg-paper">
        {error && <div className="absolute inset-x-4 top-4 z-10"><ErrorNote>{error}</ErrorNote></div>}
        {!data ? <div className="grid h-full place-items-center text-[13px] text-muted">Đang dựng lineage…</div>
          : <LineageCanvas tables={data.tables} more={data.more} sel={sel} fitKey={`${focus}|${centers.length}|${full.length}|${data.tables.length}`}
              onSelect={onSelect} onExpand={onExpand} onShowAll={onShowAll} />}
        {centers.length > 1 && (
          <button onClick={() => { setCenters([focus]); setFull([]); }}
            className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-[12px] shadow-sm hover:bg-sunk">
            <X size={13} /> Thu gọn về {focus.split(".")[1]}
          </button>
        )}
      </div>
      <aside className="scroll-thin w-[360px] shrink-0 overflow-y-auto border-l border-line bg-surface" aria-label="Chi tiết">
        {found && data && <AssetPanel dbId={dbId} eng={eng} focus={focus} sel={sel} maxLayer={data.max_layer} metricName={metricName} onSelect={onSelect} />}
      </aside>
    </div>
  );
}

/** Tab Dữ liệu. Trang chủ → danh sách (miền hoặc từ khóa) → lineage quanh một bảng; ô tìm kiếm ở mọi chỗ. */
export default function DataPage() {
  const { db } = useSession();
  const eng = db?.role === "engineer";
  const { schema, name } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const focus = schema && name ? `${schema}.${name}` : null;
  const domain = params.get("domain");
  const q = params.get("q");
  const [home, setHome] = useState<Home | null>(null);
  const [reload, setReload] = useState<Reload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHome = useCallback((silent = false) => {
    if (!silent) setHome(null);
    if (db) api<Home>(`/db/${db.id}/explore/home`).then(setHome).catch((e) => setError(e.message));
  }, [db]);
  useEffect(() => loadHome(), [loadHome]);
  // đồng bộ chép xong thêm bảng: tải lại im lặng, không nháy trang
  const onSynced = useCallback(() => loadHome(true), [loadHome]);
  const onMissing = useCallback(() => {
    setError(`Database này không có bảng ${focus}.`);
    nav("/data", { replace: true });
  }, [focus, nav]);

  const doReload = async () => {
    if (!db) return;
    setBusy(true); setError(null);
    try { setReload(await api<Reload>(`/db/${db.id}/mart/reload`, { body: {} })); loadHome(); window.dispatchEvent(new Event("lvda:reviews-changed")); }
    catch (e) { setError(e instanceof Error ? e.message : "Nạp lại thất bại."); }
    finally { setBusy(false); }
  };
  if (!db) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-paper px-6 py-3">
        <button onClick={() => nav("/data")} className="text-[18px] font-semibold tracking-tight hover:text-accent">Dữ liệu</button>
        {focus && <span className="truncate font-mono text-[13px] text-muted">/ {focus}</span>}
        <SearchBox />
        {eng && !db.has_source && <Button className="ml-auto" onClick={doReload} disabled={busy}><RefreshCcw size={15} className={cx(busy && "animate-spin")} /> {busy ? "Đang nạp…" : "Nạp lại warehouse"}</Button>}
      </div>
      {/* database đồng bộ từ nguồn ngoài: trạng thái + đồng bộ ngay thay cho nút nạp lại warehouse */}
      {eng && db.has_source && <SourceBar key={db.id} dbId={db.id} onSynced={onSynced} />}
      {(error || reload) && (
        <div className="flex flex-col gap-2 border-b border-line bg-paper px-6 py-2">
          <ErrorNote>{error}</ErrorNote>
          {reload && (
            <div className="flex items-start justify-between gap-3 text-[13px]">
              <span>
                Đã đọc lại {reload.views} view · khóa {reload.keys_ok ? <span className="text-good">đều duy nhất</span> : <span className="text-bad">có khóa trùng</span>} ·{" "}
                {reload.stale_metrics.length ? <span className="text-warn">{reload.stale_metrics.length} chỉ số cần chứng nhận lại: {reload.stale_metrics.map((s) => (
                  <button key={s.id} onClick={() => nav(`/metrics/${s.id}`)} className="mx-0.5 underline underline-offset-2">{s.name_vi}</button>
                ))}</span> : "không chỉ số nào đổi lineage"} ·{" "}
                {reload.disabled_queries.length ? <span className="text-warn">{reload.disabled_queries.length} truy vấn mẫu bị tạm ẩn</span> : "truy vấn mẫu vẫn Xanh"}
              </span>
              <button onClick={() => setReload(null)} className="rounded p-1 text-muted hover:bg-sunk" aria-label="Đóng"><X size={14} /></button>
            </div>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {focus ? <FocusView key={`${db.id}:${focus}`} dbId={db.id} eng={!!eng} focus={focus} colParam={params.get("col")} onMissing={onMissing} />
          : !home ? <div className="grid h-full place-items-center text-[13px] text-muted">Đang tải danh mục…</div>
          : domain || q ? <ListView dbId={db.id} home={home} domain={domain} q={q} />
          : <HomeView home={home} recent={recentTables(db.id)} />}
      </div>
    </div>
  );
}
