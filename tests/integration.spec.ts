import { test, expect, type Page } from "@playwright/test";

async function ready(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => document.querySelector("#editor .vditor-wysiwyg") && /欢迎|Welcome/.test(document.getElementById("file-title")?.textContent || ""));
}
async function open(page: Page, source: string, path: string | null = null) {
  return page.evaluate(async ({ source, path }) => {
    const docs = await import("/src/docs.ts");
    return docs.openDoc(path, source, path ? "test.md" : "note", "UTF-8", 1, source.length, path?.toLowerCase(), "original").id;
  }, { source, path });
}

test("文档撤销隔离、切换模式保留历史，撤回已保存基线时清 dirty", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const docs = await import("/src/docs.ts"), sync = await import("/src/editor-sync.ts"), state = await import("/src/state.ts");
    const a = docs.openDoc(null, "A\n", "a"); sync.applyDocumentEdit(a, "A2\n");
    const b = docs.openDoc(null, "B\n", "b"); sync.applyDocumentEdit(b, "B2\n"); sync.undoDocument("undo");
    docs.switchDoc(a.id); sync.undoDocument("undo");
    const before = { a: a.content, aDirty: a.dirty, b: b.content, bDirty: b.dirty };
    sync.undoDocument("redo"); return { before, redo: state.activeDoc()?.content };
  });
  expect(result).toEqual({ before: { a: "A\n", aDirty: false, b: "B\n", bDirty: false }, redo: "A2\n" });
  await page.selectOption("#btn-mode", "sv");
  await expect(page.locator("#editor .vditor-sv")).toBeVisible();
  await page.locator('[data-type="alei-undo"]').click();
  expect(await page.evaluate(async () => (await import("/src/state.ts")).activeDoc()?.content)).toBe("A\n");
});

for (const mode of ["wysiwyg", "ir", "sv"]) {
  test(`${mode}: 源码查找、批量替换单步撤销`, async ({ page }) => {
    await ready(page); await open(page, "# alpha\n\n**alpha** and alpha\n");
    await page.selectOption("#btn-mode", mode);
    await page.click("#btn-find"); await page.fill("#find-query", "alpha"); await page.fill("#find-replacement", "beta");
    await page.click("#find-run"); await expect(page.locator("#find-status")).toHaveText("1 / 3");
    await page.click("#replace-all"); await expect(page.locator("#find-status")).toHaveText("0 / 0");
    expect(await page.evaluate(async () => (await import("/src/state.ts")).activeDoc()?.content)).toBe("# beta\n\n**beta** and beta\n");
    await page.locator('[data-type="alei-undo"]').click();
    expect(await page.evaluate(async () => (await import("/src/state.ts")).activeDoc()?.dirty)).toBe(false);
  });
}

test("正则捕获、零宽匹配、跨标记源码与超时可取消", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const { searchSource, replaceMatches } = await import("/src/find-engine.ts");
    const a = searchSource({ source: "a1 **a2**", query: "a(\\d)", replacement: "$1-$&-$$", regex: true, caseSensitive: false });
    const b = searchSource({ source: "中文", query: "(?=.)", replacement: "_", regex: true, caseSensitive: true });
    const c = searchSource({ source: "a **b**", query: "a **b**", replacement: "ok", regex: false, caseSensitive: true });
    return [replaceMatches("a1 **a2**", a.matches), replaceMatches("中文", b.matches), c.matches.length];
  });
  expect(result).toEqual(["1-a1-$ **2-a2-$**", "_中_文", 1]);
  await open(page, "a".repeat(40) + "!");
  await page.click("#btn-find"); await page.fill("#find-query", "(a+)+$"); await page.check("#find-regex"); await page.click("#find-run");
  await expect(page.locator("#find-status")).toContainText(/超时|逾時|timed out/);
  await page.fill("#find-query", "a+"); await page.click("#find-run"); await expect(page.locator("#find-status")).toHaveText("1 / 1");
});

