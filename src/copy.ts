// copy.ts —— 复制行为：默认输出「渲染结果」，可切换「Markdown 源码」
// Vditor 原生 WYSIWYG/IR 复制把 markdown 源码写入 text/plain（粘贴到不支持 markdown 的应用
// 会看到 **粗体** 这类标记）；sv 预览区复制渲染 HTML 但有序列表序号由 CSS 计数器生成、
// DOM 里没有，粘贴时 1. 2. 3. 丢失。本模块统一覆写复制（capture 拦截）：
// 渲染模式 → 生成带显式序号的纯文本 + HTML；源码模式 → 转回 markdown 源码。
import { S, type CopyMode } from "./state";
import { t } from "./i18n";

// ---- 复制模式（渲染/源码）：localStorage 记忆 ----
function loadCopyMode(): CopyMode {
  try {
    const v = localStorage.getItem("md-editor-copy-mode");
    if (v === "render" || v === "source") return v;
  } catch { /* 存储禁用/损坏 → 默认渲染 */ }
  return "render";
}
S.copyMode = loadCopyMode();
export function setCopyMode(m: CopyMode) {
  S.copyMode = m;
  try { localStorage.setItem("md-editor-copy-mode", m); } catch { /* 存储禁用，仅本次会话 */ }
  const btn = document.getElementById("btn-copy-mode");
  if (btn) {
    btn.textContent = t(m === "render" ? "copyModeRender" : "copyModeSource");
    btn.title = t(m === "render" ? "copyModeRenderTip" : "copyModeSourceTip");
  }
}

// ---- 列表处理：选区克隆可能只有"裸 <li>"（<ol> 标签在选区外）----
// 序号优先读 li 的 data-marker（wysiwyg 编辑区 li 带 data-marker="1."），
// 否则按 ol start/兄弟计数；列表类型未知时用选区锚点所在列表类型兜底。
function liMarkerNum(li: HTMLElement): string | null {
  const dm = li.getAttribute("data-marker");
  if (dm == null) return null;
  const m = dm.match(/^(\d+)[.)]?$/);
  return m ? m[1] : null; // 数字 marker → 有序序号；*/-/+ → 无序
}
function prependNumSpan(li: HTMLLIElement, num: string) {
  li.style.listStyle = "none";
  const span = document.createElement("span");
  span.textContent = num + ". ";
  li.insertBefore(span, li.firstChild);
}
// 选区锚点所在的列表类型（原 DOM），用于裸 li 补语义
function detectListKind(): "ol" | "ul" | null {
  const sel = window.getSelection();
  if (!sel || !sel.anchorNode) return null;
  const el = sel.anchorNode.nodeType === 1 ? (sel.anchorNode as HTMLElement) : sel.anchorNode.parentElement;
  if (!el) return null;
  const li = el.closest("li");
  if (!li || !li.parentElement) return null;
  return li.parentElement.tagName === "OL" ? "ol" : li.parentElement.tagName === "UL" ? "ul" : null;
}
function bakeListNumbers(root: HTMLElement, fallbackKind: "ol" | "ul" | null) {
  // 1) 有 ol/ul 包裹的
  root.querySelectorAll("ol").forEach((ol) => {
    const start = parseInt(ol.getAttribute("start") || "1", 10) || 1;
    ol.style.listStyle = "none";
    Array.from(ol.children).filter((el): el is HTMLLIElement => el.tagName === "LI").forEach((li, i) => {
      const num = liMarkerNum(li) ?? (li.hasAttribute("value") ? li.getAttribute("value")! : String(start + i));
      prependNumSpan(li, num);
    });
  });
  root.querySelectorAll("ul").forEach((ul) => { ul.style.listStyle = "none"; });
  // 2) 裸 li（父链无 ol/ul）：连续分组，按 fallbackKind / data-marker 判断有序
  const lis = Array.from(root.querySelectorAll("li")).filter((li) => !li.closest("ol") && !li.closest("ul")) as HTMLLIElement[];
  let group: HTMLLIElement[] = [];
  const flush = () => {
    if (group.length === 0) return;
    const hasNum = group.some((li) => liMarkerNum(li) != null);
    if (fallbackKind === "ol" || hasNum) {
      let n = parseInt(liMarkerNum(group[0]) || "1", 10) || 1;
      group.forEach((li) => {
        const num = liMarkerNum(li) ?? String(n);
        prependNumSpan(li, num);
        n = parseInt(num, 10) + 1;
      });
    } else {
      group.forEach((li) => { li.style.listStyle = "none"; });
    }
    group = [];
  };
  for (const li of lis) {
    if (group.length === 0 || li.previousElementSibling === group[group.length - 1]) group.push(li);
    else { flush(); group = [li]; }
  }
  flush();
}

