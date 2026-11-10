// main.ts —— 应用入口：组装各业务模块、绑定全局事件、启动 Vditor
// 本文件注入业务回调并组装生命周期；领域写入口在 store，文件 IPC 在 file-service。
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, confirm } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "vditor/dist/index.css"; // Vditor 内核样式（含编辑器/工具栏/预览）
import { S, activeDoc, nextMode, type Lang, type Mode } from "./state";
import { applyAllText, t, welcomeMd } from "./i18n";
import { bindScrollTracking } from "./scroll";
import { initVditor, rebuildVditor, registerAfterHook, registerTransitionCompleteHook, updateModeUI } from "./vditor";
import { registerVditorHooks, loadFile, renderTabs, updateTitle, openDoc, switchDoc, ensureDocumentLoaded } from "./docs";
import { bindCopyBehavior, setCopyMode } from "./copy";
import { bindLinkBehavior } from "./link";
import { bindTablePopoverVisibility, bindTableInputConfirm, bindTableRowActions } from "./table";
import { saveDoc, saveAllDirty, showCloseConfirm, pauseBackgroundSaves, waitForPendingSave } from "./save";
import { bindNavigation } from "./navigation-view";
import { bindEditorImages } from "./editor-images";
import { bindEditorHtml } from "./editor-html";
import "./editor-html.css";
import { bindExportControls } from "./export";
import { openLocalResource } from "./resource-navigation";
import { openDocumentLink } from "./document-navigation";
import { applyErrorModalText, showError } from "./ui";
import { toggleDebugBar, bindDebugBar } from "./debug";
import { resetTemporaryDocument } from "./document-store";
import { bindEditorTransactions, syncDocFromEditor, editorIsComposing } from "./editor-sync";
import { bindFind } from "./find";
import { bindTheme, applyTheme } from "./theme";
import { bindOutlineControls } from "./outline";
import { bindSession, persistSession } from "./session";
import { bindAutosave } from "./autosave";
import { bindExternalChanges } from "./external-changes";
import { rebuildOutline } from "./outline";
import { bindHistoryView } from "./history-view";

import { bindTabDrag } from "./tab-drag";
import { detachDocument, receiveDetachedDocument } from "./window-transfer";
import { isDetachedWindow } from "./window-context";

interface EditorSettings { mode: Mode; lang: Lang }
let pendingSettings: EditorSettings | null = null;
let desiredSettings: EditorSettings = { mode: S.currentMode, lang: S.currentLang };
let settingsApplying = false;

function resetSettingsControls(): void {
  const lang = document.getElementById("lang-select") as HTMLSelectElement | null;
  if (lang) lang.value = S.currentLang;
  updateModeUI();
}

async function applyEditorSettings(settings: EditorSettings): Promise<void> {
  if (settingsApplying || S.switchInFlight || editorIsComposing()) {
    pendingSettings = settings;
    resetSettingsControls();
    return;
  }
  settingsApplying = true;
  const previousLang = S.currentLang;
  const languageChanges = settings.lang !== previousLang;
  const current = activeDoc();
  if (current) syncDocFromEditor(current);
  const isWelcome = current?.name === t("welcomeName") && !current.path;
  try {
    if (languageChanges && current && isWelcome && current.dirty) {
      let ok = false;
      try {
        ok = await confirm(t("langResetMsg"), { title: t("langResetTitle"), kind: "warning" });
      } catch {
        ok = window.confirm(t("langResetMsg"));
      }
      if (!ok) {
        settings = { ...settings, lang: previousLang };
        desiredSettings = { ...desiredSettings, lang: previousLang };
      }
    }

    const modeChanges = settings.mode !== S.currentMode;
    const finalLanguageChanges = settings.lang !== previousLang;
    if (!modeChanges && !finalLanguageChanges) {
      resetSettingsControls();
      return;
    }

    S.currentLang = settings.lang;
    applyAllText();
    applyErrorModalText();
    setCopyMode(S.copyMode);
    const rebuilt = rebuildVditor(settings.mode, () => {
      const doc = activeDoc();
      if (finalLanguageChanges && doc && isWelcome && doc.id === current?.id) {
        resetTemporaryDocument(doc, welcomeMd(), t("welcomeName"));
        renderTabs();
        updateTitle();
      }
    });
    if (!rebuilt) {
      pendingSettings = settings;
      resetSettingsControls();
      return;
    }
    try { localStorage.setItem("md-editor-lang", settings.lang); } catch { /* 仅本次会话 */ }
  } catch (error) {
    S.currentLang = previousLang;
    applyAllText();
    applyErrorModalText();
    setCopyMode(S.copyMode);
    resetSettingsControls();
    showError(t("openFail") + error);
  } finally {
    settingsApplying = false;
  }
}

