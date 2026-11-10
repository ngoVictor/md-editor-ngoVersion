import { THEMES, type ThemePreference } from "./theme-palette";
export interface Preferences { theme: ThemePreference; autosave: boolean; restoreSession: boolean; outlineWidth: number; sourceEditor: string }
const defaults: Preferences = { theme: "light", autosave: false, restoreSession: false, outlineWidth: 240, sourceEditor: "" };
const KEY = "alei-editor.preferences.v1";
function read(): Preferences {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { sourceEditor: typeof p.sourceEditor === "string" ? p.sourceEditor : "", theme: THEMES.includes(p.theme) ? p.theme : defaults.theme,
      autosave: p.autosave === true, restoreSession: p.restoreSession === true,
      outlineWidth: Number.isFinite(p.outlineWidth) ? Math.min(480, Math.max(150, p.outlineWidth)) : defaults.outlineWidth };
  } catch { return { ...defaults }; }
}
export const preferences = read();
export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  Object.assign(preferences, read());
  preferences[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(preferences)); } catch { /* session-only preferences */ }
}

// Independent windows share preferences without overwriting unrelated settings.
window.addEventListener("storage", event => { if (event.key === KEY || event.key === null) Object.assign(preferences, read()); });
