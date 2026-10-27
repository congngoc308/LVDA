import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Shell } from "./components/Shell";
import { useSession } from "./session";
import LoginPage from "./pages/Login";
import JoinPage from "./pages/Join";
import Workbench from "./pages/Workbench";
import EvaluationPage from "./pages/Evaluation";
import NoAccess from "./pages/NoAccess";
import SharePage from "./pages/Share";
import ConnectPage from "./pages/Connect";
import SourcesPage from "./pages/Sources";

// React Flow chỉ dùng ở tab Dữ liệu: tách chunk để các tab khác không phải tải
const DataPage = lazy(() => import("./pages/Data"));
const dataPage = <Suspense fallback={<div className="grid h-full place-items-center text-muted">Đang tải…</div>}><DataPage /></Suspense>;
// Landing giới thiệu: công khai, không cần đăng nhập, tách chunk riêng
const Landing = lazy(() => import("./landing/Landing"));
const landing = <Suspense fallback={<div className="grid h-full place-items-center text-muted">Đang tải…</div>}><Landing /></Suspense>;

function Protected({ children, engineer = false }: { children: React.ReactNode; engineer?: boolean }) {
  const { user, db, loading } = useSession();
  const loc = useLocation();
  if (loading) return <div className="grid h-full place-items-center text-muted">Đang tải…</div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (!db) return <NoAccess />;
  if (engineer && db.role !== "engineer") return <Navigate to="/" replace />;
  return <Shell>{children}</Shell>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/join/:token" element={<JoinPage />} />
      <Route path="/gioi-thieu/*" element={landing} />
      {/* Hỏi & kiểm; /metrics và /settings mở panel cấu hình agent ngay trên màn hình hỏi */}
      <Route path="/" element={<Protected><Workbench /></Protected>} />
      <Route path="/runs/:runId" element={<Protected><Workbench /></Protected>} />
      <Route path="/metrics" element={<Protected><Workbench /></Protected>} />
      <Route path="/metrics/:metricId" element={<Protected><Workbench /></Protected>} />
      <Route path="/settings" element={<Protected><Workbench /></Protected>} />
      <Route path="/data" element={<Protected>{dataPage}</Protected>} />
      <Route path="/data/:schema/:name" element={<Protected>{dataPage}</Protected>} />
      <Route path="/eval" element={<Protected engineer><EvaluationPage /></Protected>} />
      <Route path="/share" element={<Protected engineer><SharePage /></Protected>} />
      <Route path="/sources" element={<Protected><SourcesPage /></Protected>} />
      <Route path="/sources/connect" element={<Protected><ConnectPage /></Protected>} />
      <Route path="/connect" element={<Navigate to="/sources/connect" replace />} />
      {/* đường dẫn cũ: giữ để link đã lưu vẫn mở được */}
      <Route path="/reviews" element={<Navigate to="/eval?queue=1" replace />} />
      <Route path="/members" element={<Navigate to="/share?tab=members" replace />} />
      <Route path="/audit" element={<Navigate to="/share?tab=audit" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
