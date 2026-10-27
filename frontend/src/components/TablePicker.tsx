import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { needsAttention, num, type Picks, type SourceTableInfo } from "../sources";
import { cx, Pill } from "./ui";

const PAGE = 60;
type Filter = "all" | "attention" | "chosen";

/** Chọn bảng và cột mốc. Có tìm kiếm, lọc "cần chú ý" / "đã chọn", chọn hết theo bộ lọc: dùng được cả khi nguồn có vài trăm bảng. */
export function TablePicker({ tables, picks, onChange, disabled = false, synced }: {
  tables: SourceTableInfo[]; picks: Picks; onChange: (p: Picks) => void; disabled?: boolean; synced?: Set<string>;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return tables.filter((t) => (!s || t.name.toLowerCase().includes(s))
      && (filter === "all" || (filter === "chosen" ? picks[t.name]?.on : needsAttention(t, picks))));
  }, [tables, picks, q, filter]);
  const counts = { all: tables.length, attention: tables.filter((t) => needsAttention(t, picks)).length, chosen: tables.filter((t) => picks[t.name]?.on).length };
  const setAll = (on: boolean) => onChange({ ...picks, ...Object.fromEntries(shown.filter((t) => t.readable).map((t) => [t.name, { cursor: picks[t.name]?.cursor ?? null, on }])) });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Tìm bảng" aria-label="Tìm bảng"
            className="h-8 w-full rounded-md border border-line bg-surface pl-8 pr-2 text-[13px]" />
        </label>
        <div role="tablist" aria-label="Lọc bảng" className="flex gap-1">
          {([["all", "Tất cả"], ["attention", "Cần chú ý"], ["chosen", "Đã chọn"]] as [Filter, string][]).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={filter === k} onClick={() => { setFilter(k); setLimit(PAGE); }}
              className={cx("rounded-full px-2.5 py-0.5 text-[12px]", filter === k ? "bg-navy text-white" : "bg-sunk text-ink-2 hover:bg-line")}>
              {l} <span className="num opacity-70">{counts[k]}</span>
            </button>
          ))}
        </div>
        <span className="ml-auto flex gap-1 text-[12px]">
          <button disabled={disabled} onClick={() => setAll(true)} className="rounded px-1.5 py-0.5 text-accent hover:bg-accent-soft disabled:opacity-40">Chọn {q || filter !== "all" ? "các bảng này" : "hết"}</button>
          <button disabled={disabled} onClick={() => setAll(false)} className="rounded px-1.5 py-0.5 text-muted hover:bg-sunk disabled:opacity-40">Bỏ chọn</button>
        </span>
      </div>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full text-[13px]">
          <thead className="bg-sunk text-left text-[12px] text-muted">
            <tr><th className="w-8 px-2 py-1.5" /><th className="py-1.5 pr-2 font-medium">Bảng</th><th className="px-2 py-1.5 font-medium">Khóa</th>
              <th className="px-2 py-1.5 font-medium">Cột mốc</th><th className="px-2 py-1.5 font-medium">Cách đồng bộ</th></tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={5} className="px-3 py-5 text-center text-[12.5px] text-muted">Không có bảng nào khớp.</td></tr>}
            {shown.slice(0, limit).map((t) => {
              const p = picks[t.name] ?? { on: false, cursor: null };
              const colType = (c: string) => t.columns.find((x) => x.name === c)?.type ?? "";
              const numeric = p.cursor && !/time|date/i.test(colType(p.cursor));
              return (
                <tr key={t.name} className={cx("border-t border-line align-top", !p.on && "text-muted")}>
                  <td className="px-2 py-2"><input type="checkbox" aria-label={`Đồng bộ ${t.name}`} checked={p.on} disabled={!t.readable || disabled}
                    onChange={(e) => onChange({ ...picks, [t.name]: { ...p, on: e.target.checked } })} /></td>
                  <td className="py-2 pr-2">
                    <span className="font-mono">{t.name}</span>
                    {synced && (synced.has(t.name) ? !p.on && <span className="ml-1.5 text-[11.5px] text-bad">sẽ xóa khỏi bản sao</span>
                      : p.on && <span className="ml-1.5 text-[11.5px] text-accent">mới</span>)}
                    <span className="block text-[11.5px] text-muted">{t.readable ? `khoảng ${num(t.rows_estimate)} dòng · ${t.columns.length} cột` : "role không có quyền SELECT"}</span>
                  </td>
                  <td className="px-2 py-2 font-mono text-[12px]">{t.primary_key.length ? t.primary_key.join(", ") : <span className="font-sans text-warn">không có khóa chính</span>}</td>
                  <td className="px-2 py-2">
                    <select aria-label={`Cột mốc của ${t.name}`} value={p.cursor ?? ""} disabled={!t.primary_key.length || !p.on || disabled}
                      onChange={(e) => onChange({ ...picks, [t.name]: { ...p, cursor: e.target.value || null } })}
                      className="h-8 max-w-[280px] rounded-md border border-line bg-surface px-1.5 font-mono text-[12px]">
                      <option value="">không dùng</option>
                      {t.cursor_candidates.map((c) => <option key={c} value={c}>{c} · {colType(c).replace(/ without time zone| with time zone/, "")}{c === t.suggested_cursor ? " (gợi ý)" : ""}</option>)}
                    </select>
                    {numeric && <span className="mt-0.5 block text-[11.5px] text-warn">chỉ đúng nếu bảng không sửa dòng cũ</span>}
                  </td>
                  <td className="px-2 py-2">
                    {!p.on ? "—" : p.cursor ? <Pill tone="good">Tăng dần</Pill>
                      : <span><Pill>Làm mới toàn bộ</Pill>{!t.primary_key.length && <span className="mt-0.5 block text-[11.5px] text-muted">tối đa 200.000 dòng</span>}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {shown.length > limit && (
        <button onClick={() => setLimit(limit + PAGE)} className="self-center rounded px-2 py-1 text-[12.5px] text-accent hover:bg-accent-soft">
          Xem thêm {Math.min(PAGE, shown.length - limit)} bảng ({num(shown.length - limit)} còn lại)
        </button>
      )}
    </div>
  );
}
