import { open } from "@tauri-apps/plugin-dialog";
import { navigationService } from "./file-service";
import { recentFiles, bindRecentFiles } from "./recent-files";
import { searchDirectory } from "./directory-search";
import { t } from "./i18n";
import { showError } from "./ui";
type OpenResource = (path: string, line: number) => Promise<unknown>;
export function bindNavigation(openResource: OpenResource): void {
  bindRecentFiles();
  const panel = document.getElementById("navigation-panel")!, list = document.getElementById("navigation-results")!, status = document.getElementById("navigation-status")!;
  const input = document.getElementById("navigation-query") as HTMLInputElement;
  let folder = "", epoch = 0, controller: AbortController | undefined;
  const stop = () => { controller?.abort(); epoch++; };
  const row = (text: string, action: () => unknown) => {
    const button = document.createElement("button"); button.textContent = text; button.title = text;
    button.onclick = () => { void Promise.resolve(action()).catch(e => showError(String(e))); }; list.append(button);
  };
  const recents = () => { stop(); list.replaceChildren(); status.textContent = t("recentFiles"); recentFiles().forEach(path => row(path, () => openResource(path, 0))); };
  const directory = async (path: string) => {
    stop(); const token = epoch; list.replaceChildren(); status.textContent = path;
    const result = await navigationService().list(path); if (token !== epoch) return;
    if (path.toLowerCase() !== folder.toLowerCase()) row("↑", () => directory(path.replace(/[\\/][^\\/]+$/, "")));
    for (const item of result.entries) row((item.directory ? "📁 " : "") + item.name, () => item.directory ? directory(item.path) : openResource(item.path, 0));
    if (result.truncated) status.textContent += " — " + t("navigationLimit");
  };
  document.getElementById("btn-navigation")!.onclick = () => { panel.hidden = !panel.hidden; if (!panel.hidden) { recents(); input.focus(); } else stop(); };
  document.getElementById("navigation-close")!.onclick = () => { stop(); panel.hidden = true; };
  document.getElementById("navigation-cancel")!.onclick = () => { stop(); status.textContent = t("navigationCancelled"); };
  document.getElementById("navigation-recent")!.onclick = recents;
  document.getElementById("navigation-folder")!.onclick = () => { void (async () => { const selected = await open({directory:true, multiple:false}); if (typeof selected === "string") { folder = selected; await directory(folder); } })().catch(e => showError(String(e))); };
  async function search() {
    if (input.value.startsWith(">")) {
      stop(); list.replaceChildren();
      for (const id of ["btn-new", "btn-open", "btn-save", "btn-find", "btn-versions", "btn-export"]) {
        const button = document.getElementById(id)!;
        if ((button.textContent || "").toLowerCase().includes(input.value.slice(1).trim().toLowerCase())) row(button.textContent || id, () => {panel.hidden = true; button.click();});
      }
      return;
    }
    if (!folder) { status.textContent = t("chooseFolderFirst"); return; }
    stop(); controller = new AbortController(); const signal = controller.signal, token = epoch;
    list.replaceChildren(); status.textContent = t("sourceLoading");
    try {
      const result = await searchDirectory(folder, input.value, !(document.getElementById("navigation-content") as HTMLInputElement).checked, signal,
        hit => { if (token === epoch) row(`${hit.path}${hit.line ? ":"+hit.line : ""} — ${hit.text}`, () => openResource(hit.path, hit.line)); });
      if (token === epoch) status.textContent = `${result.visited} / ${result.skipped} ${t("navigationSkipped")}${result.truncated ? " — " + t("navigationLimit") : ""}`;
    } catch (e) { if (token === epoch && !signal.aborted) status.textContent = String(e); }
  }
  document.getElementById("navigation-search")!.onclick = () => { void search(); };
  input.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); void search(); } };
  window.addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") { e.preventDefault(); panel.hidden = false; input.value = e.shiftKey ? ">" : ""; recents(); input.focus(); if (e.shiftKey) void search(); } });
}
