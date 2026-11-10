// table.ts —— WYSIWYG 表格浮层（补 Vditor 重建后不自动触发"光标进表显浮层"的缺陷）
// 以及行列数字框的"确认后一次性增删"交互（避免 Vditor 逐字符增删丢数据）。
import { S, activeDoc } from "./state";
import { t } from "./i18n";
import { applyDocumentEdit, syncDocFromEditor, editorIsComposing, withSuppressInput } from "./editor-sync";

let tableInputIgnore = false;

// WYSIWYG 模式下光标进入表格单元格时显示表格浮层(vditor-panel)。
// Vditor 3.11.2 在销毁重建后的 wysiwyg 实例下"光标进表自动显浮层"逻辑不触发，
// 宿主自行监听 selectionchange 控制浮层显隐与定位。
export function bindTablePopoverVisibility() {
  document.addEventListener("selectionchange", () => {
    if (!S.vditor || S.currentMode !== "wysiwyg") return;
    const wysEl = document.querySelector("#editor .vditor-wysiwyg");
    const popover = document.querySelector("#editor .vditor-wysiwyg .vditor-panel") as HTMLElement | null;
    if (!wysEl || !popover) return;
    const sel = window.getSelection();
    const anchor = sel && sel.anchorNode;
    // selection 可落在文本节点(其 parentElement 是格)或直接落在空单元格元素(自身即格)；
    // 统一取"起点元素"再 closest，避免空单元格 anchor.parentElement=tr 漏判（cellFound=false→浮层不显示）
    const startEl = anchor ? (anchor.nodeType === 1 ? (anchor as HTMLElement) : anchor.parentElement) : null;
    const cell = startEl ? startEl.closest("td,th") : null;
    // 光标在表格单元格 或 在浮窗内(点按钮/输入行列数)时显示浮窗；
    // 点浮窗按钮/行列 input 时 selection 会落到 popover 上，必须把它视作"仍在表格编辑"，
    // 否则浮窗会一触即消（无法连续增删行/列、无法编辑行列数字）
    const inPopover = startEl ? popover.contains(startEl) : false;
    if ((cell && wysEl.contains(cell)) || inPopover) {
      popover.classList.remove("vditor-panel--none");
      popover.style.display = "block";
      if (cell && wysEl.contains(cell)) {
        // 仅光标在表格时跟随定位；点浮窗时保持原位避免跳动
        const cellRect = (cell as HTMLElement).getBoundingClientRect();
        const wysRect = (wysEl as HTMLElement).getBoundingClientRect();
        popover.style.left = Math.max(0, cellRect.left - wysRect.left) + "px";
        const popH = popover.offsetHeight;
        let top = cellRect.top - wysRect.top - popH - 4;
        if (top < 4) top = cellRect.bottom - wysRect.top + 4; // 上方放不下则放下方
        popover.style.top = top + "px";
      }
    } else {
      popover.style.display = "none";
      popover.classList.add("vditor-panel--none");
    }
  });
}

