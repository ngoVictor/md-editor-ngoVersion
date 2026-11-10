// Run against a release exe started with an isolated WebView2 profile and a leased CDP port.
import { chromium, expect } from '@playwright/test';
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { spawn } from 'node:child_process';
const root = resolve(process.argv[2]), evidence = resolve(process.env.MD_EDITOR_TEST_EVIDENCE_DIR || 'test-results/native-evidence/windows');
if (!root.startsWith(resolve('test-results/native-window-'))) throw Error('Unsafe fixture root');
const exe = resolve('src-tauri/target/release/md-editor.exe');
const checks = [], errors = [];
const browser = await chromium.connectOverCDP('http://127.0.0.1:' + (process.env.MD_EDITOR_TEST_CDP_PORT || '9223'));
const context = browser.contexts()[0];
const main = context.pages()[0];
const invoke = (page, command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
async function destroy(page) {
  const closed = page.waitForEvent('close');
  await invoke(page, 'plugin:window|destroy').catch(error => { if (!String(error).includes('closed')) throw error; });
  await closed;
}
const watch = page => page.on('pageerror', e => errors.push(e.message)); watch(main); context.on('page', watch);
async function replace(page, query, replacement) {
  await page.click('#btn-find'); await page.fill('#find-query', query); await page.fill('#find-replacement', replacement);
  await page.click('#find-run'); await expect(page.locator('#find-status')).toHaveText('1 / 1');
  await page.click('#replace-all'); await page.click('#find-close');
}
async function detach(page) {
  const next = context.waitForEvent('page', { timeout: 25000 });
  const box = await page.locator('.tab.active .tab-name').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(-30, box.y + box.height / 2, { steps: 12 }); await page.mouse.up();
  const child = await next;
  await expect(child.locator('#file-title')).toContainText('●', { timeout: 25000 });
  await expect(child.locator('#btn-new')).not.toHaveAttribute('inert', '');
  await expect.poll(() => child.evaluate(() => document.querySelector('#toolbar')?.inert ?? document.body.children[0].inert)).toBe(false);
  return child;
}
try {
  await expect(main.locator('#file-title')).toContainText('native-table.md');
  await expect(main.locator('.tab')).toHaveCount(2);
  await main.selectOption('#lang-select', 'zh-CN');
  const table = main.locator('.vditor-wysiwyg table').first();
  const scroll = await table.evaluate(el => { el.scrollLeft = el.scrollWidth; return { left: el.scrollLeft, max: el.scrollWidth - el.clientWidth }; });
  expect(scroll.left).toBeGreaterThan(0); expect(scroll.left).toBe(scroll.max);
  await main.screenshot({ path: join(evidence, 'native-table-scroll.png') });
  checks.push('Release WebView2 table scroll reaches the rightmost content');
  // Exercise the native handoff rollback and caller authorization, without moving a source tab.
  const pendingPage = context.waitForEvent('page');
  const label = await invoke(main, 'prepare_tab_window', { payload: {
    doc: { id:'probe', path:null, pathKey:null, name:'cancel-probe', content:'probe', savedContent:'probe', dirty:false, revision:0, saveState:'idle', encoding:'', mtimeMs:null, size:null, fingerprint:null, loadState:'ready', externalChange:null, saveError:null, pendingInput:false, scrollTop:0, previewScrollTop:0 },
    history: {undo:[], redo:[]}, mode:'wysiwyg'
  } });
  const pending = await pendingPage;
  await expect.poll(() => invoke(main, 'tab_transfer_status', {label})).toBe(true);
  expect(await invoke(pending, 'tab_transfer_status', {label}).then(() => '', String)).toContain('Wrong source');
  const aborted = pending.waitForEvent('close'); await invoke(main, 'abort_tab_window', {label}); await aborted;
  await expect(main.locator('.tab')).toHaveCount(2);
  checks.push('Native pending transfer can be aborted; another window cannot commit or inspect source state');
  const html = '<!doctype html><meta charset="UTF-8"><table><tr><td>原生 HTML 写盘</td></tr></table>';
  const htmlPath = join(root, 'native-export.html');
  await invoke(main, 'save_html', {path: htmlPath, html}); expect(readFileSync(htmlPath, 'utf8')).toBe(html);
  expect(await invoke(main, 'save_html', {path: join(root, 'remaining.md'), html}).then(() => '', String)).toContain('requires');
  expect(readFileSync(join(root, 'remaining.md'), 'utf8')).toBe('# Remaining');
  checks.push('HTML native atomic sink writes UTF-8 and rejects Markdown destinations');

  await replace(main, 'alpha', 'unsaved-transfer');
  const child = await detach(main);
  await expect(main.locator('.tab')).toHaveCount(1);
  await expect(child.locator('.tab')).toHaveCount(1);
  await expect(child.locator('#editor')).toContainText('unsaved-transfer');
  await child.locator('[data-type="alei-undo"]').click(); await expect(child.locator('#file-title')).not.toContainText('●');
  await expect(child.locator('#editor')).toContainText('alpha');
  await child.locator('[data-type="alei-redo"]').click(); await expect(child.locator('#file-title')).toContainText('●');
  checks.push('Real pointer drag creates a second window; unsaved content and undo/redo survive');
  // Cross-window baseline still rejects an external write, without saving the transferred dirty content.
  const path = join(root, 'native-table.md'), baseline = await invoke(child, 'file_stat', { path });
  const original = readFileSync(path, 'utf8'); writeFileSync(path, original + '\nexternal\n');
  const conflict = await invoke(child, 'save_file', { path, content: 'must-not-write', allowEmpty: false, expectedFingerprint: baseline[3], force: false }).then(() => '', String);
  expect(conflict).toContain('FILE_CHANGED:'); expect(readFileSync(path, 'utf8')).toContain('external');
  writeFileSync(path, original); // Restore only this test fixture before exercising the normal Save button.
  await child.click('#btn-save'); await expect.poll(() => readFileSync(path, 'utf8')).toContain('unsaved-transfer');
  await expect(child.locator('#file-title')).not.toContainText('●');
  checks.push('Transferred file uses real save IPC and preserves compare-and-save protection');
  const savedSession = await main.evaluate(() => localStorage.getItem('alei-editor.session.v1'));
  await expect(child.locator('#pref-session')).toBeDisabled();
  expect(await child.evaluate(() => localStorage.getItem('alei-editor.session.v1'))).toBe(savedSession);
  // A second process must route to main only while two windows exist.
  spawn(exe, [join(root, 'forwarded.md')], { windowsHide: true, stdio: 'ignore' });
  await expect(main.locator('#file-title')).toContainText('forwarded.md'); await expect(child.locator('.tab')).toHaveCount(1);
  await destroy(main);
  await expect.poll(() => main.isClosed()).toBe(true);
  spawn(exe, [join(root, 'remaining.md')], { windowsHide: true, stdio: 'ignore' });
  await expect(child.locator('#file-title')).toContainText('remaining.md');
  checks.push('Single-instance forwarding targets one window; detached window survives closing main');
  await child.click('#btn-new'); const editor = child.locator('.vditor-wysiwyg .vditor-reset');
  await editor.click(); await child.keyboard.insertText('unsaved draft');
  await expect(child.locator('#file-title')).toContainText('●');
  const draft = await detach(child);
  await expect(draft.locator('#editor')).toContainText('unsaved draft');
  await draft.screenshot({ path: join(evidence, 'native-detached-draft.png') });
  await draft.locator('.tab-close').click(); await expect(draft.locator('#close-confirm')).toBeVisible(); await draft.click('#cc-cancel');
  await expect(draft.locator('#editor')).toContainText('unsaved draft');
  await draft.locator('.tab-close').click(); await draft.click('#cc-discard');
  await expect(draft.locator('.tab')).toHaveCount(0);
  await destroy(draft); await destroy(child);
  checks.push('Detached window can detach an untitled draft; cancel/discard remain safe');
  expect(errors).toEqual([]);
  writeFileSync(join(evidence, 'native-windows.json'), JSON.stringify({ passed: true, checks, pageErrors: errors }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, checks }));
} catch (error) {
  writeFileSync(join(evidence, 'native-windows.json'), JSON.stringify({ passed: false, checks, error: String(error), pageErrors: errors }, null, 2) + '\n');
  for (const page of context.pages()) if (!page.isClosed()) await page.screenshot({ path: join(evidence, `failure-${context.pages().indexOf(page)}.png`) }).catch(() => {});
  throw error;
} finally { await browser.close(); }