// ---- 自写 DOM → 纯文本（不依赖 innerText 布局，块级换行 / li 序号 / pre 原样 / br 换行）----
// 导出：纯函数，供测试直接覆盖（复制代码块缩进/空行保留等边界）
export function domToPlainText(root: HTMLElement): string {
  const out: string[] = [];
  const PRE_NL = "\u0001"; // 代码块内换行占位符：全局换行清理会破坏代码缩进/空行，先占位、末尾还原
  const BLOCK = new Set(["P", "DIV", "LI", "OL", "UL", "PRE", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6", "TABLE", "TR", "THEAD", "TBODY", "SECTION", "HEADER", "FOOTER", "HR", "FIGCAPTION"]);
  const newline = () => { if (out.length > 0 && out[out.length - 1] !== "\n") out.push("\n"); };
  const walk = (node: Node, inPre: boolean) => {
    if (node.nodeType === 3) {
      const txt = node.textContent || "";
      out.push(inPre ? txt.replace(/\n/g, PRE_NL) : txt.replace(/\s+/g, " "));
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement;
    const tag = el.tagName;
    if (tag === "BR") { out.push(inPre ? PRE_NL : "\n"); return; }
    if (tag === "IMG") { const alt = el.getAttribute("alt"); if (alt) out.push(alt); return; }
    // 跳过 IR 模式的语法标记节点（#、> 等源码符号，避免复制残留）
    if (String(el.className || "").includes("vditor-ir__marker")) return;
    if (tag === "PRE") {
      newline();
      for (const c of el.childNodes) walk(c, true);
      newline();
      return;
    }
    if (tag === "TD" || tag === "TH") out.push("\t"); // 表格单元格分隔
    if (BLOCK.has(tag)) newline();
    for (const c of el.childNodes) walk(c, inPre);
    if (BLOCK.has(tag)) newline();
  };
  walk(root, false);
  return out.join("")
    .replace(/\u200b/g, "") // 过滤 Vditor 光标占位符
    .replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n")
    // 最多保留一个空行（\n\n）：聊天软件里空行显示为空白段，但代码块内的空行需要保留
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[\n ]+|[\n ]+$/g, "")
    .trim()
    .replace(/\u0001/g, "\n"); // 还原代码块内换行（保留缩进/空行）
}

// markdown → 渲染 DOM（lute），供 sv 编辑区复制转换用
function renderMd(md: string): HTMLElement {
  const div = document.createElement("div");
  if (S.vditor && S.vditor.vditor.lute && md.trim() !== "") {
    try { div.innerHTML = S.vditor.vditor.lute.Md2VditorDOM(md); }
    catch { div.textContent = md; }
  } else div.textContent = md;
  return div;
}

// 渲染模式复制：输出排版后内容（纯文本 + 富文本，有序列表烧入显式序号）
// 三种来源统一处理：wysiwyg 编辑区 / sv 预览区的克隆 DOM 即渲染结果；
// sv 编辑区（源码态）先 md→DOM；IR 编辑区（半渲染）直接处理克隆 DOM——
// 不能走 VditorIRDOM2Md（实测它不读 data-marker，把有序全转成 * 无序）。
function copyAsRender(event: ClipboardEvent, root: HTMLElement, region: "editor" | "preview") {
  if (!event.clipboardData) return;
  const fallbackKind = detectListKind();
  let plain = "";
  let html = "";
  if (region === "preview" || S.currentMode !== "sv") {
    // wysiwyg/ir 编辑区 + sv 预览区：克隆 DOM 即渲染结果。
    // IR 克隆的 li 同样带 data-marker 数字序号，直接处理即可。
    // IR 的语法标记节点（#、> 等源码符号）纯文本已跳过，HTML 也一并移除
    root.querySelectorAll(".vditor-ir__marker").forEach((el) => el.remove());
    bakeListNumbers(root, fallbackKind);
    plain = domToPlainText(root);
    html = root.innerHTML;
  } else {
    // sv 编辑区：源码态 → md → 渲染 DOM
    const sel = window.getSelection();
    const md = (sel ? sel.toString() : "").replace(/\u200b/g, "");
    const rendered = renderMd(md);
    bakeListNumbers(rendered, fallbackKind);
    plain = domToPlainText(rendered);
    html = rendered.innerHTML;
  }
  event.clipboardData.setData("text/plain", plain);
  if (html) event.clipboardData.setData("text/html", html);
  event.preventDefault();
}

// 选区所在区域：编辑器编辑区 / sv 预览区 / 其他（工具栏等，走默认复制）
function selectionRegion(): "editor" | "preview" | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode) return null;
  const el = sel.anchorNode.nodeType === 1 ? (sel.anchorNode as HTMLElement) : sel.anchorNode.parentElement;
  if (!el) return null;
  if (el.closest(".vditor-toolbar")) return null;
  if (el.closest(".vditor-preview")) return "preview"; // sv 右侧预览区（渲染 DOM）
  if (el.closest("#editor")) return "editor";
  return null;
}

