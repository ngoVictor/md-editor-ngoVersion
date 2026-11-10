import { S } from "./state";
import { preferences, setPreference } from "./preferences";
import { applyAppearance, bindAppearance } from "./theme-appearance";
import { CONTENT_THEME_PATH, isDarkTheme } from "./theme-palette";

export function applyTheme(): void {
  const dark = isDarkTheme(applyAppearance());
  const select = document.getElementById("pref-theme") as HTMLSelectElement | null;
  if (select) select.value = preferences.theme;
  S.vditor?.setTheme(dark ? "dark" : "classic", dark ? "dark" : "light", dark ? "github-dark" : "github", CONTENT_THEME_PATH);
}
export function bindTheme(): void {
  const select = document.getElementById("pref-theme") as HTMLSelectElement;
  select.onchange = () => { setPreference("theme", select.value as typeof preferences.theme); applyTheme(); };
  bindAppearance(applyTheme);
}
