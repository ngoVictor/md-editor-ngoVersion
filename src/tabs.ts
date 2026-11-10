// tabs.ts —— 标签栏、标题栏与空状态的纯 UI 层。
import { S, activeDoc } from "./state";
import { t } from "./i18n";

export function renderTabs(onSwitch: (id: string) => void, onClose: (id: string) => void): void {
  const bar = document.getElementById("tabs")!;
  bar.innerHTML = "";
  S.docs.forEach((doc) => {
    const tab = document.createElement("div");
    tab.className = "tab" + (doc.id === S.activeId ? " active" : "");
    tab.dataset.docId = doc.id;
    tab.title = doc.path || doc.name;
    tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", String(doc.id === S.activeId));
    tab.tabIndex = 0;
    tab.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSwitch(doc.id); } });
    const name = document.createElement("span");
    name.className = "tab-name";
    name.textContent = (doc.dirty ? "● " : "") + (doc.externalChange || doc.saveError || doc.loadState === "error" ? "⚠ " : "") + doc.name;
    const close = document.createElement("span");
    close.className = "tab-close";
    close.textContent = "✕";
    close.title = t("closeTab");
    tab.append(name, close);
    tab.addEventListener("click", () => onSwitch(doc.id));
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      onClose(doc.id);
    });
    bar.appendChild(tab);
  });
}

export function updateTitle(): void {
  const doc = activeDoc();
  document.getElementById("file-title")!.textContent = doc ? (doc.dirty ? "● " : "") + doc.name : t("noDoc");
  document.getElementById("encoding-badge")!.textContent = doc?.encoding ? ` ${doc.encoding}` : "";
}

export function showEmptyState(): void {
  document.getElementById("empty-state")!.hidden = false;
  const outline = document.getElementById("outline");
  if (outline) outline.innerHTML = '<li class="empty">' + t("noOpenFile") + "</li>";
}

export function hideEmptyState(): void {
  document.getElementById("empty-state")!.hidden = true;
}
