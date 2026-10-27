import { ArrowRight, BadgeCheck, Check, Columns3, GitMerge, KeyRound, PencilLine, ShieldCheck, Table2, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api";
import { colPath, tablePath, type ColumnDetail, type Desc, type Impact, type TableDetail, type Trust } from "../../explore";
import { layerLabel, type Sel } from "../LineageCanvas";
import { SqlView } from "../Sql";
import { Button, cx, fmtDate, Pill, RuleChip, shortCol } from "../ui";

export function DescBadge({ d }: { d?: Desc | null }) {
  if (!d) return null;
  return d.status === "approved"
    ? <Pill tone="good"><BadgeCheck size={11} />{d.source === "human" ? "người viết" : "đã duyệt"}</Pill>
    : <Pill tone="warn">AI viết · chờ duyệt</Pill>;
}

function DescEditor({ value, onSave }: { value?: Desc | null; onSave: (text: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value?.description ?? "");
  useEffect(() => setText(value?.description ?? ""), [value]);
  if (!editing) return (
    <button onClick={() => setEditing(true)} className="group flex w-full items-start gap-1 text-left" title="Sửa mô tả">
      <span className={cx("flex-1", !value && "text-faint")}>{value?.description ?? "Chưa có mô tả"}</span>
      <PencilLine size={12} className="mt-1 shrink-0 text-faint opacity-0 group-hover:opacity-100" />
    </button>
  );
  return (
    <div className="flex items-start gap-1">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label="Mô tả"
        className="flex-1 rounded border border-accent px-1.5 py-1 text-[12.5px] outline-none" autoFocus />
      <button onClick={async () => { await onSave(text); setEditing(false); }} className="rounded p-1 text-good hover:bg-good-soft" aria-label="Lưu"><Check size={14} /></button>
      <button onClick={() => { setEditing(false); setText(value?.description ?? ""); }} className="rounded p-1 text-muted hover:bg-sunk" aria-label="Hủy"><X size={14} /></button>
    </div>
  );
}

function Field({ label, children, icon }: { label: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <section className="border-t border-line px-4 py-3">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">{icon}{label}</h3>
      <div className="text-[13px]">{children}</div>
    </section>
  );
}

/** Khối tin cậy: agent đã dùng bảng/cột này trong bao nhiêu câu, bao nhiêu câu Xanh, bộ kiểm định đã chặn gì, chỉ số nào đã chứng nhận. */
function TrustBlock({ t, what }: { t: Trust; what: string }) {
  const nav = useNavigate();
  const certified = t.metrics.filter((m) => m.status === "certified");
  return (
    <Field label="Độ tin cậy" icon={<ShieldCheck size={12} />}>
      {t.catalog_only ? <p className="text-muted">Database này chỉ để duyệt danh mục, agent chưa hỏi trên đó nên chưa có số liệu kiểm định.</p>
        : t.questions + t.sql_checks === 0 ? <p className="text-muted">Agent chưa dùng {what} trong câu trả lời nào.</p> : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span><b className="num text-[17px]">{t.questions}</b> câu hỏi</span>
              {t.questions > 0 && <span className="text-good"><b className="num">{Math.round((t.green / t.questions) * 100)}%</b> Xanh</span>}
              {t.yellow > 0 && <span className="text-warn">{t.yellow} Vàng</span>}
              {t.held > 0 && <span className="text-bad">{t.held} bị giữ lại</span>}
              {t.sql_checks > 0 && <span className="text-muted">{t.sql_checks} lần kiểm SQL</span>}
            </div>
            {t.questions > 0 && (
              <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-sunk" aria-hidden>
                <span className="bg-good" style={{ width: `${(t.green / t.questions) * 100}%` }} />
                <span className="bg-warn" style={{ width: `${(t.yellow / t.questions) * 100}%` }} />
                <span className="bg-bad" style={{ width: `${(t.held / t.questions) * 100}%` }} />
              </div>
            )}
          </>
        )}
      {t.caught > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px]">
          Bộ kiểm định đã chặn <b className="num">{t.caught}</b> câu SQL sai trước khi trả lời:
          {t.caught_rules.map((r) => <span key={r.rule} className="inline-flex items-center gap-1"><RuleChip rule={r.rule} severity="high" /><span className="num text-muted">×{r.count}</span></span>)}
        </p>
      )}
      {certified.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {certified.map((m) => (
            <li key={m.id} className="flex items-start gap-1.5 text-[12.5px]">
              <BadgeCheck size={13} className="mt-0.5 shrink-0 text-good" />
              <span className="min-w-0">
                <button onClick={() => nav(`/metrics/${m.id}`)} className="text-left text-accent hover:underline">{m.name_vi}</button>
                <span className="block text-[11.5px] text-muted">chứng nhận{m.certified_by ? ` bởi ${m.certified_by}` : ""}{m.certified_at ? ` · ${fmtDate(m.certified_at)}` : ""}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Field>
  );
}

/** Đổi bảng/cột này thì cái gì ở hạ nguồn bị ảnh hưởng: đếm trước, danh sách sau. */
function ImpactBlock({ imp, maxLayer, kind }: { imp: Impact; maxLayer: number; kind: "bảng" | "cột" }) {
  const nav = useNavigate();
  const [all, setAll] = useState(false);
  const none = imp.tables_total === 0 && imp.metrics.length === 0 && imp.verified_queries.length === 0;
  return (
    <Field label={`Tác động nếu đổi ${kind} này`} icon={<TriangleAlert size={12} />}>
      {none ? <p className="text-muted">Không có gì ở hạ nguồn phụ thuộc vào {kind} này.</p> : (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              [imp.tables_total, "bảng hạ nguồn"], [imp.columns, "cột"], [imp.metrics.length, "chỉ số"],
              [imp.verified_queries.length, "truy vấn mẫu"], [imp.questions, "câu hỏi đã hỏi"],
            ].map(([n, label]) => (
              <div key={label} className={cx("rounded border px-2 py-1", Number(n) > 0 ? "border-warn/40 bg-warn-soft/50" : "border-line")}>
                <b className="num">{n}</b> <span className="text-[12px] text-muted">{label}</span>
              </div>
            ))}
          </div>
          {Object.keys(imp.by_layer).length > 0 && (
            <p className="mt-1.5 text-[12px] text-muted">{Object.entries(imp.by_layer).map(([l, n]) => `${layerLabel(Number(l), maxLayer)}: ${n}`).join(" · ")}</p>
          )}
          {imp.metrics.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">{imp.metrics.map((m) => (
              <button key={m.id} onClick={() => nav(`/metrics/${m.id}`)} className="rounded bg-good-soft px-1.5 py-0.5 text-[12px] text-good hover:underline">{m.name_vi}</button>
            ))}</div>
          )}
          {imp.tables.length > 0 && (
            <ul className="mt-2 flex flex-col gap-0.5">
              {(all ? imp.tables : imp.tables.slice(0, 6)).map((t) => (
                <li key={t.name}><button onClick={() => nav(tablePath(t.name))} className="font-mono text-[12px] text-accent hover:underline">{t.name}</button></li>
              ))}
              {imp.tables.length > 6 && <li><button onClick={() => setAll(!all)} className="text-[12px] text-muted hover:underline">{all ? "Thu gọn" : `và ${imp.tables_total - 6} bảng khác`}</button></li>}
            </ul>
          )}
          {imp.verified_queries.length > 0 && (
            <p className="mt-2 text-[12px] text-muted">Truy vấn mẫu sẽ bị kiểm lại: {imp.verified_queries.slice(0, 3).map((q) => `“${q.question}”`).join(", ")}{imp.verified_queries.length > 3 ? "…" : ""}</p>
          )}
        </>
      )}
    </Field>
  );
}

