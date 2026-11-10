import { prepareExportAssets, assetNotice } from "./export-assets";
// export-docx.ts —— 导出 Word（.docx）业务流程与排版美化
// 管线：捕获 Markdown → 快照 HTML/资源 → beautifyForWord（标题/行距/引用/分隔线/
// 表头/代码块高亮美化）→ docx.ts 纯函数转 docx → base64 → Rust save_docx 写盘。
// 后端不读取异步等待之后的文档或实例，工具栏忙碌状态由 export 统一控制。
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { esc } from "./state";
import { t } from "./i18n";
import { htmlToDocxBlob, beautifyDocx } from "./docx";
import { captureExportSnapshot } from "./export-snapshot";
export { markdownSnapshotToHtml } from "./export-snapshot";
import { showError, showInfo } from "./ui";
import { fileService } from "./file-service";



// GitHub Light 主题色：hljs token class → Word 内联颜色（html-to-docx 保留 inline color，
// 使代码块在 Word 中有语法配色；hljs 输出的 class 无法被 docx 解析，必须转内联）
const HLJS_COLORS: Record<string, string> = {
  "hljs-comment": "#6a737d",
  "hljs-quote": "#6a737d",
  "hljs-keyword": "#d73a49",
  "hljs-selector-tag": "#d73a49",
  "hljs-literal": "#005cc5",
  "hljs-number": "#005cc5",
  "hljs-type": "#005cc5",
  "hljs-string": "#032f62",
  "hljs-title": "#6f42c1",
  "hljs-section": "#6f42c1",
  "hljs-name": "#22863a",
  "hljs-selector-id": "#22863a",
  "hljs-selector-class": "#22863a",
  "hljs-built_in": "#e36209",
  "hljs-symbol": "#e36209",
  "hljs-variable": "#e36209",
  "hljs-template-variable": "#e36209",
  "hljs-bullet": "#e36209",
  "hljs-attr": "#005cc5",
  "hljs-attribute": "#005cc5",
  "hljs-addition": "#22863a",
  "hljs-deletion": "#b31d28",
  "hljs-meta": "#6a737d",
};

// 标题美化：深色系 + 分级字号（Word 默认标题是蓝色，换成更适合中文文档的深色系）
const HEADING_STYLE: Record<string, { size: string; color: string }> = {
  H1: { size: "24pt", color: "#1f2328" },
  H2: { size: "17pt", color: "#1f2328" },
  H3: { size: "14pt", color: "#1f2328" },
  H4: { size: "12.5pt", color: "#1f2328" },
  H5: { size: "11.5pt", color: "#57606a" },
  H6: { size: "11pt", color: "#57606a" },
};

// 加载 highlight.js（懒加载，仅导出时触发）
async function loadHljs() {
  const mod = await import("highlight.js");
  return (mod.default ?? mod) as {
    getLanguage(name: string): unknown;
    highlight(code: string, opts: { language: string }): { value: string };
    highlightAuto(code: string): { value: string };
  };
}

// 将容器内文本节点按 \n 切分，返回"行 HTML"数组（文本转义、元素保留 style）
function splitByLines(root: HTMLElement): string[] {
  const lines: string[] = [];
  let cur = "";
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      const parts = (node.textContent || "").split("\n");
      parts.forEach((part, i) => {
        if (i > 0) { lines.push(cur); cur = ""; }
        // 空格→&nbsp;：html-to-docx 会丢弃元素间纯空白文本节点与前导缩进，用非断空格保住代码的空格/缩进
        cur += esc(part.replace(/\t/g, "    ")).replace(/ /g, "&nbsp;");
      });
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement;
    const style = el.getAttribute("style");
    cur += `<span${style ? ` style="${style}"` : ""}>`;
    el.childNodes.forEach(walk);
    cur += "</span>";
  };
  root.childNodes.forEach(walk);
  if (cur !== "" || lines.length === 0) lines.push(cur);
  return lines;
}

