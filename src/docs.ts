// docs.ts —— 文档会话协调：编辑器、文档仓库、标签 UI 与打开/关闭流程。
import { S, activeDoc, type Doc } from "./state";
import { t, welcomeMd } from "./i18n";
import { saveScroll, restoreScroll } from "./scroll";
import { rebuildOutline, scheduleOutline, setRefreshUi } from "./outline";
import { registerInputHook, registerAfterHook } from "./vditor";
import { saveDoc, showCloseConfirm, setRefreshDocUi, pauseBackgroundSaves, waitForPendingSave } from "./save";
import { syncDocFromEditor, withSuppressInput, mountDocument, scheduleEditorSync, setEditorRefresh, editorIsComposing } from "./editor-sync";
import { showError } from "./ui";
import { fileService } from "./file-service";
import {
  activateDocument,
  addDocument,
  createDocument,
  findDocumentByPath,
  removeDocument,
  replaceDocumentFromDisk,
  setDocumentStatus,
} from "./document-store";
import {
  renderTabs as renderTabsUi,
  updateTitle,
  showEmptyState as showEmptyStateUi,
  hideEmptyState,
} from "./tabs";

export { updateTitle };

export function renderTabs(): void {
  renderTabsUi(switchDoc, (id) => { void closeDoc(id); });
}

export function switchDoc(id: string): void {
  const target = S.docs.find((doc) => doc.id === id);
  if (!target || S.windowTransfer || editorIsComposing()) return;

  const current = activeDoc();
  if (current === target) {
    if (S.vditor && !S.switchInFlight) syncDocFromEditor(target);
    if (target.loadState === "unloaded" || target.loadState === "error") void ensureDocumentLoaded(target);
    return;
  }
  if (S.vditor && current && current.id !== target.id) {
    syncDocFromEditor(current);
    if (!S.switchInFlight) saveScroll(current);
  }

  hideEmptyState();
  activateDocument(id);
  if (S.vditor && !S.switchInFlight) {
    mountDocument(target);
    restoreScroll(target);
  }
  rebuildOutline();
  renderTabs();
  updateTitle();
  if (target.loadState === "unloaded" || target.loadState === "error") void ensureDocumentLoaded(target);
}

const loadingDocs = new WeakMap<Doc, Promise<void>>();
export function ensureDocumentLoaded(doc: Doc): Promise<void> {
  const pending = loadingDocs.get(doc);
  if (pending) return pending;
  if (doc.loadState === "ready" || !doc.path) return Promise.resolve();
  const path = doc.path;
  setDocumentStatus(doc, { loadState: "loading", saveError: null });
  const task = (async () => {
    try {
      const result = await fileService().openFile(path);
      if (!S.docs.includes(doc) || doc.path !== path) return;
      const owner = findDocumentByPath(path, result.pathKey);
      if (owner && owner.id !== doc.id) { const active = S.activeId === doc.id; removeDocument(doc.id); if (active) switchDoc(owner.id); return; }
      replaceDocumentFromDisk(doc, { ...result, path, name: doc.name });
      if (activeDoc()?.id === doc.id && !S.switchInFlight) { mountDocument(doc); rebuildOutline(); }
    } catch (error) {
      if (S.docs.includes(doc)) setDocumentStatus(doc, { loadState: "error", saveError: String(error) });
    } finally { loadingDocs.delete(doc); renderTabs(); updateTitle(); }
  })();
  loadingDocs.set(doc, task); return task;
}

export function showEmptyState(): void {
  showEmptyStateUi();
  if (S.vditor) withSuppressInput(() => S.vditor!.setValue(""));
}

const closingDocs = new Set<string>();
export async function closeDoc(id: string): Promise<void> {
  if (closingDocs.has(id) || S.switchInFlight || S.windowTransfer) return;
  const doc = S.docs.find((item) => item.id === id);
  if (!doc) return;
  closingDocs.add(id);
  const resume = pauseBackgroundSaves();
  try {
    await waitForPendingSave(doc);
    if (activeDoc()?.id === id) {
      if (editorIsComposing()) return;
      syncDocFromEditor(doc);
    }
    if (doc.dirty) {
      const action = await showCloseConfirm(doc.name);
      if (action === "cancel") return;
      if (action === "save") {
        while (doc.dirty) {
          if (!(await saveDoc(doc))) return;
        }
      }
    }

    releaseDocument(id);
  } finally {
    resume();
    closingDocs.delete(id);
  }
}

