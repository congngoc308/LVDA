import { useSyncExternalStore } from "react";

export type Theme = "dark" | "light";

const KEY = "lvda:theme";
const listeners = new Set<() => void>();

/** Chế độ đang dùng: script trong index.html đã gắn data-theme trước khi vẽ (lựa chọn đã lưu, nếu không thì theo hệ điều hành). */
export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* trình duyệt chặn lưu: vẫn đổi được trong phiên này */ }
  listeners.forEach((l) => l());
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const t = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, currentTheme);
  return [t, setTheme];
}
