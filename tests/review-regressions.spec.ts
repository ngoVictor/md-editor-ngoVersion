import { test, expect, type Page } from "@playwright/test";

async function ready(page: Page) {
  await page.goto("/");
  await page.waitForFunction(async () => !!document.getElementById("file-title")?.textContent &&
    !!(await import("/src/state.ts")).S.vditor && !(await import("/src/state.ts")).S.switchInFlight);
}

test("当前标签重复激活保留尚未同步的输入及光标 DOM", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const docs = await import("/src/docs.ts"), sync = await import("/src/editor-sync.ts"), { S } = await import("/src/state.ts");
    const doc = docs.openDoc(null, "old\n", "note");
    const p = document.querySelector(".vditor-wysiwyg .vditor-reset p")!;
    p.textContent = "new draft";
    sync.scheduleEditorSync();
    docs.switchDoc(doc.id);
    return { content: doc.content, dirty: doc.dirty, attached: p.isConnected, value: S.vditor!.getValue() };
  });
  expect(result).toEqual({ content: "new draft\n", dirty: true, attached: true, value: "new draft\n" });
});

test("保存路径等待期间开始 IME 合成时拒绝旧快照写入", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const docs = await import("/src/docs.ts"), save = await import("/src/save.ts"), files = await import("/src/file-service.ts");
    const doc = docs.openDoc(null, "old\n", "note");
    let finish!: (path: string) => void, writes = 0;
    save.setSavePathPickerForTests(() => new Promise(resolve => { finish = resolve; }));
    files.setFileServiceForTests({ openFile: async () => { throw Error("unused"); }, statFile: async () => null,
      saveDocx: async () => {}, saveFile: async () => { writes++; return { mtimeMs: 1, size: 4, pathKey: "d:\\new.md", fingerprint: "saved" }; } });
    const pending = save.saveDoc(doc);
    while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
    document.querySelector(".vditor-wysiwyg .vditor-reset")!.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    finish("D:/new.md");
    return { ok: await pending, writes, path: doc.path };
  });
  expect(result).toEqual({ ok: false, writes: 0, path: null });
});

test("迟到的重复打开不能回滚等待期间已保存的正文和基线", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const docs = await import("/src/docs.ts"), files = await import("/src/file-service.ts"), sync = await import("/src/editor-sync.ts"), save = await import("/src/save.ts");
    const doc = docs.openDoc("D:/same.md", "old\n", "same.md", "UTF-8", 1, 4, "d:\\same.md", "old");
    let finish!: (value: any) => void;
    files.setFileServiceForTests({ openFile: () => new Promise(resolve => { finish = resolve; }), statFile: async () => null,
      saveDocx: async () => {}, saveFile: async request => ({ mtimeMs: 2, size: request.content.length, pathKey: "d:\\same.md", fingerprint: "new" }) });
    const opening = docs.loadFile("D:/same.md");
    while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
    sync.applyDocumentEdit(doc, "new\n"); await save.saveDoc(doc);
    finish({ content: "old\n", encoding: "UTF-8", mtimeMs: 1, size: 4, pathKey: "d:\\same.md", fingerprint: "old" });
    await opening;
    return { content: doc.content, fingerprint: doc.fingerprint, dirty: doc.dirty };
  });
  expect(result).toEqual({ content: "new\n", fingerprint: "new", dirty: false });
});

test("真实 Windows pathKey 的已加载草稿链接不读盘", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const docs = await import("/src/docs.ts"), files = await import("/src/file-service.ts"), nav = await import("/src/document-navigation.ts"), sync = await import("/src/editor-sync.ts");
    let reads = 0;
    files.setFileServiceForTests({ pathKey: async () => "\\\\?\\d:\\target.md", openFile: async () => { reads++; throw Error("deleted"); },
      statFile: async () => null, saveDocx: async () => {}, saveFile: async () => { throw Error("unused"); } });
    const target = docs.openDoc("D:/target.md", "original\n", "target.md", "UTF-8", 1, 9, "\\\\?\\d:\\target.md", "original");
    sync.applyDocumentEdit(target, "draft\n"); docs.openDoc(null, "source\n", "source");
    return { ok: await nav.openDocumentLink("D:/target.md", ""), reads, content: target.content, dirty: target.dirty };
  });
  expect(result).toEqual({ ok: true, reads: 0, content: "draft\n", dirty: true });
});

test("SV 链接到当前文件的标题使用现有预览，不等待重渲染", async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    (await import("/src/file-service.ts")).setFileServiceForTests({ openFile: async () => { throw Error("must reuse loaded document"); },
      statFile: async () => null, saveDocx: async () => {}, saveFile: async () => { throw Error("unused"); } });
    (await import("/src/docs.ts")).openDoc("D:/same.md", "# Target\n", "same.md");
  });
  await page.selectOption("#btn-mode", "sv");
  await expect(page.locator(".vditor-preview h1")).toHaveText("Target");
  expect(await page.evaluate(async () => (await import("/src/document-navigation.ts")).openDocumentLink("D:/same.md", "#target"))).toBe(true);
});

