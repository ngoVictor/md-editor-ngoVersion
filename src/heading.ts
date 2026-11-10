// heading.ts —— 渲染后标题/锚点定位横切逻辑
// 职责：找到当前模式真正可见的内容容器，从渲染 DOM 中解析标题文本/生成
// GitHub 风格 anchor slug，并把 #hash 链接定位到对应标题。
// 依赖：state（当前模式）、scroll（真实滚动容器，回顶用）。
// 被 link.ts（文档内链接跳转）与 outline.ts（大纲定位）复用，避免各自猜 DOM。
import { S } from "./state";
import { cancelScrollRestore, editorScrollEl } from "./scroll";

// 当前模式真正可见的渲染内容容器。
// 注意：Vditor 会把 wysiwyg/ir/sv/preview 四套 DOM 同时挂在 #editor 下（非当前模式 display:none），
// 直接 querySelectorAll("#editor h1...") 会命中隐藏副本/旧副本，必须按模式选根。
export function activeContentRoot(): HTMLElement | null {
  const editor = document.getElementById("editor");
  if (!editor) return null;
  const selector =
    S.currentMode === "sv" ? ".vditor-preview" :
    S.currentMode === "ir" ? ".vditor-ir" :
    ".vditor-wysiwyg";
  return editor.querySelector<HTMLElement>(selector);
}

// 渲染后的标题列表（按文档顺序）
export function renderedHeadings(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"));
}

// 标题纯文本：剔除 IR 模式的语法标记（##/### 等）与光标占位符，再折叠空白。
// 锚点 slug 应基于"渲染后的可见标题"，而不是源码行（例如 **加粗** 不参与锚点）。
export function headingText(heading: HTMLElement): string {
  const clone = heading.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".vditor-ir__marker").forEach((el) => el.remove());
  return (clone.textContent || "")
    .replace(/\u200b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// GitHub 风格 heading anchor：小写、去掉标点（保留 Unicode 字母/数字/组合符/连字符/空白）、空白转连字符。
// 例：`## 1. 执行摘要` → `1-执行摘要`，与文档中常见的 `#1-执行摘要` 链接一致。
export function headingSlug(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function renderedHeadingSlugs(root: ParentNode): Array<{ heading: HTMLElement; slug: string }> {
  const counts = new Map<string, number>();
  const used = new Set<string>();
  return renderedHeadings(root).map((heading) => {
    const base = headingSlug(headingText(heading));
    let occurrence = counts.get(base) || 0;
    let slug = occurrence === 0 ? base : `${base}-${occurrence}`;
    while (used.has(slug)) {
      occurrence++;
      slug = `${base}-${occurrence}`;
    }
    counts.set(base, occurrence + 1);
    used.add(slug);
    return { heading, slug };
  });
}

function decodeHash(rawHash: string): string {
  let hash = rawHash.replace(/^#/, "");
  try {
    hash = decodeURIComponent(hash);
  } catch {
    // 非法百分号编码保持原样，仍按原文匹配
  }
  return hash;
}

// 按 #hash 在指定内容根内定位标题：
// 1) 先精确匹配元素 id（兼容手写 HTML 锚点或 Vditor 生成的块 id）；
// 2) 再按 GitHub 风格 slug 匹配渲染标题文本（Vditor 编辑器实例不生成标准 headingAnchor id）。
export function findHeadingByHash(root: ParentNode, rawHash: string): HTMLElement | null {
  const hash = decodeHash(rawHash);
  if (!hash) return null;

  for (const el of root.querySelectorAll<HTMLElement>("[id]")) {
    if (el.id === hash) return el;
  }

  const wanted = headingSlug(hash);
  for (const item of renderedHeadingSlugs(root)) {
    if (item.slug === wanted) return item.heading;
  }
  return null;
}

// 跳转到 #hash 对应标题。返回是否命中；未命中由调用方决定提示或忽略。
export function scrollToHash(rawHash: string): boolean {
  cancelScrollRestore();
  const root = activeContentRoot();
  if (!root) return false;

  const hash = decodeHash(rawHash);
  if (!hash || hash.toLowerCase() === "top") {
    // # / #top：回到编辑区顶部。
    // sv 的 root（.vditor-preview）本身就是滚动容器；wysiwyg/ir 的真实滚动容器是 root 内的 pre.vditor-reset。
    const scroller =
      S.currentMode === "sv"
        ? root
        : root.querySelector<HTMLElement>("pre.vditor-reset") || editorScrollEl() || root;
    scroller.scrollTop = 0;
    return true;
  }

  const target = findHeadingByHash(root, rawHash);
  if (!target) return false;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}
