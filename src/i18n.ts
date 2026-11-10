// i18n.ts —— 国际化：文案数据 + 查询 + 静态 DOM 文案刷新
// 只依赖 state（S.currentLang）；语言切换触发的 Vditor 重建等业务动作由入口层 setLang 协调，
// 保持本模块无业务依赖（低耦合）。
import { S, type Lang } from "./state";
import { featureText } from "./feature-text";
import zhCNI18n from "./i18n-zh-CN";
import zhTWI18n from "./i18n-zh-TW";
import enI18n from "./i18n-en";

export const VDITOR_I18N: Record<Lang, typeof zhCNI18n> = { "zh-CN": zhCNI18n, "zh-TW": zhTWI18n, "en": enI18n };
export const VDITOR_LANG: Record<Lang, "zh_CN" | "zh_TW" | "en_US"> = { "zh-CN": "zh_CN", "zh-TW": "zh_TW", "en": "en_US" };

export const UI_TEXT: Record<Lang, Record<string, string>> = {
  "zh-CN": {
    open: "📂 打开", save: "💾 保存", welcomeName: "欢迎", untitled: "未命名", noDoc: "（无）",
    ok: "确定",
    exportWord: "📄 导出 Word", exportFail: "导出失败：", exportOk: "导出成功：",
    emptyHint: "📋 点击顶部「📂 打开」，或把 .md 文件拖入窗口，开始编辑",
    noHeadings: "（暂无标题：用 # 添加章节）",
    noOpenFile: "（暂无打开的文件：点顶部「打开」或把 .md 拖入窗口）",
    deleteChapter: "删除该章节（含正文）", closeTab: "关闭",
    openFail: "打开失败：", saveFail: "保存失败：", closeFail: "关闭失败：",
    openLinkFail: "打开链接失败：",
    clearFileTitle: "清空文件", clearFileSuf: "」内容为空，保存将清空该文件，确定？",
    delTitle: "删除章节", delConfirmSuf: "」及其所有子内容？",
    closeSaveMsg: "有未保存的修改，是否保存？", closeSave: "保存并关闭", closeDiscard: "不保存关闭", closeCancel: "取消",
    langResetTitle: "切换语言", langResetMsg: "当前欢迎页有未保存的内容，切换语言会将其重置为对应语言的欢迎页。是否继续？",
    fileChangedTitle: "外部修改", fileChangedMsg: "文件已在外部被修改，仍要覆盖保存吗？",
    fileAlreadyOpen: "保存目标已在另一个标签中打开：",
    exportTooLarge: "文档过大，无法安全导出（上限 5 MB Markdown）：",
    modeWYSIWYG: "排版成品", modeIR: "语法编辑", modeSV: "分屏预览",
    modeSelectTip: "编辑模式：排版成品 / 语法编辑 / 分屏预览（Ctrl+Alt+M 循环切换）",
    modeWYSIWYGTip: "当前：排版成品模式（所见即所得，可直接编辑表格）", modeIRTip: "当前：语法编辑模式（即时渲染，可手打 markdown 语法）", modeSVTip: "当前：分屏预览模式（左源码右预览）",
    copyModeRender: "复制：渲染", copyModeRenderTip: "当前复制模式：渲染结果（点击切换为源码；Ctrl+C 复制排版后内容）",
    copyModeSource: "复制：源码", copyModeSourceTip: "当前复制模式：Markdown 源码（点击切换为渲染结果）",
    panelTitle: "大纲 · 点击定位 · ✕删除 · 拖动重排",
    appName: "MD 编辑器",
  },
  "zh-TW": {
    open: "📂 開啟", save: "💾 儲存", welcomeName: "歡迎", untitled: "未命名", noDoc: "（無）",
    ok: "確定",
    exportWord: "📄 匯出 Word", exportFail: "匯出失敗：", exportOk: "匯出成功：",
    emptyHint: "📋 點擊頂部「📂 開啟」，或把 .md 檔案拖入視窗，開始編輯",
    noHeadings: "（暫無標題：用 # 新增章節）",
    noOpenFile: "（暫無開啟的檔案：點頂部「開啟」或把 .md 拖入視窗）",
    deleteChapter: "刪除該章節（含正文）", closeTab: "關閉",
    openFail: "開啟失敗：", saveFail: "儲存失敗：", closeFail: "關閉失敗：",
    openLinkFail: "開啟連結失敗：",
    clearFileTitle: "清空檔案", clearFileSuf: "」內容為空，儲存將清空該檔案，確定？",
    delTitle: "刪除章節", delConfirmSuf: "」及其所有子內容？",
    closeSaveMsg: "有未儲存的修改，是否儲存？", closeSave: "儲存並關閉", closeDiscard: "不儲存關閉", closeCancel: "取消",
    langResetTitle: "切換語言", langResetMsg: "目前歡迎頁有未儲存的內容，切換語言會將其重設為對應語言的歡迎頁。是否繼續？",
    fileChangedTitle: "外部修改", fileChangedMsg: "檔案已在外部被修改，仍要覆蓋儲存嗎？",
    fileAlreadyOpen: "儲存目標已在另一個分頁中開啟：",
    exportTooLarge: "文件過大，無法安全匯出（Markdown 上限 5 MB）：",
    modeWYSIWYG: "排版成品", modeIR: "語法編輯", modeSV: "分割預覽",
    modeSelectTip: "編輯模式：排版成品 / 語法編輯 / 分割預覽（Ctrl+Alt+M 循環切換）",
    modeWYSIWYGTip: "當前：排版成品模式（所見即所得，可直接編輯表格）", modeIRTip: "當前：語法編輯模式（即時渲染，可手打 markdown 語法）", modeSVTip: "當前：分割預覽模式（左原始碼右預覽）",
    copyModeRender: "複製：渲染", copyModeRenderTip: "目前複製模式：渲染結果（點擊切換為原始碼；Ctrl+C 複製排版後內容）",
    copyModeSource: "複製：原始碼", copyModeSourceTip: "目前複製模式：Markdown 原始碼（點擊切換為渲染結果）",
    panelTitle: "大綱 · 點擊定位 · ✕刪除 · 拖曳重排",
    appName: "MD 編輯器",
  },
  "en": {
    open: "📂 Open", save: "💾 Save", welcomeName: "Welcome", untitled: "Untitled", noDoc: "(none)",
    ok: "OK",
    exportWord: "📄 Export Word", exportFail: "Export failed: ", exportOk: "Exported: ",
    emptyHint: '📋 Click "Open" above, or drag a .md file into the window to start editing',
    noHeadings: "(No headings yet: use # to add a section)",
    noOpenFile: '(No file open: click "Open" above or drag a .md file here)',
    deleteChapter: "Delete this section (with content)", closeTab: "Close",
    openFail: "Open failed: ", saveFail: "Save failed: ", closeFail: "Close failed: ",
    openLinkFail: "Open link failed: ",
    clearFileTitle: "Clear file", clearFileSuf: '" is empty; saving will clear the file. Continue?',
    delTitle: "Delete section", delConfirmSuf: '" and all its content?',
    closeSaveMsg: "Unsaved changes. Save?", closeSave: "Save and close", closeDiscard: "Close without saving", closeCancel: "Cancel",
    langResetTitle: "Switch language", langResetMsg: "The welcome page has unsaved content. Switching the language will reset it to the new language's welcome page. Continue?",
    fileChangedTitle: "External change", fileChangedMsg: "The file was changed outside the editor. Overwrite it anyway?",
    fileAlreadyOpen: "The save target is already open in another tab: ",
    exportTooLarge: "The document is too large to export safely (5 MB Markdown limit): ",
    modeWYSIWYG: "WYSIWYG", modeIR: "Instant Rendering", modeSV: "Split View",
    modeSelectTip: "Edit mode: WYSIWYG / Instant Rendering / Split View (Ctrl+Alt+M to cycle)",
    modeWYSIWYGTip: "Current: WYSIWYG mode (visual table editing)", modeIRTip: "Current: Markdown (IR) mode", modeSVTip: "Current: Split View (source left, preview right)",
    copyModeRender: "Copy: Render", copyModeRenderTip: "Copy mode: rendered result (click to switch to source; Ctrl+C copies formatted content)",
    copyModeSource: "Copy: Source", copyModeSourceTip: "Copy mode: Markdown source (click to switch to rendered)",
    panelTitle: "Outline · click to navigate · ✕ delete · drag to reorder",
    appName: "MD Editor",
  },
};

