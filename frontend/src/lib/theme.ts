export type ThemePref = "light" | "dark" | "system";
const KEY = "theme";

export function resolveTheme(pref: ThemePref, prefersDark: boolean): "light" | "dark" {
  if (pref === "system") return prefersDark ? "dark" : "light";
  return pref;
}

export function getStoredPref(): ThemePref {
  const v = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

/**
 * Tell the browser which theme it is showing. The `.dark` class re-colours
 * what we paint; `color-scheme` covers what the user agent paints: the base
 * canvas before first paint (the white flash on a full load), scrollbars,
 * native controls and the mobile overscroll area.
 *
 * index.css declares it on `:root` and `.dark` too; this inline stamp holds
 * before any stylesheet loads, as does the pre-paint script in index.html.
 *
 * `theme-color` (the mobile address bar) takes the page's --background token
 * so the two cannot drift.
 */
function applyBrowserScheme(resolved: "light" | "dark"): void {
  const root = document.documentElement;
  root.style.colorScheme = resolved;
  const bg = getComputedStyle(root).getPropertyValue("--background").trim();
  if (!bg) return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = bg;
}

/**
 * Everything that draws the current theme, so a change through one control is
 * seen by the others. The site header does not re-render when the theme is
 * changed in the memoised profile menu's Settings dialog, so it subscribes.
 * Listeners are told to re-read, not given the value.
 */
type ThemeListener = () => void;
const listeners = new Set<ThemeListener>();

export function subscribeTheme(fn: ThemeListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function applyTheme(pref: ThemePref): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(KEY, pref);
  const prefersDark =
    typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = resolveTheme(pref, prefersDark);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  applyBrowserScheme(resolved);
  for (const fn of listeners) fn();
}
