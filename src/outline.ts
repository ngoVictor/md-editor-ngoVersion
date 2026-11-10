// outline.ts —— 大纲：章节解析、展示、定位、增删与重排
// 职责单一：本模块只管"大纲/章节"。内容变更后的 UI 刷新（标签/标题）通过
// setRefreshUi 由 docs 模块注册回调，避免本模块反向依赖 docs（低耦合）。
import { confirm } from "@tauri-apps/plugin-dialog";
import { S, activeDoc, esc, splitLines, joinLines, type Doc } from "./state";
import { t } from "./i18n";
import { saveScroll, restoreScroll } from "./scroll";
import { activeContentRoot, renderedHeadings, headingText } from "./heading";
import { mountDocument, syncDocFromEditor, editorIsComposing } from "./editor-sync";
import { setDocumentContent } from "./document-store";
import { preferences, setPreference } from "./preferences";

export interface Section {
  id: string;
  level: number;
  title: string;
  start: number;
  end: number;
}

// UI 刷新回调（docs 注册：renderTabs + updateTitle）
let refreshUi: (() => void) | null = null;
export function setRefreshUi(fn: () => void): void { refreshUi = fn; }

// 章节稳定 id：层级 + 标题 hash + 同名出现次数。防抖期间内容变化后大纲未刷新，
// 旧下标 id（sec-i）会漂移导致删错/跳错章节；稳定 id 用于当前正文中的定位。
// 同名标题的计数也可能漂移，所以 UI 操作还须核对渲染 revision，确认弹窗返回后再次核对。
function sectionId(level: number, title: string, occurrence: number): string {
  let h = 5381;
  for (let i = 0; i < title.length; i++) h = (h * 33) ^ title.charCodeAt(i);
  return `sec-${level}-${(h >>> 0).toString(36)}-${occurrence}`;
}

