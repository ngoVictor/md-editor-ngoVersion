// Real release IPC and UI; no source-module injection or user files.
import { chromium, expect } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(process.argv[2]), exe = resolve(process.argv[3]);
if (dirname(root) !== resolve('test-results') || !root.startsWith(resolve('test-results/native-review-'))) throw Error('Unsafe fixture root');
const evidence = resolve(process.env.MD_EDITOR_TEST_EVIDENCE_DIR || 'test-results/native-evidence/review');
mkdirSync(evidence, { recursive: true });
let browser;
for (let attempt = 0; attempt < 100; attempt++) {
  try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.MD_EDITOR_TEST_CDP_PORT}`); break; }
  catch (error) { if (attempt === 99) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
}
const context = browser.contexts()[0], page = context.pages()[0], checks = [], errors = [];
page.on('pageerror', error => { errors.push(error.message); console.error(error.stack); });
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
const launch = path => new Promise((resolve, reject) => {
  const child = spawn(exe, [path], { windowsHide: true, stdio: 'ignore' });
  child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error(`Forwarding exit: ${code}`)));
});
try {
  await expect(page.locator('#file-title')).toContainText('target.md');
  await page.selectOption('#lang-select', 'en');
  await expect(page.locator('#btn-save')).toContainText('Save');
  await expect(page.locator('.vditor-wysiwyg .vditor-reset p')).toHaveText('original');
  const target = join(root, 'target.md');
  const opened = await invoke('open_file', { path: target });
  const key = await invoke('file_path_key', { path: target });
  expect(key).toBe(opened[4]);
  expect(await invoke('file_path_key', { path: join(root, '.', 'TARGET.md') })).toBe(key);
  checks.push('Actual Windows canonical pathKey agrees with open_file, including case and dot aliases');

  await page.evaluate(() => {
    const root = document.querySelector('.vditor-wysiwyg .vditor-reset');
    const p = root.querySelector('p'); p.textContent = 'new draft';
    const range = document.createRange(); range.selectNodeContents(p); range.collapse(false);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    root.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    const rendered = root.querySelector('p'), text = root.textContent;
    document.querySelector('.tab.active').click();
    if (!rendered.isConnected || root.textContent !== text || !text.includes('new draft')) throw Error('Active tab discarded pending input');
  });
  await page.click('#btn-save');
  await expect.poll(() => readFileSync(target, 'utf8')).toContain('new draft');
  checks.push('Immediate active-tab click preserves unsynchronized text; actual native save writes the draft');

  unlinkSync(target);
  expect(await invoke('file_path_key', { path: target })).toBe(key);
  await launch(join(root, 'source.md'));
  await expect(page.locator('#file-title')).toContainText('source.md');
  await page.locator('.vditor-wysiwyg a').filter({ hasText: 'Draft target' }).click();
  await expect(page.locator('#file-title')).toContainText('target.md');
  await expect(page.locator('.vditor-wysiwyg .vditor-reset')).toContainText('new draft');
  await expect(page.locator('#error-modal')).toBeHidden();
  checks.push('Deleted on-disk target is reused from the loaded tab through native pathKey without rereading');

  const bad = join(root, 'bad.md');
  const outcome = await invoke('open_file', { path: bad }).then(() => 'unexpected success', error => String(error));
  expect(outcome).toContain('UTF-8');
  expect(readFileSync(bad).toString('hex')).toBe('efbbbfff');
  checks.push('Invalid BOM bytes are rejected by release IPC; original bytes remain unchanged');

  await page.click('#btn-navigation');
  const recents = await page.locator('#navigation-results button').allTextContents();
  expect(recents.filter(value => value.toLowerCase() === target.toLowerCase())).toHaveLength(1);
  checks.push('Native recent-file list deduplicates canonical document activations');
  expect(await page.locator('#btn-debug').count()).toBe(0);
  checks.push('Release diagnostics stay hidden');

  // Delay only the test's path dialog; close must wait even though the document is clean.
  await page.click('#navigation-close');
  await page.evaluate(() => {
    const original = window.fetch;
    window.__reviewDialogPending = false;
    window.fetch = (input, options) => {
      if (decodeURIComponent(String(input)).includes('ipc.localhost/plugin:dialog|save')) {
        window.__reviewDialogPending = true;
        return new Promise(resolve => { window.__reviewCancelDialog = () => resolve(new Response('null', { headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' } })); });
      }
      return original(input, options);
    };
  });
  await page.locator('.vditor-wysiwyg .vditor-reset p').click();
  await page.keyboard.press('Control+Shift+s');
  await page.waitForFunction(() => window.__reviewDialogPending);
  // The OS close command is intentionally absent from the capability. Deliver its
  // event through real event IPC to exercise the registered production callback.
  await invoke('plugin:event|emit', { event: 'tauri://close-requested', payload: null });
  // A round trip after close confirms the WebView survived the close event while save is pending.
  await expect.poll(() => page.evaluate(() => document.querySelector('#file-title').textContent)).toContain('target.md');
  const closed = page.waitForEvent('close');
  await page.evaluate(() => window.__reviewCancelDialog());
  await closed;
  checks.push('Production close callback via native event IPC waits for clean Save As and destroys its window after cancellation');

  expect(errors).toEqual([]);
  checks.push('No WebView page errors occur');
  writeFileSync(join(evidence, 'native-review.json'), JSON.stringify({ passed: true, checks, pageErrors: errors }, null, 2) + '\n');
} catch (error) {
  writeFileSync(join(evidence, 'native-review.json'), JSON.stringify({ passed: false, checks, error: String(error), pageErrors: errors }, null, 2) + '\n');
  throw error;
} finally { await browser.close(); }
