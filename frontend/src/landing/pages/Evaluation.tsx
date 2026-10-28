import { AlertTriangle } from "lucide-react";
import { Code, CtaBand, Frame, H2, PageHero, Section, SectionHead, Stat, usePageTitle } from "../ui";

// Số lấy từ EVAL.md (lần chạy gần nhất); `make eval` tái tạo toàn bộ.
const RULES: [string, string, number][] = [
  ["V01", "Định danh không tồn tại", 2], ["V02", "Sai cột đo", 27], ["V03", "Thiếu bộ lọc bắt buộc", 44], ["V04", "Bộ lọc khác định nghĩa", 11],
  ["V05", "Nhân dòng do join", 8], ["V06", "Sai hàm tổng hợp", 34], ["V07", "Sai khóa thực thể", 12], ["V08", "Sai cột thời gian", 25],
  ["V09", "Đường join chưa khai báo", 2], ["V10", "Lộ cột nhạy cảm", 2], ["V11", "Dùng đối tượng ngừng dùng", 1],
];

const JUDGE = [
  { name: "Bộ kiểm lineage", recall: "100,0%", fa: "0,0%", same: "100%", cost: "0 USD", ms: "12 ms", ours: true },
  { name: "LLM chấm · mock-large", recall: "64,8%", fa: "8,3%", same: "74,8%", cost: "0,00063 USD", ms: "~1,8 s" },
  { name: "LLM chấm · mock-small", recall: "60,3%", fa: "23,9%", same: "48,5%", cost: "0,00004 USD", ms: "~0,7 s" },
];

type Row = { model: string; cfg: string; ok: number; flagged: number; held: number; silent: number };
const AGENT: Row[] = [
  { model: "mock-small", cfg: "A", ok: 36, flagged: 0, held: 0, silent: 80 },
  { model: "mock-small", cfg: "B", ok: 67, flagged: 0, held: 0, silent: 49 },
  { model: "mock-small", cfg: "C", ok: 66, flagged: 9, held: 41, silent: 0 },
  { model: "mock-small", cfg: "D", ok: 106, flagged: 9, held: 0, silent: 1 },
  { model: "mock-large", cfg: "A", ok: 45, flagged: 0, held: 0, silent: 71 },
  { model: "mock-large", cfg: "B", ok: 108, flagged: 0, held: 0, silent: 8 },
  { model: "mock-large", cfg: "C", ok: 108, flagged: 0, held: 8, silent: 0 },
  { model: "mock-large", cfg: "D", ok: 116, flagged: 0, held: 0, silent: 0 },
];
const CFG: Record<string, string> = { A: "Chỉ schema", B: "+ tìm chỉ số và truy vấn mẫu", C: "+ nhãn của bộ kiểm, Đỏ bị giữ", D: "+ tự sửa tối đa 2 vòng" };
const SERIES = [
  { key: "ok", label: "Đúng", cls: "bg-good" },
  { key: "flagged", label: "Sai, có cảnh báo", cls: "bg-warn" },
  { key: "held", label: "Bị giữ lại", cls: "bg-held" },
  { key: "silent", label: "Sai, không cảnh báo", cls: "bg-bad" },
] as const;
const TOTAL = 116;

function AgentChart({ model }: { model: string }) {
  const rows = AGENT.filter((r) => r.model === model);
  return (
    <figure className="rounded-2xl border border-line bg-panel p-5 sm:p-6">
      <figcaption className="mb-5 text-[15px] font-semibold">{model}</figcaption>
      <div className="space-y-4">
        {rows.map((r) => (
          <div key={r.cfg} className="grid grid-cols-[20px_minmax(0,1fr)_44px] items-center gap-3">
            <div className="font-mono text-[13px] font-medium text-ink" title={CFG[r.cfg]}>{r.cfg}</div>
            <div className="flex h-6 gap-[2px] overflow-hidden rounded-[4px]" role="img"
              aria-label={`Cấu hình ${r.cfg}: ${r.ok} đúng, ${r.flagged} sai có cảnh báo, ${r.held} bị giữ, ${r.silent} sai không cảnh báo trên ${TOTAL} câu`}>
              {SERIES.map((s) => r[s.key] > 0 && (
                <div key={s.key} className={`${s.cls} h-full transition-opacity hover:opacity-80`} style={{ width: `${(r[s.key] / TOTAL) * 100}%` }}
                  title={`${s.label}: ${r[s.key]} / ${TOTAL}`} />
              ))}
            </div>
            <div className="num text-right text-[13px] text-ink-2">{((r.ok / TOTAL) * 100).toFixed(0)}%</div>
          </div>
        ))}
      </div>
    </figure>
  );
}

