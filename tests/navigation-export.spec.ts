import { test, expect, type Page } from "@playwright/test";
async function ready(page: Page) {
  await page.goto('/'); await expect(page.locator('#file-title')).toContainText(/欢迎|Welcome/);
}
const targetContent = '# 目标文档\n\n' + '填充段落。\n\n'.repeat(60) + '## 目标标题\n\n' + '结尾。\n\n'.repeat(30);
for (const mode of ['wysiwyg', 'ir', 'sv']) {
  test(`${mode} 点击相对文件链接后打开中文空格文件并定位标题`, async ({ page }) => {
    await ready(page);
    await page.evaluate(async ({content}) => {
      const {openDoc} = await import('/src/docs.ts'), {setFileServiceForTests} = await import('/src/file-service.ts');
      (window as any).paths = [];
      setFileServiceForTests({openFile: async path => { (window as any).paths.push(path); return {content, encoding:'UTF-8', pathKey:'d:\\project\\目标 文件.md', fingerprint:'target',mtimeMs:1,size:100}; },statFile:async()=>null,saveFile:async()=>{throw Error('Unexpected save');},saveDocx:async()=>{}});
      openDoc('D:/project/doc/index.md', '[打开目标](../%E7%9B%AE%E6%A0%87%20%E6%96%87%E4%BB%B6.md#目标标题)\n\n## 目标标题\n\n旧文档也有同名标题\n', 'index.md');
    }, {content:targetContent});
    if (mode !== 'wysiwyg') await page.selectOption('#btn-mode',mode);
    const link = mode === 'ir' ? '.vditor-ir span[data-type="a"]' : mode === 'sv' ? '.vditor-preview a' : '.vditor-wysiwyg a';
    await page.locator('#editor ' + link).first().click();
    await expect(page.locator('#file-title')).toContainText('目标 文件.md');
    const heading = page.locator(mode === 'sv' ? '.vditor-preview h2' : `.vditor-${mode} h2`);
    await expect(heading).toContainText('目标标题');
    await expect.poll(() => heading.evaluate(el => el.getBoundingClientRect().top - el.closest('.vditor-preview, pre.vditor-reset')!.getBoundingClientRect().top)).toBeLessThan(100);
    expect(await page.evaluate(() => (window as any).paths)).toEqual(['D:/project/目标 文件.md']);
  });
}
test('链接分类不把相对路径当 http；文件 URL 和 Windows 路径可解析，非法协议/设备/查询被拒绝', async ({page}) => {
  await ready(page);
  const values = await page.evaluate(async () => {
    const {resolveLinkTarget:r} = await import('/src/link-target.ts');
    return ['../README.md','#目录','file:///E:/文档/示例%20a.md#标题','G:\\notes\\readme.md','javascript:alert(1)','data:text/html,test','file://server/share/a.md','C:\\a.md:ads','a.md?foo','//evil.example/a.md'].map(h => r(h,'E:/项目/doc/index.md'));
  });
  expect(values.slice(0,4)).toEqual([{kind:'document',path:'E:/项目/README.md',hash:''},{kind:'anchor',hash:'#目录'},{kind:'document',path:'E:/文档/示例 a.md',hash:'#%E6%A0%87%E9%A2%98'},{kind:'document',path:'G:/notes/readme.md',hash:''}]);
  expect(values.slice(4).every(v=>v.kind==='invalid')).toBe(true);
});
test('文件已打开且未保存时链接只激活，保留正文、基线和撤销', async ({page})=> {
  await ready(page);
  const result = await page.evaluate(async()=>{
    const docs=await import('/src/docs.ts'), sync=await import('/src/editor-sync.ts'), files=await import('/src/file-service.ts'), nav=await import('/src/document-navigation.ts'), {historyStatus}=await import('/src/history.ts');
    let reads=0; files.setFileServiceForTests({openFile:async()=>{reads++;throw Error('deleted');},statFile:async()=>null,saveFile:async()=>{throw Error('save');},saveDocx:async()=>{}});
    const target=docs.openDoc('D:/project/target.md','# Original','target.md','UTF-8',1,10,null,'original');
    sync.applyDocumentEdit(target,'# Draft'); const before=historyStatus(target);
    docs.openDoc('D:/project/index.md','# Index','index.md'); const ok=await nav.openDocumentLink('D:/project/target.md','');
    return {ok,reads,content:target.content,dirty:target.dirty,fingerprint:target.fingerprint,before,after:historyStatus(target)};
  });
  expect(result).toMatchObject({ok:true,reads:0,content:'# Draft',dirty:true,fingerprint:'original'}); expect(result.after).toEqual(result.before);
});
test('迟到的文件读取在切走再切回后不抢标签；未命中的文件错误可见', async ({page})=>{
  await ready(page);
  const result=await page.evaluate(async()=>{
    const docs=await import('/src/docs.ts'), files=await import('/src/file-service.ts'), nav=await import('/src/document-navigation.ts'), {S}=await import('/src/state.ts');
    let finish:any; files.setFileServiceForTests({openFile:()=>new Promise(resolve=>finish=resolve),statFile:async()=>null,saveFile:async()=>{throw Error('save');},saveDocx:async()=>{}});
    const source=docs.openDoc('D:/index.md','# Source','index.md');const pending=nav.openDocumentLink('D:/late.md','');
    while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
    docs.openDoc(null,'# Other','other');docs.switchDoc(source.id);finish({content:'# Late',encoding:'UTF-8',mtimeMs:1,size:4,pathKey:'d:\\late.md',fingerprint:'late'});
    return {ok:await pending,active:S.activeId,source:source.id,opened:S.docs.some(d=>d.path==='D:/late.md')};
  });expect(result.ok).toBe(false);expect(result.active).toBe(result.source);expect(result.opened).toBe(false);
  await page.evaluate(async()=>{
    const files=await import('/src/file-service.ts'), nav=await import('/src/document-navigation.ts');
    files.setFileServiceForTests({openFile:async()=>{throw Error('FILE_NOT_FOUND');},statFile:async()=>null,saveFile:async()=>{throw Error('save');},saveDocx:async()=>{}});await nav.openDocumentLink('D:/missing.md','');
  });await expect(page.locator('#error-modal')).toContainText('FILE_NOT_FOUND');
});
test('未保存文档的相对链接给出保存提示，缺失锚点给出定位提示',async({page})=>{
  await ready(page);await page.evaluate(async()=>{const{openDoc}=await import('/src/docs.ts');openDoc(null,'[文件](./a.md)\n\n[锚点](#absent)','untitled');});
  await page.locator('.vditor-wysiwyg a').first().click();await expect(page.locator('#error-modal')).toContainText(/请先保存|Save this document/);
  await page.locator('#error-modal button').click();await page.locator('.vditor-wysiwyg a').last().click();await expect(page.locator('#error-modal')).toContainText(/未找到|Heading not found/);
});
for(const format of ['html-styled','html-plain','docx','pdf']) {
  test(`统一导出按钮实际分派 ${format}，保留快照和文档身份`,async({page})=>{
    await ready(page);
    await page.evaluate(async()=>{
      const {openDoc}=await import('/src/docs.ts'), files=await import('/src/file-service.ts');
      const doc= openDoc(null,'# Unified export\n\n| A | B |\n|---|---|\n| 甲 | 乙 |\n','sample.md'); (window as any).exportDoc=doc;(window as any).written=[];
      files.setExportServiceForTests({saveHtml:async(path,html)=>{(window as any).written.push({kind:'html',path,body:html});}});
      files.setPdfServiceForTests({renderPdf:async(path,html)=>{(window as any).written.push({kind:'pdf',path,body:html});}});
      files.setFileServiceForTests({openFile:async()=>{throw Error('open');},statFile:async()=>null,saveFile:async()=>{throw Error('save');},saveDocx:async(path,body)=>{(window as any).written.push({kind:'docx',path,body});}});
      (await import('/src/export-html.ts')).setHtmlPathPickerForTests(async()=> 'D:/unified');
      (await import('/src/export-docx-token.ts')).setTokenWordPickerForTests(async()=> 'D:/unified');
      (await import('/src/export-pdf.ts')).setPdfPathPickerForTests(async()=> 'D:/unified');
    });
    await expect(page.locator('#toolbar #btn-export')).toHaveCount(0);
    await expect(page.locator('#export-format option')).toHaveCount(7);
    await page.selectOption('#export-format',format);await page.click('#btn-export');
    await expect.poll(()=>page.evaluate(()=>(window as any).written.length)).toBe(1);
    const result=await page.evaluate(()=>({written:(window as any).written[0],doc:(window as any).exportDoc}));
    const extension=format.startsWith('html')?'html':format;expect(result.written.path).toBe(`D:/unified.${extension}`);expect(result.doc.path).toBeNull();expect(result.doc.dirty).toBe(false);
    if(extension==='docx') expect(result.written.body.startsWith('UEs')).toBe(true);
    else {expect(result.written.body).toContain('Unified export');expect(result.written.body.includes('<style>')).toBe(format!=='html-plain');}
    await expect(page.locator('#btn-export')).toBeEnabled();
  });
}
test('PDF 导出期间禁用重复点击，取消恢复入口；异步导出固定原快照',async({page})=>{
  await ready(page);
  await page.evaluate(async()=>{
    const {openDoc}=await import('/src/docs.ts'), files=await import('/src/file-service.ts');
    openDoc(null,'# Captured PDF','original.md');(window as any).writes=[];
    files.setPdfServiceForTests({renderPdf:async(path,html)=>{(window as any).writes.push({path,html});}});
    (await import('/src/export-pdf.ts')).setPdfPathPickerForTests(()=>new Promise(resolve=>(window as any).finish=resolve));
  });
  await page.selectOption('#export-format','pdf');await page.click('#btn-export');await expect(page.locator('#btn-export')).toBeDisabled();await expect(page.locator('#export-format')).toBeDisabled();
  await page.evaluate(()=>(window as any).finish(null));await expect(page.locator('#btn-export')).toBeEnabled();expect(await page.evaluate(()=>(window as any).writes.length)).toBe(0);
  await page.click('#btn-export');await page.evaluate(async()=>{(await import('/src/docs.ts')).openDoc(null,'# Later document','later.md');(window as any).finish('D:/captured.pdf');});
  await expect.poll(()=>page.evaluate(()=>(window as any).writes.length)).toBe(1);const html=await page.evaluate(()=>(window as any).writes[0].html);expect(html).toContain('Captured PDF');expect(html).not.toContain('Later document');
});
