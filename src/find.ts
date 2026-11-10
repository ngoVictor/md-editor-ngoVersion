import { activeDoc } from "./state";
import { t } from "./i18n";
import { syncDocFromEditor, applyDocumentEdit, editorIsComposing } from "./editor-sync";
import { replaceMatches, type SearchResult } from "./find-engine";

let worker: Worker | null = null;
let cancelPending: (() => void) | null = null;
let snapshot: { id: string; revision: number; source: string; result: SearchResult } | null = null;
let index = 0;
const input = (id: string) => document.getElementById(id) as HTMLInputElement;
function status(text: string): void { document.getElementById("find-status")!.textContent = text; }
function display(): void {
  if (!snapshot) return;
  const { matches, truncated } = snapshot.result;
  status(truncated ? t("searchLimit") : `${matches.length ? index + 1 : 0} / ${matches.length}`);
  const m = matches[index];
  const context = document.getElementById("find-context")!;
  context.replaceChildren();
  if (m) {
    const line = snapshot.source.slice(0, m.start).split("\n").length;
    const mark = document.createElement("mark"); mark.textContent = m.text || "∅";
    context.append(`${line}: …${snapshot.source.slice(Math.max(0, m.start - 90), m.start)}`, mark, `${snapshot.source.slice(m.end, m.end + 90)}…`);
  }
}
export async function runFind(): Promise<boolean> {
  cancelPending?.(); snapshot = null;
  const doc = activeDoc();
  if (!doc || doc.loadState !== "ready" || editorIsComposing()) return false;
  syncDocFromEditor(doc);
  if (new Blob([doc.content]).size > 5 * 1024 * 1024) { status(t("searchLarge")); return false; }
  const source = doc.content, revision = doc.revision;
  return new Promise(resolve => {
    const current = new Worker(new URL("./find-worker.ts", import.meta.url), { type: "module" });
    worker = current;
    const finish = (ok: boolean) => { clearTimeout(timer); current.terminate(); if (worker === current) { worker = null; cancelPending = null; } resolve(ok); };
    cancelPending = () => finish(false);
    const timer = window.setTimeout(() => { status(t("searchTimeout")); finish(false); }, 1500);
    current.onerror = () => { status(t("searchTimeout")); finish(false); };
    current.onmessage = event => {
      const data = event.data as { result?: SearchResult; error?: string };
      if (data.error) { status(data.error); finish(false); return; }
      if (activeDoc()?.id !== doc.id || doc.revision !== revision || doc.pendingInput) { status(t("searchStale")); finish(false); return; }
      snapshot = { id: doc.id, revision, source, result: data.result! }; index = 0; display(); finish(true);
    };
    current.postMessage({ source, query: input("find-query").value, replacement: input("find-replacement").value, regex: input("find-regex").checked, caseSensitive: input("find-case").checked });
  });
}
function replace(all: boolean): void {
  const doc = activeDoc();
  if (doc) syncDocFromEditor(doc);
  if (!doc || !snapshot || snapshot.id !== doc.id || snapshot.revision !== doc.revision || doc.pendingInput) { status(t("searchStale")); return; }
  if (snapshot.result.truncated) { status(t("searchLimit")); return; }
  const matches = all ? snapshot.result.matches : snapshot.result.matches.slice(index, index + 1);
  if (matches.length && applyDocumentEdit(doc, replaceMatches(snapshot.source, matches))) void runFind();
}
export function bindFind(): void {
  const panel = document.getElementById("find-panel")!;
  const open = () => { panel.hidden = false; input("find-query").focus(); input("find-query").select(); };
  document.getElementById("btn-find")!.onclick = open;
  document.getElementById("find-close")!.onclick = () => { panel.hidden = true; cancelPending?.(); };
  document.getElementById("find-run")!.onclick = () => { void runFind(); };
  for (const id of ["find-query", "find-replacement", "find-case", "find-regex"]) {
    input(id).addEventListener("input", () => { cancelPending?.(); snapshot = null; status(t("searchStale")); });
  }
  document.getElementById("find-next")!.onclick = () => { if (snapshot?.result.matches.length) { index = (index + 1) % snapshot.result.matches.length; display(); } };
  document.getElementById("find-prev")!.onclick = () => { if (snapshot?.result.matches.length) { index = (index + snapshot.result.matches.length - 1) % snapshot.result.matches.length; display(); } };
  document.getElementById("replace-one")!.onclick = () => replace(false);
  document.getElementById("replace-all")!.onclick = () => replace(true);
  panel.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); void runFind(); } if (e.key === "Escape") { panel.hidden = true; cancelPending?.(); } });
  window.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && ["f", "h"].includes(e.key.toLowerCase())) { e.preventDefault(); e.stopImmediatePropagation(); open(); }
  }, true);
}
