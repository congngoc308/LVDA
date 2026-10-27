import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Logo, ThemeToggle } from "../components/Shell";
import { Button, ErrorNote, VerdictStamp } from "../components/ui";
import { useSession } from "../session";

const DEMO = [
  { email: "engineer@lvda.dev", label: "Engineer", note: "định nghĩa, chứng nhận, duyệt, chia sẻ" },
  { email: "analyst@lvda.dev", label: "Analyst", note: "hỏi và kiểm số liệu" },
  { email: "guest@lvda.dev", label: "Khách", note: "chưa có quyền, dùng để thử link chia sẻ" },
];

export function LoginForm({ onDone }: { onDone?: () => void }) {
  const { login } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await login(email, password); onDone?.(); }
    catch (err) { setError(err instanceof Error ? err.message : "Không đăng nhập được."); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-[13px] font-medium">Email</span>
        <input id="email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
          className="h-10 rounded-md border border-line-strong bg-surface px-3 outline-none focus:border-accent" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[13px] font-medium">Mật khẩu</span>
        <input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
          className="h-10 rounded-md border border-line-strong bg-surface px-3 outline-none focus:border-accent" />
      </label>
      <ErrorNote>{error}</ErrorNote>
      <Button variant="primary" type="submit" disabled={busy} className="mt-1 h-10">{busy ? "Đang đăng nhập…" : "Đăng nhập"}</Button>
      <div className="mt-3 rounded-md border border-line bg-sunk/60 p-3">
        <div className="mb-2 text-[12px] text-muted">Tài khoản mẫu (mật khẩu <span className="font-mono text-ink">lvda1234</span>):</div>
        <div className="flex flex-col gap-1">
          {DEMO.map((d) => (
            <button type="button" key={d.email} onClick={() => { setEmail(d.email); setPassword("lvda1234"); }}
              className="flex items-baseline gap-2 rounded px-2 py-1 text-left hover:bg-surface">
              <span className="w-[68px] shrink-0 text-[13px] font-medium">{d.label}</span>
              <span className="truncate text-[12px] text-muted">{d.note}</span>
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}

export default function LoginPage() {
  const { user, loading } = useSession();
  const [params] = useSearchParams();
  if (!loading && user) return <Navigate to={params.get("next") || "/"} replace />;
  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <section className="hidden flex-col justify-between bg-sidebar p-10 text-ink border-r border-line lg:flex">
        <Logo light />
        <div className="max-w-md">
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-balance">Mỗi con số AI đưa ra đều kèm phiếu kiểm.</h1>
          <p className="mt-3 text-muted">
            LVDA đọc lineage của câu SQL do AI viết và so với định nghĩa chỉ số đã chứng nhận, trước khi số liệu tới tay người hỏi.
          </p>
          <div className="mt-8 rounded-lg border border-line-strong bg-sunk p-4 font-mono text-[12.5px]">
            <div className="text-faint">Doanh thu gộp tháng 3/2018</div>
            <div className="mt-2 flex items-center gap-2"><span className="rounded bg-raised px-1.5 text-ink-2">Lần 0</span>
              <span className="text-bad">SUM(p.payment_value)</span><span className="text-dim">→ V02 · V03</span></div>
            <div className="mt-1.5 flex items-center gap-2"><span className="rounded bg-raised px-1.5 text-ink-2">Lần 1</span>
              <span className="text-good">SUM(i.price + i.freight_value)</span><span className="text-dim">→ khớp</span></div>
            <div className="mt-3"><span className="rounded bg-surface px-1.5 py-1"><VerdictStamp verdict="green" size="sm" /></span></div>
          </div>
        </div>
        <p className="text-[12px] text-dim">Dữ liệu giả lập theo schema Olist. Phần viết SQL đang dùng LLM mô phỏng.</p>
      </section>
      <section className="relative grid place-items-center p-6">
        <div className="absolute right-4 top-4"><ThemeToggle /></div>
        <div className="w-full max-w-sm">
          <div className="mb-6 lg:hidden"><Logo /></div>
          <h2 className="mb-5 text-[20px] font-semibold">Đăng nhập</h2>
          <LoginForm />
        </div>
      </section>
    </div>
  );
}
