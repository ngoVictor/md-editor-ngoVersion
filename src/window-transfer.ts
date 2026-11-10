// Window handoff coordinator. Documents stay in the source until native commit succeeds.
import { invoke } from "@tauri-apps/api/core";
import { S, activeDoc, type Doc, type Mode } from "./state";
import { exportHistory, importHistory, type HistorySnapshot } from "./history";
import { importTransferredDocument } from "./document-store";
import { releaseDocument, renderTabs, updateTitle } from "./docs";
import { syncDocFromEditor, editorIsComposing } from "./editor-sync";
import { waitForPendingSave, pauseBackgroundSaves } from "./save";
import { saveScroll } from "./scroll";
import { t } from "./i18n";
import { showError } from "./ui";

interface Payload { doc: Doc; history: HistorySnapshot; mode: Mode }
export interface WindowTransferService {
  prepare(payload: Payload): Promise<string>;
  ready(label: string): Promise<boolean>;
  commit(label: string): Promise<void>;
  abort(label: string): Promise<void>;
}
const nativeService: WindowTransferService = {
  prepare: payload => invoke("prepare_tab_window", { payload }),
  ready: label => invoke("tab_transfer_status", { label }),
  commit: label => invoke("commit_tab_window", { label }),
  abort: label => invoke("abort_tab_window", { label }),
};
let service = nativeService;
export function setWindowTransferServiceForTests(value: WindowTransferService | null): void { service = value || nativeService; }
import { isDetachedWindow } from "./window-context";
const delay = () => new Promise(resolve => window.setTimeout(resolve, 100));

function lockWindow(): () => void {
  S.windowTransfer = true;
  const elements = Array.from(document.body.children).filter((el): el is HTMLElement => el instanceof HTMLElement && !el.inert);
  elements.forEach(el => { el.inert = true; });
  const block = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  window.addEventListener("keydown", block, true);
  return () => { S.windowTransfer = false; elements.forEach(el => { el.inert = false; }); window.removeEventListener("keydown", block, true); };
}

export async function detachDocument(id: string): Promise<boolean> {
  const doc = S.docs.find(d => d.id === id);
  if (!doc || S.docs.length < 2 || S.windowTransfer || S.switchInFlight || editorIsComposing() || doc.loadState !== "ready" || document.querySelector(".modal-mask:not([hidden])")) return false;
  const unlock = lockWindow(), resume = pauseBackgroundSaves();
  let label: string | undefined;
  try {
    await waitForPendingSave(doc);
    if (activeDoc()?.id === id) { syncDocFromEditor(doc); saveScroll(doc); }
    const snapshot = structuredClone(doc);
    label = await service.prepare({ doc: snapshot, history: exportHistory(doc), mode: S.currentMode });
    let ready = false;
    for (let attempt = 0; attempt < 200; attempt++) { if (await service.ready(label)) { ready = true; break; } await delay(); }
    if (!ready) throw Error(t("transferTimeout"));
    if (!S.docs.includes(doc) || doc.revision !== snapshot.revision || doc.path !== snapshot.path || doc.fingerprint !== snapshot.fingerprint) throw Error(t("searchStale"));
    await service.commit(label);
    label = undefined;
    S.windowTransfer = false;
    releaseDocument(id);
    return true;
  } catch (error) {
    if (label) { try { await service.abort(label); } catch { /* Source document remains available. */ } }
    showError(`${t("transferFailed")}: ${String(error)}`);
    return false;
  } finally { unlock(); resume(); renderTabs(); updateTitle(); }
}

// Called before editor creation, and completed after its first successful mount.
export async function receiveDetachedDocument(): Promise<(() => Promise<void>) | null> {
  if (!isDetachedWindow) return null;
  const unlock = lockWindow();
  const payload = await invoke<Payload>("receive_tab");
  const doc = importTransferredDocument(payload.doc);
  importHistory(doc, payload.history);
  S.currentMode = payload.mode;
  return async () => {
    await invoke("tab_window_ready");
    for (let attempt = 0; attempt < 250; attempt++) {
      if (await invoke<boolean>("finish_tab_receive")) { unlock(); return; }
      await delay();
    }
    throw Error(t("transferTimeout"));
  };
}