export const WELCOME_TEXT: Record<Lang, string> = {
  "zh-CN": `# 欢迎使用 MD 编辑器

- 双击 .md 文件或拖拽 .md 到窗口打开
- 支持**多个标签页**，互不覆盖
- 左侧大纲：点击定位、✕ 删除章节、拖动重排章节
- 顶部「打开 / 保存」操作文件
- 默认**排版成品**模式（所见即所得），可直接编辑表格（点单元格、浮层增删行列/对齐、数字框回车批量增删）；顶部下拉框 / Ctrl+Alt+M 循环切换：排版成品 → 语法编辑 → 分屏预览
- 复制默认输出**渲染结果**（粘贴即排版后内容，有序列表序号不丢）；点顶部「复制：渲染/源码」切换为 Markdown 源码
- 保存：**Ctrl+S**（另存为 Ctrl+Shift+S）
`,
  "zh-TW": `# 歡迎使用 MD 編輯器

- 雙擊 .md 檔案或拖曳 .md 到視窗開啟
- 支援**多個分頁**，互不覆蓋
- 左側大綱：點擊定位、✕ 刪除章節、拖曳重排章節
- 頂部「開啟 / 儲存」操作檔案
- 預設**排版成品**模式（所見即所得），可直接編輯表格（點儲存格、浮動工具列增刪列/欄/對齊、數字框 Enter 批次增刪）；頂部下拉框 / Ctrl+Alt+M 循環切換：排版成品 → 語法編輯 → 分割預覽
- 複製預設輸出**渲染結果**（貼上即排版後內容，有序清單序號不遺失）；點頂部「複製：渲染/原始碼」切換為 Markdown 原始碼
- 儲存：**Ctrl+S**（另存為 Ctrl+Shift+S）
`,
  "en": `# Welcome to MD Editor

- Double-click a .md file or drag it into the window to open
- Open multiple files in **tabs** (they won't overwrite each other)
- Left outline: click to navigate, ✕ to delete a section, drag to reorder
- Top toolbar: Open / Save
- Default **WYSIWYG** mode — edit tables visually (click a cell, use the floating toolbar to add/remove rows & columns, or type a number + Enter to batch-edit). Cycle modes (WYSIWYG → IR → Split View) via the top button or Ctrl+Alt+M
- Copy outputs the **rendered result** by default (formatted content, ordered-list numbers preserved); click the top "Copy: Render/Source" button to switch to Markdown source
- Save with **Ctrl+S** (Save As with Ctrl+Shift+S)
`,
};

