import { EyeOff, FileClock, KeyRound, Link2, Lock, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { CtaBand, PageHero, Section, SectionHead, usePageTitle } from "../ui";

function Block({ icon, title, items }: { icon: ReactNode; title: string; items: ReactNode[] }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-6">
      <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-lg bg-accent-soft text-accent">{icon}</span><div className="text-[17px] font-semibold">{title}</div></div>
      <ul className="mt-4 space-y-2.5 text-[14.5px] leading-[1.6] text-muted">
        {items.map((it, i) => <li key={i} className="flex gap-2.5"><span className="mt-[9px] size-1 shrink-0 rounded-full bg-faint" aria-hidden />{it}</li>)}
      </ul>
    </div>
  );
}

export default function SecurityPage() {
  usePageTitle("Bảo mật");
  return (
    <>
      <PageHero eyebrow="Bảo mật" title="LVDA chỉ có quyền đọc trên database nguồn"
        lead="LVDA từ chối role nguồn có quyền ghi, chỉ chạy câu SELECT hoặc WITH và ghi truy cập, thay đổi cấu hình vào nhật ký." />
      <Section sunk>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Block icon={<Lock size={18} />} title="Chỉ đọc từ kết nối tới truy vấn" items={[
            "Role nguồn có quyền ghi bị từ chối khi kết nối",
            "Phiên đồng bộ chạy ở chế độ chỉ đọc",
            <>Câu hỏi chạy bằng role <span className="font-mono text-ink-2">lvda_reader</span>, tối đa 10 giây</>,
          ]} />
          <Block icon={<ShieldCheck size={18} />} title="Chặn câu lệnh trước khi chạy" items={[
            "Chỉ nhận một câu SELECT hoặc WITH",
            "Câu dùng hàm hoặc schema bị cấm bị chặn ngay, không gửi cho model",
            <>Catalog được bọc trong thẻ <span className="font-mono text-ink-2">&lt;data&gt;</span> và chỉ được đọc như dữ liệu</>,
          ]} />
          <Block icon={<KeyRound size={18} />} title="Chuỗi kết nối và secret" items={[
            "Chuỗi kết nối được mã hóa bằng Fernet, API không trả lại",
            "Khi đổi mật khẩu, LVDA kiểm lại quyền chỉ đọc",
            "gitleaks quét secret ở mỗi pull request",
          ]} />
          <Block icon={<EyeOff size={18} />} title="Che cột nhạy cảm" items={[
            "Cột PII bị che ngay ở API, kể cả khi người dùng tự viết SQL",
            "Luật V10 báo khi SQL lộ cột nhạy cảm",
          ]} />
          <Block icon={<Link2 size={18} />} title="Phân quyền và link mời" items={[
            "Quyền theo từng database: Xem và hỏi, hoặc Sửa",
            "Link mời không cấp quá quyền người tạo, có hạn dùng và số lượt",
            "Thu hồi link thì người đã vào bằng link đó mất quyền",
          ]} />
          <Block icon={<FileClock size={18} />} title="Nhật ký chỉ ghi thêm" items={[
            "Ghi truy cập và thay đổi về chỉ số, duyệt, cấu hình, dữ liệu",
            "Mỗi dòng log có request_id, tra được trong tab Đánh giá",
          ]} />
        </div>
      </Section>
      <Section>
        <SectionHead eyebrow="Ngắt kết nối" title="Ngắt một nguồn sẽ xóa mọi dữ liệu của nguồn đó trong LVDA"
          lead="Bạn gõ lại tên database để xác nhận. LVDA xóa bản chép dữ liệu, lịch sử đồng bộ và danh sách thành viên; database nguồn không bị đụng tới." />
      </Section>
      <CtaBand />
    </>
  );
}
