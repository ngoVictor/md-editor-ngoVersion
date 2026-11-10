import { test, expect, type Page } from "@playwright/test";

async function waitEditor(page: Page) {
  await page.goto("/");
  await page.waitForSelector("#editor .vditor-wysiwyg");
  await page.waitForFunction(() => Boolean(document.getElementById("file-title")?.textContent));
}

test("保存期间继续编辑：旧请求完成后仍保持 dirty", async ({ page }) => {
  await waitEditor(page);
  const result = await page.evaluate(async () => {
    const state = await import("/src/state.ts");
    const store = await import("/src/document-store.ts");
    const files = await import("/src/file-service.ts");
    const save = await import("/src/save.ts");

    const doc = store.createDocument({
      path: "D:/race.md", pathKey: "disk/race", name: "race.md", content: "V1",
      encoding: "UTF-8", mtimeMs: 1, size: 2, fingerprint: "fp-v1",
    });
    store.addDocument(doc); // 保持非激活，避免测试被编辑器 DOM 快照干扰

    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let written = "";
    files.setFileServiceForTests({
      openFile: async () => { throw new Error("unused"); },
      statFile: async () => null,
      saveFile: async (request) => {
        written = request.content;
        await gate;
        return { mtimeMs: 2, size: request.content.length, pathKey: "disk/race", fingerprint: "fp-saved" };
      },
      saveDocx: async () => undefined,
    });

    const saving = save.saveDoc(doc);
    while (doc.saveState !== "saving") await new Promise((resolve) => setTimeout(resolve, 0));
    store.setDocumentContent(doc, "V2-unsaved", true);
    release();
    const ok = await saving;
    files.setFileServiceForTests(null);
    return { ok, written, content: doc.content, dirty: doc.dirty, revision: doc.revision, fingerprint: doc.fingerprint };
  });

  expect(result.ok).toBe(true);
  expect(result.written).toBe("V1");
  expect(result.content).toBe("V2-unsaved");
  expect(result.dirty).toBe(true);
  expect(result.revision).toBe(1);
  expect(result.fingerprint).toBe("fp-saved");
});

test("同一文档的并发保存严格排队，后续请求重新捕获最新正文", async ({ page }) => {
  await waitEditor(page);
  const result = await page.evaluate(async () => {
    const store = await import("/src/document-store.ts");
    const files = await import("/src/file-service.ts");
    const save = await import("/src/save.ts");
    const doc = store.createDocument({
      path: "D:/queue.md", pathKey: "disk/queue", name: "queue.md", content: "V1",
      encoding: "UTF-8", mtimeMs: 1, size: 2, fingerprint: "fp-v0",
    });
    store.addDocument(doc);

    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const writes: string[] = [];
    files.setFileServiceForTests({
      openFile: async () => { throw new Error("unused"); },
      statFile: async () => null,
      saveFile: async (request) => {
        writes.push(request.content);
        if (writes.length === 1) await firstGate;
        return {
          mtimeMs: writes.length + 1,
          size: request.content.length,
          pathKey: "disk/queue",
          fingerprint: `fp-${writes.length}`,
        };
      },
      saveDocx: async () => undefined,
    });

    const first = save.saveDoc(doc);
    while (doc.saveState !== "saving") await new Promise((resolve) => setTimeout(resolve, 0));
    store.setDocumentContent(doc, "V2", true);
    const second = save.saveDoc(doc);
    releaseFirst();
    const ok = await Promise.all([first, second]);
    files.setFileServiceForTests(null);
    return { ok, writes, content: doc.content, dirty: doc.dirty, fingerprint: doc.fingerprint };
  });

  expect(result).toEqual({ ok: [true, true], writes: ["V1", "V2"], content: "V2", dirty: false, fingerprint: "fp-2" });
});

