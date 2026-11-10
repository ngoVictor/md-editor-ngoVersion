import { prepareExportAssets, assetNotice } from "./export-assets";
import { save } from "@tauri-apps/plugin-dialog";
import { captureExportSnapshot } from "./export-snapshot";
import { buildHtmlExport } from "./html-export";
import { pdfService } from "./file-service";
import { showError, showInfo } from "./ui";
import { t } from "./i18n";
type Picker = (name: string) => Promise<string | null>;
const defaultPicker: Picker = name => save({ defaultPath: name, filters: [{ name: "PDF", extensions: ["pdf"] }] });
let picker = defaultPicker, exporting = false;
export function setPdfPathPickerForTests(value: Picker | null): void { picker = value || defaultPicker; }
export async function exportActiveDocAsPdf(): Promise<boolean> {
  if (exporting) return false;
  exporting = true;
  try {
    const snapshot = captureExportSnapshot(); if (!snapshot) return false;
    const assets = await prepareExportAssets(snapshot);
    const result = buildHtmlExport(assets.html, snapshot.name, true);
    const chosen = await picker(snapshot.name.replace(/\.(md|markdown|mdown|txt)$/i, "") + ".pdf");
    if (!chosen) return false;
    const path = /\.pdf$/i.test(chosen) ? chosen : `${chosen}.pdf`;
    await pdfService().renderPdf(path, result.html);
    showInfo(t("exportOk") + path + assetNotice(assets));
    return true;
  } catch (error) { showError(t("exportFail") + String(error)); return false; }
  finally { exporting = false; }
}
