import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import { htmlToDocxBlob, beautifyDocx } from "../src/docx";

for (const mode of ["wysiwyg", "ir", "sv"]) {
  test(`${mode}: 宽表格可滚至最右，正文与单元格编辑保留`, async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("#editor .vditor-wysiwyg");
    const source = `| 项目 | 内容 |\n| --- | --- |\n| 自动保存暂停 | ${"不循环".repeat(100)} |\n`;
    await page.evaluate(async source => { (await import("/src/docs.ts")).openDoc(null, source, "wide"); }, source);
    await page.selectOption("#btn-mode", mode);
    const table = page.locator(mode === "sv" ? ".vditor-preview table" : mode === "ir" ? ".vditor-ir table" : ".vditor-wysiwyg table").first();
    await expect(table).toBeVisible();
    const size = await table.evaluate(el => {
      el.scrollLeft = el.scrollWidth;
      return { scroll: el.scrollLeft, max: el.scrollWidth - el.clientWidth, overflow: getComputedStyle(el).overflowX, width: el.getBoundingClientRect().width, body: document.body.clientWidth };
    });
    expect(size.overflow).toBe("auto"); expect(size.scroll).toBeGreaterThan(0); expect(size.scroll).toBe(size.max); expect(size.width).toBeLessThan(size.body);
    expect(await page.evaluate(async () => { const { activeDoc } = await import("/src/state.ts"); (await import("/src/editor-sync.ts")).syncDocFromEditor(activeDoc()!); return activeDoc()!.content; })).toBe(source);
    if (mode === "wysiwyg") {
      await table.locator("td").last().click(); await page.keyboard.press("End"); await page.keyboard.type(" END");
      await expect.poll(() => page.evaluate(async () => { const { activeDoc } = await import("/src/state.ts"); (await import("/src/editor-sync.ts")).syncDocFromEditor(activeDoc()!); return activeDoc()!.content; })).toContain("END");
    }
  });
}

test("Word 表格每行每列显式边框，grid 与单元格宽度一致且不超出 A4", async () => {
  const blob = await beautifyDocx(await htmlToDocxBlob('<table><thead><tr><th>维度</th><th>结果</th><th>证据</th></tr></thead><tbody><tr><td>循环依赖</td><td>通过</td><td>architecture.spec.ts</td></tr><tr><td>核心状态</td><td>通过</td><td>document-store.ts</td></tr></tbody></table>'), [[0.2, 0.2, 0.6]]);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer()), xml = await zip.file("word/document.xml")!.async("string");
  const cells = [...xml.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map(m => m[0]);
  expect(cells).toHaveLength(9);
  for (const cell of cells) for (const edge of ["top", "bottom", "left", "right"]) expect(cell).toContain(`<w:${edge} w:val="single" w:sz="6"`);
  expect(xml).toContain('<w:insideH w:val="single"'); expect(xml).toContain('<w:insideV w:val="single"');
  const grid = [...xml.matchAll(/<w:gridCol w:w="(\d+)"/g)].map(m => +m[1]);
  expect(grid.reduce((a, b) => a + b, 0)).toBe(8306);
  cells.forEach((cell, i) => expect(cell).toContain(`<w:tcW w:w="${grid[i % 3]}" w:type="dxa"/>`));
});

test("移至窗口成功后才移除标签，保留未保存正文、撤销与磁盘基线", async ({ page }) => {
  await page.goto("/"); await page.waitForSelector("#editor .vditor-wysiwyg");
  const result = await page.evaluate(async () => {
    const docs = await import("/src/docs.ts"), state = await import("/src/state.ts"), store = await import("/src/document-store.ts"), history = await import("/src/history.ts"), sync = await import("/src/editor-sync.ts"), transfer = await import("/src/window-transfer.ts");
    const d = docs.openDoc("D:/test.md", "before\n", "test", "GBK", 1, 7, "key", "fingerprint");
    sync.applyDocumentEdit(d, "未保存\n"); let payload: any, retained = false;
    transfer.setWindowTransferServiceForTests({ prepare: async value => { payload = value; return "target"; }, ready: async () => true, commit: async () => { retained = state.S.docs.includes(d); }, abort: async () => {} });
    const ok = await transfer.detachDocument(d.id), removed = !state.S.docs.includes(d);
    const received = store.importTransferredDocument(payload.doc); history.importHistory(received, payload.history);
    const beforeUndo = { content: received.content, dirty: received.dirty, fingerprint: received.fingerprint, savedContent: received.savedContent, encoding: received.encoding };
    return { ok, retained, removed, beforeUndo, undo: history.takeHistory(received, "undo"), locked: state.S.windowTransfer };
  });
  expect(result).toEqual({ ok: true, retained: true, removed: true, beforeUndo: { content: "未保存\n", dirty: true, fingerprint: "fingerprint", savedContent: "before\n", encoding: "GBK" }, undo: "before\n", locked: false });
  await expect(page.locator("#btn-close-all, #btn-close-others, #btn-close-right")).toHaveCount(0);
});

test("新窗口失败时保留草稿与撤销，输入法合成期间拒绝拆分", async ({ page }) => {
  await page.goto("/"); await page.waitForSelector("#editor .vditor-wysiwyg");
  const result = await page.evaluate(async () => {
    const docs = await import("/src/docs.ts"), state = await import("/src/state.ts"), sync = await import("/src/editor-sync.ts"), history = await import("/src/history.ts"), transfer = await import("/src/window-transfer.ts");
    const doc = docs.openDoc(null, "草稿\n", "draft"); sync.applyDocumentEdit(doc, "还没保存\n"); let aborted = false;
    transfer.setWindowTransferServiceForTests({ prepare: async () => "target", ready: async () => { throw Error("Window crashed"); }, commit: async () => {}, abort: async () => { aborted = true; } });
    const ok = await transfer.detachDocument(doc.id);
    document.getElementById("error-modal")!.hidden = true;
    document.querySelector('[contenteditable="true"]')!.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const ime = await transfer.detachDocument(doc.id);
    return { ok, ime, aborted, kept: state.S.docs.includes(doc), content: doc.content, dirty: doc.dirty, undo: history.takeHistory(doc, "undo"), locked: state.S.windowTransfer };
  });
  expect(result).toEqual({ ok: false, ime: false, aborted: true, kept: true, content: "还没保存\n", dirty: true, undo: "草稿\n", locked: false });
});
