import { test, expect } from "@playwright/test";

test("HTML 两种样式保留表格、编号和缩进，移除脚本/外部资源并保留图片说明", async ({ page }) => {
  await page.goto("/"); await page.waitForSelector("#editor .vditor-wysiwyg");
  const requests: string[] = [];
  page.on("request", request => { if (request.url().includes("example.invalid")) requests.push(request.url()); });
  const result = await page.evaluate(async () => {
    const { buildHtmlExport } = await import("/src/html-export.ts");
    const html = '<h1 id="title">中文</h1><ol start="4"><li>four</li></ol><pre><code>  indent\n\nnext</code></pre><table><tr><th>标题</th></tr><tr><td>正文</td></tr></table><script>alert(1)</script><img src="https://example.invalid/tracker" onerror="alert(1)" alt="截图"><a href="javascript:alert(1)">unsafe</a><a href="#title">anchor</a><iframe src="https://example.invalid/frame"></iframe>';
    return { styled: buildHtmlExport(html, '<unsafe>', true), plain: buildHtmlExport(html, 'plain', false) };
  });
  expect(result.styled.omittedImages).toBe(1);
  expect(result.styled.html).toContain('<style>'); expect(result.plain.html).not.toContain('<style>');
  await page.setContent(result.styled.html);
  await expect(page.locator("table tr")).toHaveCount(2); await expect(page.locator("ol")).toHaveAttribute("start", "4");
  expect(await page.locator("code").textContent()).toBe('  indent\n\nnext');
  await expect(page.locator("script, iframe, img, [onerror]")).toHaveCount(0);
  await expect(page.getByText('unsafe', { exact: true })).not.toHaveAttribute('href');
  await expect(page.getByText('anchor', { exact: true })).toHaveAttribute('href', '#title');
  await expect(page.locator('body')).toContainText('[截图: https://example.invalid/tracker]');
  expect(requests).toEqual([]);
});

test("HTML 导出等待对话框时切换/修改文档，仍写入原快照且不提交保存状态", async ({ page }) => {
  await page.goto("/"); await page.waitForSelector("#editor .vditor-wysiwyg");
  const result = await page.evaluate(async () => {
    const docs = await import("/src/docs.ts"), sync = await import("/src/editor-sync.ts"), exp = await import("/src/export-html.ts"), files = await import("/src/file-service.ts");
    const doc = docs.openDoc(null, '# Original\n', 'original.md'); sync.applyDocumentEdit(doc, '# Captured\n');
    let written = '', destination = '', name = '';
    files.setExportServiceForTests({ saveHtml: async (path, html) => { destination = path; written = html; } });
    exp.setHtmlPathPickerForTests(async value => { name = value; sync.applyDocumentEdit(doc, '# Later\n'); docs.openDoc(null, '# Other\n', 'other.md'); return 'D:/exported'; });
    const ok = await exp.exportActiveDocAsHtml(true);
    return { ok, written, destination, name, dirty: doc.dirty, path: doc.path, content: doc.content };
  });
  expect(result.ok).toBe(true); expect(result.written).toContain('Captured'); expect(result.written).not.toContain('Later'); expect(result.written).not.toContain('Other');
  expect(result.destination).toBe('D:/exported.html'); expect(result.name).toBe('original.html'); expect(result.dirty).toBe(true); expect(result.path).toBeNull(); expect(result.content).toBe('# Later\n');
});

test("HTML 导出取消不写盘，写入失败不报成功；窗口转移中拒绝导出", async ({ page }) => {
  await page.goto("/"); await page.waitForSelector("#editor .vditor-wysiwyg");
  const result = await page.evaluate(async () => {
    const exp = await import("/src/export-html.ts"), files = await import("/src/file-service.ts"), { S } = await import("/src/state.ts"); let calls = 0;
    files.setExportServiceForTests({ saveHtml: async () => { calls++; throw Error('disk failure'); } });
    exp.setHtmlPathPickerForTests(async () => null); const cancel = await exp.exportActiveDocAsHtml(false);
    exp.setHtmlPathPickerForTests(async () => 'D:/test.htm'); S.windowTransfer = true; const blocked = await exp.exportActiveDocAsHtml(false); S.windowTransfer = false;
    const failed = await exp.exportActiveDocAsHtml(false);
    return { calls, cancel, blocked, failed };
  });
  expect(result).toEqual({ calls: 1, cancel: false, blocked: false, failed: false });
  await expect(page.locator('#error-modal')).toContainText('disk failure');
});