function detectLang(): Lang {
  // try/catch：隐私模式/存储被禁用时 getItem 抛错——detectLang 在模块顶层(先于 boot)同步执行，
  // 不兜底会整页白屏。navigator 同理防御。
  let saved: string | null = null;
  try { saved = localStorage.getItem("md-editor-lang"); } catch { /* 存储禁用/损坏 → 回退 navigator */ }
  if (saved === "zh-CN" || saved === "zh-TW" || saved === "en") return saved;
  let nl = "zh-cn";
  try { nl = (navigator.language || "zh-CN").toLowerCase(); } catch { /* navigator 不可用 → 默认简中 */ }
  if (nl.startsWith("zh-tw") || nl.startsWith("zh-hk") || nl.startsWith("zh-hant")) return "zh-TW";
  if (nl.startsWith("en")) return "en";
  return "zh-CN"; // 简体中文默认（含 zh-cn / zh / 其他）
}
S.currentLang = detectLang();

export function t(key: string): string {
  return featureText(S.currentLang, key) ?? UI_TEXT[S.currentLang][key] ?? UI_TEXT["en"][key] ?? key;
}
export function welcomeMd(): string {
  return WELCOME_TEXT[S.currentLang];
}

// 把所有静态 DOM 文案更新到当前语言（语言切换 / 初始化时调用）。
// 模式/复制按钮等业务文案不在此刷新（避免本模块依赖业务模块），由入口层 setLang 统一调用。
export function applyAllText() {
  document.querySelectorAll<HTMLElement>("[data-aria-label]").forEach(el => el.setAttribute("aria-label", t(el.dataset.ariaLabel!)));
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n!); });
  document.querySelectorAll<HTMLInputElement>("[data-placeholder]").forEach(el => { el.placeholder = t(el.dataset.placeholder!); el.setAttribute("aria-label", el.placeholder); });
  document.getElementById("btn-open")!.textContent = t("open");
  document.getElementById("btn-save")!.textContent = t("save");
  const pt = document.getElementById("panel-title"); if (pt) pt.textContent = t("panelTitle");
  const eh = document.getElementById("empty-hint"); if (eh) eh.textContent = t("emptyHint");
  const cmsg = document.getElementById("cc-msg"); if (cmsg) cmsg.textContent = t("closeSaveMsg");
  const csave = document.getElementById("cc-save"); if (csave) csave.textContent = t("closeSave");
  const cdisc = document.getElementById("cc-discard"); if (cdisc) cdisc.textContent = t("closeDiscard");
  const ccan = document.getElementById("cc-cancel"); if (ccan) ccan.textContent = t("closeCancel");
  const sel = document.getElementById("lang-select") as HTMLSelectElement | null;
  if (sel) sel.value = S.currentLang;
  // 模式下拉框：选项文字 + title 随语言
  const msel = document.getElementById("btn-mode") as HTMLSelectElement | null;
  if (msel) {
    msel.title = t("modeSelectTip");
    const modeOpts: [string, string][] = [["wysiwyg", "modeWYSIWYG"], ["ir", "modeIR"], ["sv", "modeSV"]];
    Array.from(msel.options).forEach((o, i) => {
      const key = modeOpts[i] ? modeOpts[i][1] : "";
      if (key) o.textContent = t(key);
    });
    msel.value = S.currentMode;
  }
  document.documentElement.lang = S.currentLang; // a11y：屏幕阅读器发音/CSS :lang/繁体字体回退随语言
  document.title = t("appName"); // 浏览器标签/Tauri 窗口/任务栏标题随语言
}
