import { ArrowRight, CornerDownRight, Database, Filter, Sigma } from "lucide-react";
import { describeFilter } from "../format";
import type { Attempt, FilterFp, Finding, Run } from "../types";
import { cx, shortCol, VERDICT_META } from "./ui";

function Col({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="min-w-[150px] flex-1">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">{icon}{title}</div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function Token({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "accent" | "filter" | "join" }) {
  const cls = { plain: "bg-sunk text-ink-2", accent: "bg-accent-soft text-accent", filter: "bg-warn-soft/70 text-ink", join: "bg-sunk text-ink-2" }[tone];
  return <span className={cx("w-fit max-w-full break-all rounded px-1.5 py-0.5 font-mono text-[11.5px] leading-snug", cls)}>{children}</span>;
}

/** Gộp cặp >= / < trên cùng một cột thành một khoảng thời gian. */
function conditionLabels(filters: FilterFp[]): string[] {
  const out: string[] = [];
  const used = new Set<number>();
  filters.forEach((f, i) => {
    if (used.has(i) || f.op === "expr") return;
    if (f.op === ">=") {
      const j = filters.findIndex((g, k) => k !== i && !used.has(k) && g.column === f.column && g.op === "<");
      if (j >= 0) {
        used.add(i); used.add(j);
        out.push(`${shortCol(f.column)} ∈ [${String(f.value)}, ${String(filters[j].value)})`);
        return;
      }
    }
    used.add(i);
    out.push(describeFilter(f));
  });
  return out;
}

const Arrow = () => <ArrowRight className="mt-6 hidden shrink-0 text-faint md:block" size={16} aria-hidden />;

/** Chuỗi bằng chứng: cột raw → cột mart → phép đo → điều kiện → kết quả. */
export function LineageChain({ run }: { run: Run }) {
  const ln = run.lineage;
  if (!ln) return <p className="text-muted">Không dựng được lineage cho câu SQL này.</p>;
  const raw = Array.from(new Set(ln.measures.flatMap((m) => m.raw)));
  const conditions = conditionLabels(ln.filters);
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-3">
      <Col title="Nguồn gốc" icon={<Database size={12} />}>
        {raw.length ? raw.map((r) => <Token key={r}>{r}</Token>) : <span className="text-[12px] text-muted">—</span>}
      </Col>
      <Arrow />
      <Col title="Cột mart" icon={<CornerDownRight size={12} />}>
        {ln.measures.length ? ln.measures.map((m) => <Token key={m.column} tone="accent">{shortCol(m.column)}</Token>) : <span className="text-[12px] text-muted">—</span>}
      </Col>
      <Arrow />
      <Col title="Phép đo" icon={<Sigma size={12} />}>
        {ln.measure_sql.slice(0, 3).map((s, i) => <Token key={i}>{s}</Token>)}
      </Col>
      <Arrow />
      <Col title="Điều kiện" icon={<Filter size={12} />}>
        {conditions.map((c, i) => <Token key={i} tone="filter">{c}</Token>)}
        {ln.joins.map((j, i) => <Token key={`j${i}`} tone="join">⋈ {shortCol(j.left)} = {shortCol(j.right)}</Token>)}
        {ln.group_by.map((g, i) => <Token key={`g${i}`}>chia theo {g.sql}</Token>)}
        {!conditions.length && !ln.joins.length && !ln.group_by.length && <span className="text-[12px] text-muted">Không có</span>}
      </Col>
    </div>
  );
}

const SEV_LABEL: Record<string, string> = { high: "Cao", medium: "Trung bình", low: "Thấp", info: "Ghi chú" };
const SEV_TONE: Record<string, string> = { high: "text-bad", medium: "text-warn", low: "text-muted", info: "text-muted" };

/** Một dòng phiếu kiểm: loại · mã luật · nội dung. */
function FindingRow({ kind, tone, code, children }: { kind: string; tone: string; code: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_48px_minmax(0,1fr)] items-baseline gap-3 border-b border-line-soft py-2.5 text-[13px] last:border-b-0">
      <span className={cx("text-[12px]", tone)}>{kind}</span>
      <span className="font-mono text-[12px] text-muted">{code}</span>
      <div className="leading-normal text-ink-2">{children}</div>
    </div>
  );
}

