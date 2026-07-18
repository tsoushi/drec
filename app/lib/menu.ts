// Home-header menu items and their user-adjustable order. The order is a
// per-device display preference, so it lives in localStorage (no DB schema
// involved). Stored value: array of `to` paths.

export type MenuItem = { to: string; label: string };

export const DEFAULT_MENU: MenuItem[] = [
  { to: "/notes", label: "ノート" },
  { to: "/calendar", label: "カレンダー" },
  { to: "/graph", label: "グラフ" },
  { to: "/stats", label: "統計" },
  { to: "/report", label: "レポート" },
  { to: "/search", label: "検索" },
  { to: "/logs", label: "ログ" },
  { to: "/export", label: "エクスポート" },
];

const KEY = "drec:menu-order";

/**
 * Read the saved order, dropping unknown paths and appending any items added
 * to the app after the order was saved (so new screens never disappear).
 */
export function loadMenuOrder(): MenuItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_MENU;
    const stored: unknown = JSON.parse(raw);
    if (!Array.isArray(stored)) return DEFAULT_MENU;
    const rest = new Map(DEFAULT_MENU.map((i) => [i.to, i]));
    const out: MenuItem[] = [];
    for (const to of stored) {
      const item = typeof to === "string" ? rest.get(to) : undefined;
      if (item) {
        out.push(item);
        rest.delete(item.to);
      }
    }
    out.push(...rest.values());
    return out;
  } catch {
    return DEFAULT_MENU;
  }
}

export function saveMenuOrder(items: MenuItem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.map((i) => i.to)));
  } catch {
    // storage unavailable (private mode etc.) — order just won't persist
  }
}

export function resetMenuOrder(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
