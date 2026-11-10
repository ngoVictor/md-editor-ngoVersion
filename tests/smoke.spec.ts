// 冒烟测试：编辑器核心交互回归（无需 Tauri 环境，纯浏览器 + vite dev server）
// 运行：node node_modules/@playwright/test/cli.js test
import { test, expect, type Page } from "@playwright/test";

// 等待 Vditor 初始化完成：默认模式编辑区出现 + after 回调已打开欢迎页
async function waitEditor(page: Page) {
  await page.goto("/");
  await page.waitForSelector("#editor .vditor-wysiwyg");
  await page.waitForFunction(() => {
    const t = document.getElementById("file-title")?.textContent || "";
    return t.includes("欢迎") || t.includes("Welcome");
  });
}

test("欢迎页加载", async ({ page }) => {
  await waitEditor(page);
  await expect(page.locator("#file-title")).toContainText(/欢迎|Welcome/);
  await expect(page.locator("#editor")).toContainText(/欢迎使用|Welcome to MD Editor/);
});

test("三模式切换：下拉选择并渲染对应编辑区", async ({ page }) => {
  await waitEditor(page);
  await page.selectOption("#btn-mode", "ir");
  await page.waitForSelector("#editor .vditor-ir");
  await page.selectOption("#btn-mode", "sv");
  await page.waitForSelector("#editor .vditor-sv");
  await page.selectOption("#btn-mode", "wysiwyg");
  await page.waitForSelector("#editor .vditor-wysiwyg");
});

test("快速连续切换模式与语言只应用最后意图", async ({ page }) => {
  await waitEditor(page);
  await page.selectOption("#btn-mode", "ir");
  await page.selectOption("#btn-mode", "sv");
  await page.selectOption("#lang-select", "en");
  await page.selectOption("#lang-select", "zh-TW");
  await expect(page.locator("#editor .vditor-sv")).toBeVisible({ timeout: 10000 });
  await expect(page.locator("#lang-select")).toHaveValue("zh-TW");
  await expect(page.locator("#btn-mode")).toHaveValue("sv");
  const state = await page.evaluate(async () => {
    const { S } = await import("/src/state.ts");
    return { mode: S.currentMode, lang: S.currentLang, switching: S.switchInFlight };
  });
  expect(state).toEqual({ mode: "sv", lang: "zh-TW", switching: false });
});

// 清空编辑区后输入（欢迎页内容在编辑区内，需先全选删除）
async function clearAndType(editor: import("@playwright/test").Locator, page: Page, text: string) {
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await page.keyboard.type(text);
}

test("语法编辑模式输入标题后大纲出现章节", async ({ page }) => {
  await waitEditor(page);
  await page.selectOption("#btn-mode", "ir");
  await page.waitForSelector("#editor .vditor-ir");
  const editor = page.locator("#editor .vditor-ir");
  await clearAndType(editor, page, "# 测试章节");
  await page.keyboard.press("Enter");
  // 大纲防抖 400ms 后刷新
  await expect(page.locator("#outline .outline-item")).toContainText("测试章节", { timeout: 5000 });
});

test("有序列表复制输出渲染结果（序号保留）", async ({ page }) => {
  await waitEditor(page);
  await page.selectOption("#btn-mode", "ir");
  await page.waitForSelector("#editor .vditor-ir");
  const editor = page.locator("#editor .vditor-ir");
  await clearAndType(editor, page, "1. 第一项");
  await page.keyboard.press("Enter");
  await page.keyboard.type("2. 第二项");
  // 全选 + 复制 → 读剪贴板
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain("1. 第一项");
  expect(text).toContain("2. 第二项");
});

test("代码块单一可编辑（无高亮预览两份）", async ({ page }) => {
  await waitEditor(page);
  await page.selectOption("#btn-mode", "ir");
  await page.waitForSelector("#editor .vditor-ir");
  const editor = page.locator("#editor .vditor-ir");
  await clearAndType(editor, page, "```");
  await page.keyboard.type("text");
  await page.keyboard.press("Enter");
  await page.keyboard.type("print(1)");
  await page.keyboard.press("Enter");
  await page.keyboard.type("```");
  // 编辑区不应有 hljs 高亮副本（codeBlockPreview=false 生效；IR 展开态 marker 里
  // 也会有 code 元素，所以只断言"无 hljs 副本"而非 code 总数）
  await expect(page.locator("#editor code.hljs")).toHaveCount(0);
});

test("语言切换更新界面文案", async ({ page }) => {
  await waitEditor(page);
  await page.selectOption("#lang-select", "zh-TW");
  await expect(page.locator("#btn-open")).toContainText("開啟");
  await page.selectOption("#lang-select", "en");
  await expect(page.locator("#btn-open")).toContainText("Open");
  // 切回简体，避免影响其他测试
  await page.selectOption("#lang-select", "zh-CN");
});

