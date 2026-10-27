import { useEffect, useState } from "react";
import { type CardSpec, type Chart, defaultChart, newCardId, type Options, type Period, validCharts } from "../../dashboard";
import { Button, Drawer } from "../ui";
import { MetricCard } from "./MetricCard";

const field = "h-9 w-full rounded-md border border-line bg-surface px-2.5 text-[13px]";

/** Sửa (hoặc tạo tay) một card: chỉ chọn trong chỉ số đã chứng nhận và chiều chia mà chỉ số đó hỗ trợ. */
export function CardEditor({ dbId, options, card, onClose, onApply }: {
  dbId: number; options: Options | null; card: CardSpec | "new" | null; onClose: () => void; onApply: (c: CardSpec) => void;
}) {
  const [draft, setDraft] = useState<CardSpec | null>(null);

  useEffect(() => {
    if (card === null || !options) { setDraft(null); return; }
    if (card !== "new") { setDraft(card); return; }
    const m = options.metrics[0];
    setDraft({ id: newCardId(), kind: "metric", title: m?.name_vi ?? "", metric_id: m?.id ?? "", dimension: null, period: "2018", chart: "number", top: null, why: null });
  }, [card, options]);

  if (!draft || !options) return <Drawer open={card !== null} onClose={onClose} title="Card"><p className="p-5 text-[13px] text-muted">Đang tải danh sách chỉ số…</p></Drawer>;

  const metric = options.metrics.find((m) => m.id === draft.metric_id);
  const dims = metric?.dimensions ?? [];
  const charts = validCharts(draft.dimension);
  const set = (patch: Partial<CardSpec>) => setDraft({ ...draft, ...patch });
  const setDim = (d: string | null) => set({
    dimension: d, chart: validCharts(d).includes(draft.chart) ? draft.chart : defaultChart(d),
    top: d && d !== "month" ? draft.top ?? 10 : null,
  });
  const setMetric = (id: string) => {
    const m = options.metrics.find((x) => x.id === id);
    const keepTitle = draft.title && draft.title !== metric?.name_vi;
    const d = draft.dimension && m?.dimensions.includes(draft.dimension) ? draft.dimension : null;
    setDraft({ ...draft, metric_id: id, title: keepTitle ? draft.title : m?.name_vi ?? id, dimension: d,
      chart: validCharts(d).includes(draft.chart) ? draft.chart : defaultChart(d), top: d && d !== "month" ? draft.top ?? 10 : null });
  };
  const ok = draft.title.trim().length > 0 && !!metric;

  return (
    <Drawer open onClose={onClose} width={520} title={card === "new" ? "Thêm card thủ công" : "Sửa card"}>
      <div className="flex flex-col gap-4 p-5">
        <label className="flex flex-col gap-1 text-[13px]"><span className="font-medium">Tiêu đề</span>
          <input className={field} value={draft.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-[13px]"><span className="font-medium">Chỉ số <span className="font-normal text-muted">(chỉ chỉ số đã chứng nhận)</span></span>
          <select className={field} value={draft.metric_id} onChange={(e) => setMetric(e.target.value)}>
            {options.metrics.map((m) => <option key={m.id} value={m.id}>{m.name_vi}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[13px]"><span className="font-medium">Chia theo</span>
            <select className={field} value={draft.dimension ?? ""} onChange={(e) => setDim(e.target.value || null)}>
              <option value="">Không chia (một con số)</option>
              {dims.map((d) => <option key={d} value={d}>{options.dimensions[d] ?? d}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px]"><span className="font-medium">Thời gian</span>
            <select className={field} value={draft.period} onChange={(e) => set({ period: e.target.value as Period })}>
              {(Object.keys(options.periods) as Period[]).map((p) => <option key={p} value={p}>{options.periods[p]}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px]"><span className="font-medium">Dạng hiển thị</span>
            <select className={field} value={draft.chart} onChange={(e) => set({ chart: e.target.value as Chart })} disabled={charts.length === 1}>
              {charts.map((c) => <option key={c} value={c}>{options.charts[c]}</option>)}
            </select>
          </label>
          {draft.dimension && draft.dimension !== "month" && (
            <label className="flex flex-col gap-1 text-[13px]"><span className="font-medium">Lấy top</span>
              <input type="number" min={1} max={30} className={field} value={draft.top ?? 10}
                onChange={(e) => set({ top: Math.min(30, Math.max(1, Number(e.target.value) || 1)) })} />
            </label>
          )}
        </div>
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-muted">Xem trước</div>
          <div className="rounded-lg border border-line p-4">
            {metric ? <MetricCard dbId={dbId} spec={draft} dimLabel={draft.dimension ? options.dimensions[draft.dimension] : undefined} />
              : <p className="text-[13px] text-muted">Chọn một chỉ số.</p>}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" disabled={!ok} onClick={() => onApply({ ...draft, title: draft.title.trim() })}>Áp dụng</Button>
        </div>
      </div>
    </Drawer>
  );
}
