// 导出 Word 功能测试
import { test, expect } from "@playwright/test";
import { XMLValidator } from "fast-xml-parser";
import { htmlToDocxBlob, beautifyDocx } from "../src/docx";
import JSZip from "jszip";

test("兼容 Word 后处理不把用户正文中的表格占位符替换为 XML", async () => {
  const blob = await beautifyDocx(await htmlToDocxBlob("<p>Literal @@TBL0@@ and @@TBL42@@</p><table><tr><td>Cell</td></tr></table>"), []);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file("word/document.xml")!.async("string");
  expect(XMLValidator.validate(xml)).toBe(true);
  expect(xml).toContain("Literal @@TBL0@@ and @@TBL42@@");
  expect(xml.match(/<w:tbl>/g)).toHaveLength(1);
});

test("htmlToDocxBlob 生成有效 docx（PK 魔数 + 中文/表格内容）", async () => {
  const html = `<h1>导出测试</h1><p>中文<b>粗体</b>内容</p><table border="1"><tr><td>1</td><td>2</td></tr></table>`;
  const blob = await htmlToDocxBlob(html);
  expect(blob.size).toBeGreaterThan(1000);
  // docx = zip 容器，魔数 PK\x03\x04
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  expect(head[0]).toBe(0x50); // P
  expect(head[1]).toBe(0x4b); // K
});

test("空 HTML 也能生成 docx（不崩溃）", async () => {
  const blob = await htmlToDocxBlob("<p></p>");
  expect(blob.size).toBeGreaterThan(500);
});

// 浏览器环境回归：vite dev server 下真实加载模块（防 node polyfill 配置回归——
// 曾出现 Class extends undefined（缺 events）/ global is not defined 等问题）
test("浏览器环境 htmlToDocxBlob 转换成功（node polyfill 生效）", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const mod = await import("/src/docx.ts");
    const blob = await mod.htmlToDocxBlob("<h1>浏览器测试</h1><p>中文内容</p>");
    const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    return { size: blob.size, pk: head[0] === 0x50 && head[1] === 0x4b };
  });
  expect(result.pk).toBe(true);
  expect(result.size).toBeGreaterThan(1000);
});

test("导出渲染使用捕获的 Markdown 快照，不读取当前编辑 DOM", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector("#editor .vditor-wysiwyg");
  const html = await page.evaluate(async () => {
    const mod = await import("/src/export-docx.ts");
    return mod.markdownSnapshotToHtml("# 稳定快照\n\n导出正文");
  });
  expect(html).toContain("稳定快照");
  expect(html).toContain("导出正文");
  expect(html).not.toContain("欢迎使用");
});

// 导出美化：标题配色/正文行距/引用块灰字/分隔线替换/表头加粗/代码块按行拆分/表格对齐
test("导出美化：标题配色 + 行距 + 表头加粗 + 代码块按行拆分 + 表格对齐", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const mod = await import("/src/export-docx.ts");
    const html = `<h1>标题</h1>
<p>第一段</p>
<p>第二段</p>
<blockquote><p>引用文字</p></blockquote>
<hr/>
<table><tr><th>表头</th><td>单元格内容较长较长</td></tr></table>
<pre><code class="language-python">def a():
    return 1</code></pre>`;
    const out = await mod.beautifyForWord(html);
    return {
      headingColor: /#1f2328|rgb\(31, ?35, ?40\)/.test(out.html),
      lineHeight: out.html.includes("line-height"),
      blockquoteGray: /#57606a|rgb\(87, ?96, ?106\)/.test(out.html),
      hrReplaced: out.html.includes("———"),
      thBold: (out.html.match(/<th[^>]*><b>/g) || []).length,
      preCount: (out.html.match(/<pre/g) || []).length,
      hasColor: out.html.includes("style=\"color:"),
      tdLeft: /<td[^>]*text-align: left/.test(out.html),
      thCenter: /<th[^>]*text-align: center/.test(out.html),
      colWidths: out.colWidths,
    };
  });
  expect(result.headingColor).toBe(true);
  expect(result.lineHeight).toBe(true);
  expect(result.blockquoteGray).toBe(true);
  expect(result.hrReplaced).toBe(true);
  expect(result.thBold).toBe(1);
  expect(result.preCount).toBe(2); // 两行代码 → 两个独立 pre
  expect(result.hasColor).toBe(true);
  expect(result.tdLeft).toBe(true);
  expect(result.thCenter).toBe(true);
  expect(result.colWidths.length).toBe(1); // 采集到表格列宽比例
  expect(result.colWidths[0].length).toBe(2);
});