// 代码块美化（就地处理 doc）：
// html-to-docx 会把 HTML 里的 \n 全折叠成空格、<br> 也丢失——换行只能靠独立段落；
// <pre> 触发库的 Courier 等宽；hljs class → 内联颜色；高亮失败兜底斜体。
function beautifyCodeBlocksDoc(doc: Document, hljs: Awaited<ReturnType<typeof loadHljs>>): void {
  doc.querySelectorAll("pre").forEach((p) => {
    const pre = p as HTMLElement;
    const code = pre.querySelector("code");
    if (!code) return;
    const langMatch = (code.className || "").match(/language-([\w+-]+)/);
    const raw = code.textContent || "";
    let highlighted = "";
    try {
      highlighted = langMatch && hljs.getLanguage(langMatch[1])
        ? hljs.highlight(raw, { language: langMatch[1] }).value
        : hljs.highlightAuto(raw).value;
    } catch {
      highlighted = "";
    }
    const tmp = doc.createElement("code");
    tmp.innerHTML = highlighted || esc(raw);
    // hljs class → 内联颜色（docx 转换只认 inline style）
    tmp.querySelectorAll("[class*='hljs-']").forEach((span) => {
      const el = span as HTMLElement;
      const cls = el.className;
      for (const [name, color] of Object.entries(HLJS_COLORS)) {
        if (cls.includes(name)) {
          el.style.color = color;
          break;
        }
      }
    });
    // 按行拆分（DOM 遍历，正确处理跨行 token），每行一个 <pre> 段落
    const frag = doc.createDocumentFragment();
    splitByLines(tmp).forEach((lineHtml) => {
      const para = doc.createElement("pre");
      para.innerHTML = highlighted ? lineHtml : `<i>${lineHtml}</i>`; // 高亮失败兜底斜体
      frag.appendChild(para);
    });
    pre.replaceWith(frag);
  });
}

// 导出前整体美化：标题配色/正文行距/引用块/分隔线/表头加粗/代码块高亮/表格对齐与列宽采集/段落空行。
// 浏览器环境（DOMParser）；导出供测试。返回美化后的 HTML + 各表格列宽比例（docx 后处理用）。
export async function beautifyForWord(html: string): Promise<{ html: string; colWidths: number[][] }> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const colWidths: number[][] = [];
  if (doc.querySelector("pre")) {
    beautifyCodeBlocksDoc(doc, await loadHljs());
  }
  // 标题：深色 + 分级字号（覆盖 Word 默认蓝色标题）
  doc.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
    const s = HEADING_STYLE[h.tagName];
    if (s) {
      const el = h as HTMLElement;
      el.style.color = s.color;
      el.style.fontSize = s.size;
    }
  });
  // 正文行距 1.5 倍（表格单元格内保持默认，避免撑大表格）
  doc.querySelectorAll("p, li").forEach((p) => {
    const el = p as HTMLElement;
    if (!el.closest("table")) el.style.lineHeight = "150%";
  });
  // 引用块：html-to-docx 的 blockquote 会丢弃子元素 inline 样式，降级为普通段落
  // （灰字 + 1.5 倍行距），保证 Word 中引用内容可区分
  doc.querySelectorAll("blockquote").forEach((bq) => {
    const frag = doc.createDocumentFragment();
    const children = Array.from(bq.children);
    if (children.length === 0) {
      const p = doc.createElement("p");
      p.style.color = "#57606a";
      p.style.lineHeight = "150%";
      p.style.marginLeft = "16px";
      p.textContent = bq.textContent || "";
      frag.appendChild(p);
    } else {
      children.forEach((child) => {
        const el = child as HTMLElement;
        el.style.color = "#57606a";
        el.style.lineHeight = "150%";
        el.style.marginLeft = "16px";
        frag.appendChild(el);
      });
    }
    bq.replaceWith(frag);
  });
  // 分隔线 hr：html-to-docx 不支持 hr（会变成空段落），替换为居中的分隔字符段
  doc.querySelectorAll("hr").forEach((hr) => {
    const p = doc.createElement("p");
    p.style.textAlign = "center";
    p.style.color = "#d0d7de";
    p.textContent = "———";
    hr.replaceWith(p);
  });
  // 表格：表头加粗 + 居中、单元格左对齐（避免两端对齐在窄列拉散字距）；
  // 同时按内容宽度估算列宽比例（html-to-docx 只等分列宽，docx 后处理时按此比例改 gridCol）
  doc.querySelectorAll("table").forEach((tbl) => {
    const rows = Array.from(tbl.querySelectorAll("tr"));
    const colCount = rows[0] ? rows[0].querySelectorAll("th,td").length : 0;
    tbl.querySelectorAll("th").forEach((th) => {
      if (!th.querySelector("b")) th.innerHTML = `<b>${th.innerHTML}</b>`;
      (th as HTMLElement).style.textAlign = "center";
    });
    tbl.querySelectorAll("td").forEach((td) => {
      (td as HTMLElement).style.textAlign = "left";
    });
    if (colCount > 0) {
      // 列宽估算：每列最大文本宽度（中文≈2、ASCII≈1），归一化为比例（最小 8%）
      const widths = new Array(colCount).fill(1);
      rows.forEach((tr) => {
        Array.from(tr.querySelectorAll("th,td")).forEach((cell, c) => {
          if (c >= colCount) return;
          let w = 0;
          for (const ch of (cell.textContent || "").trim()) w += ch.charCodeAt(0) > 255 ? 2 : 1;
          if (w > widths[c]) widths[c] = w;
        });
      });
      // Dampen long prose so short Chinese headings do not become one-character columns.
      const weights = widths.map(w => Math.sqrt(w));
      const sum = weights.reduce((a, b) => a + b, 0) || colCount;
      let norm = weights.map((w) => Math.max(0.5 / colCount, w / sum));
      const s2 = norm.reduce((a, b) => a + b, 0);
      norm = norm.map((w) => w / s2);
      colWidths.push(norm);
      tbl.setAttribute("data-cols", norm.map((w) => w.toFixed(3)).join(","));
    }
  });
  // 段间距/首行缩进/标题留白/代码底纹等排版细节改由 docx.ts 的 OOXML 后处理承担
  // （html-to-docx 不支持 margin，HTML 层插空段 hack 已移除，避免 Word 里段落松紧不一）
  return { html: doc.body.innerHTML, colWidths };
}

