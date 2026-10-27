import { X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Button, cx, ErrorNote, Modal } from "../components/ui";
import { useSession } from "../session";

type Format = "currency" | "percent" | "integer" | "days" | "score" | "number";
const FORMATS: [Format, string][] = [["currency", "Tiền"], ["percent", "Tỉ lệ %"], ["integer", "Số đếm"], ["number", "Số thập phân"], ["days", "Số ngày"], ["score", "Điểm /5"]];
const OPS = ["=", "<>", "in", "not in"] as const;
interface Filter { column: string; op: (typeof OPS)[number]; value: string }

const fold = (s: string) => s.replace(/đ/g, "d").replace(/Đ/g, "D").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const slug = (s: string) => fold(s).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
// chuỗi JSON là chuỗi YAML hợp lệ, nên dùng nó để không phải tự thoát ký tự
const q = (s: string) => JSON.stringify(s);
const scalar = (s: string) => (/^-?\d+(\.\d+)?$/.test(s) ? s : s === "true" || s === "false" ? s : q(s));

function toYaml(f: { id: string; name: string; desc: string; unit: string; format: Format; synonyms: string; owner: string; time: string; entity: string; sql: string; filters: Filter[]; assumptions: string }) {
  const rows = f.filters.filter((r) => r.column.trim());
  const notes = f.assumptions.split("\n").map((x) => x.trim()).filter(Boolean);
  return [
    `id: ${f.id}`, `name_vi: ${q(f.name.trim())}`, `description: ${q(f.desc.trim())}`, `unit: ${q(f.unit.trim())}`, `format: ${f.format}`,
    `synonyms: [${list(f.synonyms).map(q).join(", ")}]`, `owner: ${q(f.owner)}`, `time_column: ${q(f.time.trim())}`,
    ...(f.entity.trim() ? [`entity_key: ${q(f.entity.trim())}`] : []),
    "canonical_sql: |", ...f.sql.trimEnd().split("\n").map((l) => `  ${l}`),
    rows.length ? "required_filters:" : "required_filters: []",
    ...rows.map((r) => `  - {column: ${q(r.column.trim())}, op: ${q(r.op)}, value: ${r.op.includes("in") ? `[${list(r.value).map(scalar).join(", ")}]` : scalar(r.value.trim())}}`),
    notes.length ? "assumptions:" : "assumptions: []", ...notes.map((n) => `  - ${q(n)}`),
    "",
  ].join("\n");
}

const input = "h-9 w-full rounded-md border border-line-strong bg-paper px-2.5 text-[13px] outline-none placeholder:text-dim focus:border-accent";

function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-[12.5px] font-medium text-ink-2">{label}{hint && <span className="font-normal text-faint"> · {hint}</span>}</span>
      {children}
    </label>
  );
}
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-x-8 gap-y-4 border-t border-line pt-5 first:border-t-0 first:pt-0 md:grid-cols-[140px_minmax(0,1fr)]">
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.05em] text-faint">{title}</h3>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}

