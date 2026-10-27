export type Verdict = "green" | "yellow" | "red" | "blocked" | "unchecked";
export type Role = "viewer" | "engineer";

export interface User { id: number; email: string; name: string }
export interface DatabaseRef {
  id: number; name: string; description: string; role: Role; can_certify: boolean;
  granted_via: "direct" | "link"; expires_at: string | null; expired: boolean;
  catalog_only: boolean; // chỉ duyệt danh mục và lineage, agent chưa hỏi được
  has_source: boolean; // dữ liệu được đồng bộ từ một Postgres/MySQL bên ngoài
  granted_by_name: string | null; // người cấp quyền (chia sẻ trực tiếp hoặc tạo link)
}

export interface Finding {
  rule: string; title: string; severity: "high" | "medium" | "low" | "info";
  message_vi: string; evidence: string; fix: Record<string, unknown> | null;
}

export interface FilterFp { column: string; op: string; value: unknown; sql: string; clause: string; raw?: string[] }
export interface Fingerprint {
  tables: string[]; measures: { agg: string; distinct: boolean; columns: string[]; sql: string }[];
  filters: FilterFp[]; joins: { left: string; right: string; sql: string }[];
  group_by: { columns: string[]; sql: string }[]; time_columns: string[];
  measure_columns: string[]; raw_sources: string[]; column_raw?: Record<string, string[]>;
  outputs?: { name: string; aggregated: boolean; columns: string[] }[];
}
export interface RunLineage {
  measures: { column: string; raw: string[] }[]; measure_sql: string[]; filters: FilterFp[];
  joins: { left: string; right: string; sql: string }[]; group_by: { columns: string[]; sql: string; raw?: string[] }[];
  tables: string[]; time_columns: string[];
}
export interface TraceStep { step: string; ms: number; kind?: string; tokens?: number; input?: string; output?: string; verdict?: string; rules?: string[]; attempt?: number; rows?: number; status?: string; max_diff_pct?: number }
export interface Reconciliation { status: "match" | "mismatch" | "same_sql" | "error" | "no_definition"; max_diff_pct?: number; reference_sql?: string; rows_compared?: number; missing_keys?: unknown[][] }
export interface Verification {
  verdict: Verdict; blocked_reason: string | null; findings: Finding[]; fingerprint: Fingerprint | null;
  executable: boolean; elapsed_ms: number; metric_id: string | null; metric_status: string | null;
}
export interface Attempt {
  no: number; sql: string; source: "llm" | "fix" | "verified" | "user" | "metric"; verdict: Verdict;
  verification: Verification; notes: string[]; fix_notes: string[]; latency_ms: number; lineage: RunLineage | null;
}
export interface ResultColumn { key: string; label: string; kind: "dimension" | "measure"; format: string | null; unit: string | null }
export interface Answer {
  text: string; headline: string | null; headline_note?: string; columns?: ResultColumn[]; assumptions?: string[];
  reconciliation?: Reconciliation | null;
}
export interface MetricAlt { id: string; name_vi: string; status: string }
export interface Interpretation {
  kind: "metric" | "definition" | "sql" | "out_of_scope" | "adhoc" | "empty"; metric_id?: string; metric_name?: string;
  metric_status?: string; chips: string[]; carried?: boolean; suggestions?: string[]; detected?: boolean;
  time?: { label: string } | null; dimension?: string | null; matched_text?: string | null;
  alternatives?: MetricAlt[]; overridden?: boolean;
}
export interface MetricLite {
  id: string; name_vi: string; description: string; status: string; version: number; format: string;
  unit: string; time_column: string; canonical_sql: string; required_filters: { column: string; op: string; value: unknown }[];
}
export interface Run {
  id: string; question: string; input_kind: "question" | "sql"; intent: string; interpretation: Interpretation | null;
  status: "answered" | "checked" | "held" | "refused" | "blocked" | "definition" | "error";
  final_verdict: Verdict | null; final_sql: string | null; answer: Answer | null;
  result: { columns: string[]; rows: unknown[][]; truncated: boolean } | null; masked_columns?: string[];
  usage: { llm: string; model?: string; tokens: number; latency_ms: number; steps?: TraceStep[] } | null; review_status: string;
  feedback: { correct: boolean; note?: string; by?: string } | null; created_at: string; user_name: string | null;
  request_id?: string | null; metric: MetricLite | null; attempts: Attempt[];
  lineage: RunLineage | null;
  reviews: { decision: string; reason: string | null; edited_sql: string | null; decided_at: string; reviewer: string }[];
}
export interface RunLite {
  id: string; question: string; input_kind: string; status: string; final_verdict: Verdict | null;
  metric_id: string | null; review_status: string; created_at: string; headline: string | null; user_name?: string;
  feedback?: { correct: boolean } | null; recon_status?: string | null;
}