test("Save As 写入失败不改变原文档身份", async ({ page }) => {
  await waitEditor(page);
  const result = await page.evaluate(async () => {
    const store = await import("/src/document-store.ts");
    const files = await import("/src/file-service.ts");
    const save = await import("/src/save.ts");
    const doc = store.createDocument({
      path: "D:/old.md", pathKey: "disk/old", name: "old.md", content: "content",
      encoding: "UTF-8", mtimeMs: 1, size: 7, fingerprint: "old-fp",
    });
    store.addDocument(doc);
    save.setSavePathPickerForTests(async () => "D:/new.md");
    files.setFileServiceForTests({
      openFile: async () => { throw new Error("unused"); },
      statFile: async () => null,
      saveFile: async () => { throw new Error("permission denied"); },
      saveDocx: async () => undefined,
    });
    const ok = await save.saveDoc(doc, true);
    save.setSavePathPickerForTests(null);
    files.setFileServiceForTests(null);
    return { ok, path: doc.path, pathKey: doc.pathKey, name: doc.name, fingerprint: doc.fingerprint };
  });

  expect(result).toEqual({ ok: false, path: "D:/old.md", pathKey: "disk/old", name: "old.md", fingerprint: "old-fp" });
});

test("Save As 目标已被其他标签占用时拒绝写入", async ({ page }) => {
  await waitEditor(page);
  const result = await page.evaluate(async () => {
    const store = await import("/src/document-store.ts");
    const files = await import("/src/file-service.ts");
    const save = await import("/src/save.ts");
    const source = store.createDocument({ path: "D:/source.md", pathKey: "source-key", name: "source.md", content: "source" });
    const owner = store.createDocument({ path: "D:/target.md", pathKey: "target-key", name: "target.md", content: "target" });
    store.addDocument(source);
    store.addDocument(owner);
    let writes = 0;
    save.setSavePathPickerForTests(async () => "d:/TARGET.md");
    files.setFileServiceForTests({
      openFile: async () => { throw new Error("unused"); },
      statFile: async () => ({ mtimeMs: 1, size: 6, pathKey: "target-key", fingerprint: "target-fp" }),
      saveFile: async () => { writes++; throw new Error("must not write"); },
      saveDocx: async () => undefined,
    });
    const ok = await save.saveDoc(source, true);
    save.setSavePathPickerForTests(null);
    files.setFileServiceForTests(null);
    return { ok, writes, path: source.path, pathKey: source.pathKey };
  });
  expect(result).toEqual({ ok: false, writes: 0, path: "D:/source.md", pathKey: "source-key" });
});

test("dirty 文档重复打开只激活，不混用新正文和新基线", async ({ page }) => {
  await waitEditor(page);
  const result = await page.evaluate(async () => {
    const docs = await import("/src/docs.ts");
    const store = await import("/src/document-store.ts");
    const doc = docs.openDoc("D:/same.md", "disk-v1", "same.md", "UTF-8", 1, 7, "same-key", "fp-v1");
    store.setDocumentContent(doc, "local-edit", true);
    const reopened = docs.openDoc("d:/SAME.md", "disk-v2", "SAME.md", "UTF-8", 2, 7, "same-key", "fp-v2");
    return {
      sameObject: doc === reopened,
      count: (await import("/src/state.ts")).S.docs.filter((item) => item.pathKey === "same-key").length,
      content: reopened.content,
      mtime: reopened.mtimeMs,
      fingerprint: reopened.fingerprint,
      dirty: reopened.dirty,
    };
  });

  expect(result).toEqual({ sameObject: true, count: 1, content: "local-edit", mtime: 1, fingerprint: "fp-v1", dirty: true });
});

test("clean 文档重复打开会原子重载正文与基线", async ({ page }) => {
  await waitEditor(page);
  const result = await page.evaluate(async () => {
    const docs = await import("/src/docs.ts");
    const doc = docs.openDoc("D:/reload.md", "disk-v1", "reload.md", "UTF-8", 1, 7, "reload-key", "fp-v1");
    const reopened = docs.openDoc("d:/RELOAD.md", "disk-v2", "RELOAD.md", "UTF-8", 2, 7, "reload-key", "fp-v2");
    return { sameObject: doc === reopened, content: reopened.content, mtime: reopened.mtimeMs, fingerprint: reopened.fingerprint, dirty: reopened.dirty };
  });
  expect(result).toEqual({ sameObject: true, content: "disk-v2", mtime: 2, fingerprint: "fp-v2", dirty: false });
});
