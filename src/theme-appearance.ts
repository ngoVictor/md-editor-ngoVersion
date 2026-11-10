import { preferences } from "./preferences";
import { resolveTheme, type ResolvedTheme } from "./theme-palette";

export function applyAppearance(): ResolvedTheme {
  const theme = resolveTheme(preferences.theme, matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = theme;
  return theme;
}

// preferences registers its storage reader first, so callbacks see the merged value.
export function bindAppearance(onChange: () => void = applyAppearance): void {
  window.addEventListener("storage", onChange);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onChange);
  onChange();
}
