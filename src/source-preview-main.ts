// Separate entry: no Vditor, document session, autosave or editor shortcuts.
import { getCurrentWindow } from "@tauri-apps/api/window";
import { receiveSourcePreview } from "./source-preview";
import { mountSourcePreview } from "./source-preview-view";
import { S } from "./state";
import { bindAppearance } from "./theme-appearance";
import "./source-preview.css";
const root = document.getElementById("source-preview")!;
bindAppearance();
void receiveSourcePreview().then(request => {
  S.currentLang = request.lang; document.documentElement.lang = request.lang;
  return mountSourcePreview(root, () => { void getCurrentWindow().close(); }, request.path, request.line, request.column, request.initialError);
}).catch(error => { root.textContent = String(error); });