/** Thêm chỉ số bằng form. Form dựng YAML rồi đi cùng đường kiểm và lưu như trình sửa YAML: chỉ số mới luôn ở dạng nháp. */
export function MetricForm({ open, onClose, onSaved, onYaml, existing, timeColumns }: {
  open: boolean; onClose: () => void; onSaved: (id: string) => void; onYaml: (yaml: string) => void;
  existing: string[]; timeColumns: string[];
}) {
  const { db, user } = useSession();
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [desc, setDesc] = useState("");
  const [synonyms, setSynonyms] = useState("");
  const [sql, setSql] = useState("");
  const [time, setTime] = useState("");
  const [entity, setEntity] = useState("");
  const [filters, setFilters] = useState<Filter[]>([]);
  const [format, setFormat] = useState<Format>("currency");
  const [unit, setUnit] = useState("BRL");
  const [assumptions, setAssumptions] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(""); setId(""); setIdTouched(false); setDesc(""); setSynonyms(""); setSql(""); setTime(timeColumns[0] ?? ""); setEntity("");
    setFilters([]); setFormat("currency"); setUnit("BRL"); setAssumptions(""); setErrors([]); setOk(false);
  }, [open]); // chỉ đặt lại khi mở form

  const metricId = idTouched ? id : slug(name);
  const taken = existing.includes(metricId);
  const missing = [!name.trim() && "tên", !metricId && "mã", !sql.trim() && "SQL chuẩn", !time.trim() && "cột thời gian"].filter(Boolean) as string[];
  const yaml = () => toYaml({ id: metricId, name, desc, unit, format, synonyms, owner: user?.email ?? "", time, entity, sql, filters, assumptions });
  const touch = () => setOk(false);

  const send = async (path: "validate" | "save") => {
    if (!db) return;
    setBusy(true); setErrors([]);
    try {
      if (path === "validate") {
        const r = await api<{ ok: boolean; errors: string[] }>(`/db/${db.id}/metrics/validate`, { body: { yaml: yaml() } });
        setErrors(r.errors); setOk(r.ok);
      } else {
        const r = await api<{ id: string }>(`/db/${db.id}/metrics`, { method: "PUT", body: { yaml: yaml() } });
        onSaved(r.id);
      }
    } catch (e) {
      const d = e instanceof ApiError ? (e.detail as { errors?: string[] }) : null;
      setErrors(d?.errors ?? [e instanceof Error ? e.message : "Không lưu được."]); setOk(false);
    } finally { setBusy(false); }
  };
  const blocked = busy || taken || missing.length > 0;
  const setFilter = (i: number, patch: Partial<Filter>) => { setFilters(filters.map((f, k) => (k === i ? { ...f, ...patch } : f))); touch(); };

  return (
    <Modal open={open} onClose={onClose} title="Thêm chỉ số" width={880}
      footer={<>
        <button onClick={() => onYaml(yaml())} className="mr-auto self-center text-[12.5px] text-muted hover:text-ink">Sửa dạng YAML</button>
        <Button onClick={() => send("validate")} disabled={blocked}>Kiểm tra</Button>
        <Button variant="primary" onClick={() => send("save")} disabled={blocked}>Lưu bản nháp</Button>
      </>}>
      <div className="flex flex-col gap-6">
        <Group title="Định nghĩa">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Field label="Tên chỉ số">
              <input className={input} value={name} onChange={(e) => { setName(e.target.value); touch(); }} placeholder="Doanh thu hàng hóa" autoFocus />
            </Field>
            <Field label="Mã">
              <input className={cx(input, "font-mono", taken && "border-bad")} value={metricId} spellCheck={false}
                onChange={(e) => { setIdTouched(true); setId(slug(e.target.value)); touch(); }} placeholder="product_revenue" />
            </Field>
          </div>
          {taken && <p className="-mt-2 text-[12px] text-bad">Mã “{metricId}” đã có. Muốn đổi chỉ số đó thì mở nó và bấm Sửa.</p>}
          <Field label="Mô tả">
            <input className={input} value={desc} onChange={(e) => { setDesc(e.target.value); touch(); }} placeholder="Tổng giá hàng của các đơn đã giao, không gồm phí vận chuyển." />
          </Field>
          <Field label="Từ đồng nghĩa" hint="cách nhau bằng dấu phẩy">
            <input className={input} value={synonyms} onChange={(e) => { setSynonyms(e.target.value); touch(); }} placeholder="doanh thu hàng, tiền hàng" />
          </Field>
        </Group>

        <Group title="Cách tính">
          <Field label="SQL chuẩn" hint="một câu SELECT trả một cột số">
            <textarea value={sql} onChange={(e) => { setSql(e.target.value); touch(); }} spellCheck={false} rows={6}
              placeholder={"SELECT SUM(i.price) AS product_revenue\nFROM mart.fct_order_items AS i\nJOIN mart.fct_orders AS o ON o.order_id = i.order_id\nWHERE o.order_status = 'delivered'"}
              className="scroll-thin min-h-[132px] w-full resize-y rounded-md border border-line-strong bg-paper p-2.5 font-mono text-[12.5px] leading-[1.6] outline-none placeholder:text-dim focus:border-accent" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cột thời gian">
              <input className={cx(input, "font-mono")} list="lvda-time-cols" value={time} onChange={(e) => { setTime(e.target.value); touch(); }} placeholder="mart.fct_orders.purchased_at" />
              <datalist id="lvda-time-cols">{timeColumns.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label="Khóa đếm" hint="không bắt buộc">
              <input className={cx(input, "font-mono")} value={entity} onChange={(e) => { setEntity(e.target.value); touch(); }} placeholder="mart.fct_orders.order_id" />
            </Field>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-ink-2">Bộ lọc bắt buộc <span className="font-normal text-faint">· câu SQL nào thiếu sẽ bị bắt lỗi V03</span></span>
            {filters.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {filters.map((f, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,1.6fr)_96px_minmax(0,1fr)_28px] items-center gap-1.5">
                    <input className={cx(input, "font-mono")} aria-label="Cột" value={f.column} onChange={(e) => setFilter(i, { column: e.target.value })} placeholder="mart.fct_orders.order_status" />
                    <select className={cx(input, "font-mono")} aria-label="Phép so" value={f.op} onChange={(e) => setFilter(i, { op: e.target.value as Filter["op"] })}>
                      {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <input className={cx(input, "font-mono")} aria-label="Giá trị" value={f.value} onChange={(e) => setFilter(i, { value: e.target.value })}
                      placeholder={f.op.includes("in") ? "canceled, unavailable" : "delivered"} />
                    <button onClick={() => { setFilters(filters.filter((_, k) => k !== i)); touch(); }} aria-label="Bỏ bộ lọc" title="Bỏ bộ lọc"
                      className="grid size-7 place-items-center rounded-md text-dim hover:bg-hover hover:text-ink"><X size={14} /></button>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => { setFilters([...filters, { column: "", op: "=", value: "" }]); touch(); }} className="self-start text-[12.5px] text-accent hover:text-accent-2">+ Thêm bộ lọc</button>
          </div>
        </Group>

        <Group title="Hiển thị">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_140px]">
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[12.5px] font-medium text-ink-2">Định dạng số</span>
              <div role="radiogroup" aria-label="Định dạng số" className="flex flex-wrap gap-1">
                {FORMATS.map(([k, l]) => (
                  <button key={k} role="radio" aria-checked={format === k} onClick={() => { setFormat(k); if (k !== "currency") setUnit(""); else if (!unit) setUnit("BRL"); touch(); }}
                    className={cx("h-8 rounded-md border px-2.5 text-[12.5px]", format === k ? "border-accent bg-accent-soft text-ink" : "border-line-strong text-muted hover:text-ink")}>{l}</button>
                ))}
              </div>
            </div>
            <Field label="Đơn vị">
              <input className={input} value={unit} onChange={(e) => { setUnit(e.target.value); touch(); }} placeholder={format === "currency" ? "BRL" : ""} />
            </Field>
          </div>
          <Field label="Giả định" hint="mỗi dòng một ý">
            <textarea value={assumptions} onChange={(e) => { setAssumptions(e.target.value); touch(); }} rows={2} placeholder="Chỉ tính đơn đã giao"
              className="w-full resize-y rounded-md border border-line-strong bg-paper p-2.5 text-[13px] leading-[1.6] outline-none placeholder:text-dim focus:border-accent" />
          </Field>
        </Group>

        <div className="flex flex-col gap-2 border-t border-line pt-4 text-[12.5px]">
          {missing.length > 0 && <p className="text-faint">Còn thiếu: {missing.join(", ")}.</p>}
          {ok && <p className="text-good">SQL chuẩn qua kiểm định. Lưu sẽ tạo chỉ số ở dạng nháp; người có quyền chứng nhận duyệt xong mới dùng được để kiểm và dựng card.</p>}
          {errors.length > 0 && <ErrorNote><ul className="list-disc pl-4">{errors.map((e) => <li key={e}>{e}</li>)}</ul></ErrorNote>}
        </div>
      </div>
    </Modal>
  );
}
