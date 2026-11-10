// 链接点击行为回归：文档内 #hash 跳转（wysiwyg/ir/sv 三种模式）+ 外链打开
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";

const DOC = `[跳到执行摘要](#1-执行摘要)

[外部链接](https://example.com)

${Array.from({ length: 40 }, (_, i) => `填充段落 ${i}，用于制造滚动高度。`).join("\n\n")}

## 1. 执行摘要

这是执行摘要的内容。

${Array.from({ length: 40 }, (_, i) => `结尾段落 ${i}。`).join("\n\n")}
`;

async function waitEditor(page: Page) {
  await page.goto("/");
  await page.waitForSelector("#editor .vditor-wysiwyg");
  await page.waitForFunction(() => {
    const t = document.getElementById("file-title")?.textContent || "";
    return t.includes("欢迎") || t.includes("Welcome");
  });
}

async function openLinkDoc(page: Page) {
  await waitEditor(page);
  await page.evaluate(async (md) => {
    const docs = await import("/src/docs.ts");
    docs.openDoc("D:/sample.md", md, "sample.md", "UTF-8");
  }, DOC);
  await page.waitForSelector("#editor .vditor-wysiwyg a[href='#1-执行摘要']");
}

test("wysiwyg 模式点击 #hash 链接滚动到对应标题", async ({ page }) => {
  await openLinkDoc(page);
  const scroller = page.locator("#editor .vditor-wysiwyg pre.vditor-reset");
  await page.locator("#editor .vditor-wysiwyg a[href='#1-执行摘要']").click();
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(1000);

  // 目标标题应滚到滚动容器可视区顶部附近
  // scrollTop > 1000 can occur halfway through smooth scrolling; await the actual target position.
  await expect.poll(() => page.locator("#editor .vditor-wysiwyg h2", { hasText: "1. 执行摘要" })
    .evaluate(el => el.getBoundingClientRect().top - el.closest("pre")!.getBoundingClientRect().top)).toBeLessThan(100);
});

test("真实样例：doc/使用指南.md 的目录锚点可跳转", async ({ page }) => {
  const source = readFileSync(join(process.cwd(), "doc", "使用指南.md"), "utf-8");
  const md = `[跳到快捷键](#9-快捷键与常见处理)\n\n${source}`;
  await waitEditor(page);
  await page.evaluate(async (md) => {
    const docs = await import("/src/docs.ts");
    docs.openDoc("D:/使用指南.md", md, "使用指南.md", "UTF-8");
  }, md);
  await page.waitForSelector("#editor .vditor-wysiwyg a[href='#9-快捷键与常见处理']");
  // 系统性校验：样例里全部目录锚点都能在当前渲染 DOM 中解析到对应标题
  const unresolved = await page.evaluate(async () => {
    const heading = await import("/src/heading.ts");
    const root = document.querySelector("#editor .vditor-wysiwyg");
    if (!root) return ["no-root"];
    return [...root.querySelectorAll('a[href^="#"]')]
      .filter((a) => !heading.findHeadingByHash(root, a.getAttribute("href") || ""))
      .map((a) => a.getAttribute("href") || "");
  });
  expect(unresolved).toEqual([]);

  const scroller = page.locator("#editor .vditor-wysiwyg pre.vditor-reset");
  await page.locator("#editor .vditor-wysiwyg a[href='#9-快捷键与常见处理']").click();
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(200);
});

test("IR 模式点击语法节点中的链接同样跳转", async ({ page }) => {
  await openLinkDoc(page);
  await page.selectOption("#btn-mode", "ir");
  await page.waitForSelector("#editor .vditor-ir span[data-type='a']");
  await page.waitForSelector("#editor .vditor-ir h2");
  const scroller = page.locator("#editor .vditor-ir pre.vditor-reset");
  // 等 IR 重建/恢复内容完成、滚动高度已建立后再点击，避免点到"内容尚未铺开"的中间态
  await expect.poll(() => scroller.evaluate((el) => el.scrollHeight)).toBeGreaterThan(1500);
  await page.locator("#editor .vditor-ir span[data-type='a']").first().click();
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(1000);
});

test("SV 模式点击预览区 #hash 链接滚动到对应标题", async ({ page }) => {
  await openLinkDoc(page);
  await page.selectOption("#btn-mode", "sv");
  await page.waitForSelector("#editor .vditor-preview a[href='#1-执行摘要']");
  const scroller = page.locator("#editor .vditor-preview");
  await page.locator("#editor .vditor-preview a[href='#1-执行摘要']").click();
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(1000);
});

test("外链点击走 opener/回退路径而不是 Vditor 的 window.open", async ({ page }) => {
  await openLinkDoc(page);
  await page.evaluate(() => {
    (window as unknown as { __openedLinks: string[] }).__openedLinks = [];
    window.open = ((url?: string | URL) => {
      (window as unknown as { __openedLinks: string[] }).__openedLinks.push(String(url));
      return null;
    }) as typeof window.open;
  });
  await page.locator("#editor .vditor-wysiwyg a[href='https://example.com']").click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __openedLinks: string[] }).__openedLinks
      )
    )
    .toEqual(["https://example.com"]);
});

test("headingSlug 与常见中文文档锚点一致", async ({ page }) => {
  await page.goto("/");
  const slug = await page.evaluate(async () => {
    const heading = await import("/src/heading.ts");
    return [
      heading.headingSlug("1. 执行摘要"),
      heading.headingSlug("## 11. 风险登记表（汇总）"),
      heading.headingSlug("md-editor 代码审查与风险报告"),
    ];
  });
  expect(slug[0]).toBe("1-执行摘要");
  expect(slug[1]).toBe("11-风险登记表汇总");
  expect(slug[2]).toBe("md-editor-代码审查与风险报告");
});

test("重名标题使用 -1/-2 后缀定位到对应标题", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const heading = await import("/src/heading.ts");
    const root = document.createElement("div");
    root.innerHTML = "<h2>重复</h2><h2>重复</h2><h2>重复</h2>";
    return ["#重复", "#重复-1", "#重复-2"].map((hash) => {
      const found = heading.findHeadingByHash(root, hash);
      return found ? [...root.querySelectorAll("h2")].indexOf(found as HTMLHeadingElement) : -1;
    });
  });
  expect(result).toEqual([0, 1, 2]);
});