test("最近文件对真实 Windows pathKey 去重，不挤掉其他记录", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const docs = await import("/src/docs.ts"), recent = await import("/src/recent-files.ts");
    docs.openDoc("D:/other.md", "other", "other.md", "UTF-8", 1, 5, "\\\\?\\d:\\other.md", "other");
    const target = docs.openDoc("D:/same.md", "same", "same.md", "UTF-8", 1, 4, "\\\\?\\d:\\same.md", "same");
    for (let i = 0; i < 35; i++) docs.switchDoc(target.id);
    return recent.recentFiles();
  });
  expect(result).toEqual(["D:/same.md", "D:/other.md"]);
});

test("大纲不把带尾随内容的围栏行当作关闭；识别三空格内的 ATX", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const { parseSections } = await import("/src/outline.ts");
    return parseSections("   # Outside\n\n```text\n```not-a-close\n# Still code\n```\n\n  ## End\n").map(s => s.title);
  });
  expect(result).toEqual(["Outside", "End"]);
});

test("预览支持的源码扩展名均能参加正文搜索，包括 CR 行号", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const files = await import("/src/file-service.ts"), { searchDirectory } = await import("/src/directory-search.ts");
    files.setNavigationServiceForTests({ list: async () => ({ entries: ["component.tsx", "config.jsonc", "run.cmd"].map(name => ({ name, path: "D:/" + name, directory: false })), truncated: false }) });
    files.setResourceServiceForTests({ inspect: async path => ({ path, kind: "source" }), openDefault: async () => {}, openEditor: async () => {},
      readText: async path => ({ path, content: "first\rneedle", encoding: "UTF-8" }) });
    const hits: any[] = [];
    await searchDirectory("D:/", "needle", false, new AbortController().signal, hit => hits.push(hit));
    return hits.map(hit => ({ path: hit.path, line: hit.line }));
  });
  expect(result).toEqual(["component.tsx", "config.jsonc", "run.cmd"].map(name => ({ path: "D:/" + name, line: 2 })));
});

test("另存为不能抢占磁盘已删除但仍保留草稿的标签路径", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const docs = await import("/src/docs.ts"), files = await import("/src/file-service.ts"), save = await import("/src/save.ts");
    docs.openDoc("D:/deleted.md", "draft\n", "deleted.md", "UTF-8", 1, 6, "\\\\?\\d:\\deleted.md", "old");
    const source = docs.openDoc(null, "source\n", "source"); let writes = 0;
    save.setSavePathPickerForTests(async () => "D:/deleted.md");
    files.setFileServiceForTests({ pathKey: async () => "\\\\?\\d:\\deleted.md", openFile: async () => { throw Error("unused"); }, statFile: async () => null,
      saveDocx: async () => {}, saveFile: async () => { writes++; return { mtimeMs: 1, size: 7, pathKey: "\\\\?\\d:\\deleted.md", fingerprint: "new" }; } });
    return { ok: await save.saveDoc(source, true), writes, path: source.path };
  });
  expect(result).toEqual({ ok: false, writes: 0, path: null });
});

test("不同文档并发另存为同一路径只有一个写入事务", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const store = await import("/src/document-store.ts"), files = await import("/src/file-service.ts"), save = await import("/src/save.ts");
    const a = store.createDocument({ path: null, name: "a", content: "a" }), b = store.createDocument({ path: null, name: "b", content: "b" });
    store.addDocument(a); store.addDocument(b);
    let release!: () => void, writes = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    save.setSavePathPickerForTests(async () => "D:/shared.md");
    files.setFileServiceForTests({ openFile: async () => { throw Error("unused"); }, statFile: async () => null, saveDocx: async () => {},
      saveFile: async () => { writes++; await gate; return { mtimeMs: 1, size: 1, pathKey: "d:\\shared.md", fingerprint: "saved" }; } });
    const first = save.saveDoc(a, true);
    while (!writes) await new Promise(resolve => setTimeout(resolve, 0));
    const second = await save.saveDoc(b, true); release();
    return { first: await first, second, writes, a: a.path, b: b.path };
  });
  expect(result).toEqual({ first: true, second: false, writes: 1, a: "D:/shared.md", b: null });
});

