import { BadgeCheck, Check, PencilLine, X } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api";
import { colPath, tablePath, type ColumnDetail, type Desc, type Impact, type MetricRef, type TableDetail, type Trust } from "../../explore";
import { layerLabel, type Sel } from "../LineageCanvas";
import { SqlView } from "../Sql";
import { Button, cx, shortCol } from "../ui";

type Tab = "overview" | "links";
type Flag = [string, string]; // nhãn, màu chữ

function descFlag(d?: Desc | null): Flag | null {
  if (!d) return null;
  return d.status === "approved" ? [d.source === "human" ? "người viết" : "đã duyệt", "text-accent-2"] : ["AI viết · chờ duyệt", "text-warn"];
}

function DescEditor({ value, onSave }: { value?: Desc | null; onSave: (text: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value?.description ?? "");
  useEffect(() => setText(value?.description ?? ""), [value]);
  if (!editing) return (
    <button onClick={() => setEditing(true)} className="group flex w-full items-start gap-1 text-left" title="Sửa mô tả">
      <span className={cx("flex-1 text-[13px] leading-[1.65]", value ? "text-ink-2" : "text-dim")}>{value?.description ?? "Chưa có mô tả."}</span>
      <PencilLine size={12} className="mt-1 shrink-0 text-faint opacity-0 group-hover:opacity-100" />
    </button>
  );
  return (
    <div className="flex items-start gap-1">
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label="Mô tả"
        className="flex-1 rounded-md border border-accent bg-surface px-2 py-1 text-[13px] outline-none" autoFocus />
      <button onClick={async () => { await onSave(text); setEditing(false); }} className="rounded p-1 text-accent hover:bg-hover" aria-label="Lưu"><Check size={14} /></button>
      <button onClick={() => { setEditing(false); setText(value?.description ?? ""); }} className="rounded p-1 text-muted hover:bg-hover" aria-label="Hủy"><X size={14} /></button>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-t border-line-soft py-4 first:border-t-0">
      <span className="text-[12px] text-faint">{label}</span>
      {children}
    </section>
  );
}

/** Thẻ đầu panel: loại · lớp · miền, tên, liên kết ngược (cột → bảng), các dấu hiệu, hành động chính. */
function Head({ kicker, title, sub, flags, action }: { kicker: string; title: string; sub?: ReactNode; flags: (Flag | null | false)[]; action?: ReactNode }) {
  const shown = flags.filter(Boolean) as Flag[];
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-4">
      <span className="text-[12px] text-faint">{kicker}</span>
      <span className="break-all font-mono text-[16px] font-medium leading-[1.35]">{title}</span>
      {sub}
      {shown.length > 0 && <span className="flex flex-wrap gap-x-3.5 gap-y-1 text-[12px]">{shown.map(([l, c]) => <span key={l} className={cx("whitespace-nowrap", c)}>{l}</span>)}</span>}
      {action}
    </div>
  );
}

function Tabs({ tab, setTab, links }: { tab: Tab; setTab: (t: Tab) => void; links: number }) {
  return (
    <div role="tablist" className="mt-1 flex gap-5 border-b border-line px-1">
      {([["overview", "Tổng quan", null], ["links", "Liên kết", links]] as [Tab, string, number | null][]).map(([k, l, n]) => (
        <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
          className={cx("flex h-9 items-center gap-1.5 whitespace-nowrap text-[13px]", tab === k ? "text-ink shadow-[inset_0_-2px_0_var(--color-ink)]" : "text-faint hover:text-ink")}>
          {l}{n !== null && <span className="font-mono text-[11.5px] text-dim">{n}</span>}
        </button>
      ))}
    </div>
  );
}

/** Khung panel: phần đầu đứng yên, nội dung tab cuộn riêng. */
function Frame({ head, tab, setTab, links, children }: { head: ReactNode; tab: Tab; setTab: (t: Tab) => void; links: number; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 px-4 pt-4">{head}<Tabs tab={tab} setTab={setTab} links={links} /></div>
      <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-5 pb-6">{children}</div>
    </div>
  );
}

