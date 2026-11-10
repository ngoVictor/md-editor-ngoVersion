// debug.ts —— 调试面板（诊断工具）
// 实时展示：文档 / 编辑器实例 / 选区光标 / 标签页 / 大纲 / 全局状态 / 事件日志；
// 支持「复制诊断快照」：把结构化 JSON 写入剪贴板，供用户 / AI Agent 粘贴分析；
// 并通过 window.__mdEditorDebug 暴露 snapshot()/log() 供控制台编程式读取。
// 自包含：只依赖 state（S/activeDoc），通过 DOM 事件观测业务行为，不反向依赖业务模块。

import { S, activeDoc } from "./state";

let visible = false;

// ---- 事件环形缓冲（最近 N 条可观测事件，排查时序问题）----
const EVENT_LOG: string[] = [];
const MAX_EVENTS = 80;
let lastInputLog = 0; // 输入事件节流时间戳，避免逐字符刷屏淹没其它事件

function stamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function logEvent(kind: string, detail = ""): void {
  if (kind === "input") {
    const now = Date.now();
    if (now - lastInputLog < 250) return;
    lastInputLog = now;
  }
  EVENT_LOG.push(`[${stamp()}] ${kind}${detail ? "  " + detail : ""}`);
  if (EVENT_LOG.length > MAX_EVENTS) EVENT_LOG.shift();
}

// 可序列化的完整诊断快照
interface Snapshot {
  time: string;
  doc: {
    name: string; path: string | null; encoding: string; dirty: boolean;
    length: number; lines: number; scrollTop: number; preview: string;
  } | null;
  editor: {
    mode: string; modeElement: string | null; vditor: boolean;
    vditorInited: boolean; switchInFlight: boolean; suppressInput: boolean;
    activeScrollEl: string | null;
  };
  selection: { collapsed: boolean; textLength: number; preview: string };
  tabs: { total: number; activeIndex: number; list: { id: string; name: string; dirty: boolean; active: boolean; path: string | null }[] };
  outline: number;
  state: { lang: string; copyMode: string; docCounter: number; activeId: string | null; pendingFile: string | null };
  events: string[];
}

function collect(): Snapshot {
  const doc = activeDoc();
  const sel = window.getSelection();
  const collapsed = !sel || sel.isCollapsed;
  const selText = !collapsed && sel ? sel.toString() : "";

  // 编辑器当前真实模式 DOM（重建后 .vditor-* 容器不同）
  let modeEl: string | null = null;
  for (const m of ["wysiwyg", "ir", "sv"] as const) {
    if (document.querySelector(`#editor .vditor-${m}`)) { modeEl = m; break; }
  }

  return {
    time: new Date().toISOString(),
    doc: doc ? {
      name: doc.name,
      path: doc.path,
      encoding: doc.encoding,
      dirty: doc.dirty,
      length: doc.content.length,
      lines: (doc.content.match(/\n/g) || []).length + 1,
      scrollTop: Math.round(doc.scrollTop),
      preview: doc.content.slice(0, 500),
    } : null,
    editor: {
      mode: S.currentMode,
      modeElement: modeEl,
      vditor: !!S.vditor,
      vditorInited: S.vditorInited,
      switchInFlight: S.switchInFlight,
      suppressInput: S.suppressInput,
      activeScrollEl: S.activeScrollEl ? `${S.activeScrollEl.tagName.toLowerCase()}.${S.activeScrollEl.className}` : null,
    },
    selection: { collapsed, textLength: selText.length, preview: selText.slice(0, 200) },
    tabs: {
      total: S.docs.length,
      activeIndex: S.docs.findIndex((d) => d.id === S.activeId),
      list: S.docs.map((d) => ({ id: d.id, name: d.name, dirty: d.dirty, active: d.id === S.activeId, path: d.path })),
    },
    outline: document.querySelectorAll("#outline .outline-item").length,
    state: { lang: S.currentLang, copyMode: S.copyMode, docCounter: S.docCounter, activeId: S.activeId, pendingFile: S.pendingFile },
    events: EVENT_LOG.slice(-30),
  };
}

