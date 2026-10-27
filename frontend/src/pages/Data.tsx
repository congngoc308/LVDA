import { RefreshCcw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { AssetPanel } from "../components/data/AssetPanel";
import { SearchBox } from "../components/data/SearchBox";
import { SourceBar } from "../components/SyncPanel";
import { LineageCanvas, layerColor, layerLabel, type Sel } from "../components/LineageCanvas";
import { cx, ErrorNote } from "../components/ui";
import { pushRecent, recentTables, tablePath, type Brief, type Home, type LineageRes, type SearchRes } from "../explore";
import { useSession } from "../session";

interface Reload { views: number; keys_ok: boolean; stale_metrics: { id: string; name_vi: string }[]; disabled_queries: unknown[] }

const fmt = (n: number) => n.toLocaleString("vi-VN");
const layers = (maxLayer: number) => Array.from({ length: maxLayer + 1 }, (_, i) => i);

/** Tên bảng kèm lớp và các dấu hiệu cần chú ý (PII, mô tả chờ duyệt, ngừng dùng). */
function TableName({ b, maxLayer, children }: { b: Pick<Brief, "name" | "layer" | "deprecated"> & { pii: number | boolean; drafts?: number }; maxLayer: number; children?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
      <span className={cx("shrink-0 whitespace-nowrap font-mono text-[13px]", b.deprecated ? "text-dim line-through" : "text-ink")}>{b.name}</span>
      {children}
      <span className="whitespace-nowrap text-[11.5px]" style={{ color: layerColor(b.layer, maxLayer) }}>{layerLabel(b.layer, maxLayer)}</span>
      {!!b.pii && <span className="text-[11.5px] text-warn">PII</span>}
      {!!b.drafts && <span className="whitespace-nowrap text-[11.5px] text-warn">{b.drafts} chờ duyệt</span>}
      {b.deprecated && <span className="whitespace-nowrap text-[11.5px] text-bad">ngừng dùng</span>}
    </span>
  );
}

/** Bảng xếp hạng ở trang chủ: thứ hạng, tên + mô tả, số đếm kèm thanh so với hạng đầu. */
function RankPanel({ title, hint, rows, n, unit, bar, empty, maxLayer }: {
  title: string; hint: string; rows: Brief[]; n: (b: Brief) => number; unit: string; bar: string; empty: string; maxLayer: number;
}) {
  const top = Math.max(1, ...rows.map(n));
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-[10px] border border-line bg-surface">
      <div className="flex items-baseline gap-2.5 border-b border-line-soft px-[18px] pb-3 pt-3.5">
        <span className="whitespace-nowrap text-[14px] font-semibold">{title}</span><span className="whitespace-nowrap text-[12px] text-dim">{hint}</span>
      </div>
      {rows.length === 0 ? <p className="px-[18px] py-6 text-[12.5px] text-faint">{empty}</p> : rows.map((b, i) => (
        <Link key={b.name} to={tablePath(b.name)} className="grid grid-cols-[24px_minmax(0,1fr)_96px] items-center gap-3.5 border-t border-line-soft px-[18px] py-[11px] first-of-type:border-t-0 hover:bg-sunk">
          <span className="font-mono text-[12px] text-dim">{String(i + 1).padStart(2, "0")}</span>
          <span className="flex min-w-0 flex-col gap-[3px]">
            <TableName b={b} maxLayer={maxLayer} />
            <span className="truncate text-[12.5px] text-faint">{b.description ?? "Chưa có mô tả."}</span>
          </span>
          <span className="flex flex-col items-end gap-1.5">
            <span className="whitespace-nowrap text-[12px] text-faint"><span className="font-mono text-[14px] text-ink">{n(b)}</span> {unit}</span>
            <span className="flex h-[3px] w-full bg-hover"><span style={{ width: `${(n(b) / top) * 100}%`, background: bar }} /></span>
          </span>
        </Link>
      ))}
    </section>
  );
}