// 源码模式复制：输出 markdown 源码（text/plain；text/html 置空，同 Vditor 原生行为）
function copyAsSource(event: ClipboardEvent, root: HTMLElement, region: "editor" | "preview") {
  if (!event.clipboardData) return;
  let md = "";
  const sel = window.getSelection();
  if (region === "preview" && S.vditor && S.vditor.vditor.lute) {
    // 预览区是渲染 DOM → 转回 md
    md = S.vditor.vditor.lute.VditorDOM2Md(root.innerHTML);
  } else if (region === "editor") {
    if (S.currentMode === "sv") {
      md = sel ? sel.toString() : ""; // sv 编辑区选中即源码文本
    } else if (S.vditor && S.vditor.vditor.lute) {
      try {
        md = S.currentMode === "wysiwyg"
          ? S.vditor.vditor.lute.VditorDOM2Md(root.innerHTML)
          : S.vditor.vditor.lute.VditorIRDOM2Md(root.innerHTML);
      } catch { md = ""; }
    }
  }
  md = (md || root.textContent || "").replace(/\u200b/g, "").trim();
  event.clipboardData.setData("text/plain", md);
  event.clipboardData.setData("text/html", "");
  event.preventDefault();
}

export function bindCopyBehavior() {
  document.addEventListener("copy", (event) => {
    if (!event.clipboardData) return; // 无剪贴板数据时走默认
    // 焦点在 textarea/input（如 Vditor 代码块「复制」按钮的隐藏 textarea：select() + execCommand）时
    // 走浏览器默认——textarea 选区不属于 document.getSelection()，我们接管会复制到残留选区导致失败
    const ae = document.activeElement;
    if (ae && (ae.tagName === "TEXTAREA" || ae.tagName === "INPUT")) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return; // 空选区：走默认
    const region = selectionRegion();
    if (!region) return; // 编辑器外选区：走默认
    const root = document.createElement("div");
    root.appendChild(sel.getRangeAt(0).cloneContents());
    if (S.copyMode === "source") copyAsSource(event, root, region);
    else copyAsRender(event, root, region);
    event.stopImmediatePropagation(); // 阻止 Vditor 原生 copy 监听（bubble）覆盖剪贴板数据
  }, true);
}
