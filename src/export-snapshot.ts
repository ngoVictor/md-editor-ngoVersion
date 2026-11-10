// Capture synchronously before any conversion/dialog await. Exports never change identity.
import { S, activeDoc } from "./state";
import { syncDocFromEditor, editorIsComposing } from "./editor-sync";
import { t } from "./i18n";
export interface ExportSnapshot { readonly docId: string; readonly revision: number; readonly name: string; readonly sourcePath: string | null; readonly markdown: string; readonly html: string }
export function markdownSnapshotToHtml(markdown: string): string {
  const lute = S.vditor?.vditor.lute as unknown as { Md2HTML?: (value: string) => string } | undefined;
  if (!lute?.Md2HTML) throw Error("Markdown renderer is not ready");
  return lute.Md2HTML(markdown);
}
export function captureExportSnapshot(): ExportSnapshot | null {
  if (!S.vditor || S.windowTransfer || S.switchInFlight || editorIsComposing()) return null;
  const doc = activeDoc(); if (!doc || doc.loadState !== "ready") return null;
  syncDocFromEditor(doc);
  const { id: docId, revision, name, path: sourcePath, content: markdown } = doc;
  if (new TextEncoder().encode(markdown).byteLength > 5 * 1024 * 1024) throw Error(t("exportTooLarge") + name);
  return Object.freeze({ docId, revision, name, sourcePath, markdown, html: markdownSnapshotToHtml(markdown) });
}