/** Độ tin cậy: tỉ lệ Xanh trên các câu agent đã dùng bảng/cột này, và các câu SQL sai bộ kiểm định đã chặn. */
function TrustSection({ t, what }: { t: Trust; what: string }) {
  const q = t.questions;
  return (
    <Section label="Độ tin cậy">
      {t.catalog_only ? <p className="text-[13px] text-faint">Database này chỉ để duyệt danh mục, agent chưa hỏi trên đó nên chưa có số liệu kiểm định.</p>
        : q === 0 ? <p className="text-[13px] text-faint">Agent chưa dùng {what} trong câu trả lời nào{t.sql_checks ? ` · ${t.sql_checks} lần kiểm SQL` : ""}.</p> : (
          <>
            <div className="flex items-baseline gap-2.5">
              <span className="font-mono text-[28px] leading-none text-ink">{Math.round((t.green / q) * 100)}%</span>
              <span className="text-[12.5px] text-faint">Xanh trên {q} câu hỏi</span>
            </div>
            <div className="flex h-1 gap-[2px] bg-line-soft" aria-hidden>
              <span className="bg-accent" style={{ width: `${(t.green / q) * 100}%` }} />
              <span className="bg-warn" style={{ width: `${(t.yellow / q) * 100}%` }} />
              <span className="bg-bad" style={{ width: `${(t.held / q) * 100}%` }} />
            </div>
            <div className="flex flex-wrap gap-4 text-[12px] text-faint">
              <span className="whitespace-nowrap"><span className="font-mono text-accent-2">{t.green}</span> Xanh</span>
              <span className="whitespace-nowrap"><span className="font-mono text-warn">{t.yellow}</span> Vàng</span>
              <span className="whitespace-nowrap"><span className="font-mono text-bad">{t.held}</span> giữ lại</span>
            </div>
          </>
        )}
      {t.caught > 0 && (
        <span className="text-[12.5px] leading-relaxed text-muted">
          Đã chặn {t.caught} câu SQL sai trước khi trả lời: <span className="font-mono text-bad">{t.caught_rules.map((r) => `${r.rule} ×${r.count}`).join(", ")}</span>
        </span>
      )}
    </Section>
  );
}

/** Đổi bảng/cột này thì cái gì ở hạ nguồn bị ảnh hưởng: đếm trước, danh sách bảng mở khi cần. */
function ImpactSection({ imp, kind }: { imp: Impact; kind: "bảng" | "cột" }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const rows: [number, string][] = [
    kind === "bảng" ? [imp.tables_total, "bảng hạ nguồn"] : [imp.columns, "cột hạ nguồn"],
    [imp.metrics.length, "chỉ số"], [imp.verified_queries.length, "truy vấn mẫu"], [imp.questions, "câu hỏi đã hỏi"],
  ];
  return (
    <Section label={`Tác động nếu đổi ${kind} này`}>
      <div className="flex flex-col">
        {rows.map(([n, l]) => (
          <span key={l} className="flex items-baseline justify-between gap-3 py-[5px] text-[13px] leading-snug">
            <span className="whitespace-nowrap text-muted">{l}</span><span className={cx("font-mono", n > 0 ? "text-ink" : "text-dim")}>{n}</span>
          </span>
        ))}
      </div>
      {imp.tables.length > 0 && (
        <button onClick={() => setOpen(!open)} className="self-start text-[12px] text-accent-2 hover:underline">
          {open ? "Ẩn danh sách bảng hạ nguồn" : `Xem ${imp.tables_total} bảng hạ nguồn`}
        </button>
      )}
      {open && (
        <ul className="flex flex-col gap-0.5">
          {imp.tables.map((t) => <li key={t.name}><button onClick={() => nav(tablePath(t.name))} className="break-all text-left font-mono text-[12px] text-accent-2 hover:underline">{t.name}</button></li>)}
          {imp.tables_total > imp.tables.length && <li className="text-[12px] text-dim">và {imp.tables_total - imp.tables.length} bảng khác</li>}
        </ul>
      )}
    </Section>
  );
}

function LinkList({ label, items, onOpen }: { label: string; items: string[]; onOpen: (x: string) => void }) {
  if (!items.length) return null;
  return (
    <Section label={label}>
      {items.map((x) => <button key={x} onClick={() => onOpen(x)} className="self-start break-all text-left font-mono text-[12.5px] text-accent-2 hover:underline">{x}</button>)}
    </Section>
  );
}

