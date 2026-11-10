import { prepareExportAssets, assetNotice } from "./export-assets";
import { save } from "@tauri-apps/plugin-dialog";
import { captureExportSnapshot } from "./export-snapshot";
import { buildHtmlExport } from "./html-export";
import { exportService } from "./file-service";
import { showError, showInfo } from "./ui";
import { t } from "./i18n";
type Picker = (name: string) => Promise<string | null>;
const defaultPicker: Picker = name => save({ defaultPath: name, filters: [{ name: "HTML", extensions: ["html", "htm"] }] });
let picker = defaultPicker, exporting = false;
export function setHtmlPathPickerForTests(value: Picker | null): void { picker = value || defaultPicker; }
export async function exportActiveDocAsHtml(styled: boolean): Promise<boolean> {
  if (exporting) return false;
  exporting = true;
  try {
    const snapshot = captureExportSnapshot(); if (!snapshot) return false;
    const assets = await prepareExportAssets(snapshot);
    const result = buildHtmlExport(assets.html, snapshot.name, styled);
    const chosen = await picker(snapshot.name.replace(/\.(md|markdown|mdown|txt)$/i, "") + ".html");
    if (!chosen) return false;
    const path = /\.html?$/i.test(chosen) ? chosen : `${chosen}.html`;
    await exportService().saveHtml(path, result.html);
    showInfo(t("exportOk") + path + assetNotice(assets));
    return true;
  } catch (error) { showError(t("exportFail") + error); return false; }
  finally { exporting = false; }
}
