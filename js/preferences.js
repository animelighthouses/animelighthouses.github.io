/**
 * LocalStorage-backed UI preferences (theme, title mode).
 * Theme boot script duplicates THEME_STORAGE_KEY — keep literal in sync with js/theme-boot.js.
 */

export const THEME_STORAGE_KEY = "animelighthouse.theme";
export const TITLE_MODE_STORAGE_KEY = "animelighthouse.titleMode";

export const TITLE_MODE_VALUES = new Set(["title_en", "title_r", "title_jp"]);

export function normalizeTitleMode(value, fallback = "title_r") {
  return TITLE_MODE_VALUES.has(value) ? value : fallback;
}

export function readStoredTitleMode(fallback = "title_r") {
  try {
    const raw = localStorage.getItem(TITLE_MODE_STORAGE_KEY);
    return normalizeTitleMode(raw, fallback);
  } catch {
    return fallback;
  }
}

export function persistTitleMode(value) {
  if (!TITLE_MODE_VALUES.has(value)) return;
  try {
    localStorage.setItem(TITLE_MODE_STORAGE_KEY, value);
  } catch (_) {}
}

export function readStoredTheme() {
  try {
    if (localStorage.getItem(THEME_STORAGE_KEY) === "light") return "light";
  } catch (_) {}
  return "dark";
}

export function persistTheme(theme) {
  const t = theme === "light" ? "light" : "dark";
  try {
    if (t === "light") localStorage.setItem(THEME_STORAGE_KEY, "light");
    else localStorage.removeItem(THEME_STORAGE_KEY);
  } catch (_) {}
}

export function applyThemeAttr(theme) {
  const t = theme === "light" ? "light" : "dark";
  if (t === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
}
