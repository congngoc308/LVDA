import { Bot, Gauge, ListChecks, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { SqlView } from "../components/Sql";
import { Button, Card, cx, ErrorNote, fmtDate, PageHeader, Pill, RuleChip } from "../components/ui";
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

  const dirty = data && JSON.stringify(rules) !== JSON.stringify(data.rules);
  const save = async () => {
    if (!db) return;
    setError(null);
    try {
      const d = await api<SettingsData>(`/db/${db.id}/settings/rules`, { method: "PUT", body: { rules } });
      setData(d); setRules(d.rules); setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e) { setError(e instanceof Error ? e.message : "Không lưu được."); }
  };
  const saveModel = async (model: string) => {
    if (!db) return;
    setError(null);
    try { const d = await api<SettingsData>(`/db/${db.id}/settings/llm`, { method: "PUT", body: { model } }); setData(d); }
    catch (e) { setError(e instanceof Error ? e.message : "Không lưu được."); }
  };
  const update = (rule: string, patch: Partial<RuleRow>) => setRules((rs) => rs.map((r) => (r.rule === rule ? { ...r, ...patch } : r)));

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Cài đặt" subtitle="Áp cho riêng database này. Mọi thay đổi luật được ghi vào nhật ký." />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1000px] flex-col gap-6 p-8">
          <ErrorNote>{error}</ErrorNote>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
              <div className="flex items-center gap-2 font-semibold"><ListChecks size={17} /> Luật kiểm định</div>
              <div className="flex items-center gap-2">
                {saved && <span className="text-[12.5px] text-good">Đã lưu</span>}
                {canEdit && <Button size="sm" variant="primary" disabled={!dirty} onClick={save}><Save size={14} /> Lưu thay đổi</Button>}
              </div>
            </div>
            {!canEdit && <p className="border-b border-line bg-sunk px-5 py-2 text-[12.5px] text-muted">Chỉ engineer được gán trực tiếp mới đổi được luật.</p>}
            <table className="w-full text-[13.5px]">
              <thead className="bg-sunk text-left text-[12px] text-muted">
                <tr><th className="px-5 py-2 font-medium">Luật</th><th className="px-3 py-2 font-medium">Bật</th><th className="px-3 py-2 font-medium">Mức độ</th><th className="px-3 py-2 font-medium">Mặc định</th></tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.rule} className={cx("border-t border-line", !r.enabled && "text-faint")}>
                    <td className="px-5 py-2"><span className="inline-flex items-center gap-2"><RuleChip rule={r.rule} severity={r.enabled ? r.severity : "low"} />{r.title}</span></td>
                    <td className="px-3 py-2"><input type="checkbox" disabled={!canEdit} checked={r.enabled} onChange={(e) => update(r.rule, { enabled: e.target.checked })} aria-label={`Bật ${r.rule}`} /></td>
                    <td className="px-3 py-2">
                      <select disabled={!canEdit || !r.enabled} value={r.severity} onChange={(e) => update(r.rule, { severity: e.target.value })} aria-label={`Mức độ ${r.rule}`}
                        className="rounded border border-line bg-surface px-1.5 py-1 text-[13px]">
                        {SEV.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-[12.5px] text-muted">{SEV.find((s) => s[0] === r.default_severity)?.[1]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-line px-5 py-2.5 text-[12.5px] text-muted">Mức Cao làm câu trả lời Đỏ và kích hoạt tự sửa; Trung bình cho Vàng; Thấp chỉ ghi chú. Trang Đánh giá luôn dùng cấu hình mặc định để số liệu so được giữa các lần chạy.</p>
          </Card>

          {data && (
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="p-5">
                <div className="mb-3 flex items-center gap-2 font-semibold"><Bot size={17} /> Mô hình ngôn ngữ</div>
                <div role="radiogroup" aria-label="Chọn model" className="flex flex-col gap-2">
                  {data.llm.models.map((m) => (
                    <label key={m.id} className={cx("flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2",
                      data.llm.model === m.id ? "border-accent bg-accent-soft/50" : "border-line hover:bg-sunk", !canEdit && "cursor-not-allowed opacity-70")}>
                      <input type="radio" name="llm-model" className="mt-1" disabled={!canEdit} checked={data.llm.model === m.id}
                        onChange={() => saveModel(m.id)} />
                      <span className="flex-1">
                        <span className="font-mono text-[13px]">{m.id}</span> <span className="text-[12.5px] text-muted">· {m.label}</span>
                        <span className="block text-[12px] text-muted">giá tham khảo {m.price_in} / {m.price_out} USD mỗi 1.000 token vào / ra</span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="mt-3 text-[12.5px] text-muted">
                  Nhà cung cấp hiện tại: <span className="font-mono">{data.llm.provider}</span>. Model thật (OpenAI-compatible: OpenRouter, Ollama) bật bằng
                  biến môi trường <span className="font-mono">LVDA_LLM_PROVIDER</span>, <span className="font-mono">LVDA_LLM_BASE_URL</span>, <span className="font-mono">LVDA_LLM_API_KEY</span>; không cần sửa code.
                </p>
              </Card>
              <Card className="p-5">
                <div className="mb-3 flex items-center gap-2 font-semibold"><Gauge size={17} /> Giới hạn</div>
                <dl className="grid grid-cols-[170px_1fr] gap-y-1.5 text-[13px]">
                  <dt className="text-muted">Bước tối đa mỗi câu</dt><dd className="num">{data.llm.limits.max_steps}</dd>
                  <dt className="text-muted">Token tối đa mỗi câu</dt><dd className="num">{data.llm.limits.max_tokens.toLocaleString("vi-VN")}</dd>
                  <dt className="text-muted">Số vòng tự sửa</dt><dd className="num">{data.llm.limits.max_fix_rounds}</dd>
                  <dt className="text-muted">Timeout truy vấn</dt><dd className="num">{data.execution.timeout_ms / 1000} giây</dd>
                  <dt className="text-muted">Số dòng trả về tối đa</dt><dd className="num">{data.execution.max_rows.toLocaleString("vi-VN")}</dd>
                </dl>
              </Card>
            </div>
          )}

          <Card>
            <div className="border-b border-line px-5 py-3 font-semibold">Truy vấn mẫu đã duyệt <span className="num font-normal text-muted">({vq.length})</span></div>
            {vq.length === 0 ? <p className="px-5 py-6 text-center text-[13px] text-muted">Chưa có. Duyệt một câu trả lời ở trang Duyệt để tạo truy vấn mẫu.</p> : (
              <ul>
                {vq.map((v) => (
                  <li key={v.id} className="border-t border-line first:border-t-0">
                    <button onClick={() => setOpen(open === v.id ? null : v.id)} className="flex w-full items-center gap-3 px-5 py-2.5 text-left hover:bg-sunk/60">
                      <span className="flex-1">{v.question}</span>
                      {v.active ? <Pill tone="good">đang dùng</Pill> : <Pill tone="warn">tạm ẩn</Pill>}
                      <span className="text-[12px] text-muted">{v.approved_by_name} · {fmtDate(v.created_at)}</span>
                    </button>
                    {open === v.id && (
                      <div className="px-5 pb-3">
                        {v.inactive_reason && <p className="mb-2 text-[12.5px] text-warn">{v.inactive_reason}</p>}
                        <SqlView sql={v.sql} maxHeight={220} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
