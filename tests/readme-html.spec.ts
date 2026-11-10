import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const sample = readFileSync("tests/fixtures/readme-html.md", "utf8");
const csp = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).app.security.csp;

async function ready(page: Page) {
  // Exercise the packaged app's policy, rather than Vite's unrestricted image policy.
  await page.route(url => url.pathname === "/" && ["127.0.0.1", "localhost"].includes(url.hostname), async route => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": csp } });
  });
  await page.route(/^https?:\/\/(?:img\.shields\.io|trendshift\.io)\//, route => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="130" height="28"><rect width="130" height="28" fill="#087db8"/><text x="8" y="19" fill="white">test badge</text></svg>',
  }));
  await page.goto("/");
  await page.waitForFunction(async () => !!(await import("/src/state.ts")).S.vditor && !(await import("/src/state.ts")).S.switchInFlight);
}

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const doc = (await import("/src/state.ts")).activeDoc()!;
    return { content: doc.content, savedContent: doc.savedContent, dirty: doc.dirty, revision: doc.revision };
  });
}

test("README 混排样例：三模式居中、HTML 正文样式、在线 SVG 徽章同行，保存原文不变", async ({ page }) => {
  await ready(page);
  await page.evaluate(async sample => { (await import("/src/docs.ts")).openDoc("D:/sample/README.md", sample, "README.md"); }, sample);
  const before = await snapshot(page);
  for (const mode of ["wysiwyg", "ir", "sv"]) {
    await page.selectOption("#btn-mode", mode);
    await page.waitForFunction(async () => !(await import("/src/state.ts")).S.switchInFlight);
    const root = page.locator(mode === "sv" ? ".vditor-preview .vditor-reset" : `.vditor-${mode} .vditor-reset`);
    await expect(root.locator("h1").first()).toHaveText("GPT-SoVITS-WebUI");
    const python = root.locator('img[alt="Python"]');
    await expect.poll(() => python.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect.poll(() => root.locator("h1").first().evaluate(el => getComputedStyle(el).textAlign)).toMatch(/^(?:-webkit-)?center$/);
    const row = await root.locator('img[alt="GitHub release"]').boundingBox();
    expect(Math.abs((await python.boundingBox())!.y - row!.y)).toBeLessThan(2);
    if (mode !== "sv") {
      const html = root.locator(`[data-type="html-block"] > .vditor-${mode === "ir" ? "ir" : "wysiwyg"}__preview`).nth(1);
      expect(await html.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, whiteSpace: getComputedStyle(el).whiteSpace })))
        .toEqual({ background: "rgba(0, 0, 0, 0)", whiteSpace: "normal" });
      await expect.poll(() => root.locator("[data-html-hidden]").count()).toBeGreaterThanOrEqual(3);
    }
    expect(await snapshot(page)).toEqual(before);
  }
  const saved = await page.evaluate(async () => {
    let content = "";
    (await import("/src/file-service.ts")).setFileServiceForTests({
      openFile: async () => { throw Error("unused"); }, statFile: async () => null, saveDocx: async () => {},
      saveFile: async request => { content = request.content; return { pathKey: "d:\\sample\\readme.md", fingerprint: "saved", mtimeMs: 1, size: content.length }; },
    });
    const ok = await (await import("/src/save.ts")).saveDoc((await import("/src/state.ts")).activeDoc()!);
    return { ok, content };
  });
  expect(saved.ok).toBe(true);
  expect(saved.content).toBe(sample);
});

test("排版修饰不进入编辑后的 Markdown；HTML、注释及撤销仍保留", async ({ page }) => {
  await ready(page);
  const source = '<div align="center">\n\n<h1>Title</h1>\n\n[![badge](https://img.shields.io/badge/test)](https://example.com)\n\n<!-- hidden -->\n\n</div>\n\nEditable text\n';
  await page.evaluate(async source => { (await import("/src/docs.ts")).openDoc(null, source, "edit"); }, source);
  await expect(page.locator('.vditor-wysiwyg [data-html-align="center"]')).toHaveCount(3);
  await page.locator(".vditor-wysiwyg p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type(" changed");
  await expect.poll(async () => (await snapshot(page)).content).toContain("Editable text changed");
  const edited = (await snapshot(page)).content;
  expect(edited).toContain('<div align="center">');
  expect(edited).toContain("<!-- hidden -->");
  expect(edited).toContain("</div>");
  expect(edited).not.toContain("data-html-");
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await snapshot(page)).content).toBe(source);
});

test("嵌套对齐有明确边界，未闭合容器和代码示例不影响后续段落", async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => { (await import("/src/docs.ts")).openDoc(null,
    '<div align="center">\n\nOuter\n\n<div align="right">\n\nInner\n\n</div>\n\nOuter again\n\n</div>\n\nOutside\n\n```html\n<div align="center">\n```\n\n<div align="right">\n\nUnclosed\n', "nested"); });
  const p = page.locator(".vditor-wysiwyg p");
  for (const [text, align] of [["Outer", "center"], ["Inner", "right"], ["Outer again", "center"]]) {
    await expect(p.filter({ hasText: new RegExp(`^${text}$`) })).toHaveAttribute("data-html-align", align);
  }
  for (const text of ["Outside", "Unclosed"]) await expect(p.filter({ hasText: text })).not.toHaveAttribute("data-html-align");
});