export default function EvaluationPage() {
  usePageTitle("Đánh giá");
  return (
    <>
      <PageHero eyebrow="Đánh giá" title="Kết quả đánh giá bộ kiểm và agent, kèm cách đo"
        lead="Mọi số trên trang được tạo lại bằng lệnh make eval. Mỗi phần ghi rõ chỗ nào đo thật, chỗ nào dùng model giả lập.">
        <div className="flex gap-3 rounded-xl border border-warn/40 bg-warn-soft/60 p-5 text-[14.5px] leading-[1.65] text-ink-2">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" aria-hidden />
          <div><b className="font-semibold text-ink">Các phần dùng LLM đều chạy bằng model giả lập.</b> Model viết SQL và LLM chấm được cài sẵn lỗi; bộ kiểm lineage chạy code thật. Vì vậy các bảng so sánh chỉ kiểm quy trình, chưa đo chất lượng model.</div>
        </div>
      </PageHero>

      <Section sunk>
        <SectionHead eyebrow="1. Bộ kiểm trên SQL có nhãn" title="Bộ kiểm bắt cả 142 câu SQL sai và báo nhầm 0/60 câu đúng"
          lead="SQL sai lấy từ hai nguồn: (a) biến thể cấy lỗi vào SQL chuẩn, gồm cả 8 ca lỗi chung, và (b) bản nháp đầu của agent. SQL đúng là truy vấn chuẩn của các chỉ số." />
        <div className="grid gap-8 sm:grid-cols-3">
          <Stat value="142/142" label="SQL sai bị bắt" note="(a) 60/60, (b) 82/82" />
          <Stat value="0/60" label="báo nhầm trên SQL đúng" />
          <Stat value="11,9 ms" label="p50 mỗi lần kiểm" note="p95 17,4 ms, không gọi LLM" />
        </div>
        <div className="mt-10 scroll-thin overflow-x-auto rounded-2xl border border-line bg-panel">
          <table className="w-full min-w-[560px] text-[14px]">
            <caption className="sr-only">Số ca bắt được theo từng luật</caption>
            <thead className="border-b border-line text-left text-[12.5px] text-faint"><tr><th className="px-5 py-3 font-medium">Luật</th><th className="px-5 py-3 font-medium">Lỗi</th><th className="px-5 py-3 text-right font-medium">Bắt được</th></tr></thead>
            <tbody className="divide-y divide-line">
              {RULES.map(([id, name, n]) => (
                <tr key={id}><td className="px-5 py-2.5 font-mono text-[13px] text-ink-2">{id}</td><td className="px-5 py-2.5">{name}</td><td className="num px-5 py-2.5 text-right text-ink-2">{n}/{n}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-5 max-w-[820px] text-[14px] leading-[1.65] text-muted">
          <b className="font-semibold text-ink-2">Cách đọc con số 100%:</b> cả hai nguồn lỗi do dự án tự sinh, nên con số này chưa cho biết bộ kiểm có bắt được lỗi lạ của model thật hay không.
        </p>
      </Section>

      <Section>
        <SectionHead eyebrow="2. So với LLM chấm" title="Bộ kiểm cho cùng kết luận ở cả ba lần chạy"
          lead="Hai bên chấm cùng 202 ca, mỗi bên 3 lần. LLM chấm ở đây là model giả lập, độ nhiễu được chỉnh theo mức thường gặp ở LLM chấm." />
        <div className="scroll-thin overflow-x-auto rounded-2xl border border-line bg-panel">
          <table className="w-full min-w-[760px] text-[14px]">
            <thead className="border-b border-line text-left text-[12.5px] text-faint">
              <tr><th className="px-5 py-3 font-medium">Bên kiểm</th><th className="px-5 py-3 text-right font-medium">Bắt lỗi</th><th className="px-5 py-3 text-right font-medium">Báo nhầm</th><th className="px-5 py-3 text-right font-medium">Cùng kết luận qua 3 lần</th><th className="px-5 py-3 text-right font-medium">Chi phí mỗi ca</th><th className="px-5 py-3 text-right font-medium">Độ trễ</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {JUDGE.map((j) => (
                <tr key={j.name} className={j.ours ? "bg-accent-soft/40" : undefined}>
                  <td className="px-5 py-3 font-medium">{j.name}</td>
                  {[j.recall, j.fa, j.same, j.cost, j.ms].map((v, i) => <td key={i} className="num px-5 py-3 text-right text-ink-2">{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-5 max-w-[820px] text-[14px] leading-[1.65] text-muted">Dòng bộ kiểm lineage là số đo thật. Hai dòng LLM chấm chỉ phản ánh độ nhiễu của model giả lập.</p>
      </Section>

      <Section sunk>
        <SectionHead eyebrow="3. Agent theo model và cấu hình" title="Kết quả của agent qua bốn cấu hình A đến D"
          lead="Bộ gồm 116 câu hỏi tiếng Việt trên 12 chỉ số, trong đó có 9 câu ngoài phạm vi và 4 câu hỏi về định nghĩa." />
        <div className="mb-5 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-ink-2" aria-hidden>
          {SERIES.map((s) => <span key={s.key} className="inline-flex items-center gap-2"><span className={`${s.cls} size-2.5 rounded-[3px]`} />{s.label}</span>)}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <AgentChart model="mock-small" />
          <AgentChart model="mock-large" />
        </div>
        <dl className="mt-6 grid gap-2 text-[13.5px] text-muted sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(CFG).map(([k, v]) => <div key={k}><dt className="inline font-mono font-medium text-ink-2">{k}</dt> <dd className="inline">{v}</dd></div>)}
        </dl>
        <details className="mt-8 rounded-2xl border border-line bg-panel">
          <summary className="cursor-pointer px-5 py-3.5 text-[14px] font-medium">Xem bảng số</summary>
          <div className="scroll-thin overflow-x-auto border-t border-line">
            <table className="w-full min-w-[640px] text-[13.5px]">
              <thead className="text-left text-[12.5px] text-faint"><tr>{["Model", "Cấu hình", "Đúng", "Sai, có cảnh báo", "Bị giữ", "Sai, không cảnh báo", "Độ chính xác"].map((h) => <th key={h} className="px-5 py-2.5 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {AGENT.map((r) => (
                  <tr key={r.model + r.cfg}><td className="px-5 py-2">{r.model}</td><td className="px-5 py-2 font-mono">{r.cfg}</td>
                    {[r.ok, r.flagged, r.held, r.silent].map((v, i) => <td key={i} className="num px-5 py-2">{v}</td>)}
                    <td className="num px-5 py-2">{((r.ok / TOTAL) * 100).toFixed(1).replace(".", ",")}%</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <p className="mt-6 max-w-[820px] text-[14px] leading-[1.65] text-muted">
          <b className="font-semibold text-ink-2">Vì sao chưa coi đây là kết quả:</b> model giả lập mắc đúng những lỗi được cấy sẵn, nên D gần hoàn hảo là do cách dựng thí nghiệm.
          Điều đáng xem là sự thay đổi giữa các cấu hình. Với mock-small, C đưa số câu sai không cảnh báo từ 80 về 0, còn D lấy lại phần lớn câu bị giữ với chi phí khoảng 1,5 lần A.
          Cả bốn cấu hình đều từ chối đúng 9/9 câu ngoài phạm vi.
        </p>
      </Section>

      <Section>
        <SectionHead eyebrow="4. Hiểu câu hỏi và tìm bảng" title="Agent phân loại sai 2/50 câu, cả hai dùng cách diễn đạt lạ" />
        <div className="grid gap-8 sm:grid-cols-3">
          <Stat value="96,0%" label="phân loại ý định" note="48/50, tập gán nhãn tay" />
          <Stat value="95,2%" label="khớp đúng chỉ số" note="40/42 câu có nêu chỉ số" />
          <Stat value="100%" label="tìm bảng recall@5" note="số bị thổi phồng, chỉ dùng để kiểm hồi quy" />
        </div>
      </Section>

      <Section sunk>
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <H2>Giới hạn</H2>
            <ul className="mt-6 space-y-4 text-[15px] leading-[1.65] text-ink-2">
              <li><b className="font-semibold">Chưa có LLM thật.</b> So sánh model, LLM chấm và nguồn lỗi (b) cần chạy lại với model thật và người gán nhãn.</li>
              <li><b className="font-semibold">Dữ liệu tổng hợp.</b> Số dòng và phân phối sinh theo schema Olist. Có lệnh nạp CSV Olist thật từ Kaggle để chạy lại.</li>
              <li><b className="font-semibold">Chỉ một dialect SQL.</b> Hiện chỉ hỗ trợ Postgres, mỗi database ứng với một warehouse.</li>
            </ul>
          </div>
          <div>
            <H2>Tự chạy lại</H2>
            <p className="mt-6 text-[15px] leading-[1.65] text-muted">Kết quả ghi vào <span className="font-mono text-ink-2">backend/eval/results/</span> và bảng <span className="font-mono text-ink-2">app.eval_runs</span>, hoặc chạy lại từ tab Đánh giá.</p>
            <Frame glow={false} className="mt-6"><Code className="rounded-none border-0">{`make eval
# hoặc
cd backend && python -m lvda.evaluation all`}</Code></Frame>
          </div>
        </div>
      </Section>
      <CtaBand title="Tự chạy lại phần đánh giá trên máy của bạn" lead="Dựng stack bằng hai lệnh Docker, sau đó chạy make eval để tạo lại mọi bảng trên trang." />
    </>
  );
}
