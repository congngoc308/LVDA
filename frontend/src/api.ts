const TOKEN_KEY = "lvda.token";

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}
/** remember = false ("Ghi nhớ đăng nhập" bỏ tích): token chỉ sống trong tab này, đóng trình duyệt là phải đăng nhập lại. */
export function setToken(t: string | null, remember = true) {
  try {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    if (t) (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, t);
  } catch { /* bỏ qua */ }
}

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail: unknown) { super(message); this.status = status; this.detail = detail; }
}

/** Tải nội dung văn bản (ví dụ YAML xuất ra) có kèm token. */
export async function apiText(path: string): Promise<string> {
  const token = getToken();
  const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, "Không tải được.", null);
  return res.text();
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = data?.detail;
    const msg = typeof detail === "string" ? detail : detail?.message ?? "Có lỗi xảy ra. Thử lại sau.";
    if (res.status === 401) { setToken(null); window.dispatchEvent(new Event("lvda:logout")); }
    throw new ApiError(res.status, msg, detail);
  }
  return data as T;
}
