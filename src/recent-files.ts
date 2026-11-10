import { subscribeDocuments } from "./document-store";
import { fallbackPathKey } from "./state";
const KEY = "alei-editor.recent-files.v1";
export function recentFiles(): string[] {
  try { const value = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(value) ? value.filter(p => typeof p === "string" && /^[a-z]:[\\/]/i.test(p)).slice(0, 30) : []; } catch { return []; }
}
export function bindRecentFiles(): void {
  subscribeDocuments((doc, kind) => {
    if (!doc?.path || doc.loadState !== "ready" || !["structure", "disk"].includes(kind)) return;
    const paths = [doc.path, ...recentFiles().filter(p => fallbackPathKey(p) !== fallbackPathKey(doc.path!))].slice(0, 30);
    try { localStorage.setItem(KEY, JSON.stringify(paths)); } catch { /* memory-only session remains usable */ }
  });
}
