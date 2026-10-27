import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { cx } from "./ui";

const KW = new Set(("select from where join left right inner outer full cross on and or not in is null as group by order having limit " +
  "with case when then else end distinct asc desc nulls last first between like ilike union all exists true false interval cast").split(" "));
const FN = new Set("sum count avg min max coalesce date_trunc extract epoch row_number over partition".split(" "));

function tokens(line: string) {
  const out: { t: string; c?: string }[] = [];
  const re = /(--.*$)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|(.)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m[1]) out.push({ t: m[1], c: "cmt" });
    else if (m[2]) out.push({ t: m[2], c: "str" });
    else if (m[3]) out.push({ t: m[3], c: "numlit" });
    else if (m[4]) {
      const low = m[4].toLowerCase();
      out.push({ t: m[4], c: KW.has(low) ? "kw" : FN.has(low) ? "fn" : undefined });
    } else out.push({ t: m[0] });
  }
  return out;
}

/** So khớp từng dòng (LCS) để hiện khác biệt giữa hai lần thử. */
function lineDiff(a: string[], b: string[]): { line: string; kind: "same" | "add" | "del" }[] {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i].trim() === b[j].trim() ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { line: string; kind: "same" | "add" | "del" }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i].trim() === b[j].trim()) { out.push({ line: b[j], kind: "same" }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ line: a[i++], kind: "del" });
    else out.push({ line: b[j++], kind: "add" });
  }
  while (i < n) out.push({ line: a[i++], kind: "del" });
  while (j < m) out.push({ line: b[j++], kind: "add" });
  return out;
}

export function SqlView({ sql, previous, highlight, maxHeight = 360, className }:
  { sql: string; previous?: string; highlight?: string[]; maxHeight?: number; className?: string }) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => previous ? lineDiff(previous.split("\n"), sql.split("\n"))
    : sql.split("\n").map((line) => ({ line, kind: "same" as const })), [sql, previous]);
  const marks = (highlight ?? []).map((h) => h.toLowerCase()).filter(Boolean);

  const copy = async () => {
    try { await navigator.clipboard.writeText(sql); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* bỏ qua */ }
  };

  return (
    <div className={cx("group relative rounded-md border border-line bg-sunk", className)}>
      <button onClick={copy} className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded border border-line bg-surface px-1.5 py-0.5 text-[11.5px] text-muted opacity-0 transition-opacity hover:text-ink group-hover:opacity-100 focus:opacity-100">
        {copied ? <><Check size={12} /> Đã chép</> : <><Copy size={12} /> Chép SQL</>}
      </button>
      <pre className="sql scroll-thin overflow-auto py-2 font-mono text-[12.5px] leading-[1.6]" style={{ maxHeight }}>
        {lines.map((l, idx) => {
          const hit = marks.some((mk) => l.line.toLowerCase().includes(mk));
          return (
            <div key={idx} className={cx("flex px-3", l.kind === "add" && "diff-add", l.kind === "del" && "diff-del")}>
              <span className="mr-3 w-4 shrink-0 select-none text-right text-faint">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : ""}</span>
              <span className={cx("whitespace-pre", hit && "hl")}>
                {tokens(l.line).map((t, k) => <span key={k} className={t.c}>{t.t}</span>)}
              </span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}
