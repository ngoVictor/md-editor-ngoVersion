// outline 纯逻辑与章节增删重排回归（标题闭合符 / 代码围栏 / 文末换行）
import { test, expect } from "@playwright/test";

async function openPage(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.waitForSelector("#editor .vditor-wysiwyg");
  await page.waitForFunction(() => {
    const t = document.getElementById("file-title")?.textContent || "";
    return t.includes("欢迎") || t.includes("Welcome");
  });
}

test("标题解析：## C# 保留结尾 #，## hello ## 去除闭合符", async ({ page }) => {
  await openPage(page);
  const titles = await page.evaluate(async () => {
    const outline = await import("/src/outline.ts");
    return outline
      .parseSections("# A\n\n## C#\n\n## C# 结尾\n\n## hello ##\n")
      .map((s) => s.title);
  });
  expect(titles).toEqual(["A", "C#", "C# 结尾", "hello"]);
});

test("围栏解析：4 空格缩进与异长围栏不误判标题", async ({ page }) => {
  await openPage(page);
  const titles = await page.evaluate(async () => {
    const outline = await import("/src/outline.ts");
    const md = [
      "# 外面1",
      "",
      "````text",
      "## 围栏内（4 反引号开）",
      "```text",
      "### 围栏内（3 反引号不关闭 4 反引号围栏）",
      "````",
      "",
      "    ```",
      "    ## 缩进代码块内",
      "    ```",
      "",
      "# 外面2",
    ].join("\n");
    return outline.parseSections(md).map((s) => s.title);
  });
  expect(titles).toEqual(["外面1", "外面2"]);
});

test("删除最后一个章节保留文末换行", async ({ page }) => {
  await openPage(page);
  const after = await page.evaluate(async () => {
    const docs = await import("/src/docs.ts");
    const state = await import("/src/state.ts");
    const outline = await import("/src/outline.ts");
    docs.openDoc("D:/t.md", "# A\n# B\n", "t.md", "UTF-8");
    await new Promise((r) => setTimeout(r, 500));
    const doc = state.activeDoc();
    if (!doc) return "";
    const secs = outline.parseSections(doc.content);
    window.confirm = () => true; // Tauri confirm 不可用时回退 window.confirm
    await outline.deleteSection(secs[secs.length - 1].id);
    await new Promise((r) => setTimeout(r, 100));
    return state.activeDoc()?.content ?? "";
  });
  expect(after).toBe("# A\n");
});

test("把最后一个章节拖到前面不会多出空行", async ({ page }) => {
  await openPage(page);
  const after = await page.evaluate(async () => {
    const docs = await import("/src/docs.ts");
    const state = await import("/src/state.ts");
    const outline = await import("/src/outline.ts");
    docs.openDoc("D:/t.md", "# A\n# B\n", "t.md", "UTF-8");
    await new Promise((r) => setTimeout(r, 500));
    const doc = state.activeDoc();
    if (!doc) return "";
    const secs = outline.parseSections(doc.content);
    outline.moveSection(secs[1].id, secs[0].id, "before");
    await new Promise((r) => setTimeout(r, 100));
    return state.activeDoc()?.content ?? "";
  });
  expect(after).toBe("# B\n# A\n");
});
