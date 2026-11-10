import { chromium, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root=resolve(process.argv[2]), evidence=resolve(process.env.MD_EDITOR_TEST_EVIDENCE_DIR || 'test-results/native-evidence/themes');
if(!root.startsWith(resolve('test-results/native-themes-')))throw Error('Unsafe fixture root');
mkdirSync(evidence,{recursive:true});
let browser;
for(let attempt=0;attempt<80;attempt++){
 try {browser=await chromium.connectOverCDP(`http://127.0.0.1:${process.env.MD_EDITOR_TEST_CDP_PORT}`);break;}catch(error){if(attempt===79)throw error;await new Promise(r=>setTimeout(r,150));}
}
const context=browser.contexts()[0],page=context.pages()[0]||await context.waitForEvent('page',{timeout:15000}),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const original=readFileSync(join(root,'theme.md'),'utf8');
try{
 await expect(page.locator('#file-title')).toContainText('theme.md');
 await page.selectOption('#lang-select','zh-CN');
 for(const theme of ['light','dark','eye','paper','claude']){
  for(const mode of ['wysiwyg','ir','sv']){
   await page.selectOption('#btn-mode',mode);
   const content=page.locator(mode==='sv'?'.vditor-preview .vditor-reset':`.vditor-${mode} .vditor-reset`).first();
   await expect(content.locator('h6')).toBeVisible();await page.selectOption('#pref-theme',theme);
   await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
   const colors=await content.evaluate(el=>[1,2,3,4,5,6].map(n=>getComputedStyle(el.querySelector(`h${n}`)).color));
   expect(new Set(colors).size).toBe(6);
   if(mode==='wysiwyg')await page.screenshot({path:join(evidence,`native-${theme}.png`)});
  }
  checks.push(`${theme}: actual WebView2 WYSIWYG/IR/SV shows six distinct heading colors`);
 }
 const waiting=context.waitForEvent('page');
 await page.evaluate(path=>window.__TAURI_INTERNALS__.invoke('open_source_preview',{request:{path,line:2,column:1,initialError:'',lang:'zh-CN'}}),join(root,'sample.ts'));
 const preview=await waiting;preview.on('pageerror',e=>errors.push(e.message));await expect(preview.locator('#source-lines')).toContainText('const value');
 await expect(preview.locator('html')).toHaveAttribute('data-theme','claude');
 await page.selectOption('#pref-theme','eye');await expect(preview.locator('html')).toHaveAttribute('data-theme','eye');
 await preview.screenshot({path:join(evidence,'native-preview-green.png')});
 checks.push('Independent native source preview inherits and live-syncs Claude Code / soft green');
 await preview.locator('button').filter({hasText:'关闭'}).click();
 await page.reload();await expect(page.locator('#pref-theme')).toHaveValue('eye');await expect(page.locator('html')).toHaveAttribute('data-theme','eye');
 checks.push('Theme preference survives native WebView reload');
 expect(readFileSync(join(root,'theme.md'),'utf8')).toBe(original);checks.push('Native theme operations do not write to the source file');
 expect(errors).toEqual([]);
 writeFileSync(join(evidence,'native-results.json'),JSON.stringify({checks,errors},null,2));
 console.log(JSON.stringify({checks:checks.length,errors,evidence}));
}finally{await browser.close();}
