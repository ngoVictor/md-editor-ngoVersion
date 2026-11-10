import {test,expect} from '@playwright/test';
test('精简后 KaTeX 本地 WOFF2 字体可解码，公式与化学式离线显示',async({page})=>{
 const failures:string[]=[],fonts:string[]=[];
 page.on('response',r=>{if(r.url().includes('/vditor-assets/')&&r.status()>=400)failures.push(r.url());});
 page.on('request',r=>{if(r.resourceType()==='font')fonts.push(r.url());});
 await page.goto('/');await page.waitForSelector('#editor .vditor-wysiwyg');
 await page.evaluate(async()=>{
  const docs=await import('/src/docs.ts');
  docs.openDoc(null,'# 离线公式\n\n$$\n\\sum_{i=1}^n \\frac{\\alpha_i}{\\sqrt{x}} + \\mathbb{R} + \\mathbf{A} + \\mathcal{F}\n$$\n\n$\\ce{H2O}$\n','math');
  (await import('/src/vditor.ts')).rebuildVditor('sv');
 });
 await expect(page.locator('.vditor-preview .katex').first()).toBeVisible();
 const loaded=await page.evaluate(async()=>{
  await document.fonts.ready;
  return [...document.fonts].filter(f=>f.family.startsWith('KaTeX')&&f.status==='loaded').map(f=>f.family);
 });
 expect(loaded.length).toBeGreaterThan(2);expect(fonts.length).toBeGreaterThan(2);
 for(const url of fonts){expect(new URL(url).origin).toBe(new URL(page.url()).origin);expect(new URL(url).pathname).toMatch(/\.woff2$/);}
 expect(failures).toEqual([]);await expect(page.locator('.vditor-preview .katex-error')).toHaveCount(0);
});
