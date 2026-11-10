// vditor.ts —— Vditor 实例生命周期：创建/重建/模式切换/工具栏 tooltip
// 解耦设计：本模块不依赖业务模块（docs/outline 等）。Vditor 的 input/after 回调通过
// 注册表（registerInputHook / registerAfterHook）分发，业务逻辑由 docs 模块注册进来。
import Vditor from "vditor";
import { S, activeDoc, type Mode } from "./state";
import { t, VDITOR_I18N, VDITOR_LANG } from "./i18n";
import { saveScroll } from "./scroll";
import { syncDocFromEditor, undoDocument, editorIsComposing } from "./editor-sync";

import { preferences } from "./preferences";
import { resolveTheme, isDarkTheme, CONTENT_THEME_PATH } from "./theme-palette";

export type VditorOptions = NonNullable<ConstructorParameters<typeof Vditor>[1]>;

// 事件钩子注册表：业务模块把自己的 input/after 逻辑注册进来，避免本模块反向依赖
const inputHooks: Array<() => void> = [];
const afterHooks: Array<() => void> = [];
const transitionCompleteHooks: Array<() => void> = [];
export function registerInputHook(fn: () => void): void { inputHooks.push(fn); }
export function registerAfterHook(fn: () => void): void { afterHooks.push(fn); }
export function registerTransitionCompleteHook(fn: () => void): void { transitionCompleteHooks.push(fn); }

function finishTransition(): void {
  S.switchInFlight = false;
  transitionCompleteHooks.forEach((hook) => hook());
}

// 构造 Vditor options：toolbar/input/after 统一在此，mode 由参数决定（销毁重建切换模式时复用）
export function vditorOptions(mode: Mode): VditorOptions {
  const dark = isDarkTheme(resolveTheme(preferences.theme, matchMedia("(prefers-color-scheme: dark)").matches));
  return {
    mode,
    theme: dark ? "dark" : "classic",
    lang: VDITOR_LANG[S.currentLang],
    i18n: VDITOR_I18N[S.currentLang], // 注入本地 i18n（当前语言），工具栏 tooltip 自动走 i18n
    cdn: "/vditor-assets", // lute(markdown 引擎)/icons/method 等本地加载，符合 CSP，不依赖 unpkg
    // 链接点击统一由 link.ts 在 document 捕获阶段接管（内链滚动/外链系统浏览器）。
    // 关闭 Vditor 内置 window.open：Tauri WebView2 中它既打不开系统浏览器，也不会滚动 #hash。
    link: { isOpen: false },
    customWysiwygToolbar: () => {},
    height: "100%",
    cache: { enable: false },
    // 编辑区代码块直接显示源码（可编辑）：编辑器 lute 读取的是 preview.markdown.codeBlockPreview
    // （不是 markdown.codeBlockPreview——那个只影响静态 md→html 转换）。
    // false = 不再生成"高亮预览 + 源码"两份 DOM；分屏预览右侧高亮不受影响
    preview: {
      maxWidth: 920, // 编辑/预览内容限宽 920px 居中，排版舒适
      markdown: { codeBlockPreview: false },
      theme: { current: dark ? "dark" : "light", path: CONTENT_THEME_PATH },
      hljs: { lineNumber: false, style: dark ? "github-dark" : "github" },
    },
    toolbar: [
      "headings", "bold", "italic", "strike", "|",
      "line", "quote", "list", "ordered-list", "check", "outdent", "indent", "|",
      "code", "inline-code", "link", "table", "|",
      { name: "alei-undo", tip: t("undo"), icon: '<svg><use xlink:href="#vditor-icon-undo"></use></svg>', click: () => undoDocument("undo") },
      { name: "alei-redo", tip: t("redo"), icon: '<svg><use xlink:href="#vditor-icon-redo"></use></svg>', click: () => undoDocument("redo") }, "|",
      "fullscreen",
    ],
    input: () => {
      inputHooks.forEach((h) => h());
    },
    after: () => {
      // GFM soft line breaks are spaces; keep badge links on the same rendered row.
      // This configures only HTML output, not the Markdown/source DOM conversion.
      (S.vditor?.vditor.lute as unknown as { SetSoftBreak2HardBreak(value: boolean): void })?.SetSoftBreak2HardBreak(false);
      fixToolbarTooltipDirection();
      afterHooks.forEach((h) => h());
      updateModeUI();
      finishTransition();
    },
  };
}

export function initVditor() {
  S.vditor = new Vditor("editor", vditorOptions(S.currentMode));
}

// 销毁重建 Vditor（模式/语言切换共用）：先回写当前内容 + 记忆滚动位置，再 destroy→new；
// switchInFlight 锁由 after 回调统一释放；beforeDestroy 供语言切换做额外处理（如欢迎页重置）
let rebuildGeneration = 0;
export function rebuildVditor(mode: Mode, beforeDestroy?: () => void): boolean {
  // 重入锁：destroy→after 之间 vditor 处于重建中间态，连点/连按会在 vditor=null 窗口期
  // 二次进入，并发触发 destroy/new 导致 DOM 残留、重复实例或内容丢失。重建中直接忽略。
  if (!S.vditor || S.switchInFlight || editorIsComposing()) return false;
  const previousMode = S.currentMode;
  const generation = ++rebuildGeneration;
  // 兜底解锁：若 after 回调因初始化失败/异常永不执行，锁会永久占用导致后续所有切换被拒。
  // 10 秒超时强制释放（after 正常执行时先置 false，此后再置 false 无害）。
  window.setTimeout(() => {
    if (generation === rebuildGeneration && S.switchInFlight) finishTransition();
  }, 10000);
  const cur = activeDoc();
  if (cur) {
    syncDocFromEditor(cur); // 被动快照：空值守卫（防 IR 空读误清空）
    saveScroll(cur); // 记忆滚动位置（after 回调重建后恢复）
  }
  S.switchInFlight = true;
  try {
    if (beforeDestroy) beforeDestroy();
    S.currentMode = mode;
    S.vditor.destroy();
    S.vditor = null;
    S.vditor = new Vditor("editor", vditorOptions(mode));
    updateModeUI();
    return true;
  } catch (error) {
    S.vditor = null;
    S.currentMode = previousMode;
    updateModeUI();
    finishTransition();
    throw error;
  }
}

// 更新顶部模式下拉框选中值 + 当前模式徽标
export function updateModeUI() {
  const sel = document.getElementById("btn-mode") as HTMLSelectElement | null;
  if (sel) sel.value = S.currentMode;
  const badge = document.getElementById("mode-badge");
  const modeKey = S.currentMode === "wysiwyg" ? "modeWYSIWYG" : S.currentMode === "ir" ? "modeIR" : "modeSV";
  const modeTip = S.currentMode === "wysiwyg" ? "modeWYSIWYGTip" : S.currentMode === "ir" ? "modeIRTip" : "modeSVTip";
  if (badge) {
    badge.textContent = t(modeKey);
    badge.title = t(modeTip);
    badge.className = "mode-badge " + S.currentMode;
  }
}

// 工具栏 tooltip 文字走 Vditor 注入的 i18n（自动多语言）；此处只把方向改成向下，
// 避开 #editor-wrap overflow:hidden 向上裁剪
export function fixToolbarTooltipDirection() {
  document.querySelectorAll<HTMLElement>("#editor .vditor-toolbar [data-type]").forEach((btn) => {
    btn.className = btn.className.replace(/vditor-tooltipped__n[we]?/, "vditor-tooltipped__s");
  });
}