// 表格行列数字框：用户输入时不立即增删（避免逐字符触发——如想把行数改成 20，先输 "2" 会被
// 立即缩到 2 行、删掉第 3 行起的数据）。改为确认（回车/失焦）后才一次性增删到目标值。
let tableInputJustCommitted = false; // 回车确认后 blur 会再触发 focusout，用标志避免二次提交
function commitTableInput(t: HTMLInputElement) {
  tableInputIgnore = true;
  t.dispatchEvent(new Event("input", { bubbles: true })); // 放行：Vditor 按 value 增删到目标行列数
  window.setTimeout(() => { tableInputIgnore = false; }, 100);
}
export function bindTableInputConfirm() {
  // capture 拦截：阻止 Vditor 在每次 input 事件时立即增删（tableInputIgnore 时放行）
  document.addEventListener("input", (e) => {
    if (tableInputIgnore) return;
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type !== "number") return;
    const popover = document.querySelector("#editor .vditor-wysiwyg .vditor-panel");
    if (!popover || !popover.contains(t)) return;
    e.stopImmediatePropagation(); // 阻止 Vditor 的 input 监听（逐字符增删）
  }, true);
  // 回车确认 → 一次性增删到当前值
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type !== "number") return;
    const popover = document.querySelector("#editor .vditor-wysiwyg .vditor-panel");
    if (!popover || !popover.contains(t)) return;
    e.preventDefault();
    commitTableInput(t);
    tableInputJustCommitted = true; // 标记：blur 触发的 focusout 不再重复提交
    t.blur();
  }, true);
  // 失焦确认 → 一次性增删到当前值
  document.addEventListener("focusout", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || t.type !== "number") return;
    const popover = document.querySelector("#editor .vditor-wysiwyg .vditor-panel");
    if (!popover || !popover.contains(t)) return;
    if (tableInputJustCommitted) { tableInputJustCommitted = false; return; } // 回车路径已提交
    commitTableInput(t);
  }, true);
}

// Keep header rows fixed; data rows move as one document transaction, including empty cells.
export function moveTableRow(row: HTMLTableRowElement, direction: -1 | 1): boolean {
  const doc = activeDoc();
  if (!doc || !S.vditor || S.currentMode !== "wysiwyg" || S.switchInFlight || editorIsComposing()) return false;
  if (!document.querySelector("#editor .vditor-wysiwyg .vditor-reset")?.contains(row) || row.querySelector("th")) return false;
  const sibling = direction === -1 ? row.previousElementSibling : row.nextElementSibling;
  if (!(sibling instanceof HTMLTableRowElement) || sibling.querySelector("th")) return false;
  syncDocFromEditor(doc);
  const parent = row.parentElement!, next = row.nextSibling;
  let source = "";
  // Read the candidate then restore the DOM before committing. Failed conversion cannot leave a half-applied edit.
  withSuppressInput(() => {
    try { if (direction === -1) parent.insertBefore(row, sibling); else parent.insertBefore(sibling, row); source = S.vditor!.getValue(); }
    finally { parent.insertBefore(row, next); }
  });
  return Boolean(source) && applyDocumentEdit(doc, source);
}

export function bindTableRowActions(): void {
  const panel = document.createElement("div"); panel.id = "table-row-actions"; panel.hidden = true;
  const up = document.createElement("button"), down = document.createElement("button");
  up.dataset.i18n = "rowUp"; down.dataset.i18n = "rowDown";
  up.textContent = t("rowUp"); down.textContent = t("rowDown"); panel.append(up, down); document.body.append(panel);
  let selected: HTMLTableRowElement | null = null;
  panel.addEventListener("mousedown", e => e.preventDefault());
  up.onclick = () => { if (selected) moveTableRow(selected, -1); panel.hidden = true; };
  down.onclick = () => { if (selected) moveTableRow(selected, 1); panel.hidden = true; };
  document.addEventListener("selectionchange", () => {
    const anchor = getSelection()?.anchorNode;
    const el = anchor instanceof Element ? anchor : anchor?.parentElement;
    const row = el?.closest("tr");
    selected = row && document.querySelector("#editor .vditor-wysiwyg .vditor-reset")?.contains(row) ? row : null;
    panel.hidden = !selected || S.currentMode !== "wysiwyg" || Boolean(selected.querySelector("th"));
    if (panel.hidden || !selected) return;
    up.disabled = !selected.previousElementSibling || Boolean(selected.previousElementSibling.querySelector("th"));
    down.disabled = !selected.nextElementSibling;
    const rect = selected.getBoundingClientRect();
    panel.style.left = Math.max(5, Math.min(innerWidth - 220, rect.right - 210)) + "px";
    panel.style.top = Math.max(5, Math.min(innerHeight - 40, rect.bottom + 3)) + "px";
  });
  document.addEventListener("scroll", () => { panel.hidden = true; }, true);
}
