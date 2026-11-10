import { exportActiveDocAsDocx } from "./export-docx";
import { exportActiveDocAsHtml } from "./export-html";
import { exportActiveDocAsPdf } from "./export-pdf";
import { t } from "./i18n";
import { showError } from "./ui";
import { exportTokenWord } from "./export-docx-token";
import { exportPng } from "./export-png";
import { printDocument } from "./export-print";
export const EXPORT_FORMATS = [
  { id: "html-styled", label: "htmlStyled", run: () => exportActiveDocAsHtml(true) },
  { id: "html-plain", label: "htmlPlain", run: () => exportActiveDocAsHtml(false) },
  { id: "docx", label: "formatWord", run: exportTokenWord },
  { id: "docx-legacy", label: "formatWordLegacy", run: exportActiveDocAsDocx },
  { id: "png", label: "formatPng", run: exportPng },
  { id: "print", label: "formatPrint", run: printDocument },
  { id: "pdf", label: "formatPdf", run: exportActiveDocAsPdf },
] as const;
export function bindExportControls(): void {
  const select = document.getElementById("export-format") as HTMLSelectElement;
  const button = document.getElementById("btn-export") as HTMLButtonElement;
  for (const format of EXPORT_FORMATS) {
    const option = new Option(t(format.label), format.id); option.dataset.i18n = format.label; select.add(option);
  }
  let busy = false;
  button.onclick = async () => {
    if (busy) return;
    const format = EXPORT_FORMATS.find(item => item.id === select.value); if (!format) return;
    busy = true; button.disabled = select.disabled = true;
    try { await format.run(); }
    catch (error) { showError(t("exportFail") + String(error)); }
    finally { busy = false; button.disabled = select.disabled = false; }
  };
}
