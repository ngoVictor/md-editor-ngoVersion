// state.ts —— 全局状态（单一状态源）与共享类型
// 各业务模块通过本文件共享状态（S 对象），模块之间不直接互相读写状态，
// 依赖方向：业务模块 → state（低耦合，避免循环依赖）。
import type Vditor from "vditor";

// 编辑模式：排版成品(所见即所得，可直接编辑表格) / 语法编辑(即时渲染) / 分屏预览
export type Mode = "ir" | "wysiwyg" | "sv";
export type Lang = "zh-CN" | "zh-TW" | "en";
export type CopyMode = "render" | "source";

export interface Doc {
  id: string;
  path: string | null;
  pathKey: string | null;
  name: string;
  content: string;
  dirty: boolean;
  revision: number;
  saveState: "idle" | "saving";
  encoding: string;
  mtimeMs: number | null; // 打开/保存时的文件修改时间（毫秒），外部修改检测基线
  size: number | null; // 打开/保存时的文件字节数，外部修改检测基线
  fingerprint: string | null; // 磁盘内容指纹；compare-and-save 的强基线
  savedContent: string;
  loadState: "ready" | "unloaded" | "loading" | "error";
  externalChange: "changed" | "deleted" | null;
  saveError: string | null;
  pendingInput: boolean;
  scrollTop: number; // 编辑区滚动位置（标签/模式切换时记忆恢复）
  previewScrollTop: number; // sv 分屏右侧预览区滚动位置（与源码区分别记忆）
}

// 全局状态
export const S = {
  windowTransfer: false, // Window handoff blocks input, save and close until acknowledged.
  vditor: null as Vditor | null,               // Vditor 实例（vditor 模块创建/销毁）
  docs: [] as Doc[],                           // 打开的文档（标签页）
  activeId: null as string | null,             // 当前激活文档 id
  docCounter: 0,                               // 文档 id 自增计数
  currentMode: "wysiwyg" as Mode,              // 当前编辑模式（默认排版成品，可直接编辑表格）
  vditorInited: false,                         // Vditor 是否完成首次初始化（重建时不重跑 openDoc/pendingFile）
  switchInFlight: false,                       // 重建中（destroy→after），抑制重入避免双实例/内容丢失
  suppressInput: false,                        // setValue 时抑制 input 回调（避免误标 dirty）
  outlineTimer: null as number | null,         // 大纲防抖定时器
  currentLang: "zh-CN" as Lang,                // 当前语言（i18n 模块初始化）
  copyMode: "render" as CopyMode,              // 复制模式（copy 模块初始化）
  activeScrollEl: null as HTMLElement | null,  // 真实滚动容器（scroll 模块捕获）
  pendingFile: null as string | null,          // 命令行/单实例传入的待打开文件
};

export function activeDoc(): Doc | null {
  return S.docs.find((d) => d.id === S.activeId) || null;
}
export function newDocId(): string {
  return "doc-" + ++S.docCounter;
}

// Lexical presentation identity and injected browser fakes only. Native IO uses Rust pathKey.
export function fallbackPathKey(path: string): string {
  const normalized = path.replace(/\//g, "\\");
  const prefix = normalized.match(/^[a-zA-Z]:\\/)?.[0] || (normalized.startsWith("\\\\") ? "\\\\" : "");
  const body = prefix ? normalized.slice(prefix.length) : normalized;
  const parts: string[] = [];
  for (const part of body.split("\\")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return (prefix + parts.join("\\")).toLocaleLowerCase("en-US");
}

// 编辑模式循环顺序（Ctrl+Alt+M）
export const MODE_CYCLE: Mode[] = ["wysiwyg", "ir", "sv"];
export function nextMode(m: Mode): Mode {
  return MODE_CYCLE[(MODE_CYCLE.indexOf(m) + 1) % MODE_CYCLE.length];
}

// HTML 转义：动态注入 DOM 前必须调用（防注入）
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 按行拆分，保留原换行风格（\r\n 或 \n）。
// 章节删除/重排等行操作必须用它，避免 split("\n")+join("\n") 把 Windows 的 CRLF 破坏成 LF
// （会导致 Git 全文件 diff、破坏原文件换行约定）。
export function splitLines(md: string): { lines: string[]; eol: string } {
  const eol = md.includes("\r\n") ? "\r\n" : "\n";
  return { lines: md.split(/\r\n|\n/), eol };
}
export function joinLines(lines: string[], eol: string): string {
  return lines.join(eol);
}
