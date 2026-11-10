// Shared by editor and read-only windows; no editor or document dependencies.
export const THEMES = ["light", "dark", "eye", "paper", "claude", "system"] as const;
export type ThemePreference = typeof THEMES[number];
export type ResolvedTheme = Exclude<ThemePreference, "system">;
export function isDarkTheme(theme: ResolvedTheme): boolean {
  return theme === "dark" || theme === "claude";
}
export function resolveTheme(theme: ThemePreference, systemDark: boolean): ResolvedTheme {
  return theme === "system" ? (systemDark ? "dark" : "light") : theme;
}
export const CONTENT_THEME_PATH = "/vditor-assets/dist/css/content-theme";
