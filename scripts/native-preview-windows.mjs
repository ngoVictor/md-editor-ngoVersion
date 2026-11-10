// Uses a temporary profile and only workspace-owned fixtures. Native IO/renderer are real.
import { chromium, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve(process.argv[2]), evidence = resolve(process.env.MD_EDITOR_TEST_EVIDENCE_DIR || 'test-results/native-evidence/preview');
if (!root.startsWith(resolve('test-results/native-preview-'))) throw Error('Unsafe fixture root');
mkdirSync(evidence,{recursive:true});
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts()[0].pages()[0]; const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const invoke = (command,args) => page.evaluate(({command,args}) => window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
try {
  await expect(page.locator('#file-title')).toContainText('index.md');
  await page.selectOption('#lang-select','zh-CN');
  await expect(page.locator('#export-format option')).toHaveCount(4);
  await expect(page.locator('#toolbar #btn-export')).toHaveCount(0);
  for (const mode of ['wysiwyg','ir','sv']) {
    if(mode !== 'wysiwyg') await page.selectOption('#btn-mode',mode);
    const container = mode === 'sv' ? '.vditor-preview' : `.vditor-${mode}`;
    const link = mode === 'ir' ? `${container} span[data-type="a"]` : `${container} a`;
    await page.locator(link).first().click();
    await expect(page.locator('#file-title')).toContainText('README.md');
    const heading = page.locator(`${container} h2`).filter({hasText:'目标标题'});
    await expect(heading).toBeVisible();
    await expect.poll(()=>heading.evaluate(el=>el.getBoundingClientRect().top-el.closest('.vditor-preview, pre.vditor-reset').getBoundingClientRect().top)).toBeLessThan(100);
    checks.push(`${mode}: actual ../README.md opens in the editor and reaches its heading`);
    if(mode !== 'sv') { await page.locator(link).first().click(); await expect(page.locator('#file-title')).toContainText('index.md'); }
  }
  await page.selectOption('#btn-mode','wysiwyg');
  await expect(page.locator('.vditor-wysiwyg table')).toBeVisible();
  await page.locator('.vditor-wysiwyg pre.vditor-reset').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:join(evidence,'unified-export-native.png')});
  // Replace only the save dialog, not the conversion or Rust sink.
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = (input, options) => {
      if(decodeURIComponent(String(input)).includes('ipc.localhost/plugin:dialog|save')) {
        return Promise.resolve(new Response(JSON.stringify(window.__exportDestination), {headers:{'Content-Type':'application/json','Tauri-Response':'ok'}}));
      }
      return original(input, options);
    };
  });
  for(const format of ['html-styled','html-plain','docx','pdf']) {
    const ext = format.startsWith('html')?'html':format, destination=join(evidence,`sample-${format}.${ext}`);
    await page.evaluate(path=>window.__exportDestination=path,destination);
    await page.selectOption('#export-format',format);await page.click('#btn-export');
    await expect(page.locator('#error-modal')).toBeVisible({timeout:format==='pdf'?140000:15000});
    await expect(page.locator('#error-modal')).toContainText('导出成功');
    const bytes=readFileSync(destination);
    if(ext==='pdf') { expect(bytes.subarray(0,5).toString()).toBe('%PDF-'); expect(bytes.length).toBeGreaterThan(3000); }
    else if(ext==='docx') expect(bytes.subarray(0,2).toString()).toBe('PK');
    else {expect(bytes.toString()).toContain('统一导出与链接验证');expect(bytes.toString().includes('<style>')).toBe(format==='html-styled');}
    await page.locator('#error-modal button').click();await expect(page.locator('#btn-export')).toBeEnabled();
    checks.push(`${format}: single export button produces a real ${ext} file without changing Markdown`);
  }
  const before=readFileSync(join(root,'README.md'),'utf8');
  const rejected=await invoke('render_pdf',{path:join(root,'README.md'),html:'<p>must not overwrite</p>'}).then(()=>'',String);
  expect(rejected).toContain('requires .pdf');expect(readFileSync(join(root,'README.md'),'utf8')).toBe(before);
  checks.push('Native PDF rejects a Markdown destination without overwriting');
  await expect.poll(() => invoke('plugin:window|get_all_windows')).toEqual(['main']);
  checks.push('WebView2 print window is destroyed after successful export');
  const sourceBefore=readFileSync(join(root,'main.ts'),'utf8');
  const context=browser.contexts()[0];
  const firstEvent=context.waitForEvent('page');
  await page.locator('.vditor-wysiwyg a').filter({hasText:'源码'}).click();
  const first=await firstEvent;
  await expect(first.locator('.source-selected')).toHaveText('// source line 1094');
  await expect(page.locator('#source-preview')).toHaveCount(0);
  const secondEvent=context.waitForEvent('page');
  await page.locator('.vditor-wysiwyg a').filter({hasText:'源码'}).click();
  const second=await secondEvent;
  await expect(second.locator('.source-selected')).toHaveText('// source line 1094');
  await second.fill('#source-line','1400');await second.click('#source-go');
  await expect(second.locator('.source-selected')).toHaveText('// source line 1400');
  await expect(first.locator('.source-selected')).toHaveText('// source line 1094');
  checks.push('Two independent native preview windows keep separate reading positions');
  const thirdEvent=context.waitForEvent('page');
  await invoke('open_source_preview',{request:{path:join(root,'script.ps1'),line:1,column:1,initialError:'',lang:'zh-CN'}});
  const third=await thirdEvent;await expect(third.locator('.source-selected')).toHaveText('Write-Output DO_NOT_EXECUTE');
  await expect(first.locator('.source-selected')).toHaveText('// source line 1094');await expect(second.locator('.source-selected')).toHaveText('// source line 1400');
  await third.click('#source-close');await expect.poll(()=>third.isClosed()).toBe(true);
  checks.push('Three simultaneous previews of different files and positions remain isolated');
  await page.click('#btn-new');
  const editor=page.locator('.vditor-wysiwyg pre.vditor-reset');
  await editor.click();await page.keyboard.type('preview remains open while Markdown is editable');
  await expect(editor).toContainText('preview remains open while Markdown is editable');
  await expect(first.locator('.source-selected')).toHaveText('// source line 1094');
  checks.push('Source editor remains interactive and editable with two previews open and no modal backdrop');
  const windowProbe=JSON.parse(execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/probe-preview-windows.ps1','-AppProcessId',process.argv[3]],{encoding:'utf8',windowsHide:true}));
  expect(windowProbe.length).toBe(2);
  for(const result of windowProbe) {expect(result.Owner).toBe(0);expect(result.Topmost).toBe(false);expect(result.Caption).toBe(true);expect(result.Resizable).toBe(true);expect(result.Moved).toBe(true);expect(result.Resized).toBe(true);}
  writeFileSync(join(evidence,'native-window-properties.json'),JSON.stringify(windowProbe,null,2));
  checks.push('Both previews are ownerless, non-topmost OS windows with captions; moving outside editor bounds and resizing succeeds');
  await first.screenshot({path:join(evidence,'preview-first.png')});await second.screenshot({path:join(evidence,'preview-second.png')});await page.screenshot({path:join(evidence,'editor-while-previews-open.png')});
  await first.keyboard.press('Control+s');expect(readFileSync(join(root,'main.ts'),'utf8')).toBe(sourceBefore);
  await first.click('#source-close');await expect.poll(()=>first.isClosed()).toBe(true);
  await expect(second.locator('.source-selected')).toHaveText('// source line 1400');
  await second.click('#source-close');await expect.poll(()=>second.isClosed()).toBe(true);
  checks.push('Ctrl+S never writes the source; closing one preview leaves the other unchanged');
  for(const [name,kind] of [['main.ts','source'],['script.ps1','source'],['test.pdf','external'],['doc','directory']]) {
    expect((await invoke('inspect_link_resource',{path:join(root,name)})).kind).toBe(kind);
  }
  expect(await invoke('open_link_resource',{path:join(root,'script.ps1')}).then(()=>'',String)).toContain('Source files');
  expect(await invoke('open_link_resource',{path:join(root,'blocked.exe')}).then(()=>'',String)).toContain('Unsupported');
  checks.push('Native policy routes PDF/directories and prevents scripts or executables from default-application execution');
  // Denied destination must also clean up its hidden print window and preserve existing data.
  const blocked=join(root,'directory.pdf');mkdirSync(blocked);
  expect(await invoke('render_pdf',{path:blocked,html:'<!doctype html><meta charset="utf-8"><p>拒绝覆盖目录</p>'}).then(()=>'',String)).not.toBe('');
  await expect.poll(() => invoke('plugin:window|get_all_windows')).toEqual(['main']);
  checks.push('PDF commit failure destroys its print window and leaves the destination directory intact');
  // Closing the last editor must not close an independent preview. A new launch opens an editor, never routes to preview.
  const survivorEvent=context.waitForEvent('page');
  await invoke('open_source_preview',{request:{path:join(root,'main.ts'),line:24,column:1,initialError:'',lang:'zh-CN'}});
  const survivor=await survivorEvent;await expect(survivor.locator('.source-selected')).toHaveText('// source line 24');
  await invoke('plugin:window|destroy').catch(()=>{});await expect.poll(()=>page.isClosed()).toBe(true);
  await expect(survivor.locator('.source-selected')).toHaveText('// source line 24');
  const reopenedEvent=context.waitForEvent('page');
  execFileSync(resolve('src-tauri/target/release/md-editor.exe'),[join(root,'doc/index.md')],{windowsHide:true,timeout:15000});
  const reopened=await reopenedEvent;await expect(reopened.locator('#file-title')).toHaveText('index.md');
  await expect(survivor.locator('.source-selected')).toHaveText('// source line 24');
  checks.push('Preview survives editor closure; a subsequent file launch creates an editor instead of targeting preview');
  await survivor.click('#source-close');
  expect(errors).toEqual([]);writeFileSync(join(evidence,'native-results.json'),JSON.stringify({checks,errors},null,2));
  console.log(JSON.stringify({checks,errors},null,2));
} finally { await browser.close(); }
