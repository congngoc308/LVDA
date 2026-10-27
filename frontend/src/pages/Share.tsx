import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { PageHeader } from "../components/ui";
import { AuditPanel } from "./Audit";
import { MembersPanel } from "./Members";

/** Chia sẻ & nhật ký: ai được vào database, qua đường nào, và mọi thao tác đã làm. */
export default function SharePage() {
  const { hash } = useLocation();
  useEffect(() => { if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" }); }, [hash]);
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Chia sẻ & nhật ký"
        subtitle="Quyền gắn với từng database. Link chia sẻ có hạn, thu hồi được, và không cấp được quyền chứng nhận chỉ số. Mọi thao tác đều được ghi lại." />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1000px] flex-col gap-6 p-8">
          <MembersPanel />
          <div id="audit" className="scroll-mt-6"><AuditPanel /></div>
        </div>
      </div>
    </div>
  );
}