// 面板显示的文本快照
function renderText(s: Snapshot): string {
  const L: string[] = [];
  L.push("── 文档 ──");
  if (s.doc) {
    L.push(`  名称：${s.doc.name}｜路径：${s.doc.path || "（未保存）"}｜编码：${s.doc.encoding || "—"}｜已修改：${s.doc.dirty ? "是" : "否"}`);
    L.push(`  字数：${s.doc.length}｜行数：${s.doc.lines}｜滚动：${s.doc.scrollTop}`);
  } else {
    L.push("  （无激活文档）");
  }
  L.push("── 编辑器 ──");
  L.push(`  模式：${s.editor.mode}｜DOM：${s.editor.modeElement || "—"}｜实例：${s.editor.vditor ? "✓" : "✗"}｜初始化：${s.editor.vditorInited ? "✓" : "✗"}`);
  L.push(`  switchInFlight：${s.editor.switchInFlight}｜suppressInput：${s.editor.suppressInput}｜滚动容器：${s.editor.activeScrollEl || "—"}`);
  L.push("── 选区 ──");
  L.push(`  折叠：${s.selection.collapsed ? "是" : "否"}｜选中：${s.selection.textLength} 字${s.selection.preview ? "｜" + s.selection.preview : ""}`);
  L.push("── 标签页 ──");
  L.push(`  共 ${s.tabs.total} 个：` + (s.tabs.list.length ? s.tabs.list.map((t) => `${t.active ? "▶" : ""}${t.dirty ? "●" : ""}${t.name}`).join(" | ") : "（无）"));
  L.push("── 大纲 ──");
  L.push(`  章节数：${s.outline}`);
  L.push("── 全局状态 ──");
  L.push(`  语言：${s.state.lang}｜复制：${s.state.copyMode}｜docCounter：${s.state.docCounter}｜activeId：${s.state.activeId || "—"}｜pendingFile：${s.state.pendingFile || "—"}`);
  L.push("── 事件日志（最近 30 条）──");
  if (s.events.length) L.push(s.events.join("\n"));
  else L.push("  （暂无）");
  return L.join("\n");
}

function renderJson(s: Snapshot): string {
  return JSON.stringify(s, null, 2);
}

export function refreshDebugInfo(): void {
  const body = document.getElementById("dbg-body");
  if (!body || !visible) return;
  body.textContent = renderText(collect());
}

// 构建面板结构（标题 + 按钮 + 可滚动内容区）；幂等，多次调用安全
function ensureBuilt(): void {
  const bar = document.getElementById("debug-bar");
  if (!bar || document.getElementById("dbg-head")) return;

  const head = document.createElement("div");
  head.className = "dbg-head";
  head.id = "dbg-head";
  const title = document.createElement("span");
  title.className = "dbg-title";
  title.textContent = "诊断面板 · 调试";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "dbg-btn";
  copy.id = "dbg-copy";
  copy.textContent = "📋 复制快照";
  copy.title = "把当前完整诊断信息（JSON）复制到剪贴板，供 AI Agent / 开发者分析";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(renderJson(collect()));
      logEvent("debug", "快照已复制到剪贴板");
      refreshDebugInfo();
    } catch {
      logEvent("debug", "复制失败（剪贴板不可用）");
      refreshDebugInfo();
    }
  });
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "dbg-btn";
  clear.id = "dbg-clear";
  clear.textContent = "🧹 清空日志";
  clear.addEventListener("click", () => {
    EVENT_LOG.length = 0;
    logEvent("debug", "日志已清空");
    refreshDebugInfo();
  });
  head.appendChild(title);
  head.appendChild(copy);
  head.appendChild(clear);

  const body = document.createElement("div");
  body.className = "dbg-body";
  body.id = "dbg-body";
  bar.appendChild(head);
  bar.appendChild(body);
}

export function toggleDebugBar(): void {
  const bar = document.getElementById("debug-bar");
  if (!bar) return;
  visible = !visible;
  if (visible) {
    ensureBuilt();
    bar.style.display = "block";
    refreshDebugInfo();
  } else {
    bar.style.display = "none";
  }
}

let bound = false;
// 绑定：面板结构 + 事件观测（自包含，不反向依赖业务模块）+ 刷新时机 + 控制台暴露
export function bindDebugBar(): void {
  if (bound) return;
  bound = true;
  ensureBuilt();

  // 刷新时机：选区变化 / 输入 / 编辑器滚动
  document.addEventListener("selectionchange", refreshDebugInfo);
  document.addEventListener("input", refreshDebugInfo);
  document.addEventListener("scroll", (e) => {
    const t = e.target as HTMLElement | null;
    if (t && t.closest("#editor")) refreshDebugInfo();
  }, true);

  // 事件日志观测（捕获阶段，覆盖编辑器与工具栏）
  document.addEventListener("input", (e) => {
    const t = e.target as HTMLElement | null;
    const tag = t ? (t.closest("#editor") ? "editor" : t.tagName.toLowerCase()) : "?";
    logEvent("input", tag);
  }, true);
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) && !e.altKey) return;
    const parts = [
      e.ctrlKey || e.metaKey ? "Ctrl" : "",
      e.altKey ? "Alt" : "",
      e.shiftKey ? "Shift" : "",
      e.key === " " ? "Space" : e.key.toUpperCase(),
    ].filter(Boolean).join("+");
    logEvent("key", parts);
  }, true);
  document.addEventListener("click", (e) => {
    const t = e.target as HTMLElement | null;
    const el = t ? (t.closest("button, select") as HTMLElement | null) : null;
    if (el) logEvent("click", el.id || el.tagName.toLowerCase());
  }, true);

  // 暴露到 window 供控制台 / AI Agent 编程式读取：window.__mdEditorDebug.snapshot() / log() / clearLog()
  (window as unknown as { __mdEditorDebug?: unknown }).__mdEditorDebug = {
    snapshot: collect,
    log: () => EVENT_LOG.slice(),
    clearLog: () => { EVENT_LOG.length = 0; },
  };
}
