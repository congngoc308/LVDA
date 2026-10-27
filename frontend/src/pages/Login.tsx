import { AlertCircle, ArrowLeft, ArrowRight, Check, Eye, EyeOff, Lock, Mail, User } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { LogoMark, ThemeToggle } from "../components/Shell";
import { cx } from "../components/ui";
import { useSession } from "../session";

// Bố cục theo màn đăng nhập của P-116 (frontend/src/components/landing/LandingPage.tsx trên main):
// thẻ 900 x 600 chia đôi, panel màu trượt sang nửa đang không dùng. Màu lấy từ token nên chạy được cả bản sáng.

// Tài khoản seed bởi lvda.seed.bootstrap, mật khẩu chung lvda1234.
const DEMO_PASSWORD = "lvda1234";
const DEMO_DOMAIN = "@lvda.dev";
const DEMO = [
  { user: "engineer", role: "Engineer" },
  { user: "analyst", role: "Analyst" },
  { user: "guest", role: "Khách" },
];

const EASE_SLIDE = "cubic-bezier(0.6, 0.05, 0.1, 0.9)";
const EASE_EXIT = "cubic-bezier(0.7, 0, 0.3, 1)";
const EXIT_MS = 750;
const inputCls = "w-full rounded-xl border border-line-strong bg-sunk py-2 text-[14px] text-ink outline-none transition-colors placeholder:text-dim focus:border-accent";

function Field({ id, label, icon, children, hint }: { id: string; label: string; icon: ReactNode; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-[12px] font-semibold text-ink-2">{label}</label>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-dim">{icon}</div>
        {children}
      </div>
      {hint && <span className="mt-1 block text-[11px] text-dim">{hint}</span>}
    </div>
  );
}

function PasswordInput({ id, value, onChange, placeholder, autoComplete, minLength }: {
  id: string; value: string; onChange: (v: string) => void; placeholder: string; autoComplete: string; minLength?: number;
}) {
  const [show, setShow] = useState(false);
  return (
    <>
      <input id={id} type={show ? "text" : "password"} required minLength={minLength} value={value} onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete} placeholder={placeholder} className={cx(inputCls, "pl-10 pr-10")} />
      <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
        className="absolute inset-y-0 right-0 flex items-center pr-3 text-dim hover:text-ink">
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </>
  );
}

function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-center gap-2 rounded-xl border border-bad/30 bg-bad-soft px-3.5 py-2 text-[12px] text-bad">
      <AlertCircle size={16} className="shrink-0" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button type="submit" disabled={busy}
      className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-2.5 text-[14px] font-semibold text-on-accent shadow-lg shadow-accent/10 transition-all hover:bg-accent-2 active:scale-[0.99] disabled:opacity-50">
      {children}<ArrowRight size={16} aria-hidden />
    </button>
  );
}

function Brand() {
  return (
    <div className="mb-6 flex items-center gap-2">
      <LogoMark size={24} />
      <span className="text-[14px] font-bold tracking-tight text-ink">LVDA</span>
    </div>
  );
}

function Heading({ eyebrow, title, sub }: { eyebrow: string; title: string; sub: string }) {
  return (
    <div>
      <span className="text-[10px] font-bold uppercase tracking-widest text-accent">{eyebrow}</span>
      <h2 className="mt-1 text-[30px] font-bold leading-tight tracking-tight text-ink">{title}</h2>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">{sub}</p>
    </div>
  );
}

/** onPending(true) ngay trước khi gọi API, onPending(false) nếu thất bại: trang đăng nhập dùng để giữ màn lại chạy hiệu ứng thoát. */
type AuthFormProps = { onDone?: () => void; onPending?: (pending: boolean) => void };

