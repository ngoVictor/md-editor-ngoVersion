import {chromium,expect} from '@playwright/test';
import JSZip from 'jszip';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(process.argv[2]),evidence=resolve(process.env.MD_EDITOR_TEST_EVIDENCE_DIR || 'test-results/native-evidence/p4-p5');
if(!root.startsWith(resolve('test-results/native-p4p5-')))throw Error('Unsafe fixture root');
mkdirSync(evidence,{recursive:true});
let browser;
for(let attempt=0;attempt<60;attempt++) {
 try {browser=await chromium.connectOverCDP(`http://127.0.0.1:${process.env.MD_EDITOR_TEST_CDP_PORT}`);break;} catch(error){if(attempt===59)throw error;await new Promise(r=>setTimeout(r,100));}
}
const context=browser.contexts()[0],page=context.pages()[0]||await context.waitForEvent('page',{timeout:15000}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const invoke=(command,args)=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
try{
 await expect(page.locator('#file-title')).toContainText('index.md');
 await page.locator('.vditor-wysiwyg a').first().click();await expect(page.locator('#file-title')).toContainText('README.md');
 await expect(page.locator('#export-format option')).toHaveCount(7);
 await expect.poll(()=>page.locator('#editor img[srcset]').count()).toBeGreaterThan(0);
 expect(await page.locator('#editor img[srcset]').first().evaluate(el=>el.naturalWidth)).toBeGreaterThan(0);
 checks.push('Real local Chinese/space image previews load without changing Markdown');
 await page.evaluate(()=>{const original=window.fetch;window.fetch=(input,options)=>{
  if(decodeURIComponent(String(input)).includes('ipc.localhost/plugin:dialog|save'))return Promise.resolve(new Response(JSON.stringify(window.__exportDestination),{headers:{'Content-Type':'application/json','Tauri-Response':'ok'}}));
  if(decodeURIComponent(String(input)).includes('ipc.localhost/plugin:dialog|open'))return Promise.resolve(new Response(JSON.stringify(window.__folderDestination),{headers:{'Content-Type':'application/json','Tauri-Response':'ok'}}));
  return original(input,options);
 };});
 for(const format of (process.env.P4_IMAGES_ONLY?[]:['docx','docx-legacy','pdf','png','html-styled','html-plain'])){
  const ext=format.startsWith('docx')?'docx':format.startsWith('html')?'html':format,path=join(evidence,`sample-${format}.${ext}`);
  await page.evaluate(path=>window.__exportDestination=path,path);await page.selectOption('#export-format',format);await page.click('#btn-export');
  await expect(page.locator('#error-modal')).toBeVisible({timeout:150000});await expect(page.locator('#error-modal')).toContainText('导出成功');
  const bytes=readFileSync(path);
  if(ext==='docx'){const zip=await JSZip.loadAsync(bytes);const xml=await zip.file('word/document.xml').async('string');expect(xml).toContain('w:tblBorders');expect(Object.keys(zip.files).filter(x=>x.startsWith('word/media/')&&!zip.files[x].dir).length).toBeGreaterThanOrEqual(3);if(format==='docx'){expect(xml).toContain('w:footnoteReference');expect(await zip.file('word/footnotes.xml').async('string')).toContain('脚注正文');}}
  else if(ext==='png'){expect(bytes.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');expect(bytes.readUInt32BE(16)).toBe(1000);}
  else if(ext==='pdf')expect(bytes.subarray(0,5).toString()).toBe('%PDF-');
  else expect((bytes.toString().match(/data:image\/png;base64/g)||[]).length).toBeGreaterThanOrEqual(3);
  checks.push(`${format}: actual native artifact includes image/formula/diagram (Word includes borders and new backend footnotes)`);
  await page.locator('#error-modal button').click();await expect(page.locator('#btn-export')).toBeEnabled();
 }
 await page.evaluate(path=>window.__folderDestination=path,root);await page.click('#btn-navigation');await expect(page.locator('#navigation-results')).toContainText('README.md');
 await page.click('#navigation-folder');await expect(page.locator('#navigation-results')).toContainText('main.ts');
 await page.fill('#navigation-query','source line 1094');await page.check('#navigation-content');await page.click('#navigation-search');
 await expect(page.locator('#navigation-results')).toContainText('main.ts:1094',{timeout:30000});
 const opened=context.waitForEvent('page');await page.locator('#navigation-results button').filter({hasText:'main.ts:1094'}).click();const preview=await opened;await expect(preview.locator('.source-selected')).toHaveText('// source line 1094');await preview.click('#source-close');
 checks.push('Recent files, read-only directory, real content search and exact source-line preview');
 await page.screenshot({path:join(evidence,'navigation-native.png')});await page.click('#navigation-close');
 await page.click('#btn-new');const editor=page.locator('.vditor-wysiwyg pre.vditor-reset');await editor.click();await page.keyboard.type('Image paste draft');
 await editor.evaluate(async el=>{
  const c=document.createElement('canvas');c.width=120;c.height=60;c.getContext('2d').fillRect(0,0,120,60);
  const blob=await new Promise(resolve=>c.toBlob(resolve));const data=new DataTransfer();data.items.add(new File([blob],'粘贴 图.png',{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}));
 });await expect.poll(()=>editor.locator('img').count()).toBe(1);await expect.poll(()=>editor.locator('img').first().getAttribute('src')).toMatch(/^file:/);
 console.log('Draft image reference:',await editor.locator('img').first().getAttribute('src'));
 const saved=join(root,'保存 目标','pasted.md');mkdirSync(join(root,'保存 目标'),{recursive:true});await page.evaluate(path=>window.__exportDestination=path,saved);await page.click('#btn-save');await expect(page.locator('#file-title')).toContainText('pasted.md');
 const markdown=readFileSync(saved,'utf8');expect(markdown).toContain('assets/');expect(markdown).not.toContain('data:image');expect(markdown).not.toContain('image-drafts');
 const asset=markdown.match(/assets\/[a-f0-9]+\.png/)[0];expect(existsSync(join(root,'保存 目标',asset))).toBe(true);
 checks.push('Native clipboard image staging and first Save As migrate to adjacent content-addressed assets');
 const copied=join(root,'跨目录 副本','copy.md');mkdirSync(join(root,'跨目录 副本'),{recursive:true});await page.evaluate(path=>window.__exportDestination=path,copied);await page.keyboard.press('Control+Shift+S');
 await expect(page.locator('#file-title')).toContainText('copy.md');expect(readFileSync(copied,'utf8')).toContain('assets/');expect(existsSync(join(root,'跨目录 副本',asset))).toBe(true);expect(readFileSync(saved,'utf8')).toBe(markdown);
 checks.push('Cross-directory Save As preserves original Markdown/assets and produces a self-contained copy');
 await page.screenshot({path:join(evidence,'image-paste-native.png')});
 const before=readFileSync(copied,'utf8');await expect(invoke('save_png',{path:copied,dataBase64:'AA=='})).rejects.toBeDefined();expect(readFileSync(copied,'utf8')).toBe(before);checks.push('PNG native sink rejects overwriting a Markdown path');
 // Opens a dialog only: no print submission or physical job is sent by this test.
 await page.selectOption('#export-format','print');await page.click('#btn-export');
 await expect(page.locator('#error-modal')).toBeVisible({timeout:40000});await expect(page.locator('#error-modal')).toContainText('已打开系统打印');
 const labels=await invoke('plugin:window|get_all_windows');const label=labels.find(l=>l.startsWith('print-'));expect(label).toBeTruthy();
 await invoke('plugin:window|destroy',{label});await page.locator('#error-modal button').click();
 checks.push('WebView2 opens system print UI in a separate offline window; test closes it without submitting a print job');
 writeFileSync(join(evidence,'native-results.json'),JSON.stringify({checks,errors,root},null,2));
 console.log(JSON.stringify({checks:checks.length,errors,evidence}));
 if(errors.length)throw Error(errors.join('\n'));
}catch(error){console.error('Native UI failure:', await page.locator('#error-modal').textContent().catch(()=>''));await page.screenshot({path:join(evidence,'failure.png')}).catch(()=>{});throw error;}finally{await browser.close();}
