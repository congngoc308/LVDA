function viNumber(v: number, decimals: number) {
  return v.toLocaleString("vi-VN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatValue(v: unknown, fmt?: string | null, unit?: string | null): string {
  if (v === null || v === undefined) return "—";
  if (typeof v !== "number") return String(v);
  switch (fmt) {
    case "currency": return `${viNumber(v, 2)} ${unit || "BRL"}`;
    case "percent": return `${viNumber(v * 100, 1)}%`;
    case "integer": return viNumber(v, 0);
    case "days": return `${viNumber(v, 1)} ngày`;
    case "score": return `${viNumber(v, 2)} / 5`;
    default: return viNumber(v, Number.isInteger(v) ? 0 : 2);
  }
}

export function formatDim(v: unknown): string {
  if (v === null || v === undefined) return "(không có)";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return `${Number(s.slice(5, 7))}/${s.slice(0, 4)}`;
  return s;
}

export function describeFilter(f: { column: string; op: string; value: unknown }) {
  const col = f.column.startsWith("mart.") ? f.column.slice(5) : f.column;
  const one = (x: unknown) => (typeof x === "string" ? `'${x}'` : typeof x === "boolean" ? (x ? "TRUE" : "FALSE") : String(x));
  if (f.op === "expr") return col;
  if (f.op === "is null" || f.op === "is not null") return `${col} ${f.op.toUpperCase()}`;
  if (Array.isArray(f.value)) {
    if (f.op === "between") return `${col} BETWEEN ${one(f.value[0])} AND ${one(f.value[1])}`;
    return `${col} ${f.op.toUpperCase()} (${f.value.map(one).join(", ")})`;
  }
  return `${col} ${f.op.toUpperCase()} ${one(f.value)}`;
}

export function toCsv(columns: string[], rows: unknown[][]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}
