// Per-document bounded snapshots. No editor, store or UI dependencies.
import type { Doc } from "./state";

interface History { undo: string[]; redo: string[]; lastAt: number; startedAt: number; group: string }
const histories = new WeakMap<Doc, History>();
const MAX_STEPS = 100;
const MAX_BYTES = 16 * 1024 * 1024; // approximate UTF-16 storage per document
function history(doc: Doc): History {
  let h = histories.get(doc);
  if (!h) { h = { undo: [], redo: [], lastAt: 0, startedAt: 0, group: "" }; histories.set(doc, h); }
  return h;
}
function trim(h: History): void {
  let bytes = [...h.undo, ...h.redo].reduce((n, s) => n + s.length * 2, 0);
  while (h.undo.length > MAX_STEPS || (bytes > MAX_BYTES && h.undo.length)) bytes -= h.undo.shift()!.length * 2;
  while (bytes > MAX_BYTES && h.redo.length) bytes -= h.redo.shift()!.length * 2;
}
export function recordEdit(doc: Doc, before: string, group = "transaction"): void {
  const h = history(doc), now = Date.now();
  if (group !== "typing" || h.group !== group || now - h.lastAt > 700 || now - h.startedAt > 3000) {
    h.undo.push(before); h.startedAt = now;
  }
  h.redo.length = 0;
  h.group = group; h.lastAt = now;
  trim(h);
}
export function sealHistory(doc: Doc): void { history(doc).group = ""; }
export function clearHistory(doc: Doc): void { histories.delete(doc); }
export function historyStatus(doc: Doc): { undo: number; redo: number } {
  const h = history(doc); return { undo: h.undo.length, redo: h.redo.length };
}
export function takeHistory(doc: Doc, direction: "undo" | "redo"): string | undefined {
  const h = history(doc), from = h[direction], to = h[direction === "undo" ? "redo" : "undo"];
  const value = from.pop();
  if (value === undefined) return undefined;
  to.push(doc.content); h.group = ""; trim(h);
  return value;
}

export interface HistorySnapshot { undo: string[]; redo: string[] }
export function exportHistory(doc: Doc): HistorySnapshot { const h = history(doc); return { undo: [...h.undo], redo: [...h.redo] }; }
export function importHistory(doc: Doc, snapshot: HistorySnapshot): void {
  const h = history(doc); h.undo = [...snapshot.undo]; h.redo = [...snapshot.redo]; h.group = ""; trim(h);
}
