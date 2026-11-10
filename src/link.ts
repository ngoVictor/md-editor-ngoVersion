// link.ts —— 编辑器内链接点击行为（#hash、本地文档、外部网址）
// 背景：Vditor 默认对链接点击执行 window.open(href)，但 Tauri WebView2 中 window.open
// 不是"系统默认浏览器"，内链 #hash 也不会滚动（编辑器实例 headingAnchor 被 Vditor 固定为 false，
// 标题没有标准 id）。本模块在 document 捕获阶段统一接管：
//   wysiwyg/sv 预览：<a href="...">
//   ir：<span data-type="a"> 语法节点（.vditor-ir__marker--link 存 URL）
// 依赖：state（模式）、heading（内链定位）、i18n/ui（错误提示）。被 main.ts 调用一次。
import { resolveLinkTarget, type LinkTarget } from "./link-target";
import { invoke } from "@tauri-apps/api/core";
import { S, activeDoc } from "./state";
import { scrollToHash } from "./heading";
import { t } from "./i18n";
import { showError } from "./ui";

function isTauriEnv(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function isSafeExternalHref(href: string): boolean {
  return resolveLinkTarget(href, null).kind === "external";
}

// 外链：Tauri 下走 opener 插件（系统默认浏览器/邮件/电话应用）；纯浏览器环境（测试/调试）回退 window.open。
export async function openExternalHref(href: string): Promise<boolean> {
  if (!isSafeExternalHref(href)) return false;
  try {
    await invoke("plugin:opener|open_url", { url: href });
    return true;
  } catch (e) {
    if (!isTauriEnv()) {
      window.open(href, "_blank", "noopener,noreferrer");
      return true;
    }
    showError(t("openLinkFail") + e);
    return false;
  }
}

// IR 模式链接不是 <a>：点击 span[data-type="a"]，URL 存在 :scope 下的 .vditor-ir__marker--link。
// Vditor 展开态（vditor-ir__node--expand）点击用于编辑，不在本模块处理。
function irLinkHref(target: Element): string | null {
  const node = target.closest<HTMLElement>('.vditor-ir__node[data-type="a"]');
  if (!node || node.classList.contains("vditor-ir__node--expand")) return null;
  const marker = Array.from(node.children).find((el) =>
    el.classList.contains("vditor-ir__marker--link")
  );
  const href = (marker?.textContent || "").replace(/\u200b/g, "").trim();
  return href || null;
}

// 从点击事件解析链接地址；非链接点击返回 null。
// 图片点击保留给 Vditor（图片预览/编辑浮层），即使图片被包在 <a> 里也不抢。
export function linkHrefFromClickEvent(event: MouseEvent): string | null {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || !target.closest("#editor")) return null;
  if (target.closest("img")) return null;

  const anchor = target.closest<HTMLAnchorElement>("a");
  if (anchor) return anchor.getAttribute("href") || null;

  if (S.currentMode === "ir") return irLinkHref(target);
  return null;
}

export function bindLinkBehavior(openDocument: (path: string, hash: string) => Promise<boolean>, openResource: (target: Extract<LinkTarget, {kind:"local"}>, preview: boolean) => Promise<boolean>): void {
  document.addEventListener(
    "click",
    (event) => {
      if (event.defaultPrevented || event.button !== 0) return;
      const href = linkHrefFromClickEvent(event);
      if (!href) return;

      // 在捕获阶段终止传播，阻止 Vditor 自身的 link 处理（window.open/preventDefault）。
      event.preventDefault();
      event.stopImmediatePropagation();

      const target = resolveLinkTarget(href, activeDoc()?.path || null);
      if (target.kind === "anchor") {
        if (!scrollToHash(target.hash)) showError(t("linkAnchorMissing") + target.hash);
      } else if (target.kind === "external") void openExternalHref(target.href);
      else if (target.kind === "document") void openDocument(target.path, target.hash);
      else if (target.kind === "local") void openResource(target, event.shiftKey);
      else showError(t(target.reason));
    },
    true
  );
}
