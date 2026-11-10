import { captureExportSnapshot } from "./export-snapshot";
import { prepareExportAssets, assetNotice } from "./export-assets";
import { buildHtmlExport } from "./html-export";
import { outputService } from "./file-service";
import { showInfo } from "./ui";
import { t } from "./i18n";
export async function printDocument(): Promise<void> {
  const snapshot=captureExportSnapshot();if(!snapshot)return;
  const assets=await prepareExportAssets(snapshot);
  await outputService().printHtml(buildHtmlExport(assets.html,snapshot.name,true).html);
  showInfo(t("printOpened")+assetNotice(assets));
}
