// save.ts —— 串行化保存事务与关闭确认。
import { save as saveDialog, confirm } from "@tauri-apps/plugin-dialog";
import { S, activeDoc, type Doc } from "./state";
import { t } from "./i18n";
import { syncDocFromEditor, editorIsComposing, mountDocument } from "./editor-sync";
import { migrateImages } from "./image-migration";
import { absoluteImageReference, rewriteImageReferences, imageReferences } from "./image-references";
import { exportHistory, importHistory } from "./history";
import { showError } from "./ui";
import { FileConflictError, fileService, type FileMetadata } from "./file-service";
import {
  commitSavedDocument,
  findDocumentByPath,
  setSaveState,
  setDocumentContent,
  setDocumentStatus,
  markPendingInput,
} from "./document-store";

let refreshDocUi: (() => void) | null = null;
let backgroundPause = 0;
export function pauseBackgroundSaves(): () => void { backgroundPause++; return () => { backgroundPause--; }; }
export async function waitForPendingSave(doc: Doc): Promise<void> {
  let pending = saveTails.get(doc.id);
  while (pending) { await pending; pending = saveTails.get(doc.id); }
}
export function setRefreshDocUi(fn: () => void): void { refreshDocUi = fn; }

const SAVE_EXTS = ["md", "markdown", "mdown", "txt"];
export function withMarkdownExt(path: string): string {
  const ext = path.split(/[\\/]/).pop()?.split(".").pop() || "";
  return SAVE_EXTS.some((item) => item.toLowerCase() === ext.toLowerCase()) ? path : `${path}.md`;
}

async function askConfirm(message: string, title: string): Promise<boolean> {
  try {
    return await confirm(message, { title, kind: "warning" });
  } catch {
    return window.confirm(message);
  }
}

type SavePathPicker = () => Promise<string | null>;
const defaultSavePathPicker: SavePathPicker = async () => {
  try {
    const selected = await saveDialog({ filters: [{ name: "Markdown", extensions: SAVE_EXTS }] });
    return selected ? withMarkdownExt(selected as string) : null;
  } catch (error) {
    showError(t("saveFail") + error);
    return null;
  }
};
let savePathPicker: SavePathPicker = defaultSavePathPicker;

export function setSavePathPickerForTests(picker: SavePathPicker | null): void {
  savePathPicker = picker || defaultSavePathPicker;
}

async function candidateMetadata(doc: Doc, path: string, identityChanges: boolean): Promise<FileMetadata | null> {
  if (!identityChanges) {
    return doc.pathKey && doc.fingerprint && doc.mtimeMs != null && doc.size != null
      ? { pathKey: doc.pathKey, fingerprint: doc.fingerprint, mtimeMs: doc.mtimeMs, size: doc.size }
      : null;
  }

  const metadata = await fileService().statFile(path);
  if (metadata) {
    const owner = findDocumentByPath(path, metadata.pathKey);
    if (owner && owner.id !== doc.id) {
      showError(t("fileAlreadyOpen") + owner.name);
      throw new Error("SAVE_TARGET_ALREADY_OPEN");
    }
  }
  return metadata;
}

// Every await may change the editor lifecycle. Never treat a failed flush as a snapshot.
function synchronizeForSave(doc: Doc): boolean {
  if (!S.docs.includes(doc) || S.windowTransfer || S.switchInFlight || doc.loadState !== "ready") return false;
  return activeDoc() !== doc || (!editorIsComposing() && syncDocFromEditor(doc));
}
const savingTargets = new Map<string, Doc>();
function targetAvailable(doc: Doc, path: string, key: string): boolean {
  const owner = findDocumentByPath(path, key), savingOwner = savingTargets.get(key);
  if ((owner && owner !== doc) || (savingOwner && savingOwner !== doc)) {
    showError(t("fileAlreadyOpen") + (owner || savingOwner)!.name);
    return false;
  }
  return true;
}

