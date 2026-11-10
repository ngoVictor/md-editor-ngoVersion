// Read-only source viewer. No Doc, editor instance, save, history or document-store writes.
import { open } from "@tauri-apps/plugin-dialog";
import { resourceService } from "./file-service";
import { preferences, setPreference } from "./preferences";
import { t } from "./i18n";
type Picker = () => Promise<string | null>;
const defaultPicker: Picker = async () => {
  const value = await open({ multiple: false, directory: false, filters: [{ name: "Code editor (.exe)", extensions: ["exe"] }] });
  return typeof value === "string" ? value : null;
};
let picker = defaultPicker;
export function setSourceEditorPickerForTests(value: Picker | null): void { picker = value || defaultPicker; }
export async function mountSourcePreview(view: HTMLElement, close: () => void, path: string, line = 1, column = 1, initialError = ""): Promise<void> {
  let disposed = false;
  const current = () => !disposed && view.isConnected;
  // Static structure only; file names and contents are assigned with textContent.
  view.innerHTML = `<div class="source-header"><strong id="source-title"></strong><button id="source-close" type="button"></button></div>
    <div id="source-path"></div><p id="source-hint"></p>
    <div class="source-actions"><button id="source-open-editor" type="button"></button><button id="source-choose-editor" type="button"></button><button id="source-forget-editor" type="button"></button>
    <label><span id="source-line-label"></span> <input id="source-line" type="number" min="1" value="1"></label><button id="source-go" type="button"></button></div>
    <output id="source-status" aria-live="polite"></output><ol id="source-lines"></ol>`;
  view.tabIndex = -1; view.focus();
  const dispose = () => { disposed = true; view.replaceChildren(); window.removeEventListener("storage", refresh); };
  view.querySelector<HTMLButtonElement>("#source-close")!.onclick = () => { dispose(); close(); };
  window.addEventListener("pagehide", dispose, {once:true});
  view.addEventListener("keydown", event => {
    if (event.key === "Escape") { dispose(); close(); }
    if (event.ctrlKey || event.metaKey) {
      if (["s", "z", "y"].includes(event.key.toLowerCase())) event.preventDefault();
      event.stopPropagation();
    }
  });
  const text = (id: string, value: string) => { view.querySelector(`#${id}`)!.textContent = value; };
  text("source-title", t("sourcePreview")); text("source-close", t("close")); text("source-path", path);
  text("source-hint", t("sourceHint")); text("source-open-editor", t("sourceOpenEditor")); text("source-choose-editor", t("sourceChooseEditor")); text("source-forget-editor", t("sourceForgetEditor")); text("source-line-label", t("sourceLine")); text("source-go", t("sourceGo"));
  text("source-status", initialError || t("sourceLoading")); view.querySelector("#source-lines")!.replaceChildren();
  const input = view.querySelector<HTMLInputElement>("#source-line")!; input.value = String(line); input.removeAttribute("max");
  const goButton = view.querySelector<HTMLButtonElement>("#source-go")!; goButton.onclick = null; input.onkeydown = null;
  const openButton = view.querySelector<HTMLButtonElement>("#source-open-editor")!, chooseButton = view.querySelector<HTMLButtonElement>("#source-choose-editor")!, forgetButton = view.querySelector<HTMLButtonElement>("#source-forget-editor")!;
  const refresh = () => { openButton.disabled = !preferences.sourceEditor; forgetButton.disabled = !preferences.sourceEditor; openButton.title = preferences.sourceEditor; }; refresh(); window.addEventListener("storage", refresh);
  let launching = false;
  const launch = async (choose: boolean) => {
    if (launching) return; launching = true; openButton.disabled = chooseButton.disabled = true;
    try {
      const editor = choose ? await picker() : preferences.sourceEditor;
      if (!editor || !current()) return;
      const requested = Math.max(1, Math.floor(Number(input.value) || line));
      await resourceService().openEditor(path, editor, requested, column);
      if (!current()) return;
      setPreference("sourceEditor", editor); text("source-status", t("sourceEditorOpened"));
    } catch (error) { if (current()) text("source-status", String(error)); }
    finally { launching = false; if (current()) { chooseButton.disabled = false; refresh(); } }
  };
  chooseButton.disabled = false; chooseButton.onclick = () => { void launch(true); }; openButton.onclick = () => { void launch(false); };
  forgetButton.onclick = () => { setPreference("sourceEditor", ""); refresh(); };
  try {
    const result = await resourceService().readText(path); if (!current()) return;
    const lines = result.content.split(/\r\n|\n|\r/);
    const render = () => {
      const requested = Math.max(1, Math.floor(Number(input.value) || 1));
      const selected = Math.min(lines.length, requested), start = Math.max(0, selected - 101), end = Math.min(lines.length, start + 400);
      input.max = String(lines.length); input.value = String(selected);
      const list = view.querySelector<HTMLOListElement>("#source-lines")!; list.start = start + 1; list.replaceChildren();
      const fragment = document.createDocumentFragment();
      for (let i = start; i < end; i++) {
        const row = document.createElement("li"), code = document.createElement("code"); code.textContent = lines[i] || " "; row.append(code);
        if (i + 1 === selected) { row.classList.add("source-selected"); row.setAttribute("aria-current", "true"); }
        fragment.append(row);
      }
      list.append(fragment);
      text("source-status", `${initialError ? initialError + "\n" : ""}${result.encoding} · ${t("sourceLine")} ${selected} / ${lines.length} · ${start + 1}–${end}${requested > lines.length ? " · " + t("sourceLineClamped") : ""}`);
      list.querySelector(".source-selected")?.scrollIntoView({block:"center"});
    };
    goButton.onclick = render;
    input.onkeydown = event => { if (event.key === "Enter") { event.preventDefault(); render(); } };
    render();
  } catch (error) { if (current()) text("source-status", String(error)); }
}
