import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { SqlView } from "../components/Sql";
import { Button, cx, ErrorNote, fmtDate, Pill } from "../components/ui";
import { useSession } from "../session";

interface RuleRow { rule: string; title: string; default_severity: string; enabled: boolean; severity: string }
interface SettingsData {
  rules: RuleRow[];
  llm: {
    provider: string; model: string; default_model: string; base_url: string | null; supported: string[]; planned: string[];
    models: { id: string; label: string; price_in: number; price_out: number }[];
    limits: { max_steps: number; max_tokens: number; max_fix_rounds: number };
  };
  execution: { timeout_ms: number; max_rows: number };
}
interface VQ { id: number; question: string; sql: string; metric_id: string | null; active: boolean; inactive_reason: string | null; created_at: string; approved_by_name: string }

const SEV = [["high", "Cao"], ["medium", "Trung bình"], ["low", "Thấp"]] as const;
const SEV_ON: Record<string, string> = { high: "bg-[oklch(0.52_0.18_25)] text-white", medium: "bg-[oklch(0.58_0.13_70)] text-white", low: "bg-neutral-solid text-white" };
const nf = (n: number) => n.toLocaleString("vi-VN");

/** Một nhóm cài đặt: cột trái là tên + giải thích, cột phải là nội dung. */
function Group({ title, note, children }: { title: string; note: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-wrap gap-x-10 gap-y-4 border-t border-line py-6">
      <div className="flex flex-[0_0_200px] flex-col gap-1.5">
        <h4 className="text-[14px] font-medium">{title}</h4>
        <p className="text-[12.5px] leading-relaxed text-faint">{note}</p>
      </div>
      <div className="flex min-w-0 flex-[1_1_460px] flex-col gap-2.5">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
  const { db } = useSession();
  const canEdit = db?.role === "engineer" && db.granted_via === "direct";
  const [data, setData] = useState<SettingsData | null>(null);
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [vq, setVq] = useState<VQ[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    if (!db) return;
    api<SettingsData>(`/db/${db.id}/settings`).then((d) => { setData(d); setRules(d.rules); }).catch((e) => setError(e.message));
    api<VQ[]>(`/db/${db.id}/verified-queries`).then(setVq).catch(() => {});
  }, [db]);
  useEffect(load, [load]);

  const dirty = !!data && JSON.stringify(rules) !== JSON.stringify(data.rules);
  const save = async () => {
    if (!db) return;
    setError(null);
    try {
      const d = await api<SettingsData>(`/db/${db.id}/settings/rules`, { method: "PUT", body: { rules } });
      setData(d); setRules(d.rules); setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e) { setError(e instanceof Error ? e.message : "Không lưu được."); }
  };
  const saveModel = async (model: string) => {
    if (!db || !canEdit || model === data?.llm.model) return;
    setError(null);
    try { const d = await api<SettingsData>(`/db/${db.id}/settings/llm`, { method: "PUT", body: { model } }); setData(d); }
    catch (e) { setError(e instanceof Error ? e.message : "Không lưu được."); }
  };
  const update = (rule: string, patch: Partial<RuleRow>) => setRules((rs) => rs.map((r) => (r.rule === rule ? { ...r, ...patch } : r)));
  const sevLabel = (v: string) => SEV.find((s) => s[0] === v)?.[1] ?? v;

  const limits: [string, number, string][] = data ? [
    ["Bước tối đa mỗi câu", data.llm.limits.max_steps, "bước"],
    ["Token tối đa mỗi câu", data.llm.limits.max_tokens, "token"],
    ["Số vòng tự sửa", data.llm.limits.max_fix_rounds, "vòng"],
    ["Timeout truy vấn", data.execution.timeout_ms / 1000, "giây"],
    ["Số dòng trả về tối đa", data.execution.max_rows, "dòng"],
  ] : [];

  return (
    <div className="flex h-full flex-col">
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-7 pb-6">
        <p className="py-5 text-[13px] text-muted">
          Áp cho riêng database {db?.name.split(" · ")[0]}. Mọi thay đổi luật được ghi vào nhật ký.
          {!canEdit && " Chỉ engineer được gán trực tiếp mới đổi được."}
          {saved && <span className="ml-2 text-good">Đã lưu.</span>}
        </p>
        <ErrorNote>{error}</ErrorNote>

        <Group title="Luật kiểm định" note="Cao làm câu trả lời Đỏ và kích hoạt tự sửa. Trung bình cho Vàng. Thấp chỉ ghi chú. Trang Đánh giá luôn dùng cấu hình mặc định.">
          <div className="flex flex-col">
            {rules.map((r) => (
              <div key={r.rule} className="grid grid-cols-[40px_minmax(0,1fr)_auto_30px] items-center gap-3 border-b border-line-soft py-[7px]">
                <span className={cx("font-mono text-[12px] text-faint", !r.enabled && "opacity-45")}>{r.rule}</span>
                <span className={cx("flex min-w-0 flex-col gap-px", !r.enabled && "opacity-45")}>
                  <span className="text-[13px] text-ink">{r.title}</span>
                  {r.severity !== r.default_severity && <span className="text-[11.5px] text-warn">đã đổi · mặc định {sevLabel(r.default_severity)}</span>}
                </span>
                <div className={cx("flex gap-0.5 rounded-md border border-raised p-0.5", !r.enabled && "opacity-45")} role="radiogroup" aria-label={`Mức độ ${r.rule}`}>
                  {SEV.map(([v, l]) => (
                    <button key={v} role="radio" aria-checked={r.severity === v} disabled={!canEdit || !r.enabled} onClick={() => update(r.rule, { severity: v })}
                      className={cx("h-6 whitespace-nowrap rounded px-[9px] text-[12px] disabled:cursor-not-allowed", r.severity === v ? SEV_ON[v] : "text-dim enabled:hover:text-ink-2")}>{l}</button>
                  ))}
                </div>
                <button role="switch" aria-checked={r.enabled} aria-label={`Bật ${r.rule}`} title="Bật/tắt" disabled={!canEdit}
                  onClick={() => update(r.rule, { enabled: !r.enabled })} data-on={r.enabled}
                  className="lv-switch cursor-pointer data-[on=true]:bg-accent disabled:cursor-not-allowed" />
              </div>
            ))}
          </div>
        </Group>

        {data && (
          <Group title="Mô hình ngôn ngữ" note={<>Model thật (OpenAI-compatible: OpenRouter, Ollama) bật bằng biến môi trường, không cần sửa code. Đang dùng: <span className="font-mono">{data.llm.provider}</span>.</>}>
            <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))]" role="radiogroup" aria-label="Chọn model">
              {data.llm.models.map((m) => {
                const on = data.llm.model === m.id;
                return (
                  <button key={m.id} role="radio" aria-checked={on} disabled={!canEdit} onClick={() => saveModel(m.id)}
                    className={cx("flex flex-col gap-1 rounded-lg border p-3 text-left disabled:cursor-not-allowed", on ? "border-accent bg-selected" : "border-line-strong enabled:hover:bg-hover")}>
                    <span className="flex w-full items-center gap-2">
                      <span className="flex-1 font-mono text-[13px] text-ink">{m.id}</span>
                      <span className={cx("grid size-3.5 place-items-center rounded-full border", on ? "border-accent" : "border-line-strong")}>
                        {on && <span className="size-1.5 rounded-full bg-accent" />}
                      </span>
                    </span>
                    <span className="text-[12.5px] text-ink-2">{m.label}</span>
                    <span className="text-[11.5px] text-faint">giá tham khảo {m.price_in.toLocaleString("vi-VN", { maximumFractionDigits: 6 })} / {m.price_out.toLocaleString("vi-VN", { maximumFractionDigits: 6 })} USD mỗi 1.000 token vào / ra</span>
                  </button>
                );
              })}
            </div>
            <code className="font-mono text-[11.5px] leading-[1.7] text-faint">LVDA_LLM_PROVIDER · LVDA_LLM_BASE_URL · LVDA_LLM_API_KEY</code>
          </Group>
        )}

        {data && (
          <Group title="Giới hạn" note="Áp cho mỗi câu hỏi. Đặt ở cấu hình máy chủ, chung cho mọi database.">
            <div className="flex flex-col">
              {limits.map(([k, v, unit]) => (
                <div key={k} className="flex items-center gap-4 border-b border-line-soft py-[9px]">
                  <span className="flex-1 text-[13px] text-ink">{k}</span>
                  <span className="num grid h-[30px] w-[76px] place-items-center rounded-md border border-line-strong bg-paper text-[13px] text-accent">{nf(v)}</span>
                  <span className="w-11 shrink-0 text-[12px] text-faint">{unit}</span>
                </div>
              ))}
            </div>
          </Group>
        )}

        <Group title="Truy vấn mẫu đã duyệt" note="Dùng làm ví dụ cho LLM khi gặp câu hỏi tương tự.">
          {vq.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line-strong p-5 text-center text-[13px] text-faint">Chưa có. Duyệt một câu trả lời ở trang Đánh giá để tạo truy vấn mẫu.</div>
          ) : (
            <ul className="flex flex-col">
              {vq.map((v) => (
                <li key={v.id} className="border-b border-line-soft last:border-b-0">
                  <button onClick={() => setOpen(open === v.id ? null : v.id)} className="flex w-full items-center gap-3 py-2.5 text-left hover:text-ink">
                    <span className="flex-1 text-[13px] text-ink-2">{v.question}</span>
                    {v.active ? <Pill tone="good">đang dùng</Pill> : <Pill tone="warn">tạm ẩn</Pill>}
                    <span className="whitespace-nowrap text-[12px] text-faint">{v.approved_by_name} · {fmtDate(v.created_at)}</span>
                  </button>
                  {open === v.id && (
                    <div className="pb-3">
                      {v.inactive_reason && <p className="mb-2 text-[12.5px] text-warn">{v.inactive_reason}</p>}
                      <SqlView sql={v.sql} maxHeight={220} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Group>
      </div>
      {dirty && canEdit && (
        <div className="flex shrink-0 items-center gap-2 border-t border-line-strong bg-selected px-7 py-3">
          <span className="flex-1 text-[13px] text-ink-2">Có thay đổi chưa lưu</span>
          <Button onClick={() => data && setRules(data.rules)}>Hủy</Button>
          <Button variant="primary" onClick={save}>Lưu thay đổi</Button>
        </div>
      )}
    </div>
  );
}
