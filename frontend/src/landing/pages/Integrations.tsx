import { Bot, Cable, Database, FileCode2, Terminal } from "lucide-react";
import type { ReactNode } from "react";
import { Code, CtaBand, PageHero, Section, SectionHead, usePageTitle } from "../ui";

const TOOLS = [
  ["verify_sql", "Kiểm SQL, trả kết luận và phát hiện"],
  ["explain_sql_lineage", "Lineage của SQL: cột đo, bộ lọc, join, nguồn"],
  ["list_metrics", "Liệt kê chỉ số theo trạng thái"],
  ["get_metric_definition", "Định nghĩa đầy đủ của một chỉ số"],
  ["run_certified_metric", "Chạy chỉ số đã chứng nhận theo khoảng thời gian và chiều chia"],
];

function Item({ icon, title, tag, children }: { icon: ReactNode; title: string; tag?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-6">
      <div className="flex items-center justify-between">
        <div className="grid size-10 place-items-center rounded-lg bg-accent-soft text-accent">{icon}</div>
        {tag && <span className="rounded-full bg-raised px-2 py-0.5 text-[12px] text-ink-2">{tag}</span>}
      </div>
      <div className="mt-4 text-[17px] font-semibold">{title}</div>
      <div className="mt-2 text-[14.5px] leading-[1.6] text-muted">{children}</div>
    </div>
  );
}

export default function IntegrationsPage() {
  usePageTitle("Tích hợp");
  return (
    <>
      <PageHero eyebrow="Tích hợp" title="Dùng bộ kiểm trong app, trong agent qua MCP và trong CI"
        lead="Claude Code hoặc Cursor gọi bộ kiểm qua MCP, pipeline CI gọi qua CLI. Trang này chỉ liệt kê những gì đã có trong mã nguồn." />
      <Section sunk>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Item icon={<Database size={19} />} title="PostgreSQL" tag="nguồn">Kết nối bằng role chỉ đọc và đồng bộ tăng dần. Kho của LVDA cũng chạy Postgres 16.</Item>
          <Item icon={<Database size={19} />} title="MySQL" tag="nguồn">Kết nối bằng user chỉ có quyền SELECT và SHOW VIEW. Repo kèm sẵn một MySQL 8.4 mẫu.</Item>
          <Item icon={<Bot size={19} />} title="MCP" tag="agent">Server MCP có năm tool, chạy qua stdio hoặc HTTP, dùng được với Claude Code, Cursor và các client MCP khác.</Item>
          <Item icon={<Terminal size={19} />} title="CLI" tag="CI"><span className="font-mono text-ink-2">lvda verify</span> thoát với mã 1 khi SQL bị Đỏ hoặc bị chặn, nên bước CI đó thất bại.</Item>
          <Item icon={<Cable size={19} />} title="LLM tương thích OpenAI" tag="chưa thử thật">Một client dùng chung cho OpenRouter, Ollama và vLLM. Chưa chạy với endpoint thật.</Item>
          <Item icon={<FileCode2 size={19} />} title="MetricFlow, YAML, CSV Olist" tag="nhập xuất">Nhập định nghĩa chỉ số từ MetricFlow, xuất ra YAML và nạp CSV Olist thật từ Kaggle.</Item>
        </div>
      </Section>
      <Section>
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <SectionHead className="!mb-6" eyebrow="MCP" title="Năm tool của server MCP" />
            <dl className="divide-y divide-line border-y border-line">
              {TOOLS.map(([n, d]) => <div key={n} className="py-3.5"><dt className="font-mono text-[13.5px] text-accent">{n}</dt><dd className="mt-1 text-[14.5px] text-muted">{d}</dd></div>)}
            </dl>
          </div>
          <div className="space-y-5">
            <div><div className="mb-2 text-[14px] font-medium">Thêm vào Claude Code (stdio)</div>
              <Code>{`claude mcp add lvda -- <đường dẫn>\\backend\\.venv\\Scripts\\python <đường dẫn>\\backend\\mcp_server.py`}</Code></div>
            <div><div className="mb-2 text-[14px] font-medium">Hoặc chạy qua HTTP</div>
              <Code>{`python backend\\mcp_server.py --http   # http://127.0.0.1:8021/mcp`}</Code></div>
            <div><div className="mb-2 text-[14px] font-medium">Kiểm SQL trong CI</div>
              <Code>{`lvda verify --sql "SELECT COUNT(o.order_id) FROM mart.fct_orders o" --metric order_count
# thoát với mã 1 khi Đỏ hoặc bị chặn`}</Code></div>
            <div><div className="mb-2 text-[14px] font-medium">Dùng LLM thật thay model giả lập</div>
              <Code>{`LVDA_LLM_PROVIDER=openai
LVDA_LLM_BASE_URL=…
LVDA_LLM_API_KEY=…
LVDA_LLM_MODEL=…`}</Code></div>
          </div>
        </div>
      </Section>
      <CtaBand />
    </>
  );
}