test("过期查找结果不能覆盖新编辑", async ({ page }) => {
  await ready(page); await open(page, "old\n");
  await page.click("#btn-find"); await page.fill("#find-query", "old"); await page.fill("#find-replacement", "replacement"); await page.click("#find-run");
  await expect(page.locator("#find-status")).toHaveText("1 / 1");
  await page.evaluate(async () => { const state = await import("/src/state.ts"); (await import("/src/editor-sync.ts")).applyDocumentEdit(state.activeDoc()!, "new\n"); });
  await page.click("#replace-all");
  expect(await page.evaluate(async () => (await import("/src/state.ts")).activeDoc()?.content)).toBe("new\n");
});

test("表格行移动固定表头并可撤销", async ({ page }) => {
  await ready(page); await open(page, "| H | V |\n|---|---|\n| A | 1 |\n| B | 2 |\n");
  const result = await page.evaluate(async () => {
    const { moveTableRow } = await import("/src/table.ts"), { activeDoc } = await import("/src/state.ts");
    const rows = document.querySelectorAll<HTMLTableRowElement>("#editor .vditor-wysiwyg .vditor-reset table tr");
    const blocked = moveTableRow(rows[1], -1), moved = moveTableRow(rows[2], -1), content = activeDoc()!.content;
    (await import("/src/editor-sync.ts")).undoDocument("undo");
    return { blocked, moved, content, dirty: activeDoc()!.dirty };
  });
  expect(result.blocked).toBe(false); expect(result.moved).toBe(true);
  expect(result.content.indexOf("B")).toBeLessThan(result.content.indexOf("A")); expect(result.dirty).toBe(false);
});

test("单标签关闭取消保留当前与其他文档", async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    const docs = await import("/src/docs.ts"), sync = await import("/src/editor-sync.ts");
    const a = docs.openDoc(null, "a", "first"); sync.applyDocumentEdit(a, "dirty"); docs.openDoc(null, "b", "second");
    void docs.closeDoc(a.id);
  });
  await expect(page.locator("#close-confirm")).toBeVisible(); await page.click("#cc-cancel");
  expect(await page.evaluate(async () => (await import("/src/state.ts")).S.docs.slice(-2).map(doc => doc.name))).toEqual(["first", "second"]);
});

test("自动保存共用事务，外改冲突暂停且不 force，空文档不后台清空", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const store = await import("/src/document-store.ts"), files = await import("/src/file-service.ts"), auto = await import("/src/autosave.ts");
    const { setPreference } = await import("/src/preferences.ts");
    const doc = store.createDocument({ path: "D:/auto.md", name: "auto", content: "old", pathKey: "auto", fingerprint: "old", mtimeMs: 1, size: 3 });
    store.addDocument(doc); store.setDocumentContent(doc, "new", true); const requests: boolean[] = [];
    files.setFileServiceForTests({ openFile: async () => { throw Error("unused"); }, statFile: async () => null, saveDocx: async () => {}, saveFile: async r => { requests.push(r.force); throw new files.FileConflictError("changed"); } });
    setPreference("autosave", true); await auto.autosaveDirty(); await auto.autosaveDirty();
    const empty = store.createDocument({ path: "D:/empty.md", name: "empty", content: "old" }); store.addDocument(empty); store.setDocumentContent(empty, "", true); await auto.autosaveDirty();
    return { requests, dirty: doc.dirty, conflict: doc.externalChange, empty: empty.dirty };
  });
  expect(result).toEqual({ requests: [false], dirty: true, conflict: "changed", empty: true });
});

test("外改检查不改基线；重载等待期间的新编辑受到保护", async ({ page }) => {
  await ready(page); await open(page, "local\n", "D:/external.md");
  const result = await page.evaluate(async () => {
    const files = await import("/src/file-service.ts"), ext = await import("/src/external-changes.ts"), { activeDoc } = await import("/src/state.ts"), sync = await import("/src/editor-sync.ts");
    const doc = activeDoc()!; let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    const disk = { pathKey: "d:/external.md", fingerprint: "external", mtimeMs: 2, size: 5, content: "disk", encoding: "UTF-8" };
    files.setFileServiceForTests({ openFile: async () => { await gate; return disk; }, statFile: async () => disk, saveDocx: async () => {}, saveFile: async () => disk });
    await ext.checkExternalChanges(); const detected = doc.externalChange, baseline = doc.fingerprint;
    const reload = ext.reloadDocument(doc); sync.applyDocumentEdit(doc, "typed during reload\n"); release(); const ok = await reload;
    return { detected, baseline, ok, content: doc.content, dirty: doc.dirty };
  });
  expect(result).toEqual({ detected: "changed", baseline: "original", ok: false, content: "typed during reload\n", dirty: true });
});

