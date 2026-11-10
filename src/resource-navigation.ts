// Native policy independently validates every local-resource operation.
import type { LinkTarget } from "./link-target";
import { resourceService } from "./file-service";
import { preferences } from "./preferences";
import { showSourcePreview } from "./source-preview";
import { openDocumentLink } from "./document-navigation";
import { S } from "./state";
import { subscribeDocuments } from "./document-store";
import { showError } from "./ui";
import { t } from "./i18n";
let sequence = 0, activation = 0, activeId = S.activeId;
subscribeDocuments(() => { if (activeId !== S.activeId) { activeId = S.activeId; activation++; } });
export async function openLocalResource(target: Extract<LinkTarget, {kind:"local"}>, preview = false): Promise<boolean> {
  if (S.windowTransfer || S.switchInFlight) return false;
  const token = ++sequence, epoch = activation;
  const current = () => token === sequence && epoch === activation && !S.windowTransfer;
  try {
    const resource = await resourceService().inspect(target.path); if (!current()) return false;
    if (resource.kind === "document" && target.line === null) return openDocumentLink(resource.path, target.hash);
    if (resource.kind === "source" || resource.kind === "document") {
      if (target.hash) throw Error(t("sourceAnchorUnsupported"));
      if (preferences.sourceEditor && !preview) {
        try { await resourceService().openEditor(resource.path, preferences.sourceEditor, target.line || 1, target.column || 1); return true; }
        catch (error) { if (current()) await showSourcePreview(resource.path, target.line || 1, target.column || 1, String(error)); return false; }
      }
      await showSourcePreview(resource.path, target.line || 1, target.column || 1); return true;
    }
    if (target.line !== null || target.hash) throw Error(t("sourceAnchorUnsupported"));
    await resourceService().openDefault(resource.path); return true;
  } catch (error) { if (current()) showError(t("openLinkFail") + String(error)); return false; }
}
