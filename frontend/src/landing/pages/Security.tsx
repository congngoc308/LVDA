import { EyeOff, FileClock, KeyRound, Link2, Lock, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { CtaBand, PageHero, Section, SectionHead, usePageTitle } from "../ui";

function Block({ icon, title, items }: { icon: ReactNode; title: string; items: ReactNode[] }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-6">
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
      <PageHero eyebrow="Bảo mật" title="LVDA không bao giờ sửa được database của bạn"
        lead="Quyền đọc được kiểm trước khi nhận, câu lệnh được chặn trước khi chạy, và mọi thao tác quan trọng nằm trong nhật ký chỉ ghi thêm." />
      <Section sunk>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Block icon={<Lock size={18} />} title="Chỉ đọc ở mọi tầng" items={[
            "Role nguồn có bất kỳ quyền ghi nào bị từ chối khi kết nối",
            "Phiên đồng bộ chạy ở chế độ chỉ đọc",
            <>Câu hỏi chạy bằng role <span className="font-mono text-ink-2">lvda_reader</span>: chỉ SELECT trên schema kho, giới hạn 10 giây mỗi câu</>,
          ]} />
          <Block icon={<ShieldCheck size={18} />} title="Chặn câu lệnh trước khi chạy" items={[
            "Chỉ nhận đúng một câu SELECT hoặc WITH",
            "Hàm và schema bị cấm được chặn ngay, không qua model",
            <>Nội dung catalog đưa vào prompt nằm trong thẻ <span className="font-mono text-ink-2">&lt;data&gt;</span>, không được coi là chỉ dẫn</>,
          ]} />
          <Block icon={<KeyRound size={18} />} title="Bí mật không đi ra ngoài" items={[
            "Chuỗi kết nối mã hóa bằng Fernet, API không bao giờ trả lại",
            "Đổi mật khẩu nguồn thì kết nối và quyền chỉ đọc được kiểm lại trước khi lưu",
            "CI quét secret bằng gitleaks trên mỗi pull request",
          ]} />
          <Block icon={<EyeOff size={18} />} title="Che cột nhạy cảm" items={[
            "Cột PII được che với người xem ngay ở tầng API, kể cả với SQL tự viết",
            "Luật V10 báo khi câu SQL lộ cột nhạy cảm",
          ]} />
          <Block icon={<Link2 size={18} />} title="Phân quyền và link mời" items={[
            "Quyền theo từng database: Xem và hỏi, hoặc Sửa",
            "Link mời không cấp quyền cao hơn người tạo, có hạn dùng và số lượt",
            "Người vào bằng link không chứng nhận được chỉ số; thu hồi link là gỡ họ",
            "Chỉ engineer được giao trực tiếp mới quản lý thành viên và link",
          ]} />
          <Block icon={<FileClock size={18} />} title="Nhật ký chỉ ghi thêm" items={[
            "Ghi truy cập, chỉ số, duyệt, cấu hình và dữ liệu",
            "Mỗi yêu cầu có request_id xuyên qua mọi dòng log, tra được trong tab Đánh giá",
          ]} />
        </div>
      </Section>
      <Section>
        <SectionHead eyebrow="Ngắt kết nối" title="Gỡ một nguồn là gỡ hết dấu vết của nó trong LVDA"
          lead="Ngắt kết nối cần gõ lại tên database để xác nhận. LVDA xóa bản chép, lịch sử đồng bộ và thành viên của database đó. Database nguồn không bị đụng tới." />
      </Section>
      <CtaBand />
    </>
  );
}