function requestEditorSettings(change: Partial<EditorSettings>): void {
  const desired = { ...desiredSettings, ...change };
  desiredSettings = desired;
  pendingSettings = desired;
  if (settingsApplying || S.switchInFlight) {
    resetSettingsControls();
    return;
  }
  pendingSettings = null;
  void applyEditorSettings(desired);
}

function drainPendingSettings(): void {
  if (!pendingSettings || settingsApplying || S.switchInFlight) return;
  const desired = pendingSettings;
  pendingSettings = null;
  void applyEditorSettings(desired);
}

async function boot() {
  // md-editor 是 Markdown 编辑器，不需要麦克风；Vditor 自带 RecordMedia 录音模块会调
  // getUserMedia({audio:true}) 触发系统麦克风权限弹窗。启动即禁用，杜绝无谓的麦克风请求。
  if (navigator.mediaDevices) {
    (navigator.mediaDevices as unknown as { getUserMedia: unknown }).getUserMedia = () =>
      Promise.reject(new DOMException("microphone disabled in md-editor", "NotAllowedError"));
  }

  const receiveComplete = await receiveDetachedDocument();
  desiredSettings = { mode: S.currentMode, lang: S.currentLang };
  bindTabDrag(id => { void detachDocument(id); }, switchDoc);

  // 单实例：已运行时再次双击 .md → 新标签。
  // 尽早注册（先于 initVditor），配合 Rust 侧 StartupFile 兜底，最大限度避免启动窗口期事件丢失
  try {
    await getCurrentWindow().listen<string>("open-file", (e) => loadFile(e.payload));
  } catch {
    // 非 tauri 环境忽略
  }

  // 注册 Vditor 事件钩子（docs：编辑回写 / 首次初始化 / 重建恢复）
  registerVditorHooks();
  if (receiveComplete) {
    let completed = false;
    registerAfterHook(() => { if (!completed) { completed = true; void receiveComplete().catch(error => showError(String(error))); } });
  }
  bindEditorTransactions();
  bindEditorImages();
  bindEditorHtml();
  bindNavigation((path, line) => openLocalResource({kind: "local", path, hash: "", line: line || null, column: null}, !!line));
  registerTransitionCompleteHook(drainPendingSettings);
  document.addEventListener("compositionend", () => { window.setTimeout(drainPendingSettings, 0); });
  registerTransitionCompleteHook(applyTheme);
  bindFind(); bindTheme(); bindOutlineControls();
  bindHistoryView();
  bindExportControls();
  bindSession(); bindAutosave(); bindExternalChanges(() => { renderTabs(); updateTitle(); rebuildOutline(); }, ensureDocumentLoaded);
  document.getElementById("btn-new")!.onclick = () => { if (!editorIsComposing()) openDoc(null, "", t("untitled")); };
  document.getElementById("btn-save-all")!.onclick = () => { const doc = activeDoc(); if (doc) syncDocFromEditor(doc); void saveAllDirty(); };

  try {
    const sf = isDetachedWindow ? null : await invoke<string | null>("get_startup_file");
    if (sf) S.pendingFile = sf;
  } catch {
    // 非 tauri 环境忽略
  }

  // 模式切换：顶部下拉框直接选择 + Ctrl+Alt+M 循环（排版成品→语法编辑→分屏预览）
  document.getElementById("btn-mode")!.addEventListener("change", (e) => {
    requestEditorSettings({ mode: (e.target as HTMLSelectElement).value as Mode });
  });
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === "m" || e.key === "M")) {
      e.preventDefault();
      requestEditorSettings({ mode: nextMode(pendingSettings?.mode || S.currentMode) });
    }
  });
  updateModeUI();
  applyAllText(); // 初始化静态文案到当前语言
  applyErrorModalText(); // 错误模态按钮文案
  const langSel = document.getElementById("lang-select") as HTMLSelectElement | null;
  if (langSel) langSel.addEventListener("change", () => requestEditorSettings({ lang: langSel.value as Lang }));
  bindTablePopoverVisibility(); // WYSIWYG 表格浮层显示（补 Vditor 重建后不自动触发的缺陷）
  bindTableInputConfirm(); // 表格行列数字框：确认（回车/失焦）后才增删，避免逐字符删数据
  bindTableRowActions();
  bindScrollTracking(); // 跟踪真实滚动容器 + 实时记录滚动位置
  // 调试条只在开发/浏览器调试环境开放；生产 exe 隐藏入口与快捷键，不暴露文档路径/内容快照
  const isProd = (import.meta as ImportMeta & { env?: { PROD?: boolean } }).env?.PROD === true;
  if (!isProd) {
    bindDebugBar(); // 调试条信息刷新（选中内容 / 文档状态实时诊断）
    // 调试条开关（低调的 ⚙ 按钮 + Ctrl+Shift+D 快捷键）
    document.getElementById("btn-debug")!.addEventListener("click", toggleDebugBar);
    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        toggleDebugBar();
      }
    });
  } else {
    document.getElementById("btn-debug")?.remove();
  }
  bindCopyBehavior(); // 统一复制行为：默认渲染结果（带显式序号），可切换源码
  bindLinkBehavior(openDocumentLink, openLocalResource); // 锚点、本地文档和外部网址，捕获阶段先于 Vditor 处理
  document.getElementById("btn-copy-mode")!.addEventListener("click", () => {
    setCopyMode(S.copyMode === "render" ? "source" : "render");
  });

  initVditor();

  // 关闭窗口前确认：有未保存修改时让用户选择 保存并关闭 / 不保存关闭 / 取消
  let windowCloseInFlight = false;
  try {
    const win = getCurrentWindow();
    await win.onCloseRequested(async (e) => {
      if (editorIsComposing() || S.switchInFlight || S.windowTransfer) { e.preventDefault(); return; }
      const current = activeDoc();
      if (current) syncDocFromEditor(current);
      persistSession();
      e.preventDefault();
      if (windowCloseInFlight) return;
      windowCloseInFlight = true;
      const resume = pauseBackgroundSaves();
      try {
        await Promise.all(S.docs.map(waitForPendingSave));
        if (editorIsComposing() || S.switchInFlight || S.windowTransfer) return;
        const latest = activeDoc();
        if (latest?.loadState === "ready" && S.vditor && !syncDocFromEditor(latest)) return;
        if (!S.docs.some(d => d.dirty)) { await win.destroy(); return; }
        const action = await showCloseConfirm();
        if (action === "cancel") return;
        if (action === "save" && !(await saveAllDirty())) return;
        await win.destroy();
      } catch (e2) {
        showError(t("closeFail") + e2);
      } finally {
        resume();
        windowCloseInFlight = false;
      }
    });
  } catch {
    // 非 tauri 环境忽略
  }
  // 拖拽打开：用 Tauri 原生拖放事件（dragDropEnabled=true 时 OS 文件拖放由 Tauri 拦截，
  // HTML5 drop 拿不到文件 → 实测无反应）。原生事件能拿到真实路径，用 open_file 读取，保留路径可直存。
  try {
    await getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === "drop" && event.payload.paths && event.payload.paths.length > 0) {
        // 多文件拖放：全部打开（不只第一个），非法类型忽略
        for (const p of event.payload.paths) {
          if (/\.(md|markdown|mdown|txt)$/i.test(p)) loadFile(p);
        }
      }
    });
  } catch {
    // 非 tauri 环境忽略
  }

  document.getElementById("btn-open")!.addEventListener("click", async () => {
    try {
      const p = await openDialog({
        multiple: false,
        filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdown", "txt"] }],
      });
      if (p) void loadFile(p as string);
    } catch (error) {
      showError(t("openFail") + error);
    }
  });

  document.getElementById("btn-save")!.addEventListener("click", () => { const d = activeDoc(); if (d) saveDoc(d, false, true); });

  // Ctrl+S 保存 / Ctrl+Shift+S 另存为（原版声称支持 Ctrl+S，实际未绑定——此处补上）
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
      e.preventDefault(); // 阻止 WebView 默认行为（如另存页面）
      const d = activeDoc();
      if (d) saveDoc(d, e.shiftKey, true);
    }
  });
}

window.addEventListener("DOMContentLoaded", boot);
