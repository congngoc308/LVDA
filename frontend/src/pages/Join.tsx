import { Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { Logo } from "../components/Shell";
import { Button, ErrorNote, fmtDate } from "../components/ui";
import { useSession } from "../session";
import { LoginForm } from "./Login";

interface Preview {
  database_id: number; database_name: string; role: "viewer" | "engineer"; expires_at: string;
  created_by_name: string; problem: string | null; current_role: string | null;
}
const ROLE_TEXT = { viewer: "Xem và hỏi (viewer)", engineer: "Sửa (engineer, không chứng nhận chỉ số)" };

export default function JoinPage() {
  const { token = "" } = useParams();
  const { user, loading, refresh, selectDb } = useSession();
  const nav = useNavigate();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    api<Preview>("/share-links/preview", { body: { token } }).then(setPreview).catch((e) => setError(e.message));
  }, [user, token]);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ database_id: number }>("/share-links/accept", { body: { token } });
      await refresh();
      selectDb(r.database_id);
      nav("/");
    } catch (e) { setError(e instanceof Error ? e.message : "Không nhận được quyền."); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-full place-items-center p-6">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-7">
        <Logo />
        <div className="mt-6 flex items-center gap-2 font-semibold"><Link2 size={18} /> Lời mời vào database</div>
        {loading ? <p className="mt-4 text-muted">Đang tải…</p> : !user ? (
          <div className="mt-3">
            <p className="mb-4 text-muted">Đăng nhập để xem lời mời. Link chỉ dùng được khi bạn đã đăng nhập.</p>
            <LoginForm />
          </div>
        ) : preview ? (
          <div className="mt-4 flex flex-col gap-4">
            <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-[13.5px]">
              <dt className="text-muted">Database</dt><dd className="font-medium">{preview.database_name}</dd>
              <dt className="text-muted">Quyền</dt><dd>{ROLE_TEXT[preview.role]}</dd>
              <dt className="text-muted">Người mời</dt><dd>{preview.created_by_name}</dd>
              <dt className="text-muted">Hết hạn</dt><dd>{fmtDate(preview.expires_at)}</dd>
              {preview.current_role && <><dt className="text-muted">Hiện tại</dt><dd>Bạn đang có quyền {preview.current_role}</dd></>}
            </dl>
            <ErrorNote>{preview.problem ?? error}</ErrorNote>
            <div className="flex justify-end gap-2">
              <Button onClick={() => nav("/")}>Để sau</Button>
              <Button variant="primary" disabled={!!preview.problem || busy} onClick={accept}>{busy ? "Đang nhận…" : "Nhận quyền"}</Button>
            </div>
          </div>
        ) : <div className="mt-4"><ErrorNote>{error}</ErrorNote>{!error && <p className="text-muted">Đang kiểm tra link…</p>}</div>}
      </div>
    </div>
  );
}
