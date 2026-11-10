import { activeDoc } from "./state";
import { archiveService } from "./file-service";
import { applyDocumentEdit, syncDocFromEditor } from "./editor-sync";
import { setDocumentStatus } from "./document-store";
import { t } from "./i18n";

let generation = 0;
export function bindHistoryView(): void {
  const panel = document.getElementById("versions-panel")!;
  const list = document.getElementById("versions-list") as HTMLSelectElement;
  const preview = document.getElementById("version-preview")!;
  const status = document.getElementById("versions-status")!;
  const restore = document.getElementById("version-restore") as HTMLButtonElement;
  let selected: { docId: string; revision: number; content: string; path: string } | null = null;
  let openingDocId: string | null = null;
  const selectVersion = async () => {
    const token = ++generation, doc = activeDoc(); selected = null; restore.disabled = true; preview.textContent = "";
    if (!doc?.path || doc.id !== openingDocId || !list.value) { status.textContent = t("versionChanged"); return; }
    syncDocFromEditor(doc); const revision = doc.revision, path = doc.path;
    try {
      const content = await archiveService().readVersion(path, list.value);
      if (token !== generation) return;
      syncDocFromEditor(doc);
      if (activeDoc()?.id !== doc.id || doc.revision !== revision || doc.path !== path || doc.pendingInput) { status.textContent = t("versionChanged"); return; }
      selected = { docId: doc.id, revision, content, path }; preview.textContent = content.slice(0, 20000);
      restore.disabled = false; status.textContent = content.length > 20000 ? "…" : "";
    } catch (error) { if (token === generation) status.textContent = String(error); }
  };
  list.onchange = () => { void selectVersion(); };
  document.getElementById("btn-versions")!.onclick = async () => {
    const token = ++generation, doc = activeDoc(); panel.hidden = false; list.replaceChildren(); preview.textContent = ""; selected = null; restore.disabled = true;
    openingDocId = doc?.id || null;
    if (!doc?.path || doc.loadState !== "ready") { status.textContent = t("noVersions"); return; }
    status.textContent = t("loading"); const path = doc.path;
    try {
      const entries = await archiveService().listVersions(path);
      if (token !== generation || activeDoc()?.id !== doc.id || doc.path !== path) return;
      for (const entry of entries) { const option = document.createElement("option"); option.value = entry.id; option.textContent = `${new Date(entry.modifiedMs).toLocaleString()} · ${entry.encoding} · ${entry.size} B`; list.append(option); }
      status.textContent = entries.length ? "" : t("noVersions");
      if (entries.length) await selectVersion();
    } catch (error) { if (token === generation) status.textContent = `${t("desktopOnly")}: ${String(error)}`; }
  };
  restore.onclick = () => {
    const doc = activeDoc(); if (doc) syncDocFromEditor(doc);
    if (!selected || !doc || doc.saveState !== "idle" || doc.id !== selected.docId || doc.path !== selected.path || doc.revision !== selected.revision || doc.pendingInput) { status.textContent = t("versionChanged"); return; }
    if (applyDocumentEdit(doc, selected.content)) {
      // A restored version must remain reviewable until an explicit manual save, even with autosave enabled.
      setDocumentStatus(doc, { saveError: t("historyHint") }); panel.hidden = true; selected = null;
    }
  };
  document.getElementById("versions-close")!.onclick = () => { ++generation; selected = null; panel.hidden = true; };
}