// 表格列宽后处理：按比例改写 docx 的 gridCol（浏览器生成 + 后处理，node 侧解包验证）
test("表格列宽后处理：gridCol 按内容比例分配", async ({ page }) => {
  await page.goto("/");
  const b64 = await page.evaluate(async () => {
    const dx = await import("/src/docx.ts");
    const blob0 = await dx.htmlToDocxBlob(`<table border="1"><tr><th>短</th><th>很长很长很长很长很长很长很长</th></tr></table>`);
    const adjusted = await dx.beautifyDocx(blob0, [[0.2, 0.8]]);
    const buf = new Uint8Array(await adjusted.arrayBuffer());
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
    return btoa(bin);
  });
  // node 侧解包验证
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(Buffer.from(b64, "base64"));
  const xml = (await zip.file("word/document.xml")?.async("string")) || "";
  const grid = xml.match(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/)?.[0] || "";
  expect(grid).toContain('w:w="1661"'); // 0.2 * A4 usable width
  expect(grid).toContain('w:w="6645"'); // remaining A4 usable width
});

// 无 thead 的普通表格：首行不应被误判为表头加底纹
test("无表头表格首行不误加表头底纹", async ({ page }) => {
  await page.goto("/");
  const b64 = await page.evaluate(async () => {
    const dx = await import("/src/docx.ts");
    const blob = await dx.beautifyDocx(
      await dx.htmlToDocxBlob(`<table><tr><td>普通行</td><td>不是表头</td></tr></table>`),
      []
    );
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
    return btoa(bin);
  });
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(Buffer.from(b64, "base64"));
  const xml = (await zip.file("word/document.xml")?.async("string")) || "";
  expect(xml).not.toContain('w:fill="EDF2F7"');
  expect(XMLValidator.validate(xml)).toBe(true);
});

// 导出排版回归：代码空格/缩进保留（&nbsp;）+ 代码行高 auto + 引用块竖线 + 表格单一 grid + 无非法属性
test("导出排版：代码空格缩进保留 + 引用块竖线 + 表格单一 grid + 无 undefined", async ({ page }) => {
  await page.goto("/");
  const b64 = await page.evaluate(async () => {
    const dx = await import("/src/docx.ts");
    const ex = await import("/src/export-docx.ts");
    const html = `<h1>标题</h1><p>正文段落。</p><blockquote><p>引用文字</p></blockquote>
<pre><code class="language-python">def hello():
    # 注释
    print("hi")</code></pre>
<table><thead><tr><th>名称</th><th>说明说明</th></tr></thead><tbody><tr><td>甲</td><td>乙</td></tr></tbody></table>`;
    const { html: pretty, colWidths } = await ex.beautifyForWord(html);
    const blob = await dx.beautifyDocx(await dx.htmlToDocxBlob(pretty), colWidths);
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
    return btoa(bin);
  });
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(Buffer.from(b64, "base64"));
  const xml = (await zip.file("word/document.xml")?.async("string")) || "";

  // OOXML 后处理不能产出畸形 XML
  expect(XMLValidator.validate(xml)).toBe(true);
  // 表头行（含 <w:b/>）应有浅灰底纹
  expect(xml).toContain('w:fill="EDF2F7"');

  // 代码空格/缩进保留为 U+00A0（html-to-docx 会丢普通空格，需 &nbsp; 兜底）
  const codeTexts = (xml.match(/<w:t xml:space="preserve">[^<]*<\/w:t>/g) || []).map((r) => r.replace(/<[^>]+>/g, ""));
  const code = codeTexts.join("");
  expect(code).toContain("def\u00a0hello");           // token 间空格保留
  expect(code).toContain("\u00a0\u00a0\u00a0\u00a0print"); // 4 空格缩进保留

  // 代码行高 auto（不裁剪中文）
  expect(xml).not.toContain('w:lineRule="exact"');

  // 引用块：左竖线 + 左缩进
  expect(xml).toContain("<w:pBdr>");
  expect(xml).toContain('<w:ind w:left="240"');

  // 表格单一 tblGrid（html-to-docx 会为 thead/tbody 各生成一个，需 collapse）
  expect((xml.match(/<w:tblGrid>/g) || []).length).toBe(1);

  // 无非法 undefined 属性（html-to-docx 会给 pgMar 写 header/footer/gutter="undefined"）
  expect(xml).not.toContain('="undefined"');
});
