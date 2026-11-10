// Coordinates local links through the existing document lifecycle; no direct IPC or state writes.
import { S, activeDoc } from "./state";
import { fileService } from "./file-service";
import { openDoc, switchDoc } from "./docs";
import { findDocumentByPath, subscribeDocuments } from "./document-store";
import { editorIsComposing, syncDocFromEditor } from "./editor-sync";
import { scrollToHash } from "./heading";
import { cancelScrollRestore } from "./scroll";
import { showError } from "./ui";
import { t } from "./i18n";
let request = 0, activation = 0, lastId = S.activeId;
subscribeDocuments(() => { if (lastId !== S.activeId) { lastId = S.activeId; activation++; } });
const available = () => !!S.vditor && !S.switchInFlight && !S.windowTransfer && !editorIsComposing();
export async function openDocumentLink(path: string, hash: string): Promise<boolean> {
  if (!available()) return false;
  const source = activeDoc(); if (!source) return false;
  syncDocFromEditor(source);
  const token = ++request, epoch = activation, revision = source.revision, editor = S.vditor;
  const current = () => token === request && epoch === activation && activeDoc() === source && source.revision === revision && S.vditor === editor && available();
  const oldPreviewNode = document.querySelector("#editor .vditor-preview .vditor-reset")?.firstChild;
  try {
    // Reuse an already loaded document, including unsaved drafts whose file has disappeared.
    const key = await fileService().pathKey(path);
    if (activeDoc() === source) syncDocFromEditor(source);
    if (!current()) return false;
    let target = findDocumentByPath(path, key);
    if (target?.loadState === "ready") switchDoc(target.id);
    else {
      const result = await fileService().openFile(path);
      if (activeDoc() === source) syncDocFromEditor(source);
      if (!current()) return false;
      target = openDoc(path, result.content, path.split(/[\\/]/).pop(), result.encoding, result.mtimeMs, result.size, result.pathKey, result.fingerprint);
    }
    if (activeDoc() !== target) return false;
    if (!hash) return true;
    cancelScrollRestore();
    const targetEpoch = activation, targetRevision = target.revision;
    // SV preview renders asynchronously. Stop on any navigation/edit/rebuild, including away-and-back.
    const deadline = performance.now() + 2000;
    while (performance.now() < deadline) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      if (token !== request || activation !== targetEpoch || activeDoc() !== target || target.revision !== targetRevision || S.vditor !== editor || !available()) return false;
      if (target !== source && S.currentMode === "sv" && document.querySelector("#editor .vditor-preview .vditor-reset")?.firstChild === oldPreviewNode) continue;
      if (scrollToHash(hash)) return true;
    }
    showError(t("linkAnchorMissing") + hash); return false;
  } catch (error) { if (current()) showError(t("openLinkFail") + String(error)); return false; }
}