// Blob → base64 字符串（分段拼接避免调用栈溢出）
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// 导出当前文档为 .docx（统一导出入口的 Word 选项）；完成后弹窗告知结果
type Picker = (name: string) => Promise<string | null>;
const defaultPicker: Picker = name => saveDialog({ defaultPath: name, filters: [{ name: "Word", extensions: ["docx"] }] });
let picker = defaultPicker;
export function setDocxPathPickerForTests(value: Picker | null): void { picker = value || defaultPicker; }
let exportInFlight = false;
export async function exportActiveDocAsDocx(): Promise<boolean> {
  if (exportInFlight) return false;
  let snapshot;
  try { snapshot = captureExportSnapshot(); }
  catch (error) { showError(String(error)); return false; }
  if (!snapshot) return false;
  exportInFlight = true;
  try {
    // 只从捕获的 Markdown 快照渲染；模式重建或后续编辑不会改变本次导出内容。
    const assets = await prepareExportAssets(snapshot, true);
    const html = assets.html;
    const { html: pretty, colWidths } = await beautifyForWord(html);
    const blob0 = await htmlToDocxBlob(pretty);
    // docx 排版后处理（jszip 改 OOXML）：段落间距/首行缩进/标题留白/代码底纹/中文字体/表格列宽
    const blob = await beautifyDocx(blob0, colWidths);
    const dataBase64 = await blobToBase64(blob);
    const defaultName = (snapshot.name.replace(/\.(md|markdown|mdown|txt)$/i, "") || "untitled") + ".docx";
    const sp = await picker(defaultName);
    if (!sp) return false;
    const path = /\.docx$/i.test(sp as string) ? sp as string : `${sp}.docx`;
    await fileService().saveDocx(path, dataBase64);
    showInfo(t("exportOk") + path + assetNotice(assets));
    return true;
  } catch (e) {
    showError(t("exportFail") + e);
    return false;
  } finally {
    exportInFlight = false;
  }
}
