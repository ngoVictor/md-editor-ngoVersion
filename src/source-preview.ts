// Opens independent native windows; this module owns no preview DOM or document state.
import { invoke } from "@tauri-apps/api/core";
import { S, type Lang } from "./state";
export interface PreviewRequest { path: string; line: number; column: number; initialError: string; lang: Lang }
type Opener = (request: PreviewRequest) => Promise<void>;
const nativeOpen: Opener = request => invoke("open_source_preview", { request });
let opener = nativeOpen;
export function setSourcePreviewOpenerForTests(value: Opener | null): void { opener = value || nativeOpen; }
export function showSourcePreview(path: string, line = 1, column = 1, initialError = ""): Promise<void> {
  return opener({path, line, column, initialError, lang:S.currentLang});
}
export function receiveSourcePreview(): Promise<PreviewRequest> { return invoke("receive_source_preview"); }
