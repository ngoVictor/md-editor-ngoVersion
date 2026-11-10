import { S, activeDoc } from "./state";
import { preferences, setPreference } from "./preferences";
import { syncDocFromEditor, editorIsComposing } from "./editor-sync";
import { saveDoc } from "./save";

let running = false;
export async function autosaveDirty(): Promise<void> {
  if (S.windowTransfer || running || !preferences.autosave || S.switchInFlight || editorIsComposing()) return;
  if (!document.getElementById("close-confirm")?.hidden) return;
  running = true;
  try {
    const current = activeDoc(); if (current) syncDocFromEditor(current);
    for (const doc of [...S.docs]) {
      if (!preferences.autosave) break;
      if (doc.path && doc.dirty && doc.loadState === "ready" && !doc.externalChange && !doc.saveError) await saveDoc(doc, false, true, true);
    }
  } finally { running = false; }
}
export function bindAutosave(): void {
  const checkbox = document.getElementById("pref-autosave") as HTMLInputElement;
  checkbox.checked = preferences.autosave;
  checkbox.onchange = () => setPreference("autosave", checkbox.checked);
  window.setInterval(() => { void autosaveDirty(); }, 30000);
  window.addEventListener("blur", () => { void autosaveDirty(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) void autosaveDirty(); });
}