// Successful native handoff and confirmed close share the same UI cleanup.
export function releaseDocument(id: string): void {
    const removed = removeDocument(id);
    if (!removed) return;
    if (S.activeId === null) {
      const next = S.docs[removed.index] || S.docs[removed.index - 1] || null;
      if (next) switchDoc(next.id);
      else showEmptyState();
    }
    renderTabs();
    updateTitle();
}

export function openDoc(
  path: string | null,
  content: string,
  name?: string,
  encoding?: string,
  mtimeMs?: number | null,
  size?: number | null,
  pathKey?: string | null,
  fingerprint?: string | null
): Doc {
  hideEmptyState();
  if (path) {
    const existing = findDocumentByPath(path, pathKey);
    if (existing) {
      if (activeDoc()?.id === existing.id) syncDocFromEditor(existing);
      // dirty 文档只激活并保留旧基线；clean 文档安全重载，正文与基线始终同版本。
      if (!existing.dirty && !(activeDoc()?.id === existing.id && editorIsComposing())) {
        replaceDocumentFromDisk(existing, {
          path,
          pathKey,
          name: name || path.split(/[\\/]/).pop() || t("untitled"),
          content,
          encoding,
          mtimeMs,
          size,
          fingerprint,
        });
        if (activeDoc() === existing && S.vditor && !S.switchInFlight) {
          mountDocument(existing); rebuildOutline(); renderTabs(); updateTitle();
        }
      }
      switchDoc(existing.id);
      return existing;
    }
  }

  const doc = createDocument({
    path,
    pathKey,
    name: name || (path ? path.split(/[\\/]/).pop() || t("untitled") : t("untitled")),
    content,
    encoding,
    mtimeMs,
    size,
    fingerprint,
  });
  addDocument(doc);
  switchDoc(doc.id);
  return doc;
}

export async function loadFile(path: string): Promise<void> {
  try {
    const key = await fileService().pathKey(path);
    const existing = findDocumentByPath(path, key);
    if (existing && activeDoc() === existing) syncDocFromEditor(existing);
    const revision = existing?.revision, baseline = existing?.fingerprint;
    const result = await fileService().openFile(path);
    const owner = findDocumentByPath(path, result.pathKey);
    if (owner && owner !== existing) { switchDoc(owner.id); return; }
    if (existing && activeDoc() === existing) syncDocFromEditor(existing);
    if (existing && (!S.docs.includes(existing) || existing.pathKey !== key)) return;
    if (existing && (existing.revision !== revision || existing.fingerprint !== baseline || existing.saveState !== "idle")) {
      switchDoc(existing.id);
      return;
    }
    openDoc(
      path,
      result.content,
      undefined,
      result.encoding,
      result.mtimeMs,
      result.size,
      result.pathKey,
      result.fingerprint
    );
  } catch (error) {
    showError(t("openFail") + error);
  }
}

export function registerVditorHooks(): void {
  registerInputHook(() => {
    if (S.suppressInput) return;
    const doc = activeDoc();
    if (!doc) return;
    scheduleEditorSync();
    updateTitle();
    renderTabs();
    scheduleOutline();
  });

  registerAfterHook(() => {
    if (!S.vditorInited) {
      S.vditorInited = true;
      if (S.docs.length) {
        const doc = activeDoc();
        if (doc && S.vditor) {
          mountDocument(doc);
          restoreScroll(doc);
          if (doc.loadState !== "ready") void ensureDocumentLoaded(doc);
        }
        rebuildOutline();
        renderTabs();
        updateTitle();
      } else {
        openDoc(null, welcomeMd(), t("welcomeName"));
      }
      if (S.pendingFile) {
        const file = S.pendingFile;
        S.pendingFile = null;
        void loadFile(file);
      }
      return;
    }

    const doc = activeDoc();
    if (!doc) {
      showEmptyState();
      return;
    }
    if (S.vditor) {
      mountDocument(doc);
      restoreScroll(doc);
    }
    rebuildOutline();
    renderTabs();
    updateTitle();
  });

  setRefreshUi(() => { renderTabs(); updateTitle(); });
  setRefreshDocUi(() => { renderTabs(); updateTitle(); });
  setEditorRefresh(() => { renderTabs(); updateTitle(); scheduleOutline(); });
}