/** Trang chủ: không liệt kê 500 bảng, chỉ đưa ra lối vào (con số tổng, vừa xem, hay dùng, trong chỉ số, theo miền). */
function HomeView({ home, recent }: { home: Home; recent: string[] }) {
  const nav = useNavigate();
  const ml = home.max_layer;
  const stats: [string, number][] = [
    ["Bảng", home.tables], ["Cột", home.columns], ["Miền nghiệp vụ", home.domains.length],
    ["Lượt agent dùng", home.domains.reduce((a, d) => a + d.uses, 0)],
  ];
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1320px] flex-col gap-10 px-4 pb-14 pt-6 md:px-8">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3">
          {stats.map(([l, n]) => (
            <div key={l} className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-surface px-[18px] py-4">
              <span className="whitespace-nowrap text-[12.5px] text-muted">{l}</span>
              <span className="font-mono text-[30px] leading-none text-ink">{fmt(n)}</span>
            </div>
          ))}
        </div>

        {recent.length > 0 && (
          <div className="-mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
            <span className="whitespace-nowrap text-[12px] text-faint">Vừa xem</span>
            {recent.map((n) => (
              <Link key={n} to={tablePath(n)} className="font-mono text-[12.5px] text-ink-2 underline decoration-edge underline-offset-4 hover:text-accent-2">{n}</Link>
            ))}
          </div>
        )}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(420px,100%),1fr))] gap-4">
          <RankPanel title="Agent hay dùng" hint="theo số câu hỏi" rows={home.popular.slice(0, 5)} n={(b) => b.uses} unit="câu hỏi" bar="var(--color-accent)"
            empty="Chưa có câu hỏi nào dùng bảng của database này." maxLayer={ml} />
          <RankPanel title="Trong chỉ số đã chứng nhận" hint="theo số chỉ số" rows={home.certified.slice(0, 5)} unit="chỉ số" bar="var(--color-teal)"
            n={(b) => (b as Home["certified"][number]).metrics} empty="Database này chưa có chỉ số đã chứng nhận." maxLayer={ml} />
        </div>

        <section className="flex flex-col">
          <div className="flex flex-wrap items-baseline gap-4 pb-2.5">
            <span className="text-[15px] font-semibold">Miền nghiệp vụ</span>
            <span className="flex-1" />
            {layers(ml).map((l) => (
              <span key={l} className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-faint">
                <span className="h-[3px] w-2.5" style={{ background: layerColor(l, ml) }} />{layerLabel(l, ml)}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-3">
            {home.domains.map((d) => {
              const segs = Object.entries(d.layers).map(([l, n]) => ({ l: Number(l), n }));
              return (
                <button key={d.key} onClick={() => nav(`/data?domain=${d.key}`)}
                  className="flex flex-col gap-3.5 rounded-[10px] border border-line bg-surface px-[18px] py-4 text-left transition-colors hover:border-edge-hover">
                  <span className="flex w-full items-baseline gap-2.5">
                    <span className="flex-1 text-[15px] font-semibold">{d.label}</span>
                    <span className="whitespace-nowrap font-mono text-[12px] text-faint">{d.tables} bảng</span>
                  </span>
                  <span className="flex w-full flex-col gap-2">
                    <span className="flex h-2 gap-[2px]" aria-hidden>
                      {segs.map((s) => <span key={s.l} style={{ flexGrow: s.n, background: layerColor(s.l, ml) }} />)}
                    </span>
                    <span className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-faint">
                      {segs.map((s) => <span key={s.l} className="whitespace-nowrap">{layerLabel(s.l, ml)} <span className="font-mono text-ink">{s.n}</span></span>)}
                    </span>
                  </span>
                  <span className="flex w-full flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-line-soft pt-3 text-[12px]">
                    <span className="whitespace-nowrap text-muted"><span className="font-mono text-ink">{fmt(d.uses)}</span> lượt agent dùng</span>
                    {d.pii > 0 && <span className="whitespace-nowrap text-warn">{d.pii} bảng có PII</span>}
                    {d.drafts > 0 && <span className="whitespace-nowrap text-warn">{d.drafts} mô tả chờ duyệt</span>}
                    {d.deprecated > 0 && <span className="whitespace-nowrap text-bad">{d.deprecated} ngừng dùng</span>}
                  </span>
                </button>
              );
            })}
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
  const label = domain && !q ? home.domains.find((d) => d.key === domain)?.label ?? domain : `Kết quả cho “${q}”`;
  const items = res?.items ?? [];
  const byLayer = res?.by_layer ?? {};
  const all = Object.values(byLayer).reduce((a, n) => a + n, 0);
  const ml = home.max_layer;

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1320px] flex-col gap-[18px] px-4 pb-14 pt-6 md:px-8">
        <Link to="/data" className="self-start whitespace-nowrap text-[12.5px] text-faint hover:text-ink">← Dữ liệu</Link>
        <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
          <div className="flex flex-wrap items-baseline gap-3 px-5 pb-1 pt-[18px]">
            <h2 className="text-[20px] font-semibold tracking-[-0.01em]">{label}</h2>
            <span className="whitespace-nowrap font-mono text-[13px] text-faint">{res ? fmt(res.total) : "…"} {q ? "kết quả" : "bảng"}</span>
            <span className="flex-1" />
            <div className="flex flex-wrap gap-4">
              {TAGS.map(([k, l]) => {
                const on = tags.includes(k);
                return (
                  <button key={k} aria-pressed={on} onClick={() => setTags((cur) => (on ? cur.filter((x) => x !== k) : [...cur, k]))}
                    className={cx("flex items-center gap-[7px] whitespace-nowrap text-[12.5px]", on ? "text-ink" : "text-muted hover:text-ink")}>
                    <span className={cx("grid size-3 place-items-center rounded-[3px] border text-[9px] font-bold leading-none text-on-accent", on ? "border-accent bg-accent" : "border-line-strong")}>{on ? "✓" : ""}</span>{l}
                  </button>
                );
              })}
            </div>
          </div>
          <div role="tablist" aria-label="Lọc theo lớp" className="scroll-thin flex gap-[22px] overflow-x-auto px-5">
            {[null, ...layers(ml)].map((l) => (
              <button key={String(l)} role="tab" aria-selected={layer === l} onClick={() => setLayer(l)}
                className={cx("flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap text-[13px]", layer === l ? "text-ink shadow-[inset_0_-2px_0_var(--color-accent)]" : "text-faint hover:text-ink")}>
                {l === null ? "Mọi lớp" : layerLabel(l, ml)}
                <span className="font-mono text-[11.5px] text-dim">{res ? fmt(l === null ? all : byLayer[String(l)] ?? 0) : ""}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface">
          {!res ? [0, 1, 2, 3, 4].map((i) => <div key={i} className="border-b border-line-soft px-5 py-[13px] last:border-b-0"><div className="h-9 animate-pulse rounded bg-sunk" /></div>) : (
            <>
              {items.length === 0 && <div className="py-10 text-center text-[13px] text-faint">Không có bảng nào khớp bộ lọc.</div>}
              {items.map((i) => (
                <Link key={i.kind === "table" ? i.name : `${i.name}.${i.column}`} to={i.kind === "table" ? tablePath(i.name) : `${tablePath(i.name)}?col=${encodeURIComponent(i.column)}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-5 border-b border-line-soft px-5 py-[13px] last:border-b-0 hover:bg-sunk">
                  <span className="flex min-w-0 flex-col gap-[3px]">
                    {i.kind === "table" ? <TableName b={i} maxLayer={ml} /> : (
                      <TableName b={{ name: i.column, layer: i.layer, deprecated: i.deprecated, pii: i.pii }} maxLayer={ml}>
                        <span className="whitespace-nowrap font-mono text-[11.5px] text-dim">trong {i.name}</span>
                      </TableName>
                    )}
                    <span className="truncate text-[12.5px] text-faint">{i.description ?? "Chưa có mô tả."}</span>
                  </span>
                  <span className="flex gap-5 whitespace-nowrap text-[12px] text-faint">
                    <span>{i.domain_label}</span>
                    <span className="min-w-[80px] text-right text-ink-2">{i.uses ? `${i.uses} câu hỏi` : ""}</span>
                  </span>
                </Link>
              ))}
              {res.total > items.length && (
                <button onClick={() => setLimit(limit + PAGE)} className="h-11 text-[13px] text-accent-2 hover:bg-sunk">
                  Xem thêm {Math.min(PAGE, res.total - items.length)} / {fmt(res.total - items.length)} còn lại
                </button>
              )}
            </>
          )}
        </div>
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
  const metric = useMemo(() => {
    if (sel?.kind !== "metric" || !data) return undefined;
    for (const t of data.tables) for (const c of t.columns) for (const m of c.metrics) if (m.id === sel.id) return m;
    return undefined;
  }, [sel, data]);

  return (
    <div className="flex h-full min-h-0">
      <div className="relative min-w-0 flex-1 bg-paper">
        {error && <div className="absolute inset-x-4 top-4 z-10"><ErrorNote>{error}</ErrorNote></div>}
        {!data ? <div className="grid h-full place-items-center text-[13px] text-faint">Đang dựng lineage…</div>
          : <LineageCanvas tables={data.tables} more={data.more} sel={sel} fitKey={`${focus}|${centers.length}|${full.length}|${data.tables.length}`}
              onSelect={onSelect} onExpand={onExpand} onShowAll={onShowAll} />}
        {centers.length > 1 && (
          <button onClick={() => { setCenters([focus]); setFull([]); }}
            className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-md border border-edge bg-surface px-2.5 py-1 text-[12px] hover:bg-hover">
            <X size={13} /> Thu gọn về {focus.split(".")[1]}
          </button>
        )}
      </div>
      <aside className="flex min-h-0 w-[360px] shrink-0 flex-col border-l border-line bg-panel" aria-label="Chi tiết">
        {found && data && <AssetPanel dbId={dbId} eng={eng} focus={focus} sel={sel} maxLayer={data.max_layer} metric={metric} onSelect={onSelect} />}
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
      <header className={cx("flex shrink-0 items-center gap-3", focus ? "h-14 border-b border-line px-6" : "mx-auto w-full max-w-[1320px] px-4 pb-1 pt-7 md:px-8")}>
        <div className="flex min-w-0 flex-1 items-center gap-2.5 text-[13px] text-faint">
          {(focus || domain || q) && <button onClick={() => nav("/data")} className="whitespace-nowrap text-[14px] font-medium text-ink-2 hover:text-ink">Tất cả bảng</button>}
          {focus && <span className="truncate font-mono text-[13px] text-faint">/ {focus}</span>}
          <SearchBox />
        </div>
        {eng && !db.has_source && (
          <button onClick={doReload} disabled={busy}
            className="flex h-8 shrink-0 items-center gap-[7px] whitespace-nowrap rounded-md border border-edge px-3 text-[13px] text-ink hover:bg-hover disabled:opacity-60">
            <RefreshCcw size={14} className={cx(busy && "animate-spin")} /> {busy ? "Đang nạp…" : "Nạp lại warehouse"}
          </button>
        )}
      </header>
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
          : !home ? <div className="grid h-full place-items-center text-[13px] text-faint">Đang tải danh mục…</div>
          : domain || q ? <ListView dbId={db.id} home={home} domain={domain} q={q} />
          : <HomeView home={home} recent={recentTables(db.id)} />}
      </div>
    </div>
  );
}