// 章节解析：基于 md 源码行，跳过代码围栏里的 #。
// 围栏按 CommonMark 规则识别（≤3 空格缩进、关闭围栏必须同字符且长度 ≥ 开启围栏）；
// 4 空格缩进代码块里的 ``` 不会误开关，4 反引号围栏里的 3 反引号行也不会误关闭。
export function parseSections(md: string): Section[] {
  const { lines } = splitLines(md);
  type H = { level: number; line: number; title: string };
  const heads: H[] = [];
  let fence: { char: string; len: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const fenceLine = ln.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (fenceLine && fenceLine[1][0] === fence.char && fenceLine[1].length >= fence.len && /^ {0,3}(?:`{3,}|~{3,})[ \t]*$/.test(ln)) {
        fence = null; // 同字符且长度足够的围栏行关闭代码块
      }
      continue; // 围栏内一切行都不是标题
    }
    if (fenceLine && (fenceLine[1][0] !== "`" || !ln.slice(fenceLine[0].length).includes("`"))) {
      fence = { char: fenceLine[1][0], len: fenceLine[1].length };
      continue;
    }
    // 仅识别 ATX 标题(#)；Setext(===/--- 下划线式)不计入大纲(罕见且 --- 与分隔线歧义)。
    // 闭合 # 前必须存在空白（CommonMark），否则 `## C#` 这类合法标题不能把结尾 # 当闭合符吞掉。
    const m = ln.match(/^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/);
    if (m) heads.push({ level: m[1].length, line: i, title: m[2].trim() });
  }
  const secs: Section[] = [];
  const seen: Record<string, number> = {}; // 同名标题出现次数（稳定 id 用）
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    let end = lines.length - 1;
    for (let j = i + 1; j < heads.length; j++) {
      if (heads[j].level <= h.level) {
        end = heads[j].line - 1;
        break;
      }
    }
    // 文件以换行结尾时 split 会多出一个末尾空串元素。它只是"最后一行的行终止符"，
    // 不属于章节内容；若算进最后一个章节，删除/拖动会把文末换行变成多余空行或弄丢换行。
    if (end === lines.length - 1 && lines[end] === "") end--;
    const occ = (seen[h.title] = (seen[h.title] || 0) + 1);
    secs.push({ id: sectionId(h.level, h.title, occ), level: h.level, title: h.title, start: h.line, end });
  }
  return secs;
}

export function rebuildOutline() {
  if (!S.vditor) return;
  const doc = activeDoc();
  const renderedRevision = doc?.revision;
  const currentOutline = () => {
    const current = activeDoc();
    if (!current || current !== doc || S.windowTransfer || S.switchInFlight || editorIsComposing()) return false;
    syncDocFromEditor(current);
    if (current.revision !== renderedRevision) { rebuildOutline(); return false; }
    return true;
  };
  const filter = (document.getElementById("outline-filter") as HTMLInputElement | null)?.value.toLocaleLowerCase() || "";
  const secs = parseSections(doc ? doc.content : S.vditor.getValue()).filter(s => s.title.toLocaleLowerCase().includes(filter));
  const ul = document.getElementById("outline")!;
  ul.innerHTML = "";
  if (secs.length === 0) {
    ul.innerHTML = '<li class="empty">' + esc(t("noHeadings")) + "</li>";
    return;
  }
  secs.forEach((s) => {
    const li = document.createElement("li");
    li.className = "outline-item";
    li.style.paddingLeft = s.level * 12 + 8 + "px";
    li.dataset.id = s.id;
    li.innerHTML =
      `<span class="ot" title="${esc(s.title)}">${esc(s.title)}</span>` +
      `<span class="odel" title="${esc(t("deleteChapter"))}">✕</span>`;
    li.addEventListener("click", () => { if (currentOutline()) scrollToHeading(s.id); });
    li.querySelector(".odel")!.addEventListener("click", (e) => {
      e.stopPropagation();
      if (currentOutline()) void deleteSection(s.id);
    });
    // 章节拖动重排：用 pointer 事件而非 HTML5 DnD——dragDropEnabled=true 时(Tauri 文件拖放需要)，
    // Windows 前端 HTML5 drag-and-drop 被禁用(Tauri schema 明确)，原 draggable/dragstart 会失效。
    li.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !currentOutline()) return; // 仅左键和当前大纲
      const dragSecId = s.id;
      const startY = e.clientY;
      let moved = false;
      let overLi: HTMLElement | null = null;
      const onMove = (ev: PointerEvent) => {
        if (!moved && Math.abs(ev.clientY - startY) < 5) return; // 移动阈值，避免点击误触
        if (!moved) { moved = true; li.classList.add("dragging"); }
        const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
        const t = el ? (el.closest(".outline-item") as HTMLElement | null) : null;
        document.querySelectorAll(".outline-item.over").forEach((x) => x.classList.remove("over"));
        if (t && t !== li && ul.contains(t)) { t.classList.add("over"); overLi = t; } else overLi = null;
      };
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        li.classList.remove("dragging");
        document.querySelectorAll(".outline-item.over").forEach((x) => x.classList.remove("over"));
        if (moved && overLi && overLi.dataset.id && overLi.dataset.id !== dragSecId && currentOutline()) {
          const rect = overLi.getBoundingClientRect();
          const pos: "before" | "after" = ev.clientY - rect.top < rect.height / 2 ? "before" : "after";
          moveSection(dragSecId, overLi.dataset.id, pos);
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
    ul.appendChild(li);
  });
}

export function scheduleOutline() {
  if (S.outlineTimer !== null) window.clearTimeout(S.outlineTimer);
  S.outlineTimer = window.setTimeout(() => {
    S.outlineTimer = null;
    rebuildOutline();
  }, 400);
}

// 定位到章节：按稳定 id 在当前内容中查找（防抖窗口内标题未变则命中；已变则安全忽略）
export function scrollToHeading(id: string) {
  const doc = activeDoc();
  const secs = parseSections(doc ? doc.content : S.vditor ? S.vditor.getValue() : "");
  const target = secs.find((s) => s.id === id);
  if (!target) return;
  // 只查当前模式真正可见的内容容器：Vditor 会把多套模式 DOM 同时挂在 #editor 下，
  // 直接全查可能命中隐藏副本，导致 scrollIntoView 作用在不可见元素上。
  const root = activeContentRoot();
  if (!root) return;
  const heads = renderedHeadings(root);
  // 优先按标题纯文本定位（同名计数），可跳过 Setext 等未进大纲标题的重名干扰；
  // 命中失败再回退 DOM 索引（无 Setext 时与原行为等价）
  const idx = secs.findIndex((s) => s.id === id);
  const sameBefore = secs.slice(0, idx).filter((s) => s.title === target.title).length;
  let seen = 0;
  for (const h of heads) {
    if (headingText(h) === target.title) {
      if (seen === sameBefore) {
        h.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      seen++;
    }
  }
  if (heads[idx]) heads[idx].scrollIntoView({ behavior: "smooth", block: "start" });
}

// 内容变更后的统一提交：写回编辑器 + 刷新大纲/标签/标题，并保持滚动位置
function commitContentChange(doc: Doc) {
  if (!S.vditor) return;
  saveScroll(doc); // 先记录当前滚动位置再重建
  mountDocument(doc);
  restoreScroll(doc); // 保持原滚动位置（超出新高度时浏览器自动钳制）
  rebuildOutline();
  refreshUi?.();
}

export async function deleteSection(id: string) {
  if (!S.vditor || S.windowTransfer || S.switchInFlight || editorIsComposing()) return;
  const doc = activeDoc();
  if (!doc) return;
  syncDocFromEditor(doc);
  const revision = doc.revision;
  const secs = parseSections(doc.content);
  const s = secs.find((x) => x.id === id);
  if (!s) return;
  let ok = false;
  // 英文正文不前置 delTitle（否则生成 'Delete section"标题" and all its content?' 病句：
  // 引号孤立 + 与标题框 'Delete section' 重复）。中文用「删除章节「标题」…」结构（「」配对正确）。
  // delTitle 仍作为 confirm 弹窗的标题框。
  const delQ = S.currentLang === "en" ? '"' : "「";
  const delMsg = (S.currentLang === "en" ? "" : t("delTitle")) + delQ + s.title + t("delConfirmSuf");
  try {
    ok = await confirm(delMsg, { title: t("delTitle"), kind: "warning" });
  } catch {
    ok = window.confirm(delMsg);
  }
  if (!ok || activeDoc()?.id !== doc.id || S.switchInFlight || editorIsComposing()) return;
  syncDocFromEditor(doc);
  if (doc.revision !== revision || S.windowTransfer) return;
  const latest = parseSections(doc.content).find(section => section.id === id);
  if (!latest) return;
  const { lines, eol } = splitLines(doc.content); // 保留原 CRLF/LF 换行风格
  setDocumentContent(doc, joinLines(lines.slice(0, latest.start).concat(lines.slice(latest.end + 1)), eol), true);
  commitContentChange(doc);
}

export function moveSection(dragId: string, targetId: string, pos: "before" | "after") {
  if (!S.vditor || S.windowTransfer || S.switchInFlight || editorIsComposing()) return;
  const doc = activeDoc();
  if (!doc) return;
  syncDocFromEditor(doc);
  const secs = parseSections(doc.content);
  const drag = secs.find((x) => x.id === dragId);
  const target = secs.find((x) => x.id === targetId);
  if (!drag || !target || drag === target) return;
  if (target.start >= drag.start && target.end <= drag.end) return;
  const { lines, eol } = splitLines(doc.content); // 保留原 CRLF/LF 换行风格
  const block = lines.slice(drag.start, drag.end + 1);
  const work = lines.slice();
  work.splice(drag.start, drag.end - drag.start + 1);
  const shift = drag.start < target.start ? drag.end - drag.start + 1 : 0;
  const insertAt = pos === "before" ? target.start - shift : target.end - shift + 1;
  work.splice(insertAt, 0, ...block);
  setDocumentContent(doc, joinLines(work, eol), true);
  commitContentChange(doc);
}

export function bindOutlineControls(): void {
  document.getElementById("outline-filter")!.addEventListener("input", rebuildOutline);
  const panel = document.getElementById("outline-panel")!;
  const handle = document.getElementById("outline-resize")!;
  const resize = (width: number) => {
    const value = Math.round(Math.min(480, Math.max(150, width)));
    panel.style.width = value + "px"; panel.style.flexBasis = value + "px";
    handle.setAttribute("aria-valuenow", String(value)); setPreference("outlineWidth", value);
  };
  resize(preferences.outlineWidth);
  handle.addEventListener("pointerdown", e => { if (e.button === 0) { handle.setPointerCapture(e.pointerId); e.preventDefault(); } });
  handle.addEventListener("pointermove", e => { if (handle.hasPointerCapture(e.pointerId)) resize(e.clientX - panel.getBoundingClientRect().left); });
  handle.addEventListener("pointerup", e => { if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId); });
  handle.addEventListener("keydown", e => { if (["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); resize(preferences.outlineWidth + (e.key === "ArrowLeft" ? -10 : 10)); } });
}
