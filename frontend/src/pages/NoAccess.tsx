import { KeyRound } from "lucide-react";
import { Logo } from "../components/Shell";
import { Button } from "../components/ui";
import { useSession } from "../session";

export default function NoAccess() {
  const { user, logout } = useSession();
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-7">
        <Logo />
        <div className="mt-6 flex items-start gap-3">
          <KeyRound className="mt-0.5 text-muted" size={20} />
          <div>
            <h1 className="font-semibold">Bạn chưa có quyền vào database nào</h1>
            <p className="mt-1 text-muted">
              Tài khoản <b className="text-ink">{user?.email}</b> chưa được gán quyền, hoặc quyền qua link đã hết hạn.
              Hãy xin engineer phụ trách một link chia sẻ, rồi mở link đó khi đang đăng nhập.
            </p>
          </div>
        </div>
        <div className="mt-6 flex justify-end"><Button onClick={logout}>Đăng xuất</Button></div>
      </div>
    </div>
  );
}