test("延迟加载只挂载仍激活的文档", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const store = await import("/src/document-store.ts"), docs = await import("/src/docs.ts"), state = await import("/src/state.ts"), files = await import("/src/file-service.ts");
    const lazy = store.createDocument({ path: "D:/lazy.md", name: "lazy", content: "" }); store.setDocumentStatus(lazy, { loadState: "unloaded" }); store.addDocument(lazy);
    let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    files.setFileServiceForTests({ openFile: async () => { await gate; return { content: "loaded", encoding: "UTF-8", mtimeMs: 1, size: 6, pathKey: "lazy", fingerprint: "fp" }; }, statFile: async () => null, saveFile: async () => { throw Error("unused"); }, saveDocx: async () => {} });
    docs.switchDoc(lazy.id); const pending = docs.ensureDocumentLoaded(lazy); const current = docs.openDoc(null, "current\n", "current"); release(); await pending;
    return { lazy: lazy.content, state: lazy.loadState, current: state.activeDoc()?.id === current.id, editor: state.S.vditor?.getValue() };
  });
  expect(result).toEqual({ lazy: "loaded", state: "ready", current: true, editor: "current\n" });
});

test("会话只持久化路径，重启后按需读取且失败可重试", async ({ page }) => {
  await ready(page); await page.check("#pref-session");
  await open(page, "private one\n", "D:/one.md"); await open(page, "private two\n", "D:/two.md");
  const persisted = await page.evaluate(() => localStorage.getItem("alei-editor.session.v1"));
  expect(persisted).not.toContain("private");
  await page.reload();
  await expect(page.locator("#document-status")).toContainText(/读取失败|讀取失敗|Load failed/);
  expect(await page.evaluate(async () => (await import("/src/state.ts")).S.docs.map(doc => doc.loadState))).toEqual(["unloaded", "error"]);
  await page.evaluate(async () => {
    (await import("/src/file-service.ts")).setFileServiceForTests({
      openFile: async path => ({ content: path.includes("two") ? "two\n" : "one\n", pathKey: path.toLowerCase(), fingerprint: "disk", mtimeMs: 1, size: 4, encoding: "UTF-8" }),
      statFile: async () => null, saveFile: async () => { throw Error("unused"); }, saveDocx: async () => {},
    });
  });
  await page.locator("#document-status button").click(); await expect(page.locator("#document-status")).toBeHidden();
  expect(await page.evaluate(async () => (await import("/src/state.ts")).activeDoc()?.content)).toBe("two\n");
  await page.locator(".tab").first().click();
  await expect.poll(() => page.evaluate(async () => (await import("/src/state.ts")).activeDoc()?.content)).toBe("one\n");
});

test("未编辑文档的原始 CRLF 和 dirty 不受重建影响；历史有预算", async ({ page }) => {
  await ready(page); await open(page, "# CRLF\r\n\r\nbody\r\n");
  await page.selectOption("#btn-mode", "ir"); await expect(page.locator("#editor .vditor-ir")).toBeVisible();
  const result = await page.evaluate(async () => {
    const { activeDoc } = await import("/src/state.ts"), store = await import("/src/document-store.ts"), history = await import("/src/history.ts");
    const doc = activeDoc()!; (await import("/src/editor-sync.ts")).syncDocFromEditor(doc);
    const value = { content: doc.content, dirty: doc.dirty };
    const bounded = store.createDocument({ path: null, name: "budget", content: "0" });
    for (let n = 1; n <= 120; n++) store.setDocumentContent(bounded, String(n), true);
    return { value, count: history.historyStatus(bounded).undo };
  });
  expect(result).toEqual({ value: { content: "# CRLF\r\n\r\nbody\r\n", dirty: false }, count: 100 });
});

