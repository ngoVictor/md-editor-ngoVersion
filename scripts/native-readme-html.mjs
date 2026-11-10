// Real packaged WebView2, actual remote badges, and a disposable copy of the README.
import { chromium, expect } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2]);
const evidence = resolve(process.env.MD_EDITOR_TEST_EVIDENCE_DIR || 'test-results/native-evidence/readme-html');
mkdirSync(evidence, { recursive: true });
let browser;
for (let attempt = 0; attempt < 100; attempt++) {
  try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.MD_EDITOR_TEST_CDP_PORT}`); break; }
  catch (error) { if (attempt === 99) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
}
const page = browser.contexts()[0].pages()[0];
const original = readFileSync(join(root, 'README.md'));
const checks = [], modes = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await expect(page.locator('#file-title')).toContainText('README.md');
  await page.selectOption('#pref-theme', 'light');
  for (const mode of ['wysiwyg', 'ir', 'sv']) {
    await page.selectOption('#btn-mode', mode);
    const content = page.locator(mode === 'sv' ? '.vditor-preview .vditor-reset' : `.vditor-${mode} .vditor-reset`);
    await expect(content.locator('h1').first()).toHaveText('GPT-SoVITS-WebUI');
    await expect.poll(() => content.locator('h1').first().evaluate(el => getComputedStyle(el).textAlign)).toMatch(/^(?:-webkit-)?center$/);
    // External services can be unavailable; capture their actual status separately.
    await expect.poll(() => content.locator('img').evaluateAll(imgs => imgs.every(img => img.complete)), { timeout: 30000 }).toBe(true);
    const images = await content.locator('img').evaluateAll(imgs => imgs.map(img => ({ alt: img.alt, loaded: img.naturalWidth > 0, src: img.getAttribute('src') })));
    const python = await content.locator('img[alt="Python"]').boundingBox();
    const release = await content.locator('img[alt="GitHub release"]').boundingBox();
    const rowWidth = await content.locator('img[alt="Python"]').evaluate(img => img.closest('p').getBoundingClientRect().width);
    const fitsRow = python.width + release.width + 8 <= rowWidth;
    const sameRow = Math.abs(python.y - release.y) < 2;
    // A narrow split-view pane may naturally wrap real badges onto separate lines.
    if (fitsRow) expect(sameRow).toBe(true);
    modes.push({ mode, images, fitsRow, sameRow });
    await page.screenshot({ path: join(evidence, `native-${mode}.png`) });
    await expect(page.locator('#file-title')).toHaveText('README.md');
    checks.push(`${mode}: HTML title centered and document remains clean`);
  }
  const beforeSave = statSync(join(root, 'README.md')).mtimeMs;
  await page.locator('#btn-save').click();
  await expect.poll(() => statSync(join(root, 'README.md')).mtimeMs).not.toBe(beforeSave);
  expect(readFileSync(join(root, 'README.md')).equals(original)).toBe(true);
  checks.push('Mode switches and explicit save retain original file bytes');
  expect(errors).toEqual([]);
  writeFileSync(join(evidence, 'native-results.json'), JSON.stringify({ checks, modes, errors }, null, 2));
  console.log(JSON.stringify({ checks, imageStatus: modes.map(({ mode, images, fitsRow, sameRow }) => ({ mode, loaded: images.filter(img => img.loaded).length, total: images.length, fitsRow, sameRow })), evidence }, null, 2));
} finally { await browser.close(); }