export function FindingsList({ findings, compact = false, fixes = [], notes: extra = [] }: { findings: Finding[]; compact?: boolean; fixes?: { rule: string; text: string }[]; notes?: string[] }) {
  const real = findings.filter((f) => f.severity !== "info");
  const notes = findings.filter((f) => f.severity === "info");
  if (!findings.length && !fixes.length && !extra.length) return <p className="py-2 text-[13px] text-good">Không có phát hiện nào. Câu SQL khớp định nghĩa và các luật chung.</p>;
  return (
    <div className="flex flex-col">
      {real.map((f, i) => (
        <FindingRow key={i} kind={SEV_LABEL[f.severity]} tone={SEV_TONE[f.severity]} code={f.rule}>
          <span className="text-ink">{f.title}.</span> {f.message_vi}
          {!compact && f.evidence && <code className="mt-1.5 block w-fit max-w-full truncate rounded bg-paper px-1.5 py-0.5 font-mono text-[11.5px] text-muted">{f.evidence}</code>}
        </FindingRow>
      ))}
      {extra.map((n, i) => <FindingRow key={`x${i}`} kind="Lưu ý" tone="text-warn" code="—">{n}</FindingRow>)}
      {notes.map((f, i) => <FindingRow key={`n${i}`} kind="Ghi chú" tone="text-muted" code={f.rule || "—"}>{f.message_vi}</FindingRow>)}
      {fixes.map((f, i) => <FindingRow key={`f${i}`} kind="Đã sửa" tone="text-good" code={f.rule}>{f.text}</FindingRow>)}
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = { llm: "LLM viết", fix: "Tự sửa", verified: "Truy vấn mẫu", user: "Bạn nhập", metric: "SQL chuẩn" };
const DOT: Record<string, string> = { green: "bg-good", yellow: "bg-warn", red: "bg-bad", blocked: "bg-bad" };

/** Các lần thử trên một dòng: Lần 0 · LLM viết · Đỏ V05 → Lần 1 · Tự sửa · Xanh. Bấm để xem lần đó. */
export function AttemptChips({ attempts, active, onSelect }: { attempts: Attempt[]; active: number; onSelect: (n: number) => void }) {
  return (
    <ol className="flex flex-wrap items-center gap-2.5" aria-label="Các lần thử">
      {attempts.map((a, i) => {
        const meta = VERDICT_META[a.verdict] ?? VERDICT_META.unchecked;
        const rules = a.verification.findings.filter((f) => f.severity !== "info");
        return (
          <li key={a.no} className="flex items-center gap-2.5">
            {i > 0 && <ArrowRight size={14} className="text-dim" aria-hidden />}
            <button onClick={() => onSelect(i)} aria-pressed={active === i}
              className={cx("flex items-center gap-1.5 whitespace-nowrap rounded-[5px] border px-2 py-[3px] text-[12px] transition-colors",
                active === i ? "border-[#44485f] text-ink" : "border-raised text-faint hover:text-ink-2")}>
              <span className={cx("size-1.5 rounded-full", DOT[a.verdict] ?? "bg-line-strong")} />
              Lần {a.no} · {SOURCE_LABEL[a.source] ?? a.source} · {meta.label}
              {rules.slice(0, 3).map((f) => <span key={f.rule} className={cx("font-mono", f.severity === "high" ? "text-bad" : f.severity === "medium" ? "text-warn" : "text-muted")}>{f.rule}</span>)}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function AttemptDetail({ attempt, previous }: { attempt: Attempt; previous?: Attempt }) {
  // lần trước bị luật nào thì ghi "Đã sửa" kèm mã luật đó
  const prevRules = previous?.verification.findings.filter((f) => f.severity !== "info").map((f) => f.rule) ?? [];
  const fixes = (previous?.fix_notes ?? []).map((text, i) => ({ rule: prevRules[i] ?? prevRules[0] ?? "—", text }));
  return <FindingsList findings={attempt.verification.findings} fixes={fixes} notes={attempt.notes} />;
}