test("新输入在延迟同步前保存也写入最新内容", async ({ page }) => {
  await ready(page); await open(page, "seed\n", "D:/flush.md");
  const result = await page.evaluate(async () => {
    const { activeDoc } = await import("/src/state.ts"), files = await import("/src/file-service.ts"), sync = await import("/src/editor-sync.ts");
    const doc = activeDoc()!; let written = "";
    files.setFileServiceForTests({ openFile: async () => { throw Error("unused"); }, statFile: async () => null, saveDocx: async () => {}, saveFile: async request => {
      written = request.content; return { pathKey: doc.pathKey!, fingerprint: "saved", mtimeMs: 2, size: written.length };
    } });
    const root = document.querySelector("#editor .vditor-wysiwyg .vditor-reset")!;
    root.querySelector("p")!.textContent = "latest";
    sync.scheduleEditorSync(); const ok = await (await import("/src/save.ts")).saveDoc(doc);
    return { ok, written, dirty: doc.dirty };
  });
  expect(result).toEqual({ ok: true, written: "latest\n", dirty: false });
});

test("历史恢复成为可撤销修改，自动保存不会立即覆盖磁盘", async ({ page }) => {
  await ready(page); await open(page, "current\n", "D:/history.md");
  await page.evaluate(async () => {
    (await import("/src/file-service.ts")).setArchiveServiceForTests({ listVersions: async () => [{ id: "1-1", modifiedMs: 1, encoding: "GBK", size: 5 }], readVersion: async () => "previous\n" });
  });
  await page.click("#btn-versions"); await expect(page.locator("#version-preview")).toHaveText("previous"); await page.click("#version-restore");
  const state = await page.evaluate(async () => { const d = (await import("/src/state.ts")).activeDoc()!; return { content: d.content, dirty: d.dirty, paused: Boolean(d.saveError) }; });
  expect(state).toEqual({ content: "previous\n", dirty: true, paused: true });
  await page.locator('[data-type="alei-undo"]').click(); expect(await page.evaluate(async () => (await import("/src/state.ts")).activeDoc()?.content)).toBe("current\n");
});

test("未命名笔记切换语言不被欢迎页覆盖；主题大纲设置不改正文", async ({ page }) => {
  await ready(page); await open(page, "# Keep\n\n# Other\n");
  await page.selectOption("#lang-select", "en"); await page.selectOption("#pref-theme", "dark"); await page.fill("#outline-filter", "Keep");
  await expect(page.locator("#outline .outline-item")).toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(async () => { const d = (await import("/src/state.ts")).activeDoc()!; return { content: d.content, dirty: d.dirty }; })).toEqual({ content: "# Keep\n\n# Other\n", dirty: false });
});

test("删除清空可撤销；输入法合成期间切换和撤销不丢文字", async ({ page }) => {
  await ready(page); await open(page, "seed\n");
  const editor = page.locator("#editor .vditor-wysiwyg .vditor-reset");
  await editor.click(); await page.keyboard.press("ControlOrMeta+a"); await page.keyboard.press("Delete");
  await expect.poll(() => page.evaluate(async () => (await import("/src/state.ts")).activeDoc()?.content.trim())).toBe("");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(async () => (await import("/src/state.ts")).activeDoc()?.content)).toBe("seed\n");
  const state = await page.evaluate(async () => {
    const docs = await import("/src/docs.ts"), sync = await import("/src/editor-sync.ts"), state = await import("/src/state.ts");
    const current = state.activeDoc()!, el = document.querySelector("#editor .vditor-wysiwyg .vditor-reset")!;
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    sync.undoDocument("redo"); docs.switchDoc(state.S.docs[0].id);
    const stayed = state.activeDoc()?.id === current.id;
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    return { stayed, content: current.content };
  });
  expect(state).toEqual({ stayed: true, content: "seed\n" });
});
