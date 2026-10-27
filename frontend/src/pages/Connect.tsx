import { CheckCircle2, ClipboardPaste, Copy, Eye, EyeOff, Loader2, MinusCircle, RotateCw, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { CopyProgress } from "../components/SyncPanel";
import { TablePicker } from "../components/TablePicker";
import { Button, cx, ErrorNote } from "../components/ui";
import { useSession } from "../session";
import {
  attention, buildDsn, type CheckResult, type ConnFields, DEFAULT_PORT, defaultPicks, ENV_LABEL, type Environment, guessEnv, KIND_LABEL, num,
  parseConnection, type Picks, SCHEDULES, type SourceKind, useSource,
} from "../sources";

const EMPTY: ConnFields = { kind: "postgres", host: "", port: DEFAULT_PORT.postgres, database: "", user: "", password: "", schema: "", params: "" };
type Step = 1 | 2 | 3 | 4;

function readOnlySql(f: ConnFields, schema: string) {
  const db = f.database || "tên_db";
  return f.kind === "postgres"
    ? `CREATE ROLE lvda_ro LOGIN PASSWORD 'đặt_mật_khẩu';\nGRANT CONNECT ON DATABASE ${db} TO lvda_ro;\nGRANT USAGE ON SCHEMA ${schema} TO lvda_ro;\nGRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO lvda_ro;\nALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT SELECT ON TABLES TO lvda_ro;`
    : `CREATE USER 'lvda_ro'@'%' IDENTIFIED BY 'đặt_mật_khẩu';\nGRANT SELECT, SHOW VIEW ON ${db}.* TO 'lvda_ro'@'%';`;
}

/** Ô nhập có nhãn; lỗi nằm ngoài label để không bị đọc gộp vào tên ô. */
function Field({ label, error, children, className }: { label: string; error?: string | null; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col gap-1 text-[13px]", className)}>
      <label className="flex flex-col gap-1"><span className="font-medium">{label}</span>{children}</label>
      {error && <span role="alert" className="text-[12px] text-bad">{error}</span>}
    </div>
  );
}
const inputCls = (bad: boolean) => cx("h-9 w-full rounded-md border bg-surface px-2.5 text-[13px]", bad ? "border-bad ring-1 ring-bad/30" : "border-line");

/** Cột trái: 4 bước, bước đã xong có tóm tắt và nút Sửa (khóa khi đã bắt đầu sao chép). */
function Rail({ step, reached, summaries, locked, onEdit }: {
  step: Step; reached: Step; summaries: Partial<Record<Step, React.ReactNode>>; locked: boolean; onEdit: (s: Step) => void;
}) {
  const titles: Record<Step, string> = { 1: "Nguồn", 2: "Kiểm tra", 3: "Chọn bảng", 4: "Sao chép lần đầu" };
  return (
    <ol className="flex flex-col">
      {([1, 2, 3, 4] as Step[]).map((s) => {
        const done = s < reached || (s === 4 && !!summaries[4]);
        const active = s === step;
        return (
          <li key={s} className="relative flex gap-3 pb-6 last:pb-0">
            {s < 4 && <span className={cx("absolute left-[13px] top-7 h-[calc(100%-24px)] w-px", done ? "bg-good" : "bg-line")} aria-hidden />}
            <span className={cx("num z-[1] grid size-[27px] shrink-0 place-items-center rounded-full text-[12px] font-semibold",
              done ? "bg-good text-paper" : active ? "bg-accent text-on-accent" : "border border-line-strong bg-surface text-muted")}>
              {done ? <CheckCircle2 size={16} /> : s}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-center gap-2">
                <span className={cx("text-[13.5px]", active || done ? "font-semibold" : "text-muted")}>{titles[s]}</span>
                {done && s < 4 && !locked && <button onClick={() => onEdit(s)} className="ml-auto text-[12px] text-accent hover:underline">Sửa</button>}
              </div>
              {summaries[s] && <div className="mt-0.5 break-words text-[12px] text-muted">{summaries[s]}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const CHECK_ICON = {
  ok: <CheckCircle2 size={17} className="text-good" />, fail: <XCircle size={17} className="text-bad" />, skip: <MinusCircle size={17} className="text-faint" />,
};

/** Kết nối database theo 4 bước: Nguồn → Kiểm tra (mạng, xác thực, role chỉ đọc, đọc schema) → Chọn bảng → Sao chép lần đầu. */
export default function ConnectPage() {
  const { canConnect, refresh, selectDb } = useSession();
  const nav = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [reached, setReached] = useState<Step>(1);
  const [f, setF] = useState<ConnFields>(EMPTY);
  const [paste, setPaste] = useState("");
  const [pasted, setPasted] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [demos, setDemos] = useState<{ label: string; kind: SourceKind; dsn: string }[]>([]);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [picks, setPicks] = useState<Picks>({});
  const [name, setName] = useState("");
  const [env, setEnv] = useState<Environment>("prod");
  const [schedule, setSchedule] = useState(60);
  const [lookback, setLookback] = useState(5);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [created, setCreated] = useState<number | null>(null);
  const seq = useRef(0);
  const { state: synced } = useSource(created, created !== null);

  useEffect(() => { if (canConnect) api<typeof demos>("/sources/demo").then(setDemos).catch(() => {}); }, [canConnect]);

  const go = (s: Step) => { setStep(s); setReached((r) => (s > r ? s : r)); };
  const set = (patch: Partial<ConnFields>) => {
    setF((cur) => {
      const next = { ...cur, ...patch };
      if (patch.kind && patch.kind !== cur.kind && cur.port === DEFAULT_PORT[cur.kind]) next.port = DEFAULT_PORT[patch.kind];
      return next;
    });
    if (reached > 1) setReached(1); // đổi nguồn thì kết quả kiểm tra và bảng đã chọn không còn đúng
  };
  const ready = !!(f.host.trim() && f.database.trim() && f.user.trim());

  const runCheck = async (fields: ConnFields) => {
    const my = ++seq.current;
    go(2);
    setChecking(true); setResult(null);
    try {
      const r = await api<CheckResult>("/sources/test", { body: { kind: fields.kind, dsn: buildDsn(fields), schema_name: fields.kind === "postgres" ? fields.schema.trim() || null : null } });
      if (my !== seq.current) return;
      setResult(r);
      if (r.ok && r.tables) {
        const tables = r.tables;
        // kiểm tra lại (đổi user, mật khẩu...) thì giữ những gì đã tuỳ chỉnh cho bảng còn tồn tại
        setPicks((cur) => {
          const next = defaultPicks(tables);
          for (const k of Object.keys(next)) if (cur[k] && tables.find((t) => t.name === k)?.readable) next[k] = cur[k];
          return next;
        });
        setName((n) => n || fields.database.trim());
        setEnv(guessEnv(fields.host));
      }
    } catch (e) {
      if (my === seq.current) setResult({ ok: false, checks: [], error: { message: e instanceof Error ? e.message : "Không kiểm tra được.", field: null } });
    } finally { if (my === seq.current) setChecking(false); }
  };
  const fill = (text: string) => {
    const p = parseConnection(text);
    if (!p) { setPasted("Không nhận ra chuỗi này. Dạng hợp lệ: postgresql://…, mysql://… hoặc jdbc:…"); return; }
    const next = { ...EMPTY, ...p, port: p.port || DEFAULT_PORT[p.kind ?? "postgres"] } as ConnFields;
    setF(next); setPaste(""); setReached(1);
    setPasted(`Đã điền từ chuỗi kết nối ${KIND_LABEL[next.kind]}${p.params ? ` (giữ tham số ${p.params})` : ""}.`);
    if (next.host && next.database && next.user) void runCheck(next); // dán đủ thông tin thì kiểm tra luôn
  };

  const sum = useMemo(() => (result?.tables ? attention(result.tables, picks) : null), [result, picks]);
  const estRows = sum ? sum.chosen.reduce((a, t) => a + (t.rows_estimate ?? 0), 0) : 0;
  const fieldError = (k: keyof ConnFields) => (step === 1 && result?.error?.field === k ? result.error.message : null);
  const schemaName = result?.schema ?? (f.schema.trim() || (f.kind === "postgres" ? "public" : f.database));
  const readonlyFailed = result?.checks.some((c) => c.id === "readonly" && c.status === "fail");

  const create = async () => {
    if (!sum) return;
    setCreating(true); setError(null);
    try {
      const r = await api<{ database_id: number }>("/sources", {
        body: {
          kind: f.kind, dsn: buildDsn(f), schema_name: f.kind === "postgres" ? f.schema.trim() || null : null, name: name.trim(),
          environment: env, schedule_minutes: schedule, lookback_minutes: lookback,
          tables: sum.chosen.map((t) => ({ name: t.name, cursor: picks[t.name].cursor })),
        },
      });
      setCreated(r.database_id);
      go(4);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Không kết nối được."); }
    finally { setCreating(false); }
  };

  if (!canConnect) return <p className="p-8 text-muted">Chỉ engineer mới kết nối được nguồn dữ liệu mới.</p>;

  const run = synced?.running ?? synced?.runs[0] ?? null;
  const finished = !!run && run.status !== "running" && created !== null;
  const summaries: Partial<Record<Step, React.ReactNode>> = {
    1: reached > 1 && <span className="font-mono">{f.kind === "postgres" ? "postgresql" : "mysql"}://{f.user}@{f.host}:{f.port}/{f.database}</span>,
    2: reached > 2 && "Mạng · xác thực · role chỉ đọc · đọc schema: đạt cả 4",
    3: reached > 3 && sum && `${sum.chosen.length}/${result?.tables?.length} bảng trong ${schemaName} · khoảng ${num(estRows)} dòng`,
    4: finished ? (run.status === "ok" ? "Hoàn tất. Lần sau chỉ lấy dòng mới hoặc vừa sửa." : "Xong, có bảng lỗi: xem chi tiết.") : null,
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-paper px-6 py-3 text-[13px]">
        <Link to="/sources" className="text-muted hover:text-ink">Nguồn dữ liệu</Link>
        <span className="text-faint">/</span>
        <span className="font-medium">Kết nối database</span>
        <Button size="sm" className="ml-auto" onClick={() => nav(created ? `/sources?id=${created}` : "/sources")}>Đóng</Button>
      </div>
      <div className="grid min-h-0 flex-1 md:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="border-b border-line bg-surface p-6 md:border-b-0 md:border-r">
          <Rail step={step} reached={reached} summaries={summaries} locked={created !== null} onEdit={(s) => setStep(s)} />
          {created !== null && (
            <p className="mt-6 rounded-md bg-sunk px-3 py-2.5 text-[12px] text-muted">Có thể đóng trang này. Việc sao chép chạy nền và hiện tiến độ ở danh sách nguồn.</p>
          )}
        </aside>

        <section aria-label="Bước hiện tại" className="scroll-thin min-h-0 overflow-y-auto bg-paper">
          <div className="mx-auto flex max-w-[820px] flex-col gap-4 p-6">
            {step === 1 && (
              <>
                <div>
                  <h2 className="text-[17px] font-semibold">Nguồn</h2>
                  <p className="text-[13px] text-muted">Dán chuỗi kết nối để tự điền, hoặc điền từng ô. Dùng một user chỉ có quyền SELECT.</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="relative">
                    <ClipboardPaste size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                    <input value={paste} aria-label="Dán chuỗi kết nối" spellCheck={false} autoComplete="off"
                      placeholder="postgresql://…, mysql://… hoặc jdbc:…"
                      onChange={(e) => { setPaste(e.target.value); if (/:\/\//.test(e.target.value)) fill(e.target.value); }}
                      className="h-10 w-full rounded-md border border-dashed border-line-strong bg-surface pl-8 pr-2.5 font-mono text-[13px] focus:border-solid" />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                    {pasted ? <span>{pasted}</span> : <span>Dán đủ user, mật khẩu và database thì LVDA kiểm tra luôn.</span>}
                    {demos.length > 0 && <>
                      <span className="ml-auto">Thử nhanh:</span>
                      {demos.map((d) => (
                        <button key={d.label} type="button" onClick={() => fill(d.dsn)}
                          className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-ink-2 hover:border-accent hover:text-accent">{d.label}</button>
                      ))}
                    </>}
                  </div>
                </div>
                <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
                  <div role="radiogroup" aria-label="Loại database" className="flex gap-1.5">
                    {(["postgres", "mysql"] as SourceKind[]).map((k) => (
                      <button key={k} type="button" role="radio" aria-checked={f.kind === k} onClick={() => set({ kind: k })}
                        className={cx("rounded-md border px-3 py-1.5 text-[13px]", f.kind === k ? "border-accent bg-accent-soft font-medium text-accent" : "border-line hover:bg-sunk")}>
                        {KIND_LABEL[k]}
                      </button>
                    ))}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
                    <Field label="Host" error={fieldError("host")}>
                      <input className={cx(inputCls(!!fieldError("host")), "font-mono")} value={f.host} onChange={(e) => set({ host: e.target.value })} placeholder="db.congty.vn" spellCheck={false} autoComplete="off" />
                    </Field>
                    <Field label="Cổng" error={fieldError("port")}>
                      <input className={cx(inputCls(!!fieldError("port")), "num")} value={f.port} inputMode="numeric" onChange={(e) => set({ port: e.target.value.replace(/\D/g, "") })} />
                    </Field>
                  </div>
                  <div className={cx("grid gap-3", f.kind === "postgres" && "sm:grid-cols-[1fr_200px]")}>
                    <Field label="Database" error={fieldError("database")}>
                      <input className={cx(inputCls(!!fieldError("database")), "font-mono")} value={f.database} onChange={(e) => set({ database: e.target.value })} spellCheck={false} />
                    </Field>
                    {f.kind === "postgres" && (
                      <Field label="Schema" error={fieldError("schema")}>
                        <input className={cx(inputCls(!!fieldError("schema")), "font-mono")} value={f.schema} onChange={(e) => set({ schema: e.target.value })} placeholder="public" spellCheck={false} />
                      </Field>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="User" error={fieldError("user")}>
                      <input className={cx(inputCls(!!fieldError("user")), "font-mono")} value={f.user} onChange={(e) => set({ user: e.target.value })} placeholder="lvda_ro" spellCheck={false} autoComplete="off" />
                    </Field>
                    <div className="flex flex-col gap-1 text-[13px]">
                      <label htmlFor="source-pw" className="font-medium">Mật khẩu</label>
                      <span className="flex gap-1.5">
                        <input id="source-pw" className={cx(inputCls(!!fieldError("password")), "font-mono")} type={showPw ? "text" : "password"} value={f.password}
                          onChange={(e) => set({ password: e.target.value })} autoComplete="new-password" onKeyDown={(e) => e.key === "Enter" && ready && runCheck(f)} />
                        <Button type="button" onClick={() => setShowPw(!showPw)} aria-label={showPw ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>{showPw ? <EyeOff size={15} /> : <Eye size={15} />}</Button>
                      </span>
                      {fieldError("password") && <span role="alert" className="text-[12px] text-bad">{fieldError("password")}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex justify-end"><Button variant="primary" disabled={!ready} onClick={() => runCheck(f)}>Tiếp: kiểm tra kết nối</Button></div>
              </>
            )}

            {step === 2 && (
              <>
                <h2 className="text-[17px] font-semibold">Kiểm tra</h2>
                <ul className="flex flex-col rounded-lg border border-line bg-surface" aria-live="polite">
                  {(result?.checks.length ? result.checks : (["Mạng", "Xác thực", "Role chỉ đọc", "Đọc schema"].map((label, i) => ({ id: String(i), label, status: "skip", detail: null })))).map((c) => (
                    <li key={c.id} className="flex items-start gap-3 border-t border-line px-4 py-3 first:border-t-0">
                      <span className="mt-0.5">{checking ? <Loader2 size={17} className="animate-spin text-accent" /> : CHECK_ICON[c.status as "ok" | "fail" | "skip"]}</span>
                      <span className="min-w-0 flex-1">
                        <span className={cx("block text-[13.5px] font-medium", !checking && c.status === "skip" && "text-muted")}>{c.label}</span>
                        <span className={cx("block text-[12.5px]", c.status === "fail" ? "text-bad" : "text-muted")}>
                          {checking ? "Đang kiểm tra…" : c.status === "skip" ? "Bỏ qua vì bước trước chưa qua" : c.detail}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                {!checking && result && !result.ok && (
                  readonlyFailed ? (
                    <div className="flex flex-col gap-2 rounded-md border border-bad/30 bg-bad-soft px-3 py-2.5 text-[13px] text-bad">
                      <span>User <b className="font-mono">{f.user}</b> có quyền ghi nên LVDA không dùng. Chạy đoạn SQL này trên nguồn (bằng tài khoản quản trị), rồi đổi user thành <span className="font-mono">lvda_ro</span>:</span>
                      <pre className="overflow-x-auto rounded bg-surface px-3 py-2 font-mono text-[12px] text-ink">{readOnlySql(f, schemaName)}</pre>
                      <span className="flex flex-wrap gap-1.5">
                        <Button size="sm" onClick={() => { void navigator.clipboard?.writeText(readOnlySql(f, schemaName)); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                          <Copy size={13} /> {copied ? "Đã chép" : "Chép SQL"}
                        </Button>
                        <Button size="sm" onClick={() => setStep(1)}>Đổi user</Button>
                        <Button size="sm" onClick={() => runCheck(f)}><RotateCw size={13} /> Kiểm tra lại</Button>
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      {/* câu lỗi đã nằm ở bước hỏng phía trên; chỉ nhắc lại khi lỗi không thuộc bước nào */}
                      {!result.checks.some((c) => c.status === "fail") && <ErrorNote>{result.error?.message}</ErrorNote>}
                      <Button onClick={() => setStep(1)}>Sửa nguồn</Button>
                      <Button variant="ghost" onClick={() => runCheck(f)}><RotateCw size={14} /> Kiểm tra lại</Button>
                    </div>
                  )
                )}
                {!checking && result?.ok && (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-good/30 bg-good-soft px-3 py-2.5 text-[13px] text-good">
                    <span>Đạt cả 4 bước · {result.server} · {result.tables?.length} bảng trong {result.schema}</span>
                    <Button variant="primary" onClick={() => go(3)}>Tiếp: chọn bảng</Button>
                  </div>
                )}
              </>
            )}

            {step === 3 && sum && result?.tables && (
              <>
                <div>
                  <h2 className="text-[17px] font-semibold">Chọn bảng</h2>
                  <p className="text-[13px] text-muted">Đã chọn sẵn mọi bảng đọc được. Bảng có cột updated_at được đồng bộ tăng dần, bảng không có thì làm mới toàn bộ mỗi lần.</p>
                </div>
                <div className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-[1fr_150px_170px]">
                  <Field label="Tên trong LVDA"><input className={inputCls(false)} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
                  <Field label="Môi trường">
                    <select className={inputCls(false)} value={env} onChange={(e) => setEnv(e.target.value as Environment)}>
                      {(["prod", "staging", "dev"] as Environment[]).map((v) => <option key={v} value={v}>{ENV_LABEL[v]}</option>)}
                    </select>
                  </Field>
                  <Field label="Đồng bộ">
                    <select className={inputCls(false)} value={schedule} onChange={(e) => setSchedule(Number(e.target.value))}>
                      {SCHEDULES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="text-[13px]">
                  <p><b className="num">{sum.chosen.length}</b> bảng · <b className="num text-good">{sum.incremental.length}</b> tăng dần
                    {sum.full.length > 0 && <> · <b className="num">{sum.full.length}</b> làm mới toàn bộ</>} · khoảng <b className="num">{num(estRows)}</b> dòng</p>
                  <ul className="mt-1 flex flex-col gap-0.5 text-[12.5px] text-muted">
                    {sum.noKey.length > 0 && <li className="text-warn"><span className="font-mono">{sum.noKey.map((t) => t.name).join(", ")}</span> không có khóa chính: chỉ chép được nếu dưới 200.000 dòng.</li>}
                    {sum.unreadable.length > 0 && <li className="text-warn">{sum.unreadable.length} bảng role không đọc được, đã bỏ qua.</li>}
                  </ul>
                </div>
                <TablePicker tables={result.tables} picks={picks} onChange={setPicks} />
                <label className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="font-medium">Lùi mốc</span>
                  <input type="number" min={0} max={1440} className="num h-8 w-20 rounded-md border border-line bg-surface px-2" value={lookback}
                    onChange={(e) => setLookback(Math.max(0, Math.min(1440, Number(e.target.value) || 0)))} />
                  <span className="text-[12px] text-muted">phút: mỗi lần đọc lại một đoạn trước mốc để không sót giao dịch commit muộn</span>
                </label>
                <ErrorNote>{error}</ErrorNote>
                <div className="flex justify-end">
                  <Button variant="primary" disabled={!sum.chosen.length || !name.trim() || creating} onClick={create}>{creating ? "Đang kết nối…" : "Kết nối và sao chép"}</Button>
                </div>
              </>
            )}

            {step === 4 && (
              run ? (
                <div className="rounded-lg border border-line bg-surface p-5">
                  <CopyProgress run={run} title={
                    <div className="flex flex-wrap items-baseline gap-2">
                      <h2 className="text-[17px] font-semibold">Sao chép lần đầu</h2>
                      <span className="font-mono text-[12px] text-muted">{f.database}.{schemaName} → kho LVDA</span>
                    </div>} />
                  {finished && (
                    <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-line pt-4">
                      <Button onClick={() => nav(`/sources?id=${created}`)}>Xem nguồn</Button>
                      <Button variant="primary" onClick={() => { selectDb(created!); nav("/data"); }}>Mở dữ liệu</Button>
                    </div>
                  )}
                </div>
              ) : <p className="inline-flex items-center gap-1.5 text-[13px] text-muted"><Loader2 size={14} className="animate-spin" /> Đang bắt đầu…</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