export function AssetPanel({ dbId, eng, focus, sel, maxLayer, metricName, onSelect }: {
  dbId: number; eng: boolean; focus: string; sel: Sel; maxLayer: number; metricName?: string; onSelect: (s: Sel) => void;
}) {
  const nav = useNavigate();
  const target = sel ?? { kind: "table" as const, table: focus };
  const [table, setTable] = useState<TableDetail | null>(null);
  const [column, setColumn] = useState<ColumnDetail | null>(null);
  const [showSql, setShowSql] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = target.kind === "metric" ? `m:${target.id}` : target.kind === "column" ? `c:${target.table}.${target.column}` : `t:${target.table}`;
  const load = useCallback(() => {
    setError(null);
    if (target.kind === "table") {
      setColumn(null);
      api<TableDetail>(`/db/${dbId}/explore/table/${encodeURIComponent(target.table)}`).then(setTable).catch((e) => setError(e.message));
    } else if (target.kind === "column") {
      setTable(null);
      api<ColumnDetail>(`/db/${dbId}/explore/column/${encodeURIComponent(target.table)}/${encodeURIComponent(target.column)}`).then(setColumn).catch((e) => setError(e.message));
    }
  }, [dbId, key]); // `key` mã hoá đủ `target`
  useEffect(() => { setShowSql(false); load(); }, [load]);

  const saveDesc = async (name: string, text: string) => {
    await api(`/db/${dbId}/descriptions`, { method: "PUT", body: { column: name, description: text } });
    load();
  };
  const approveAll = async (name: string) => {
    await api(`/db/${dbId}/descriptions/approve`, { body: { table: name } });
    load();
  };

  if (error) return <p className="p-4 text-[13px] text-bad">{error}</p>;

  if (target.kind === "metric") return (
    <div className="px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-faint">chỉ số</div>
      <div className="mt-0.5 text-[15px] font-medium">{metricName ?? target.id}</div>
      <div className="font-mono text-[12px] text-muted">{target.id}</div>
      <Button size="sm" className="mt-2" onClick={() => nav(`/metrics/${target.id}`)}>Mở định nghĩa <ArrowRight size={13} /></Button>
      <p className="mt-3 text-[12.5px] text-muted">Các cột tính ra chỉ số này đang được làm nổi trên đồ thị.</p>
    </div>
  );

  if (target.kind === "column") {
    const c = column;
    if (!c || c.column !== target.column) return <PanelSkeleton />;
    const goCol = (full: string) => onSelect({ kind: "column", table: full.slice(0, full.lastIndexOf(".")), column: full.slice(full.lastIndexOf(".") + 1) });
    return (
      <>
        <div className="px-4 py-3">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-faint"><Columns3 size={12} />cột · {c.type}</div>
          <div className="mt-0.5 break-all font-mono text-[15px] font-medium">{c.column}</div>
          <button onClick={() => onSelect({ kind: "table", table: c.table.name })} className="font-mono text-[12px] text-accent hover:underline">{c.table.name}</button>
          <div className="mt-1.5 flex flex-wrap gap-1">{c.pii && <Pill tone="warn">PII · viewer thấy bị che</Pill>}<DescBadge d={c.description} /></div>
        </div>
        <TrustBlock t={c.trust} what="cột này" />
        <ImpactBlock imp={c.impact} maxLayer={maxLayer} kind="cột" />
        <Field label="Mô tả">{eng ? <DescEditor value={c.description} onSave={(x) => saveDesc(`${c.table.name}.${c.column}`, x)} /> : c.description?.description ?? <span className="text-faint">—</span>}</Field>
        {c.parents.length > 0 && (
          <Field label="Lấy trực tiếp từ">
            <ul className="flex flex-col gap-0.5">{c.parents.map((p) => <li key={p}><button onClick={() => goCol(p)} className="break-all font-mono text-[12px] text-accent hover:underline">{p}</button></li>)}</ul>
          </Field>
        )}
        {c.sources.length > 0 && c.sources.join() !== c.parents.join() && (
          <Field label="Nguồn gốc ở lớp nguồn">
            <ul className="flex flex-col gap-0.5">{c.sources.map((p) => <li key={p}><button onClick={() => nav(colPath(p))} className="break-all font-mono text-[12px] text-accent hover:underline">{p}</button></li>)}</ul>
          </Field>
        )}
        {c.children.length > 0 && (
          <Field label={`Được dùng trực tiếp bởi (${c.children.length})`}>
            <ul className="flex flex-col gap-0.5">{c.children.slice(0, 12).map((p) => <li key={p}><button onClick={() => nav(colPath(p))} className="break-all font-mono text-[12px] text-accent hover:underline">{shortCol(p)}</button></li>)}</ul>
          </Field>
        )}
      </>
    );
  }

  const t = table;
  if (!t || t.name !== target.table) return <PanelSkeleton />;
  return (
    <>
      <div className="px-4 py-3">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-faint"><Table2 size={12} />{t.object === "view" ? "view" : "bảng"} · {layerLabel(t.layer, maxLayer)} · {t.domain_label}</div>
        <div className="mt-0.5 break-all font-mono text-[15px] font-medium">{t.name}</div>
        <div className="mt-1.5 flex flex-wrap gap-1">{t.deprecated && <Pill tone="bad">ngừng dùng</Pill>}<DescBadge d={t.description_obj} />{t.pii > 0 && <Pill tone="warn">{t.pii} cột PII</Pill>}</div>
        {t.name !== focus && <Button size="sm" className="mt-2" onClick={() => nav(tablePath(t.name))}>Xem lineage quanh bảng này <ArrowRight size={13} /></Button>}
      </div>
      <TrustBlock t={t.trust} what="bảng này" />
      <ImpactBlock imp={t.impact} maxLayer={maxLayer} kind="bảng" />
      <Field label="Mô tả">{eng ? <DescEditor value={t.description_obj} onSave={(x) => saveDesc(t.name, x)} /> : t.description ?? <span className="text-faint">—</span>}</Field>
      <Field label="Khóa và số dòng" icon={<KeyRound size={12} />}>
        {t.grain.length > 0 && <div>mỗi dòng là một <span className="font-mono">{t.grain.join(", ")}</span></div>}
        {t.key ? <div className={cx("mt-0.5", t.key.unique ? "text-good" : "text-bad")}>{t.key.unique ? "Khóa duy nhất" : `${t.key.rows - t.key.distinct} dòng trùng khóa`} · {t.key.rows.toLocaleString("vi-VN")} dòng</div>
          : <div className="text-muted">Chưa khai báo khóa.</div>}
        <div className="mt-0.5 text-muted">{t.columns} cột</div>
      </Field>
      {t.relationships.length > 0 && (
        <Field label="Quan hệ join đã khai báo" icon={<GitMerge size={12} />}>
          <ul className="flex flex-col gap-1">{t.relationships.map((r) => {
            const other = r.child === t.name ? r.parent : r.child;
            return (
              <li key={`${r.child}-${r.parent}-${r.keys.join()}`}>
                <span className="text-muted">{r.child === t.name ? "nhiều-một tới " : "một-nhiều từ "}</span>
                <button onClick={() => nav(tablePath(other))} className="font-mono text-accent hover:underline">{shortCol(other)}</button>
                {r.unique_when && <div className="text-[11.5px] text-muted">duy nhất khi {shortCol(r.unique_when.column)} = {String(r.unique_when.value)}</div>}
              </li>
            );
          })}</ul>
        </Field>
      )}
      {t.sql && (
        <Field label="SQL của view">
          <button className="text-accent hover:underline" onClick={() => setShowSql(!showSql)}>{showSql ? "Ẩn" : "Xem SQL"}</button>
          {showSql && <div className="mt-2"><SqlView sql={t.sql.trim()} maxHeight={240} /></div>}
        </Field>
      )}
      {eng && t.drafts > 0 && <div className="border-t border-line px-4 py-3"><Button size="sm" onClick={() => approveAll(t.name)}><BadgeCheck size={14} /> Duyệt {t.drafts} mô tả của bảng</Button></div>}
    </>
  );
}

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Đang tải">
      {[60, 90, 40, 75, 55].map((w, i) => <div key={i} className="h-3 animate-pulse rounded bg-sunk" style={{ width: `${w}%` }} />)}
    </div>
  );
}
