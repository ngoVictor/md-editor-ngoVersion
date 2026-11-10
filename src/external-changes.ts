import { confirm } from "@tauri-apps/plugin-dialog";
import { S, activeDoc, type Doc } from "./state";
import { fileService } from "./file-service";
import { replaceDocumentFromDisk, setDocumentStatus, subscribeDocuments } from "./document-store";
import { mountDocument, syncDocFromEditor, editorIsComposing } from "./editor-sync";
import { t } from "./i18n";

let refresh: () => void = () => {};
let retry: (doc: Doc) => Promise<void> = async () => {};
let checking = false;
export async function checkExternalChanges(): Promise<void> {
  if (S.windowTransfer || checking || document.hidden) return;
  checking = true;
  try {
    // Fingerprints require reading file contents. Poll only the visible document;
    // inactive documents are still protected by compare-and-save on every write.
    const current = activeDoc();
    for (const doc of current ? [current] : []) {
      if (!doc.path || doc.loadState !== "ready" || doc.saveState === "saving") continue;
      const path = doc.path, baseline = doc.fingerprint;
      try {
        const disk = await fileService().statFile(path);
        if (!S.docs.includes(doc) || doc.path !== path || doc.fingerprint !== baseline || doc.saveState !== "idle") continue;
        setDocumentStatus(doc, { externalChange: !disk ? "deleted" : disk.fingerprint !== baseline ? "changed" : null });
      } catch { /* Save still performs compare-and-save; a transient stat error does not rewrite the baseline. */ }
    }
  } finally { checking = false; refresh(); }
}
export async function reloadDocument(doc: Doc): Promise<boolean> {
  if (!doc.path || doc.saveState !== "idle" || S.windowTransfer || S.switchInFlight || editorIsComposing()) return false;
  syncDocFromEditor(doc);
  const revision = doc.revision, path = doc.path, fingerprint = doc.fingerprint;
  if (doc.dirty) {
    let ok: boolean;
    try { ok = await confirm(t("reloadConfirm"), { title: t("reload"), kind: "warning" }); }
    catch { ok = window.confirm(t("reloadConfirm")); }
    if (!ok) return false;
  }
  try {
    const disk = await fileService().openFile(path);
    syncDocFromEditor(doc);
    if (!S.docs.includes(doc) || doc.path !== path || doc.revision !== revision || doc.fingerprint !== fingerprint || doc.saveState !== "idle" || doc.pendingInput || S.windowTransfer || S.switchInFlight || editorIsComposing()) return false;
    replaceDocumentFromDisk(doc, { ...disk, path, name: doc.name });
    if (activeDoc()?.id === doc.id && !S.switchInFlight) mountDocument(doc);
    refresh(); return true;
  } catch (error) { setDocumentStatus(doc, { saveError: String(error) }); refresh(); return false; }
}
function renderStatus(): void {
  const box = document.getElementById("document-status")!, doc = activeDoc();
  box.replaceChildren(); box.hidden = true;
  if (!doc) return;
  let message = "", action: (() => void) | null = null, label = "";
  if (doc.loadState !== "ready") {
    message = doc.loadState === "error" ? `${t("loadError")}: ${doc.saveError}` : t("loading");
    if (doc.loadState === "error") { action = () => { void retry(doc); }; label = t("retry"); }
  } else if (doc.externalChange) {
    message = t(doc.externalChange === "deleted" ? "externalDeleted" : "externalChanged");
    if (doc.externalChange === "changed") { action = () => { void reloadDocument(doc); }; label = t("reload"); }
  } else if (doc.saveError) message = `${t("savePaused")}: ${doc.saveError}`;
  if (!message) return;
  box.hidden = false; box.append(message);
  if (action) { const button = document.createElement("button"); button.textContent = label; button.onclick = action; box.append(button); }
}
export function bindExternalChanges(refreshUi: () => void, retryLoading: (doc: Doc) => Promise<void>): void {
  refresh = () => { renderStatus(); refreshUi(); }; retry = retryLoading;
  subscribeDocuments((_doc, kind) => { renderStatus(); if (kind === "structure") window.setTimeout(() => { void checkExternalChanges(); }, 0); }); renderStatus();
  window.addEventListener("focus", () => { void checkExternalChanges(); });
  window.setInterval(() => { void checkExternalChanges(); }, 15000);
}