test("写盘返回时仍在合成的文字保持未保存标记", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const docs = await import("/src/docs.ts"), save = await import("/src/save.ts"), files = await import("/src/file-service.ts");
    const doc = docs.openDoc("D:/ime.md", "old\n", "ime.md", "UTF-8", 1, 4, "d:\\ime.md", "old");
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); let writing = false;
    files.setFileServiceForTests({ openFile: async () => { throw Error("unused"); }, statFile: async () => null, saveDocx: async () => {},
      saveFile: async () => { writing = true; await gate; return { mtimeMs: 2, size: 4, pathKey: doc.pathKey!, fingerprint: "saved" }; } });
    const pending = save.saveDoc(doc);
    while (!writing) await new Promise(resolve => setTimeout(resolve, 0));
    document.querySelector(".vditor-wysiwyg .vditor-reset")!.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    release();
    return { ok: await pending, dirty: doc.dirty, pending: doc.pendingInput };
  });
  expect(result).toEqual({ ok: true, dirty: true, pending: true });
});

test("图片写资源期间切走再切回同一文档，不向新挂载位置插入", async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    const docs = await import("/src/docs.ts"), files = await import("/src/file-service.ts");
    const doc = docs.openDoc(null, "before\n", "paste");
    let release!: () => void, storing = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    files.setImageStoreForTests({ store: async () => { storing = true; await gate; return "assets/image.png"; } });
    const canvas = document.createElement("canvas"); canvas.width = 20; canvas.height = 10;
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!)));
    const data = new DataTransfer(); data.items.add(new File([blob], "image.png", { type: "image/png" }));
    document.querySelector(".vditor-wysiwyg pre.vditor-reset")!.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: data }));
    while (!storing) await new Promise(resolve => setTimeout(resolve, 0));
    docs.openDoc(null, "other\n", "other"); docs.switchDoc(doc.id); release();
  });
  await expect(page.locator("#error-modal")).toBeVisible();
  expect(await page.evaluate(async () => (await import("/src/state.ts")).activeDoc()!.content)).toBe("before\n");
});

test("大纲延迟刷新期间同名章节位置变化，不删除旧控件指向的新章节", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const docs = await import("/src/docs.ts"), outline = await import("/src/outline.ts");
    const doc = docs.openDoc(null, "# Same\n\nfirst\n\n# Same\n\nsecond\n", "outline");
    outline.rebuildOutline();
    const oldDelete = document.querySelector<HTMLElement>("#outline .odel")!;
    const root = document.querySelector(".vditor-wysiwyg pre.vditor-reset")!;
    root.querySelector("h1")!.remove(); root.querySelector("p")!.remove();
    let confirms = 0; window.confirm = () => { confirms++; return true; };
    oldDelete.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    return { content: doc.content, confirms };
  });
  expect(result).toEqual({ content: "# Same\n\nsecond\n", confirms: 0 });
});

test("另存为写盘等待期间目标被打开，成功副本不形成重复标签身份", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const docs = await import("/src/docs.ts"), files = await import("/src/file-service.ts"), save = await import("/src/save.ts"), { S } = await import("/src/state.ts");
    const source = docs.openDoc(null, "source\n", "source");
    save.setSavePathPickerForTests(async () => "D:/late.md");
    files.setFileServiceForTests({ openFile: async () => { throw Error("unused"); }, statFile: async () => null, saveDocx: async () => {},
      saveFile: async () => {
        docs.openDoc("D:/late.md", "disk version\n", "late.md", "UTF-8", 1, 13, "d:\\late.md", "old");
        return { pathKey: "d:\\late.md", fingerprint: "new", mtimeMs: 2, size: 7 };
      } });
    return { ok: await save.saveDoc(source, true), path: source.path, content: source.content, owners: S.docs.filter(doc => doc.pathKey === "d:\\late.md").length };
  });
  expect(result).toEqual({ ok: false, path: null, content: "source\n", owners: 1 });
});

test("关闭标签等待期间新排入的保存也必须完成后才移除文档", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const docs = await import("/src/docs.ts"), files = await import("/src/file-service.ts"), save = await import("/src/save.ts"), { S } = await import("/src/state.ts");
    const doc = docs.openDoc("D:/close.md", "content\n", "close.md", "UTF-8", 1, 8, "d:\\close.md", "old");
    const releases: (() => void)[] = [];
    files.setFileServiceForTests({ openFile: async () => { throw Error("unused"); }, statFile: async () => null, saveDocx: async () => {},
      saveFile: async () => { await new Promise<void>(resolve => releases.push(resolve)); return { mtimeMs: 2, size: 8, pathKey: doc.pathKey!, fingerprint: "saved" }; } });
    const first = save.saveDoc(doc);
    while (!releases[0]) await new Promise(resolve => setTimeout(resolve, 0));
    const closing = docs.closeDoc(doc.id);
    const second = save.saveDoc(doc);
    releases[0]();
    while (!releases[1]) await new Promise(resolve => setTimeout(resolve, 0));
    const retained = S.docs.includes(doc);
    releases[1](); await Promise.all([first, second, closing]);
    return { retained, closed: !S.docs.includes(doc) };
  });
  expect(result).toEqual({ retained: true, closed: true });
});
