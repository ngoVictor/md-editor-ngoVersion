// scroll.ts —— 编辑区滚动位置记忆
// 真实滚动容器：实测 wysiwyg/ir 是编辑区内部的 pre.vditor-reset（.vditor-wysiwyg/.vditor-ir
// 本身不滚动），sv 是 .vditor-sv，预览区是 .vditor-preview。用 scroll 事件捕获真实滚动元素
// 缓存（S.activeScrollEl），避免再猜 CSS。
import { S, activeDoc, type Doc } from "./state";

export function editorScrollEl(): HTMLElement | null {
  if (!S.vditor) return null;
  // sv 模式固定用源码区：preview 的滚动位置单独存 doc.previewScrollTop，不要被"最近滚动过的元素"覆盖
  if (S.currentMode === "sv") return document.querySelector<HTMLElement>("#editor .vditor-sv");
  // 非 sv 模式只复用"编辑区滚动容器"缓存；sv 预览区的缓存不能串到这里
  if (
    S.activeScrollEl &&
    S.activeScrollEl.isConnected &&
    S.activeScrollEl.closest("#editor") &&
    S.activeScrollEl.classList.contains("vditor-reset")
  ) {
    return S.activeScrollEl;
  }
  return document.querySelector<HTMLElement>("#editor pre.vditor-reset");
}

export function previewScrollEl(): HTMLElement | null {
  if (!S.vditor) return null;
  return document.querySelector<HTMLElement>("#editor .vditor-preview");
}

// 跟踪编辑区真实滚动容器，并在滚动时实时更新当前 doc 的位置（切换时快照永远最新）。
// sv 模式两个滚动区分别写 doc.scrollTop（源码区）与 doc.previewScrollTop（预览区）。
export function bindScrollTracking() {
  document.addEventListener("scroll", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement) || !t.closest("#editor")) return;
    if (t.classList.contains("vditor-reset") || t.classList.contains("vditor-sv") || t.classList.contains("vditor-preview")) {
      S.activeScrollEl = t;
      const doc = activeDoc();
      if (!doc) return;
      if (S.currentMode === "sv" && t.classList.contains("vditor-preview")) doc.previewScrollTop = t.scrollTop;
      else doc.scrollTop = t.scrollTop;
    }
  }, true);
}

export function saveScroll(doc: Doc) {
  const el = editorScrollEl();
  if (el) doc.scrollTop = el.scrollTop;
  if (S.currentMode === "sv") {
    const preview = previewScrollEl();
    if (preview) doc.previewScrollTop = preview.scrollTop;
  }
}

// setValue 重建 DOM 后滚动归零；内容高度可能随字体/图片加载继续增长，连试 3 帧
let restoreGeneration = 0;
export function cancelScrollRestore(): void { restoreGeneration++; }
export function restoreScroll(doc: Doc) {
  const generation = ++restoreGeneration;
  const editor = S.vditor;
  const target = doc.scrollTop || 0;
  const previewTarget = doc.previewScrollTop || 0;
  let tries = 0;
  const tryRestore = () => {
    if (generation !== restoreGeneration || activeDoc()?.id !== doc.id || S.vditor !== editor) return;
    const el = editorScrollEl();
    if (el && el.scrollTop !== target) el.scrollTop = target;
    if (S.currentMode === "sv") {
      const preview = previewScrollEl();
      if (preview && preview.scrollTop !== previewTarget) preview.scrollTop = previewTarget;
    }
    if (tries < 3) {
      tries++;
      requestAnimationFrame(tryRestore);
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(tryRestore));
}