async function saveDocNow(doc: Doc, forceSaveAs: boolean, refreshUI: boolean, background = false): Promise<boolean> {
  if (!synchronizeForSave(doc)) return false;
  if (background && (backgroundPause || !S.docs.includes(doc) || !doc.path || doc.externalChange || doc.saveError)) return false;
  setSaveState(doc, "saving");
  refreshDocUi?.();
  let targetKey: string | undefined;
  try {
    if (activeDoc()?.id === doc.id) syncDocFromEditor(doc);

    if (background && !doc.dirty) return true;

    let path = doc.path;
    if (!path || forceSaveAs) {
      path = await savePathPicker();
      if (!path) return false;
    }
    const identityChanges = path !== doc.path;

    let metadata: FileMetadata | null;
    try {
      metadata = await candidateMetadata(doc, path, identityChanges);
    } catch (error) {
      if (error instanceof Error && error.message === "SAVE_TARGET_ALREADY_OPEN") return false;
      showError(t("saveFail") + error);
      return false;
    }

    targetKey = metadata?.pathKey || await fileService().pathKey(path);
    if (!targetAvailable(doc, path, targetKey)) return false;
    savingTargets.set(targetKey, doc);

    // 对话框与 stat 等待期间可能继续编辑；所有交互完成后再捕获稳定保存快照。
    if (!synchronizeForSave(doc)) return false;
    let content = doc.content;
    let savedRevision = doc.revision;
    if (content.trim() === "") {
      if (background) return false;
      const quote = S.currentLang === "en" ? '"' : "「";
      const message = (S.currentLang === "en" ? "" : t("clearFileTitle")) + quote + doc.name + t("clearFileSuf");
      if (!(await askConfirm(message, t("clearFileTitle")))) return false;
      if (!synchronizeForSave(doc)) return false;
      content = doc.content;
      savedRevision = doc.revision;
    }

    const originalContent = content, originalPath = doc.path;
    if (identityChanges) content = await migrateImages(content, originalPath, path);
    const resourcesChanged = content !== originalContent;
    if (!synchronizeForSave(doc)) return false;
    if (resourcesChanged && (doc.revision !== savedRevision || doc.pendingInput || editorIsComposing())) {
      throw new Error(t("searchStale"));
    }
    if (!targetAvailable(doc, path, targetKey)) return false;
    const request = {
      path,
      content,
      allowEmpty: content.trim() === "",
      expectedFingerprint: metadata?.fingerprint ?? null,
      force: false,
    };

    let result: FileMetadata;
    try {
      result = await fileService().saveFile(request);
    } catch (error) {
      if (!(error instanceof FileConflictError)) throw error;
      if (background) { setDocumentStatus(doc, { externalChange: "changed", saveError: t("fileChangedMsg") }); return false; }
      const fileName = path.split(/[\\/]/).pop() || doc.name;
      const ok = await askConfirm(fileName + "\n" + t("fileChangedMsg"), t("fileChangedTitle"));
      if (!ok) return false;
      if (!synchronizeForSave(doc)) return false;
      if (!targetAvailable(doc, path, targetKey)) return false;
      result = await fileService().saveFile({ ...request, force: true });
    }

    if (!S.docs.includes(doc)) return false;
    // Composition can start while the disk command is running. Its unfinished text is unsaved.
    if (activeDoc() === doc && editorIsComposing()) markPendingInput(doc, true);

    if (identityChanges) {
      // A disk read may have opened the target while the native write was in progress.
      const owner = findDocumentByPath(path, result.pathKey);
      if (owner && owner !== doc) throw new Error("副本已写入目标路径，但该路径已由其他标签打开；当前草稿和原路径已保留。");
      if (activeDoc()?.id === doc.id) syncDocFromEditor(doc);
      const hasImages = resourcesChanged || imageReferences(originalContent).length > 0 || imageReferences(doc.content).length > 0;
      if (hasImages && (doc.revision !== savedRevision || doc.pendingInput || (activeDoc()?.id === doc.id && editorIsComposing()))) {
        throw new Error("副本已写入目标路径，但期间正文已变化；当前草稿和原路径已保留，请重新另存为。");
      }
      const history = exportHistory(doc);
      const rebase = (text: string) => rewriteImageReferences(text, url => absoluteImageReference(originalPath, url));
      importHistory(doc, {undo: history.undo.map(rebase), redo: history.redo.map(rebase)});
      if (resourcesChanged) {
        setDocumentContent(doc, content, true, "history");
        savedRevision = doc.revision;
      }
    }
    commitSavedDocument(doc, savedRevision, {
      path,
      pathKey: result.pathKey,
      mtimeMs: result.mtimeMs,
      size: result.size,
      fingerprint: result.fingerprint,
      encoding: "UTF-8",
    }, content);
    if (resourcesChanged && activeDoc()?.id === doc.id) mountDocument(doc);
    if (refreshUI || identityChanges || doc.dirty) refreshDocUi?.();
    return true;
  } catch (error) {
    setDocumentStatus(doc, { saveError: String(error) });
    if (!background) showError(t("saveFail") + doc.name + " — " + error);
    return false;
  } finally {
    if (targetKey && savingTargets.get(targetKey) === doc) savingTargets.delete(targetKey);
    setSaveState(doc, "idle");
    refreshDocUi?.();
  }
}

// 每个文档的保存请求严格串行。第二次保存会在第一次完成后重新捕获最新 revision。
const saveTails = new Map<string, Promise<boolean>>();
export function saveDoc(doc: Doc, forceSaveAs = false, refreshUI = false, background = false): Promise<boolean> {
  const previous = saveTails.get(doc.id) || Promise.resolve(true);
  const next = previous.catch(() => false).then(() => saveDocNow(doc, forceSaveAs, refreshUI, background));
  saveTails.set(doc.id, next);
  void next.finally(() => {
    if (saveTails.get(doc.id) === next) saveTails.delete(doc.id);
  });
  return next;
}

export async function saveAllDirty(): Promise<boolean> {
  for (const doc of [...S.docs]) {
    while (doc.dirty) {
      if (!(await saveDoc(doc))) return false;
    }
  }
  return true;
}

type CloseAction = "save" | "discard" | "cancel";

function showSingleCloseConfirm(name?: string): Promise<CloseAction> {
  return new Promise((resolve) => {
    const mask = document.getElementById("close-confirm")!;
    document.getElementById("cc-msg")!.textContent = (name ? name + "\n" : "") + t("closeSaveMsg");
    mask.hidden = false;
    const finish = (action: CloseAction) => {
      mask.hidden = true;
      document.getElementById("cc-save")!.onclick = null;
      document.getElementById("cc-discard")!.onclick = null;
      document.getElementById("cc-cancel")!.onclick = null;
      resolve(action);
    };
    document.getElementById("cc-save")!.onclick = () => finish("save");
    document.getElementById("cc-discard")!.onclick = () => finish("discard");
    document.getElementById("cc-cancel")!.onclick = () => finish("cancel");
  });
}

// 不同关闭工作流依次显示确认框，避免一个“放弃”选择同时作用于标签和整个窗口。
let closeConfirmTail: Promise<void> = Promise.resolve();
export function showCloseConfirm(name?: string): Promise<CloseAction> {
  const result = closeConfirmTail.then(() => showSingleCloseConfirm(name));
  closeConfirmTail = result.then(() => undefined, () => undefined);
  return result;
}
