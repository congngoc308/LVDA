import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { cx, ErrorNote } from "../components/ui";
import { useSession } from "../session";
import { AuditTable, type AuditEvent } from "./Audit";
import { LinksPanel, MembersTable, type LinkRow, type MemberRow } from "./Members";

type Tab = "members" | "links" | "audit";

/** Chia sẻ & nhật ký: ai được vào database, qua đường nào, và mọi thao tác đã làm; ba tab, chọn tab ghi vào ?tab=. */
export default function SharePage() {
  const { db, user } = useSession();
  const canManage = db?.role === "engineer" && db.granted_via === "direct";
  const [params, setParams] = useSearchParams();
  const { hash } = useLocation();
  const want = params.get("tab") ?? hash.slice(1); // #audit: đường dẫn cũ
  // tab đầu (mặc định) là Link chia sẻ; ai không quản lý link thì mặc định Thành viên
  const first: Tab = canManage ? "links" : "members";
  const tab: Tab = want === "audit" ? "audit" : want === "members" ? "members" : want === "links" && canManage ? "links" : first;
  const go = (t: Tab) => setParams(t === first ? {} : { tab: t }, { replace: true });

  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!db) return;
    api<MemberRow[]>(`/db/${db.id}/members`).then(setMembers).catch((e) => setError(e.message));
    if (canManage) api<LinkRow[]>(`/db/${db.id}/share-links`).then(setLinks).catch(() => {});
    api<AuditEvent[]>(`/db/${db.id}/audit`).then(setEvents).catch((e) => setError(e.message));
  }, [db, canManage]);
  useEffect(load, [load]);
  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); load(); } catch (e) { setError(e instanceof Error ? e.message : "Thao tác thất bại."); }
  }, [load]);
  const names = useMemo(() => new Map((members ?? []).map((m) => [m.user_id, m.name])), [members]);
  if (!db) return null;

  const tabs: [Tab, string, number | undefined][] = [
    ...(canManage ? [["links", "Link chia sẻ", links.filter((l) => l.state === "active").length] as [Tab, string, number]] : []),
    ["members", "Thành viên", members?.length], ["audit", "Nhật ký", events?.length],
  ];
  const loading = <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-5">{[0, 1, 2, 3].map((i) => <div key={i} className="h-9 animate-pulse rounded bg-sunk" />)}</div>;

  return (
    <div className="flex h-full flex-col">
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-5 px-4 pb-14 pt-9 md:px-8">
          {!canManage && <p className="rounded-md bg-sunk px-3 py-2 text-[13px] text-muted">Bạn có quyền engineer qua link nên chỉ xem được. Quản lý thành viên và link cần engineer được gán trực tiếp.</p>}
          <ErrorNote>{error}</ErrorNote>

          <div role="tablist" className="flex flex-wrap items-center gap-6 border-b border-line">
            {tabs.map(([k, l, n]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => go(k)}
                className={cx("flex h-[42px] items-center gap-[7px] whitespace-nowrap text-[14px]", tab === k ? "text-ink shadow-[inset_0_-2px_0_var(--color-accent)]" : "text-faint hover:text-ink")}>
                {l}<span className="font-mono text-[12px] text-dim">{n ?? ""}</span>
              </button>
            ))}
          </div>

          {tab === "members" && (members ? <MembersTable members={members} canManage={canManage} selfId={user?.id} dbId={db.id} act={act} /> : loading)}
          {tab === "links" && <LinksPanel links={links} dbId={db.id} act={act} />}
          {tab === "audit" && (events ? <AuditTable events={events} names={names} /> : loading)}
        </div>
      </div>
    </div>
  );
}