test("统一导出按钮存在且文案随语言", async ({ page }) => {
  await waitEditor(page);
  await expect(page.locator("#btn-export")).toBeVisible();
  await page.selectOption("#lang-select", "zh-TW");
  await expect(page.locator("#btn-export")).toHaveText("匯出");
  await page.selectOption("#lang-select", "zh-CN");
});
test("复制代码块保留缩进与空行", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const mod = await import("/src/copy.ts");
    const div = document.createElement("div");
    div.innerHTML = "<pre><code>def a():\n    return 1\n\n    return 2</code></pre>";
    return mod.domToPlainText(div);
  });
  expect(result).toContain("    return 1");       // 缩进保留（不被全局换行清理吞掉）
  expect(result).toContain("return 1\n\n    return 2"); // 空行 + 缩进保留
});

test("欢迎页有未保存内容时切换语言需确认，取消不重置", async ({ page }) => {
  await waitEditor(page);
  await page.selectOption("#lang-select", "zh-CN");
  await page.evaluate(async () => {
    const state = await import("/src/state.ts");
    const doc = state.activeDoc();
    if (doc) {
      doc.dirty = true;
      doc.content = "# 用户笔记";
    }
    window.confirm = () => false; // Tauri confirm 不可用时回退 window.confirm
  });
  await page.selectOption("#lang-select", "en");
  await page.waitForTimeout(300);
  const r = await page.evaluate(async () => {
    const state = await import("/src/state.ts");
    return {
      lang: state.S.currentLang,
      content: state.activeDoc()?.content,
      dirty: state.activeDoc()?.dirty,
      select: (document.getElementById("lang-select") as HTMLSelectElement).value,
    };
  });
  expect(r.lang).toBe("zh-CN");
  expect(r.content).toBe("# 用户笔记");
  expect(r.dirty).toBe(true);
  expect(r.select).toBe("zh-CN");
});

test("SV 模式源码区与预览区滚动位置分别记录", async ({ page }) => {
  await waitEditor(page);
  const md = Array.from({ length: 120 }, (_, i) => `段落 ${i}\n\n`).join("");
  await page.evaluate(async (md) => {
    const docs = await import("/src/docs.ts");
    docs.openDoc("D:/scroll.md", md, "scroll.md", "UTF-8");
  }, md);
  await page.selectOption("#btn-mode", "sv");
  await page.waitForSelector("#editor .vditor-preview");
  const r = await page.evaluate(async () => {
    const state = await import("/src/state.ts");
    const src = document.querySelector<HTMLElement>("#editor .vditor-sv");
    const preview = document.querySelector<HTMLElement>("#editor .vditor-preview");
    // 等两栏内容铺开、滚动高度可用后再设值，否则 scrollTop 会被钳制回 0
    for (let i = 0; i < 50 && (!src || src.scrollHeight < 1500 || !preview || preview.scrollHeight < 1500); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const srcTarget = src ? Math.min(120, Math.max(0, src.scrollHeight - src.clientHeight - 10)) : 0;
    const previewTarget = preview ? Math.min(240, Math.max(0, preview.scrollHeight - preview.clientHeight - 10)) : 0;
    if (src) {
      src.scrollTop = srcTarget;
      src.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
    if (preview) {
      preview.scrollTop = previewTarget;
      preview.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 50));
    return {
      top: state.activeDoc()?.scrollTop,
      preview: state.activeDoc()?.previewScrollTop,
      srcActual: src?.scrollTop,
      previewActual: preview?.scrollTop,
      srcTarget,
      previewTarget,
    };
  });
  // 两个滚动区各自记录：谁滚动就写谁，互不覆盖
  expect(r.top).toBe(r.srcActual);
  expect(r.preview).toBe(r.previewActual);
  expect(r.srcActual).toBeGreaterThan(0);
  expect(r.previewActual).toBeGreaterThan(0);
});

test("调试条：结构化诊断信息 + window.__mdEditorDebug 可编程读取", async ({ page }) => {
  await waitEditor(page);
  // 打开调试条
  await page.click("#btn-debug");
  await expect(page.locator("#debug-bar")).toBeVisible();
  await expect(page.locator("#dbg-head")).toBeVisible();
  // 面板文本包含诊断分区
  await expect(page.locator("#dbg-body")).toContainText("── 文档 ──");
  await expect(page.locator("#dbg-body")).toContainText("── 编辑器 ──");
  await expect(page.locator("#dbg-body")).toContainText("── 事件日志");
  // window.__mdEditorDebug 提供结构化快照（供 AI Agent / 控制台读取）
  const snap = await page.evaluate(() => {
    const dbg = (window as unknown as { __mdEditorDebug?: { snapshot: () => unknown } }).__mdEditorDebug;
    return dbg ? dbg.snapshot() : null;
  });
  expect(snap).toBeTruthy();
  const s = snap as { doc: { name: string } | null; editor: { mode: string }; tabs: { total: number } };
  expect(s.doc).toBeTruthy();
  expect(s.editor.mode).toBe("wysiwyg");
  expect(s.tabs.total).toBeGreaterThanOrEqual(1);
  // 关闭调试条
  await page.click("#btn-debug");
  await expect(page.locator("#debug-bar")).toBeHidden();
});
