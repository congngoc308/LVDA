import { ArrowRight, CornerDownRight, Database, Filter, GitMerge, Sigma, Wrench } from "lucide-react";
import { describeFilter } from "../format";
import type { Attempt, FilterFp, Finding, Run } from "../types";
import { cx, RuleChip, shortCol, VERDICT_META, VerdictStamp } from "./ui";

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

export function FindingsList({ findings, compact = false }: { findings: Finding[]; compact?: boolean }) {
  const real = findings.filter((f) => f.severity !== "info");
  const notes = findings.filter((f) => f.severity === "info");
  if (!findings.length) return <p className="text-[13px] text-good">Không có phát hiện nào. Câu SQL khớp định nghĩa và các luật chung.</p>;
  return (
    <div className="flex flex-col gap-2">
      {real.map((f, i) => (
        <div key={i} className={cx("rounded-md border px-3 py-2", f.severity === "high" ? "border-bad/25 bg-bad-soft/40" : f.severity === "medium" ? "border-warn/30 bg-warn-soft/40" : "border-line")}>
          <div className="flex flex-wrap items-center gap-2">
            <RuleChip rule={f.rule} severity={f.severity} />
            <span className="font-medium">{f.title}</span>
            <span className="text-[12px] text-muted">· mức {SEV_LABEL[f.severity]}</span>
          </div>
          <p className="mt-1 text-[13px] text-ink-2">{f.message_vi}</p>
          {!compact && f.evidence && <code className="mt-1.5 block w-fit max-w-full truncate rounded bg-surface px-1.5 py-0.5 font-mono text-[11.5px] text-ink-2 ring-1 ring-line">{f.evidence}</code>}
        </div>
      ))}
      {notes.map((f, i) => (
        <div key={`n${i}`} className="flex items-start gap-2 text-[13px] text-ink-2">
          <RuleChip rule={f.rule} severity="info" /><span>{f.message_vi}</span>
        </div>
      ))}
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = { llm: "LLM viết", fix: "Tự sửa", verified: "Truy vấn mẫu", user: "Bạn nhập" };

/** Dòng thời gian các lần thử: mỗi lần là một bước có phán quyết và các luật vi phạm. */
export function AttemptTimeline({ attempts, active, onSelect }: { attempts: Attempt[]; active: number; onSelect: (n: number) => void }) {
  return (
    <ol className="flex flex-wrap items-stretch gap-2" aria-label="Các lần thử">
      {attempts.map((a, i) => {
        const meta = VERDICT_META[a.verdict] ?? VERDICT_META.unchecked;
        const rules = a.verification.findings.filter((f) => f.severity !== "info");
        return (
          <li key={a.no} className="flex items-center gap-2">
            {i > 0 && <span className="flex items-center gap-1 text-[11.5px] text-muted"><Wrench size={12} /> sửa</span>}
            <button onClick={() => onSelect(i)} aria-pressed={active === i}
              className={cx("flex min-w-[148px] flex-col items-start gap-1 rounded-md border px-2.5 py-1.5 text-left transition-colors",
                active === i ? "border-ink/60 bg-surface shadow-sm" : "border-line bg-sunk/60 hover:bg-surface")}>
              <span className="flex w-full items-center justify-between gap-2 text-[11.5px] text-muted">
                <span>Lần {a.no} · {SOURCE_LABEL[a.source] ?? a.source}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1">
                <VerdictStamp verdict={a.verdict} size="sm" />
                {rules.slice(0, 3).map((f) => <RuleChip key={f.rule} rule={f.rule} severity={f.severity} />)}
                {rules.length === 0 && <span className={cx("text-[11.5px]", meta.cls.split(" ")[0])}>không lỗi</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function AttemptDetail({ attempt, previous }: { attempt: Attempt; previous?: Attempt }) {
  return (
    <div className="flex flex-col gap-3">
      {(attempt.notes.length > 0 || (previous?.fix_notes.length ?? 0) > 0) && (
        <ul className="flex flex-col gap-1 text-[13px]">
          {attempt.notes.map((n, i) => <li key={i} className="text-warn">• {n}</li>)}
          {previous?.fix_notes.map((n, i) => <li key={`f${i}`} className="text-ink-2"><GitMerge size={12} className="mr-1 inline text-good" />{n}</li>)}
        </ul>
      )}
      <FindingsList findings={attempt.verification.findings} />
    </div>
  );
}