/** Form đăng nhập; trang /join cũng dùng lại. */
export function LoginForm({ onDone, onPending }: AuthFormProps) {
  const { login } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    onPending?.(true);
    try { await login(email.trim(), password, remember); onDone?.(); }
    catch (err) { onPending?.(false); setError(err instanceof Error ? err.message : "Đã xảy ra lỗi, vui lòng thử lại."); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <form onSubmit={submit} className="space-y-4">
        <Field id="login-email" label="Email" icon={<Mail size={16} />}>
          <input id="login-email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="ban@congty.vn" className={cx(inputCls, "pl-10 pr-4")} />
        </Field>
        <Field id="login-password" label="Mật khẩu" icon={<Lock size={16} />}>
          <PasswordInput id="login-password" value={password} onChange={setPassword} placeholder="Nhập mật khẩu" autoComplete="current-password" />
        </Field>
        <div className="flex items-center justify-between text-[12px]">
          <label className="flex cursor-pointer items-center gap-2 font-medium text-ink-2">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 cursor-pointer accent-accent" />
            Ghi nhớ đăng nhập
          </label>
          <button type="button" onClick={() => setForgotOpen((v) => !v)} aria-expanded={forgotOpen} className="font-semibold text-accent hover:text-accent-2">
            Quên mật khẩu?
          </button>
        </div>
        {forgotOpen && <p className="text-[11.5px] text-muted">LVDA chưa có đặt lại mật khẩu tự động. Hãy nhờ engineer quản lý database đặt lại cho bạn.</p>}
        {error && <ErrorBox>{error}</ErrorBox>}
        <SubmitButton busy={busy}>{busy ? "Đang đăng nhập…" : "Đăng nhập"}</SubmitButton>
      </form>
      <div className="mt-4 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-dim">Tài khoản dùng thử</span>
          <span className="rounded border border-accent/30 bg-accent-soft px-1.5 py-0.5 font-mono text-[9px] font-semibold text-accent">{DEMO_DOMAIN} · {DEMO_PASSWORD}</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {DEMO.map((d) => (
            <button key={d.user} type="button" title={d.user + DEMO_DOMAIN}
              onClick={() => { setEmail(d.user + DEMO_DOMAIN); setPassword(DEMO_PASSWORD); setError(null); }}
              className="group min-w-0 rounded-lg border border-line-strong bg-sunk/60 px-2.5 py-1.5 text-left transition-all hover:border-accent">
              <div className="truncate font-mono text-[11px] font-medium text-ink-2 group-hover:text-accent">{d.user}</div>
              <div className="truncate text-[9.5px] text-dim">{d.role}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function RegisterForm({ onPending }: AuthFormProps) {
  const { register } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!agree) { setError("Bạn cần đồng ý với Điều khoản và Chính sách bảo mật."); return; }
    setBusy(true);
    onPending?.(true);
    try { await register(email.trim(), password, name.trim() || undefined); }
    catch (err) { onPending?.(false); setError(err instanceof Error ? err.message : "Đã xảy ra lỗi, vui lòng thử lại."); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3.5">
      <Field id="reg-name" label="Họ và tên" icon={<User size={16} />}>
        <input id="reg-name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Nguyễn Văn A" className={cx(inputCls, "pl-10 pr-4")} />
      </Field>
      <Field id="reg-email" label="Email" icon={<Mail size={16} />}>
        <input id="reg-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="ban@congty.vn" className={cx(inputCls, "pl-10 pr-4")} />
      </Field>
      <Field id="reg-password" label="Mật khẩu" icon={<Lock size={16} />} hint="Mật khẩu dài từ 8 ký tự trở lên.">
        <PasswordInput id="reg-password" value={password} onChange={setPassword} placeholder="Ít nhất 8 ký tự" autoComplete="new-password" minLength={8} />
      </Field>
      <label className="flex cursor-pointer items-start gap-2.5 pt-1 text-[12px] font-medium text-ink-2">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-4 cursor-pointer accent-accent" />
        <span>Tôi đồng ý với <span className="font-semibold text-accent">Điều khoản sử dụng</span> và <span className="font-semibold text-accent">Chính sách bảo mật</span></span>
      </label>
      {error && <ErrorBox>{error}</ErrorBox>}
      <SubmitButton busy={busy}>{busy ? "Đang tạo tài khoản…" : "Tạo tài khoản"}</SubmitButton>
    </form>
  );
}

/** Ô kính nổi trong panel màu: biểu tượng người dùng kèm hai huy hiệu. */
function FloatingBadge({ signUp }: { signUp: boolean }) {
  return (
    <div className="lv-bob relative flex size-40 flex-col items-center justify-center rounded-2xl border border-white/20 bg-white/10 p-4 shadow-2xl backdrop-blur-md">
      <div className={cx("flex size-20 items-center justify-center rounded-full text-white", signUp ? "bg-white/25" : "bg-white/20")}><User size={40} /></div>
      {signUp ? (
        <>
          <div className="absolute -left-2.5 -top-2.5 flex size-8 items-center justify-center rounded-xl bg-white text-[#16a34a] shadow-lg"><ArrowRight size={16} /></div>
          <div className="absolute -bottom-2.5 -right-2.5 flex size-8 items-center justify-center rounded-xl bg-white text-[16px] font-bold text-slate-800 shadow-lg">+</div>
        </>
      ) : (
        <>
          <div className="absolute -left-2.5 -top-2.5 flex size-8 items-center justify-center rounded-xl bg-white text-[#2257d6] shadow-lg"><Check size={16} strokeWidth={3} /></div>
          <div className="absolute -bottom-2.5 -right-2.5 flex items-center gap-1 rounded-xl bg-white px-2.5 py-1 text-[10px] font-bold text-slate-800 shadow-lg">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />Đã kiểm
          </div>
        </>
      )}
    </div>
  );
}

function OverlayCopy({ show, from, eyebrow, title, sub, action }: {
  show: boolean; from: "left" | "right"; eyebrow: string; title: string; sub: string; action: ReactNode;
}) {
  return (
    <div inert={!show}
      className={cx("absolute inset-0 flex flex-col items-center justify-center space-y-6 p-12 text-center transition-all duration-500 ease-in-out",
        show ? "translate-x-0 opacity-100" : cx("opacity-0", from === "right" ? "translate-x-8" : "-translate-x-8"))}>
      <FloatingBadge signUp={from === "left"} />
      <div className="space-y-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-white/70">{eyebrow}</span>
        <h2 className="text-[30px] font-bold leading-tight tracking-tight text-white">{title}</h2>
        <p className="mx-auto max-w-[280px] text-[12px] leading-relaxed text-white/80">{sub}</p>
      </div>
      {action}
    </div>
  );
}

const ghostBtn = "flex items-center gap-1.5 rounded-xl border border-white/40 bg-transparent px-6 py-2.5 text-[12px] font-semibold text-white transition-all duration-150 hover:border-white hover:bg-white/10 active:scale-95";

export default function LoginPage() {
  const { user, loading } = useSession();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">("login");
  const signUp = mode === "register";
  // Vừa đăng nhập/đăng ký xong trên chính trang này: giữ màn lại, hai nửa thẻ kéo ra hai bên (0,75 s) rồi mới chuyển trang.
  // Mở /login khi đã đăng nhập sẵn thì chuyển ngay.
  const pending = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const prev = document.title;
    document.title = `${signUp ? "Tạo tài khoản" : "Đăng nhập"} · LVDA`;
    return () => { document.title = prev; };
  }, [signUp]);
  useEffect(() => {
    if (!user || !pending.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setGone(true); return; }
    setLeaving(true);
    const t = window.setTimeout(() => setGone(true), EXIT_MS);
    return () => window.clearTimeout(t);
  }, [user]);
  const onPending = (v: boolean) => { pending.current = v; };
  if (!loading && user && (!pending.current || gone)) return <Navigate to={params.get("next") || "/"} replace />;

  const exit = `${EXIT_MS}ms ${EASE_EXIT}`;
  const fly = (dx: string): CSSProperties => leaving
    ? { transform: `translateX(${dx})`, opacity: 0, transition: `transform ${exit}, opacity ${exit}` }
    : {};
  const half = "relative h-full w-full overflow-hidden border-line bg-surface md:w-1/2";
  const pane = (active: boolean) => cx("flex h-full flex-col justify-between p-8 transition-all duration-500 ease-in-out sm:p-12 md:absolute md:inset-0",
    active ? "opacity-100" : "pointer-events-none opacity-0");
  const mobileSwitch = (label: string, cta: string, next: "login" | "register") => (
    <p className="mt-6 text-center text-[12.5px] text-muted md:hidden">
      {label} <button type="button" onClick={() => setMode(next)} className="font-semibold text-accent">{cta}</button>
    </p>
  );

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-x-hidden overflow-y-auto bg-paper p-4 select-none">
      <div className="absolute right-4 top-4 transition-opacity duration-300" style={leaving ? { opacity: 0 } : undefined}><ThemeToggle /></div>
      <div className="relative flex w-full max-w-[900px] md:h-[600px]" style={{ perspective: "1200px" }}>

        {/* Nửa trái: đăng nhập */}
        <div className={cx(half, "rounded-[2rem] border md:rounded-none md:rounded-l-[2.5rem] md:border-y md:border-l md:border-r-0", signUp && "hidden md:block")}
          style={fly("-800px")}>
          <div className={pane(!signUp)} inert={signUp}>
            <div>
              <Brand />
              <Heading eyebrow="Không gian làm việc của bạn" title="Chào mừng trở lại" sub="Đăng nhập để tiếp tục hỏi và kiểm số liệu." />
            </div>
            <div className="my-auto pt-6"><LoginForm onPending={onPending} /></div>
            {mobileSwitch("Chưa có tài khoản?", "Tạo tài khoản", "register")}
          </div>
        </div>

        {/* Nửa phải: tạo tài khoản */}
        <div className={cx(half, "rounded-[2rem] border md:rounded-none md:rounded-r-[2.5rem] md:border-y md:border-r md:border-l-0", !signUp && "hidden md:block")}
          style={fly("800px")}>
          <div className={pane(signUp)} inert={!signUp}>
            <div>
              <Brand />
              <Heading eyebrow="Bắt đầu trong vài phút" title="Tạo tài khoản" sub="Đăng ký, rồi nhận quyền database qua link chia sẻ." />
            </div>
            <div className="my-auto pt-4"><RegisterForm onPending={onPending} /></div>
            <div className="shrink-0 pt-4 text-center text-[10px] text-dim">Bằng cách đăng ký, bạn xác nhận đồng ý với mọi chính sách của LVDA.</div>
            {mobileSwitch("Đã có tài khoản?", "Đăng nhập", "login")}
          </div>
        </div>

        {/* Panel màu trượt: che nửa đang không dùng */}
        <div className="absolute left-0 top-0 z-20 hidden h-full w-1/2 overflow-hidden text-white md:block"
          style={{
            transform: leaving ? (signUp ? "translateX(-800px)" : "translateX(calc(100% + 800px))") : signUp ? "translateX(0%)" : "translateX(100%)",
            borderRadius: signUp ? "40px 0 0 40px" : "0 40px 40px 0",
            opacity: leaving ? 0 : 1,
            transition: leaving
              ? `transform ${exit}, opacity ${exit}`
              : `transform 1s ${EASE_SLIDE}, border-radius 1s ${EASE_SLIDE}`,
            background: "linear-gradient(135deg, #3b7bff 0%, #2257d6 45%, #1e3a5f 100%)",
          }}>
          <OverlayCopy show={!signUp} from="right" eyebrow="Làm theo cách của bạn" title="Mới dùng LVDA?"
            sub="Tạo tài khoản để hỏi số liệu bằng tiếng Việt, mỗi câu trả lời đều kèm phiếu kiểm lineage."
            action={<button type="button" onClick={() => setMode("register")} className={ghostBtn}>Tạo tài khoản<ArrowRight size={14} /></button>} />
          <OverlayCopy show={signUp} from="left" eyebrow="Rất vui gặp lại" title="Đã có tài khoản?"
            sub="Database và phiếu kiểm của bạn vẫn ở đó. Đăng nhập để tiếp tục công việc."
            action={<button type="button" onClick={() => setMode("login")} className={ghostBtn}><ArrowLeft size={14} />Quay lại đăng nhập</button>} />
          <div className="absolute inset-x-0 bottom-12 text-center">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/60">
              {signUp ? "Truy cập an toàn · Quyền theo từng database" : "Mỗi con số đều kèm phiếu kiểm"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
