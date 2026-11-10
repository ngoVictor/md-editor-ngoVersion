// document-store.ts —— 文档领域状态的唯一写入口。
// 业务模块可读取 state.S，但文档身份、正文 revision、dirty 与磁盘基线必须在此原子提交。
import { S, newDocId, fallbackPathKey, type Doc } from "./state";
import { clearHistory, recordEdit } from "./history";

type ChangeKind = "content" | "structure" | "disk" | "status";
const listeners = new Set<(doc: Doc | null, kind: ChangeKind) => void>();
export function subscribeDocuments(fn: (doc: Doc | null, kind: ChangeKind) => void): () => void {
  listeners.add(fn); return () => { listeners.delete(fn); };
}
function emit(doc: Doc | null, kind: ChangeKind): void { listeners.forEach(fn => fn(doc, kind)); }

export interface DiskIdentity {
  path: string;
  pathKey: string;
  mtimeMs: number;
  size: number;
  fingerprint: string;
  encoding?: string;
}

export interface NewDocument {
  path: string | null;
  pathKey?: string | null;
  name: string;
  content: string;
  encoding?: string;
  mtimeMs?: number | null;
  size?: number | null;
  fingerprint?: string | null;
}

export function createDocument(input: NewDocument): Doc {
  return {
    id: newDocId(),
    path: input.path,
    pathKey: input.path ? input.pathKey || fallbackPathKey(input.path) : null,
    name: input.name,
    content: input.content,
    dirty: false,
    revision: 0,
    saveState: "idle",
    encoding: input.encoding || "",
    mtimeMs: input.mtimeMs ?? null,
    size: input.size ?? null,
    fingerprint: input.fingerprint ?? null,
    savedContent: input.content,
    loadState: "ready",
    externalChange: null,
    saveError: null,
    pendingInput: false,
    scrollTop: 0,
    previewScrollTop: 0,
  };
}

export function addDocument(doc: Doc): void {
  S.docs.push(doc);
  emit(doc, "structure");
}

export function removeDocument(id: string): { doc: Doc; index: number } | null {
  const index = S.docs.findIndex((doc) => doc.id === id);
  if (index < 0) return null;
  const [doc] = S.docs.splice(index, 1);
  if (S.activeId === id) S.activeId = null;
  clearHistory(doc);
  emit(doc, "structure");
  return { doc, index };
}

export function activateDocument(id: string | null): void {
  S.activeId = id;
  emit(S.docs.find(d => d.id === id) || null, "structure");
}

export function findDocumentByPath(path: string, pathKey?: string | null): Doc | null {
  const key = pathKey || fallbackPathKey(path);
  return S.docs.find((doc) => doc.pathKey === key) || null;
}

export function setDocumentContent(doc: Doc, content: string, markDirty: boolean, kind = "transaction"): boolean {
  const changed = doc.content !== content;
  if (changed) {
    if (markDirty && kind !== "history") recordEdit(doc, doc.content, kind);
    doc.content = content;
    doc.revision++;
  }
  if (markDirty) doc.dirty = content !== doc.savedContent;
  if (changed) emit(doc, "content");
  return changed;
}

export function replaceDocumentFromDisk(doc: Doc, input: NewDocument): void {
  if (doc.content !== input.content) doc.revision++;
  doc.content = input.content;
  doc.path = input.path;
  doc.pathKey = input.path ? input.pathKey || fallbackPathKey(input.path) : null;
  doc.name = input.name;
  doc.encoding = input.encoding || "";
  doc.mtimeMs = input.mtimeMs ?? null;
  doc.size = input.size ?? null;
  doc.fingerprint = input.fingerprint ?? null;
  doc.dirty = false;
  doc.savedContent = input.content;
  doc.loadState = "ready";
  doc.externalChange = null;
  doc.saveError = null;
  doc.pendingInput = false;
  clearHistory(doc);
  emit(doc, "disk");
}

export function resetTemporaryDocument(doc: Doc, content: string, name: string): void {
  if (doc.content !== content) doc.revision++;
  doc.content = content;
  doc.name = name;
  doc.dirty = false;
  doc.savedContent = content;
  clearHistory(doc);
  emit(doc, "content");
}

export function setSaveState(doc: Doc, state: Doc["saveState"]): void {
  doc.saveState = state;
  emit(doc, "status");
}

export function setDocumentStatus(doc: Doc, status: Partial<Pick<Doc, "loadState" | "externalChange" | "saveError">>): void {
  Object.assign(doc, status); emit(doc, "status");
}
export function markPendingInput(doc: Doc, pending: boolean): void {
  doc.pendingInput = pending;
  doc.dirty = pending || doc.content !== doc.savedContent;
  emit(doc, "status");
}

export function commitSavedDocument(
  doc: Doc,
  savedRevision: number,
  identity: DiskIdentity,
  savedContent = doc.content
): void {
  doc.path = identity.path;
  doc.pathKey = identity.pathKey;
  doc.name = identity.path.split(/[\\/]/).pop() || doc.name;
  doc.mtimeMs = identity.mtimeMs;
  doc.size = identity.size;
  doc.fingerprint = identity.fingerprint;
  doc.encoding = identity.encoding || "UTF-8";
  doc.dirty = doc.pendingInput || doc.revision !== savedRevision;
  doc.savedContent = savedContent;
  doc.externalChange = null;
  doc.saveError = null;
  emit(doc, "disk");
}

// Native handoff preserves the exact document revision and disk baseline, but allocates a local id.
export function importTransferredDocument(snapshot: Doc): Doc {
  const doc: Doc = { ...snapshot, id: newDocId(), saveState: "idle", pendingInput: false };
  addDocument(doc); activateDocument(doc.id); return doc;
}
