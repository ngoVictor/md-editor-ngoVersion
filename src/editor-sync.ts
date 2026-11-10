// Editor/document boundary: delayed work is bound to a document and mount generation.
import { S, activeDoc, type Doc } from "./state";
import { markPendingInput, setDocumentContent } from "./document-store";
import { sealHistory, takeHistory, historyStatus } from "./history";

let mountedId: string | null = null;
let generation = 0;
let renderedValue: string | null = null;
let timer: number | undefined;
let composing = false;
let refresh: () => void = () => {};
export function setEditorRefresh(fn: () => void): void { refresh = fn; }
export function editorIsComposing(): boolean { return composing; }
export function editorMountGeneration(): number { return generation; }
export function withSuppressInput(fn: () => void): void {
  const previous = S.suppressInput;
  S.suppressInput = true;
  try { fn(); } finally { S.suppressInput = previous; }
}
export function mountDocument(doc: Doc): void {
  window.clearTimeout(timer); generation++; composing = false;
  mountedId = doc.id; renderedValue = null;
  if (!S.vditor) return;
  document.getElementById("editor")!.style.visibility = doc.loadState === "ready" ? "visible" : "hidden";
  if (doc.loadState !== "ready") return;
  withSuppressInput(() => S.vditor!.setValue(doc.content, true));
  renderedValue = S.vditor.getValue();
  sealHistory(doc);
  updateHistoryButtons();
}
export function syncDocFromEditor(doc: Doc, opts?: { allowEmpty?: boolean; markDirty?: boolean }): boolean {
  if (!S.vditor || S.switchInFlight || activeDoc()?.id !== doc.id || doc.loadState !== "ready" || composing) return false;
  if (mountedId && mountedId !== doc.id) return false;
  window.clearTimeout(timer);
  const value = S.vditor.getValue();
  if (value === renderedValue) { if (doc.pendingInput) markPendingInput(doc, false); return true; }
  if (opts?.allowEmpty || doc.pendingInput || value !== "" || doc.content === "") {
    setDocumentContent(doc, value, true, opts?.markDirty || doc.pendingInput ? "typing" : "transaction");
    renderedValue = value;
    markPendingInput(doc, false);
    updateHistoryButtons();
    return true;
  }
  return false;
}
export function scheduleEditorSync(): void {
  if (S.suppressInput || S.switchInFlight || composing) return;
  const doc = activeDoc();
  if (!doc || doc.loadState !== "ready") return;
  markPendingInput(doc, true);
  const token = generation;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    if (token !== generation || activeDoc()?.id !== doc.id) return;
    syncDocFromEditor(doc, { allowEmpty: true, markDirty: true }); refresh();
  }, doc.content.length > 262144 ? 1500 : 0);
}
export function applyDocumentEdit(doc: Doc, content: string): boolean {
  if (S.windowTransfer || S.switchInFlight || composing || doc.loadState !== "ready" || !S.docs.includes(doc)) return false;
  setDocumentContent(doc, content, true);
  if (activeDoc()?.id === doc.id) mountDocument(doc);
  refresh(); return true;
}
export function undoDocument(direction: "undo" | "redo"): void {
  const doc = activeDoc();
  if (!doc || S.switchInFlight || composing || doc.loadState !== "ready") return;
  syncDocFromEditor(doc);
  const value = takeHistory(doc, direction);
  if (value === undefined) return;
  setDocumentContent(doc, value, true, "history");
  mountDocument(doc); refresh();
}
export function updateHistoryButtons(): void {
  const doc = activeDoc();
  const counts = doc ? historyStatus(doc) : { undo: 0, redo: 0 };
  for (const name of ["undo", "redo"] as const) {
    const button = document.querySelector<HTMLElement>(`[data-type="alei-${name}"]`);
    if (button) { button.setAttribute("aria-disabled", String(!counts[name])); button.classList.toggle("history-disabled", !counts[name]); }
  }
}
export function bindEditorTransactions(): void {
  const inEditor = (target: EventTarget | null) => target instanceof Element && !!target.closest("#editor .vditor-reset, #editor .vditor-sv");
  document.addEventListener("compositionstart", e => { if (inEditor(e.target)) composing = true; }, true);
  document.addEventListener("compositionend", e => { if (inEditor(e.target)) { composing = false; scheduleEditorSync(); } }, true);
  document.addEventListener("input", e => { if (inEditor(e.target) && !(e as InputEvent).isComposing) scheduleEditorSync(); }, true);
  document.addEventListener("beforeinput", e => {
    const type = (e as InputEvent).inputType;
    if (inEditor(e.target) && (type === "historyUndo" || type === "historyRedo")) {
      e.preventDefault(); e.stopImmediatePropagation(); undoDocument(type === "historyUndo" ? "undo" : "redo");
    }
  }, true);
  document.addEventListener("keyup", e => { if (inEditor(e.target) && ["Backspace", "Delete"].includes(e.key)) scheduleEditorSync(); }, true);
  window.addEventListener("keydown", e => {
    if (!inEditor(e.target)) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && ["z", "y"].includes(e.key.toLowerCase())) {
      e.preventDefault(); e.stopImmediatePropagation();
      // Do not serialize incomplete IME text. Complete composition before undo.
      if (composing || e.isComposing) return;
      undoDocument(e.key.toLowerCase() === "y" || e.shiftKey ? "redo" : "undo");
    } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
      const doc = activeDoc(); if (doc) { syncDocFromEditor(doc); sealHistory(doc); }
    }
  }, true);
}
