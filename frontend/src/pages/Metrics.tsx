import { BadgeCheck, Download, PencilLine, Plus, Search, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildAnswerGraph, GraphLegend, LineageGraph, type Graph } from "../components/LineageGraph";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError, apiText } from "../api";
import { SqlView } from "../components/Sql";
import { Button, cx, Drawer, ErrorNote, fmtDate, Modal, shortCol } from "../components/ui";
import { describeFilter } from "../format";
import { useSession } from "../session";
import type { Fingerprint } from "../types";
import { MetricForm } from "./MetricForm";

interface Metric {
  id: string; name_vi: string; description: string; status: string; version: number; format: string; unit: string;
  synonyms: string[]; time_column: string; canonical_sql: string; assumptions: string[];
  required_filters: { column: string; op: string; value: unknown }[];
  meta: { owner: string; certified_at: string | null; certified_by_name: string | null; updated_at: string; stale_reason: string | null };
}
interface MetricDetail extends Metric {
  fingerprint: Fingerprint | null;
  versions: { version: number; created_at: string; created_by: string; yaml: string }[];
}

const METRICFLOW_SAMPLE = `semantic_models:
  - name: orders
    model: ref('fct_orders')
    defaults:
      agg_time_dimension: purchased_at
    entities:
      - name: order_id
        type: primary
    measures:
      - name: gmv_total
        agg: sum
        expr: gmv
metrics:
  - name: gmv_from_orders
    label: Doanh thu gộp (từ fct_orders)
    type: simple
    type_params:
      measure: gmv_total
    filter: "{{ Dimension('order_id__order_status') }} = 'delivered'"
`;

function ImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { db } = useSession();
  const [text, setText] = useState("");
  const [results, setResults] = useState<{ id: string | null; ok: boolean; version?: number; errors: string[] }[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setText(""); setResults(null); } }, [open]);
  const run = async () => {
    if (!db) return;
    setBusy(true);
    try {
      const r = await api<{ results: typeof results }>(`/db/${db.id}/metrics/import`, { body: { yaml: text } });
      setResults(r.results);
      if (r.results?.some((x) => x.ok)) onDone();
    } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Nhập định nghĩa chỉ số" width={760}
      footer={<>
        <button className="mr-auto self-center text-[12.5px] text-accent hover:underline" onClick={() => setText(METRICFLOW_SAMPLE)}>Dán ví dụ dbt MetricFlow</button>
        <Button onClick={onClose}>Đóng</Button>
        <Button variant="primary" disabled={busy || !text.trim()} onClick={run}>Nhập</Button>
      </>}>
      <p className="mb-2 text-[13px] text-muted">Dán YAML của LVDA (một hoặc nhiều chỉ số) hoặc YAML dbt MetricFlow (semantic_models + metrics loại simple). Mỗi chỉ số hợp lệ tạo một phiên bản nháp, cần chứng nhận.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} aria-label="YAML cần nhập"
        className="scroll-thin h-[300px] w-full resize-y rounded-md border border-line-strong bg-sunk p-3 font-mono text-[12.5px] outline-none focus:border-accent" />
      {results && (
        <ul className="mt-3 flex flex-col gap-1.5 text-[13px]">
          {results.map((r, i) => (
            <li key={i} className={r.ok ? "text-good" : "text-bad"}>
              {r.ok ? `Đã nhập ${r.id} (v${r.version}, nháp)` : `Không nhập được ${r.id ?? "(không có id)"}: ${r.errors.join("; ")}`}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function StatusPill({ status }: { status: string }) {
  const [label, tone, dot] = status === "certified" ? ["Đã chứng nhận", "bg-good-soft text-good", "bg-good"]
    : status === "stale" ? ["Cần chứng nhận lại", "bg-bad-soft text-bad", "bg-bad"]
    : status === "deprecated" ? ["Ngừng dùng", "bg-raised text-muted", "bg-muted"]
    : ["Nháp", "bg-warn-soft text-warn", "bg-warn"];
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-[9px] py-[3px] text-[12px] font-medium", tone)}>
      <span className={cx("size-1.5 rounded-full", dot)} />{label}
    </span>
  );
}

function metricGraph(d: MetricDetail): Graph | null {
  const fp = d.fingerprint;
  if (!fp) return null;
  const raw = (c: string) => fp.column_raw?.[c] ?? [];
  return buildAnswerGraph({
    measures: fp.measure_columns.map((c) => ({ column: c, raw: raw(c) })), measure_sql: fp.measures.map((m) => m.sql),
    filters: fp.filters.map((f) => ({ ...f, raw: raw(f.column) })), joins: fp.joins,
    group_by: fp.group_by.map((g) => ({ ...g, raw: g.columns.flatMap(raw) })), tables: fp.tables, time_columns: fp.time_columns,
  }, [], d.name_vi, `chỉ số · v${d.version}`);
}

function VersionDiff({ versions }: { versions: MetricDetail["versions"] }) {
  const [base, setBase] = useState<number | null>(null);
  if (versions.length < 2) return <p className="text-[12.5px] text-muted">Mới có một phiên bản.</p>;
  const cur = versions[0];
  const old = versions.find((v) => v.version === (base ?? versions[1].version)) ?? versions[1];
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-[12.5px] text-muted">So v{cur.version} với
        <select value={old.version} onChange={(e) => setBase(Number(e.target.value))} className="rounded border border-line bg-surface px-1 py-0.5" aria-label="Phiên bản để so">
          {versions.slice(1).map((v) => <option key={v.version} value={v.version}>v{v.version}</option>)}
        </select>
      </label>
      <SqlView sql={cur.yaml.trim()} previous={old.yaml.trim()} maxHeight={300} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line px-5 py-4">
      <h3 className="mb-2 text-[12px] font-medium text-faint">{title}</h3>
      {children}
    </section>
  );
}

function YamlEditor({ initial, open, onClose, onSaved }: { initial: string; open: boolean; onClose: () => void; onSaved: (id: string) => void }) {
  const { db } = useSession();
  const [text, setText] = useState(initial);
  const [errors, setErrors] = useState<string[]>([]);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(initial); setErrors([]); setOk(false); }, [initial, open]);

  const validate = async () => {
    if (!db) return;
    setBusy(true);
    try {
      const r = await api<{ ok: boolean; errors: string[] }>(`/db/${db.id}/metrics/validate`, { body: { yaml: text } });
      setErrors(r.errors); setOk(r.ok);
    } finally { setBusy(false); }
  };
  const save = async () => {
    if (!db) return;
    setBusy(true);
    try {
      const r = await api<Metric>(`/db/${db.id}/metrics`, { method: "PUT", body: { yaml: text } });
      onSaved(r.id);
    } catch (e) {
      const d = e instanceof ApiError ? (e.detail as { errors?: string[] }) : null;
      setErrors(d?.errors ?? [e instanceof Error ? e.message : "Không lưu được."]);
      setOk(false);
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Định nghĩa chỉ số (YAML)" width={760}
      footer={<>
        <span className="mr-auto self-center text-[12px] text-muted">Lưu sẽ tạo phiên bản mới ở trạng thái nháp, cần chứng nhận lại.</span>
        <Button onClick={validate} disabled={busy}>Kiểm tra</Button>
        <Button variant="primary" onClick={save} disabled={busy}>Lưu phiên bản</Button>
      </>}>
      <textarea value={text} onChange={(e) => { setText(e.target.value); setOk(false); }} spellCheck={false} aria-label="YAML"
        className="scroll-thin h-[380px] w-full resize-y rounded-md border border-line-strong bg-sunk p-3 font-mono text-[12.5px] leading-relaxed outline-none focus:border-accent" />
      <div className="mt-3 flex flex-col gap-2">
        {ok && <p className="text-[13px] text-good">Hợp lệ. SQL chuẩn qua kiểm định, sẵn sàng lưu.</p>}
        {errors.length > 0 && <ErrorNote><ul className="list-disc pl-4">{errors.map((e) => <li key={e}>{e}</li>)}</ul></ErrorNote>}
      </div>
    </Modal>
  );
}

export default function MetricsPage() {
  const { db } = useSession();
  const { metricId } = useParams();
  const nav = useNavigate();
  const [list, setList] = useState<Metric[]>([]);
  const [detail, setDetail] = useState<MetricDetail | null>(null);
  const [editor, setEditor] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eng = db?.role === "engineer";
  // /metrics?new=1 (từ trình sửa card của tab Đánh giá): mở sẵn màn hình thêm chỉ số
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (eng && params.has("new")) { setCreating(true); setParams({}, { replace: true }); }
  }, [eng, params, setParams]);

  const load = useCallback(() => { if (db) api<Metric[]>(`/db/${db.id}/metrics`).then(setList).catch((e) => setError(e.message)); }, [db]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!db || !metricId) { setDetail(null); return; }
    api<MetricDetail>(`/db/${db.id}/metrics/${metricId}`).then(setDetail).catch((e) => setError(e.message));
  }, [db, metricId]);

  const act = async (action: "certify" | "deprecate") => {
    if (!db || !detail) return;
    try {
      setDetail(await api<MetricDetail>(`/db/${db.id}/metrics/${detail.id}/${action}`, { body: {} }));
      load();
      window.dispatchEvent(new Event("lvda:reviews-changed"));
    } catch (e) { setError(e instanceof Error ? e.message : "Không đổi được trạng thái."); }
  };
  const graph = useMemo(() => (detail ? metricGraph(detail) : null), [detail]);
  const [importing, setImporting] = useState(false);
  const exportYaml = async () => {
    if (!db) return;
    try {
      const text = await apiText(`/db/${db.id}/metrics/export`);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "application/x-yaml;charset=utf-8" }));
      a.download = "lvda-metrics.yml";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { setError(e instanceof Error ? e.message : "Không xuất được."); }
  };

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "cert" | "draft">("all");
  const isCert = (m: Metric) => m.status === "certified";
  const q = query.trim().toLowerCase();
  const shown = list.filter((m) => (filter === "all" || (filter === "cert") === isCert(m)) && (!q || `${m.name_vi} ${m.id}`.toLowerCase().includes(q)));
  const filters: ["all" | "cert" | "draft", string, number][] = [
    ["all", "Tất cả", list.length], ["cert", "Đã chứng nhận", list.filter(isCert).length], ["draft", "Nháp", list.filter((m) => !isCert(m)).length],
  ];
  const grid = "grid grid-cols-[minmax(150px,1fr)_minmax(180px,1.5fr)_minmax(140px,1fr)_150px] gap-4";

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="flex flex-col gap-4 px-7 py-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="ml-auto flex flex-wrap gap-2">
            {eng && <Button onClick={() => setImporting(true)}><Download size={13} /> Nhập YAML / MetricFlow</Button>}
            <Button onClick={exportYaml}><Upload size={13} /> Xuất YAML</Button>
            {eng && <Button variant="primary" onClick={() => setCreating(true)}><Plus size={13} strokeWidth={2.4} /> Thêm chỉ số</Button>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex h-8 w-[260px] max-w-full items-center gap-2 rounded-md border border-line-strong px-2.5 focus-within:border-accent">
            <Search size={13} className="text-dim" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm tên hoặc mã chỉ số" aria-label="Tìm chỉ số"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none focus-visible:outline-none" />
          </label>
          <div className="flex gap-0.5 rounded-md border border-line-strong p-0.5" role="group" aria-label="Lọc theo trạng thái">
            {filters.map(([k, label, n]) => (
              <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k}
                className={cx("flex h-[26px] items-center gap-1.5 whitespace-nowrap rounded px-2.5 text-[12.5px]", filter === k ? "bg-raised text-ink" : "text-muted hover:text-ink")}>
                {label}<span className="font-mono text-[11px] text-dim">{n}</span>
              </button>
            ))}
          </div>
        </div>
        <ErrorNote>{error}</ErrorNote>
        <div className="scroll-thin overflow-x-auto rounded-lg border border-line">
          <div className="min-w-[680px]">
            <div className={cx(grid, "border-b border-line bg-paper px-4 py-[9px] text-[12px] text-faint")}>
              <span>Chỉ số</span><span>Bộ lọc bắt buộc</span><span>Cột thời gian</span><span>Trạng thái</span>
            </div>
            {shown.map((m) => {
              const filters = m.required_filters.map(describeFilter).join("; ");
              return (
                <button key={m.id} onClick={() => nav(`/metrics/${m.id}`)}
                  className={cx(grid, "w-full items-center border-b border-line-soft px-4 py-[11px] text-left last:border-b-0 hover:bg-hover-soft", metricId === m.id && "bg-hover")}>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-[13px] text-ink">{m.name_vi}</span>
                    <span className="font-mono text-[11.5px] text-faint">{m.id} · v{m.version}</span>
                  </span>
                  <span className={cx("break-words font-mono text-[12px] leading-normal", filters ? "text-ink-2" : "text-dim")}>{filters || "không có"}</span>
                  <span className="break-words font-mono text-[12px] text-muted">{shortCol(m.time_column)}</span>
                  <span className="justify-self-start"><StatusPill status={m.status} /></span>
                </button>
              );
            })}
            {shown.length === 0 && <div className="p-7 text-center text-[13px] text-faint">{list.length ? "Không có chỉ số nào khớp." : "Chưa có chỉ số nào."}</div>}
          </div>
        </div>
      </div>

      <Drawer open={!!detail} onClose={() => nav("/metrics")} width={780}
        title={detail && <span className="flex items-center gap-2">{detail.name_vi} <span className="font-mono text-[12px] font-normal text-muted">{detail.id} · v{detail.version}</span></span>}>
        {detail && (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
              <StatusPill status={detail.status} />
              {detail.meta.certified_by_name && <span className="text-[12px] text-muted">bởi {detail.meta.certified_by_name} · {fmtDate(detail.meta.certified_at)}</span>}
              <div className="ml-auto flex gap-2">
                {eng && <Button size="sm" onClick={() => setEditor(detail.versions[0]?.yaml ?? "")}><PencilLine size={14} /> Sửa</Button>}
                {db?.can_certify && (detail.status === "certified" || detail.status === "stale") && <Button size="sm" variant="ghost" onClick={() => act("deprecate")}>Ngừng dùng</Button>}
                {detail.status !== "certified" && db?.can_certify && <Button size="sm" variant="primary" onClick={() => act("certify")}><BadgeCheck size={14} /> {detail.status === "stale" ? "Chứng nhận lại" : "Chứng nhận"}</Button>}
              </div>
            </div>
            {detail.status === "stale" && detail.meta.stale_reason && <p className="border-b border-line bg-bad-soft/60 px-5 py-2 text-[12.5px] text-bad">{detail.meta.stale_reason} Xem lại đồ thị lineage bên dưới rồi chứng nhận lại.</p>}
            {detail.status !== "certified" && detail.status !== "deprecated" && !db?.can_certify && <p className="border-b border-line bg-warn-soft/50 px-5 py-2 text-[12.5px] text-warn">Chỉ người có quyền chứng nhận mới đưa chỉ số này vào dùng để kiểm.</p>}
            {graph && <Section title="Lineage của chỉ số"><LineageGraph graph={graph} minHeight={140} /><div className="mt-2"><GraphLegend /></div></Section>}
            <Section title="Định nghĩa"><p>{detail.description}</p>
              <div className="mt-2 flex flex-wrap gap-1">{detail.synonyms.map((s) => <span key={s} className="rounded bg-sunk px-1.5 py-0.5 text-[12px] text-ink-2">{s}</span>)}</div>
            </Section>
            <Section title="SQL chuẩn"><SqlView sql={detail.canonical_sql.trim()} maxHeight={220} /></Section>
            {detail.fingerprint && (
              <Section title="Dấu vân tay lineage">
                <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-[13px]">
                  <dt className="text-muted">Phép đo</dt><dd className="font-mono text-[12px]">{detail.fingerprint.measures.map((m) => m.sql).join(", ")}</dd>
                  <dt className="text-muted">Cột đo</dt><dd className="flex flex-wrap gap-1">{detail.fingerprint.measure_columns.map((c) => <span key={c} className="rounded bg-accent-soft px-1.5 font-mono text-[11.5px] text-accent">{shortCol(c)}</span>)}</dd>
                  <dt className="text-muted">Nguồn gốc</dt><dd className="flex flex-wrap gap-1">{detail.fingerprint.raw_sources.map((c) => <span key={c} className="rounded bg-sunk px-1.5 font-mono text-[11.5px]">{c}</span>)}</dd>
                  <dt className="text-muted">Bộ lọc</dt><dd className="font-mono text-[12px]">{detail.required_filters.map(describeFilter).join("; ") || "—"}</dd>
                  <dt className="text-muted">Join</dt><dd className="font-mono text-[12px]">{detail.fingerprint.joins.map((j) => `${shortCol(j.left)} = ${shortCol(j.right)}`).join("; ") || "—"}</dd>
                  <dt className="text-muted">Cột thời gian</dt><dd className="font-mono text-[12px]">{shortCol(detail.time_column)}</dd>
                </dl>
              </Section>
            )}
            {detail.assumptions.length > 0 && <Section title="Giả định"><ul className="list-disc pl-5 text-ink-2">{detail.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></Section>}
            <Section title="Lịch sử phiên bản">
              <ul className="mb-3 flex flex-col gap-1 text-[13px]">
                {detail.versions.map((v) => <li key={v.version} className="flex gap-3"><span className="num w-8">v{v.version}</span><span className="text-muted">{fmtDate(v.created_at)} · {v.created_by}</span></li>)}
              </ul>
              <VersionDiff versions={detail.versions} />
            </Section>
          </>
        )}
      </Drawer>

      <MetricForm open={creating} onClose={() => setCreating(false)} existing={list.map((m) => m.id)}
        timeColumns={[...new Set(list.map((m) => m.time_column).filter(Boolean))]}
        onYaml={(y) => { setCreating(false); setEditor(y); }}
        onSaved={(id) => { setCreating(false); load(); nav(`/metrics/${id}`); }} />
      <ImportModal open={importing} onClose={() => setImporting(false)} onDone={load} />
      <YamlEditor open={editor !== null} initial={editor ?? ""} onClose={() => setEditor(null)}
        onSaved={(id) => { setEditor(null); load(); nav(`/metrics/${id}`); api<MetricDetail>(`/db/${db!.id}/metrics/${id}`).then(setDetail); }} />
    </div>
  );
}
