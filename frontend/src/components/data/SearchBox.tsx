import { Columns3, Search, Table2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api";
import { colPath, tablePath, type SearchItem, type SearchRes } from "../../explore";
import { useSession } from "../../session";
import { cx } from "../ui";

/** Tìm bảng hoặc cột: kết quả do backend xếp hạng (khớp tên, mô tả, mức agent dùng), có điều hướng bàn phím. */
export function SearchBox({ autoFocus = false }: { autoFocus?: boolean }) {
  const { db } = useSession();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchRes | null>(null);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!db || !q.trim()) { setRes(null); return; }
    const t = setTimeout(() => {
      api<SearchRes>(`/db/${db.id}/explore/search?q=${encodeURIComponent(q.trim())}&limit=12`).then((r) => { setRes(r); setActive(0); }).catch(() => {});
    }, 150);
    return () => clearTimeout(t);
  }, [db, q]);

  // phím "/" ở bất kỳ đâu trên trang Dữ liệu để nhảy vào ô tìm
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") { e.preventDefault(); box.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const open = (i: SearchItem) => {
    setQ(""); setRes(null);
    nav(i.kind === "column" ? colPath(`${i.name}.${i.column}`) : tablePath(i.name));
  };
  const items = res?.items ?? [];
  const tables = items.filter((i) => i.kind === "table");
  const columns = items.filter((i) => i.kind === "column");
  const ordered = [...tables, ...columns];

  const row = (i: SearchItem) => {
    const idx = ordered.indexOf(i);
    return (
      <li key={`${i.name}.${i.kind === "column" ? i.column : ""}`}>
        <button onMouseEnter={() => setActive(idx)} onClick={() => open(i)}
          className={cx("flex w-full flex-col px-3 py-1.5 text-left", idx === active ? "bg-accent-soft" : "hover:bg-sunk")}>
          <span className="flex items-center gap-1.5">
            {i.kind === "column" ? <Columns3 size={13} className="shrink-0 text-faint" /> : <Table2 size={13} className="shrink-0 text-faint" />}
            <span className={cx("font-mono text-[12.5px]", i.deprecated && "line-through decoration-faint")}>{i.kind === "column" ? i.column : i.name}</span>
            {i.kind === "column" && <span className="truncate font-mono text-[11px] text-muted">trong {i.name}</span>}
            {(i.kind === "column" ? i.pii : i.pii > 0) && <span className="rounded bg-warn-soft px-1 text-[10px] text-warn">PII</span>}
            <span className="ml-auto shrink-0 text-[11px] text-muted">{i.domain_label}{i.uses ? ` · ${i.uses} câu hỏi` : ""}</span>
          </span>
          {i.description && <span className="line-clamp-1 pl-[19px] text-[11.5px] text-muted">{i.description}</span>}
        </button>
      </li>
    );
  };

  return (
    <div className="relative w-full max-w-[520px] flex-1">
      <label className="flex items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 py-1.5 focus-within:border-accent">
        <Search size={15} className="text-faint" />
        <input ref={box} value={q} autoFocus={autoFocus} onChange={(e) => setQ(e.target.value)} role="combobox" aria-expanded={!!res}
          aria-label="Tìm bảng hoặc cột" placeholder="Tìm bảng, cột hoặc mô tả (không cần dấu) · phím /"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, ordered.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === "Enter" && ordered[active]) open(ordered[active]);
            if (e.key === "Escape") { setQ(""); setRes(null); }
          }}
          className="w-full bg-transparent text-[13.5px] outline-none" />
        {q && <button onClick={() => { setQ(""); setRes(null); }} className="rounded p-0.5 text-muted hover:bg-sunk" aria-label="Xóa từ khóa"><X size={14} /></button>}
      </label>
      {res && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[440px] overflow-y-auto rounded-md border border-line bg-surface py-1 shadow-lg">
          {res.total === 0 && <p className="px-3 py-3 text-[12.5px] text-muted">Không tìm thấy. Thử từ khóa ngắn hơn hoặc tên cột.</p>}
          {tables.length > 0 && <><div className="px-3 pb-0.5 pt-1.5 text-[10.5px] font-medium uppercase tracking-wider text-faint">Bảng</div><ul>{tables.map(row)}</ul></>}
          {columns.length > 0 && <><div className="px-3 pb-0.5 pt-1.5 text-[10.5px] font-medium uppercase tracking-wider text-faint">Cột</div><ul>{columns.map(row)}</ul></>}
          {res.total > items.length && (
            <button onClick={() => { const t = q.trim(); setQ(""); setRes(null); nav(`/data?q=${encodeURIComponent(t)}`); }}
              className="w-full border-t border-line px-3 py-2 text-left text-[12.5px] text-accent hover:bg-sunk">Xem tất cả {res.total} kết quả</button>
          )}
        </div>
      )}
    </div>
  );
}
