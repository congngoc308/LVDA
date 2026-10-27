import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "./api";
import type { DatabaseRef, User } from "./types";

const DB_KEY = "lvda.db";

interface Session {
  user: User | null;
  databases: DatabaseRef[];
  db: DatabaseRef | null;
  canConnect: boolean; // engineer ở đâu đó thì được kết nối nguồn mới

  loading: boolean;
  login: (email: string, password: string, remember?: boolean) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  selectDb: (id: number) => void;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [databases, setDatabases] = useState<DatabaseRef[]>([]);
  const [canConnect, setCanConnect] = useState(false);
  const [dbId, setDbId] = useState<number | null>(() => {
    try { const v = localStorage.getItem(DB_KEY); return v ? Number(v) : null; } catch { return null; }
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) { setUser(null); setDatabases([]); setLoading(false); return; }
    try {
      const me = await api<{ user: User; databases: DatabaseRef[]; can_connect: boolean }>("/auth/me");
      setUser(me.user);
      setDatabases(me.databases);
      setCanConnect(me.can_connect);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const onLogout = () => { setUser(null); setDatabases([]); };
    window.addEventListener("lvda:logout", onLogout);
    return () => window.removeEventListener("lvda:logout", onLogout);
  }, []);

  const login = useCallback(async (email: string, password: string, remember = true) => {
    const res = await api<{ token: string }>("/auth/login", { body: { email, password } });
    setToken(res.token, remember);
    setLoading(true);
    await refresh();
  }, [refresh]);

  const register = useCallback(async (email: string, password: string, name?: string) => {
    const res = await api<{ token: string }>("/auth/register", { body: { email, password, name } });
    setToken(res.token);
    setLoading(true);
    await refresh();
  }, [refresh]);

  const logout = useCallback(() => { setToken(null); setUser(null); setDatabases([]); }, []);

  const selectDb = useCallback((id: number) => {
    setDbId(id);
    try { localStorage.setItem(DB_KEY, String(id)); } catch { /* bỏ qua */ }
  }, []);

  const active = databases.filter((d) => !d.expired);
  const db = active.find((d) => d.id === dbId) ?? active[0] ?? null;

  const value = useMemo(() => ({ user, databases, db, canConnect, loading, login, register, logout, refresh, selectDb }),
    [user, databases, db, canConnect, loading, login, register, logout, refresh, selectDb]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession ngoài SessionProvider");
  return s;
}