function MetricList({ metrics }: { metrics: MetricRef[] }) {
  const nav = useNavigate();
  if (!metrics.length) return null;
  return (
    <Section label="Chỉ số dùng tới">
      {metrics.map((m) => (
        <button key={m.id} onClick={() => nav(`/metrics/${m.id}`)} className="flex items-baseline justify-between gap-3 text-left text-[13px] leading-snug hover:text-accent-2">
          <span className="min-w-0 flex-1">{m.name_vi}</span><span className="shrink-0 font-mono text-[12px] text-dim">{m.id}</span>
        </button>
      ))}
    </Section>
  );
}

const NoLinks = () => <div className="py-6 text-[13px] text-faint">Chưa có quan hệ hay chỉ số nào gắn với mục này.</div>;
const uniqMetrics = (ms: MetricRef[]) => [...new Map(ms.map((m) => [m.id, m])).values()];

export function AssetPanel({ dbId, eng, focus, sel, maxLayer, metric, onSelect }: {
  dbId: number; eng: boolean; focus: string; sel: Sel; maxLayer: number; metric?: { name_vi: string; status: string }; onSelect: (s: Sel) => void;
}) {
  const nav = useNavigate();
  const target = sel ?? { kind: "table" as const, table: focus };
  const [table, setTable] = useState<TableDetail | null>(null);
  const [column, setColumn] = useState<ColumnDetail | null>(null);
  const [showSql, setShowSql] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
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
  useEffect(() => setTab("overview"), [key]);

  const saveDesc = async (name: string, text: string) => {
    await api(`/db/${dbId}/descriptions`, { method: "PUT", body: { column: name, description: text } });
    load();
  };
  const approveAll = async (name: string) => {
    await api(`/db/${dbId}/descriptions/approve`, { body: { table: name } });
    load();
  };

  if (error) return <p className="p-4 text-[13px] text-bad">{error}</p>;

  if (target.kind === "metric") {
    const ok = metric?.status === "certified";
    return (
      <Frame tab={tab} setTab={setTab} links={0}
        head={<Head kicker="Chỉ số" title={metric?.name_vi ?? target.id} flags={[metric ? [ok ? "đã chứng nhận" : metric.status, ok ? "text-accent-2" : "text-warn"] : null]}
          sub={<button onClick={() => nav(`/metrics/${target.id}`)} className="self-start font-mono text-[12px] text-accent-2 hover:underline">{target.id} · mở định nghĩa →</button>} />}>
        {tab === "overview"
          ? <Section label="Mô tả"><span className="text-[13px] leading-[1.65] text-muted">Các cột tính ra chỉ số này đang được làm nổi trên đồ thị.</span></Section>
          : <NoLinks />}
      </Frame>
    );
  }

  if (target.kind === "column") {
    const c = column;
    if (!c || c.column !== target.column) return <PanelSkeleton />;
    const goCol = (full: string) => onSelect({ kind: "column", table: full.slice(0, full.lastIndexOf(".")), column: full.slice(full.lastIndexOf(".") + 1) });
    const sources = c.sources.join() !== c.parents.join() ? c.sources : [];
    const children = c.children.slice(0, 12);
    const links = c.parents.length + sources.length + children.length + c.metrics.length;
    return (
      <Frame tab={tab} setTab={setTab} links={links}
        head={<Head kicker={`Cột · ${c.type}`} title={c.column} flags={[c.pii && ["PII · viewer thấy bị che", "text-warn"], descFlag(c.description)]}
          sub={<button onClick={() => onSelect({ kind: "table", table: c.table.name })} className="self-start font-mono text-[12px] text-accent-2 hover:underline">← {c.table.name}</button>} />}>
        {tab === "overview" ? (
          <>
            <TrustSection t={c.trust} what="cột này" />
            <ImpactSection imp={c.impact} kind="cột" />
            <Section label="Mô tả">
              {eng ? <DescEditor value={c.description} onSave={(x) => saveDesc(`${c.table.name}.${c.column}`, x)} />
                : <span className={cx("text-[13px] leading-[1.65]", c.description ? "text-ink-2" : "text-dim")}>{c.description?.description ?? "Chưa có mô tả."}</span>}
            </Section>
          </>
        ) : links === 0 ? <NoLinks /> : (
          <>
            <LinkList label="Lấy trực tiếp từ" items={c.parents} onOpen={goCol} />
            <LinkList label="Nguồn gốc ở lớp nguồn" items={sources} onOpen={(p) => nav(colPath(p))} />
            <LinkList label={`Được dùng trực tiếp bởi (${c.children.length})`} items={children} onOpen={(p) => nav(colPath(p))} />
            <MetricList metrics={c.metrics} />
          </>
        )}
      </Frame>
    );
  }

  const t = table;
  if (!t || t.name !== target.table) return <PanelSkeleton />;
  const metrics = uniqMetrics(t.trust.metrics);
  const links = t.relationships.length + metrics.length;
  return (
    <Frame tab={tab} setTab={setTab} links={links}
      head={<Head kicker={`${t.object === "view" ? "View" : "Bảng"} · ${layerLabel(t.layer, maxLayer)} · ${t.domain_label}`} title={t.name}
        flags={[t.deprecated && ["ngừng dùng", "text-bad"], t.drafts > 0 ? [`${t.drafts} mô tả chờ duyệt`, "text-warn"] : descFlag(t.description_obj), t.pii > 0 && [`${t.pii} cột PII`, "text-warn"]]}
        action={t.name !== focus && (
          <button onClick={() => nav(tablePath(t.name))} className="mt-1.5 h-8 rounded-md border border-edge text-[13px] text-ink hover:bg-hover">Xem lineage quanh bảng này</button>
        )} />}>
      {tab === "overview" ? (
        <>
          <TrustSection t={t.trust} what="bảng này" />
          <ImpactSection imp={t.impact} kind="bảng" />
          <Section label="Mô tả">
            {eng ? <DescEditor value={t.description_obj} onSave={(x) => saveDesc(t.name, x)} />
              : <span className={cx("text-[13px] leading-[1.65]", t.description ? "text-ink-2" : "text-dim")}>{t.description ?? "Chưa có mô tả."}</span>}
            {eng && t.drafts > 0 && <Button size="sm" className="self-start" onClick={() => approveAll(t.name)}><BadgeCheck size={14} /> Duyệt {t.drafts} mô tả của bảng</Button>}
          </Section>
          <Section label="Khóa và số dòng">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
              <span className="text-faint">Mỗi dòng là</span><span className="break-all font-mono text-ink">{t.grain.length ? t.grain.join(", ") : "—"}</span>
              <span className="text-faint">Số dòng</span><span className="font-mono text-ink">{t.key ? t.key.rows.toLocaleString("vi-VN") : "—"}</span>
              <span className="text-faint">Khóa</span>
              <span className={t.key && !t.key.unique ? "text-bad" : "text-ink"}>{!t.key ? "Chưa khai báo" : t.key.unique ? "Duy nhất" : `${(t.key.rows - t.key.distinct).toLocaleString("vi-VN")} dòng trùng khóa`}</span>
              <span className="text-faint">Số cột</span><span className="font-mono text-ink">{t.columns}</span>
            </div>
          </Section>
          {t.sql && (
            <Section label="SQL của view">
              <button className="self-start text-[12.5px] text-accent-2 hover:underline" onClick={() => setShowSql(!showSql)}>{showSql ? "Ẩn" : "Xem SQL"}</button>
              {showSql && <SqlView sql={t.sql.trim()} maxHeight={240} />}
            </Section>
          )}
        </>
      ) : links === 0 ? <NoLinks /> : (
        <>
          {t.relationships.length > 0 && (
            <Section label="Quan hệ join đã khai báo">
              {t.relationships.map((r) => {
                const other = r.child === t.name ? r.parent : r.child;
                return (
                  <span key={`${r.child}-${r.parent}-${r.keys.join()}`} className="flex flex-col gap-0.5 text-[13px]">
                    <span><span className="text-faint">{r.child === t.name ? "nhiều-một tới " : "một-nhiều từ "}</span>
                      <button onClick={() => nav(tablePath(other))} className="font-mono text-[12.5px] text-accent-2 hover:underline">{other}</button></span>
                    {r.unique_when && <span className="text-[12px] text-dim">duy nhất khi {shortCol(r.unique_when.column)} = {String(r.unique_when.value)}</span>}
                  </span>
                );
              })}
            </Section>
          )}
          <MetricList metrics={metrics} />
        </>
      )}
    </Frame>
  );
}

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label="Đang tải">
      {[60, 90, 40, 75, 55].map((w, i) => <div key={i} className="h-3 animate-pulse rounded bg-sunk" style={{ width: `${w}%` }} />)}
    </div>
  );
}
