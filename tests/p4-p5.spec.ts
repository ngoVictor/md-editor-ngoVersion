import {test,expect} from '@playwright/test';
import JSZip from 'jszip';
async function ready(page:any){await page.goto('/');await page.waitForSelector('#editor .vditor-wysiwyg');await page.waitForFunction(async()=>!(await import('/src/state.ts')).S.switchInFlight);}

test('图片迁移只改真实图片和引用定义，保留代码、CRLF、标题和其他字节',async({page})=>{
 await ready(page);const result=await page.evaluate(async()=>{
  const {rewriteImageReferences}=await import('/src/image-references.ts');
  const source='# 中文\r\n\r\n![A](<图 片.png> "标题")\r\n\r\n`![code](a.png)`\r\n\r\n```md\r\n![code](a.png)\r\n```\r\n\r\n![ref][x]\r\n\r\n[x]: image.png\r\n';
  return rewriteImageReferences(source,u=>'assets/'+encodeURIComponent(u));
 });expect(result).toContain('![A](assets/%E5%9B%BE%20%E7%89%87.png "标题")');expect(result).toContain('`![code](a.png)`');expect(result).toContain('```md\r\n![code](a.png)');expect(result).toContain('[x]: <assets/image.png>');
});

for(const mode of ['wysiwyg','ir','sv'])test(`${mode} 本地预览不把 data/srcset 写入正文或 dirty`,async({page})=>{
 await ready(page);await page.evaluate(async mode=>{
  const files=await import('/src/file-service.ts'),docs=await import('/src/docs.ts');const c=document.createElement('canvas');c.width=80;c.height=40;c.getContext('2d')!.fillRect(0,0,80,40);files.setAssetServiceForTests({readImage:async()=>c.toDataURL()});
  docs.openDoc('D:/中文/doc.md','![图](a.png)\n','image.md');
  if(mode!=='wysiwyg') (await import('/src/vditor.ts')).rebuildVditor(mode);
 },mode);
 await expect.poll(()=>page.locator('#editor img[srcset]').count()).toBeGreaterThan(0);
 const result=await page.evaluate(async()=>{const {activeDoc,S}=await import('/src/state.ts'),{syncDocFromEditor}=await import('/src/editor-sync.ts');const doc=activeDoc()!;syncDocFromEditor(doc);return{content:doc.content,dirty:doc.dirty,value:S.vditor!.getValue(),images:[...document.querySelectorAll<HTMLImageElement>('#editor img[srcset]')].map(x=>x.naturalWidth)};});
 expect(result.content).toBe('![图](a.png)\n');expect(result.dirty).toBe(false);expect(result.value).not.toContain('data:image');expect(result.value).not.toContain('srcset');expect(result.images).toContain(80);
});

for(const outcome of ['success','failure','late-edit'])test(`Save As 图片迁移 ${outcome} 保留身份、草稿与撤销语义`,async({page})=>{
 await ready(page);const result=await page.evaluate(async outcome=>{
  const files=await import('/src/file-service.ts'),docs=await import('/src/docs.ts'),sync=await import('/src/editor-sync.ts'),save=await import('/src/save.ts'),{activeDoc}=await import('/src/state.ts'),history=await import('/src/history.ts');
  docs.openDoc('D:/old/a.md','![old](before.png)\n','a.md');const doc=activeDoc()!;sync.applyDocumentEdit(doc,'![new](image.png)\n');
  files.setAssetServiceForTests({readImage:async()=> 'data:image/png;base64,fixture'});files.setImageStoreForTests({store:async()=> 'assets/hash.png'});
  save.setSavePathPickerForTests(async()=> 'D:/new/b.md');let written='';
  files.setFileServiceForTests({openFile:async()=>{throw Error('unexpected');},statFile:async()=>null,saveDocx:async()=>{},saveFile:async request=>{written=request.content;if(outcome==='failure')throw Error('denied');if(outcome==='late-edit')sync.applyDocumentEdit(doc,'![late](late.png)\n');return{pathKey:'d:\\new\\b.md',mtimeMs:1,size:written.length,fingerprint:'new'};}});
  const ok=await save.saveDoc(doc,true);return{ok,written,path:doc.path,content:doc.content,dirty:doc.dirty,undo:history.exportHistory(doc).undo};
 },outcome);
 expect(result.written).toContain('assets/hash.png');
 if(outcome==='success'){expect(result.ok).toBe(true);expect(result.path).toBe('D:/new/b.md');expect(result.dirty).toBe(false);expect(result.undo.join('')).toContain('file:///D:/old/before.png');}
 else{expect(result.ok).toBe(false);expect(result.path).toBe('D:/old/a.md');expect(result.dirty).toBe(true);expect(result.content).toContain(outcome==='late-edit'?'late.png':'image.png');}
});

test('目录搜索取消后拒绝迟到结果，数量有界且不读二进制',async({page})=>{
 await ready(page);const result=await page.evaluate(async()=>{
  const files=await import('/src/file-service.ts'),{searchDirectory}=await import('/src/directory-search.ts');let release:any;
  files.setNavigationServiceForTests({list:async()=>new Promise(resolve=>release=resolve)});const controller=new AbortController(),hits:any[]=[];
  const pending=searchDirectory('D:/docs','query',true,controller.signal,h=>hits.push(h)).catch(e=>e.name);
  controller.abort();release({entries:[{name:'query.md',path:'D:/docs/query.md',directory:false}],truncated:false});return{error:await pending,hits};
 });expect(result).toEqual({error:'AbortError',hits:[]});
});

test('Word token 输出嵌套编号、脚注、表格边框与 A4 列宽',async({page})=>{
 await ready(page);const bytes=await page.evaluate(async()=>{
  const {tokensToDocx}=await import('/src/docx-tokens.ts');const md='# 中文标题\n\n正文[^one]  **粗体**\n\n3. 第一项\n   1. 内层\n   2. 内层二\n4. 第二项\n\n> 引用段落\n\n| 维度 | 结果 | 证据 |\n|---|---|---|\n| 循环依赖 | 通过 | 完整证据 |\n\n```ts\nconst text = "高亮";\n```\n\n[^one]: 脚注正文\n';const b=await tokensToDocx(md,new Map());return Array.from(new Uint8Array(await b.arrayBuffer()));
 });const zip=await JSZip.loadAsync(Uint8Array.from(bytes)),xml=await zip.file('word/document.xml')!.async('string'),numbering=await zip.file('word/numbering.xml')!.async('string');
 expect(xml).toContain('w:footnoteReference');expect(await zip.file('word/footnotes.xml')!.async('string')).toContain('脚注正文');expect(xml).toContain('w:tblBorders');expect(xml).toContain('Microsoft YaHei');expect(numbering).toContain('%2.');expect(numbering).toContain('w:start w:val="3"');expect([...xml.matchAll(/<w:gridCol w:w="(\d+)"/g)].reduce((n,m)=>n+Number(m[1]),0)).toBe(8306);
});

test('离线公式和 Mermaid 生成真实图片且不改变原始 Markdown',async({page})=>{
 test.setTimeout(60000);await ready(page);const result=await page.evaluate(async()=>{
  const {specialMarkdown}=await import('/src/export-specials.ts');return specialMarkdown('# 公式\n\n$x^2+y^2=z^2$\n\n```mermaid\ngraph LR\n A[开始] --> B[完成]\n```\n');
 });expect(result.issues).toEqual([]);expect((result.markdown.match(/data:image\/png;base64/g)||[]).length).toBe(2);
});

test('PNG 输出真实像素，超长文档拒绝分配巨型画布',async({page})=>{
 test.setTimeout(60000);await ready(page);const result=await page.evaluate(async()=>{
  const {renderHtmlPng}=await import('/src/export-png.ts'),{buildHtmlExport}=await import('/src/html-export.ts'),{rasterSize}=await import('/src/raster-image.ts');
  const png=await renderHtmlPng(buildHtmlExport('<h1>PNG 导出</h1><table><tr><th>表头</th><td>右侧内容</td></tr></table>','PNG',true).html);
  let error='';try{await renderHtmlPng('<html><body><div style="height:17000px">Too long</div></body></html>');}catch(e){error=String(e);}
  return{size:rasterSize('data:image/png;base64,'+png),error,frames:document.querySelectorAll('iframe').length};
 });expect(result.size.width).toBe(1000);expect(result.size.height).toBeGreaterThan(100);expect(result.error).toContain('1600');expect(result.frames).toBe(0);
});

for(const mode of ['wysiwyg','ir','sv'])test(`${mode} 未命名图片粘贴保留完整 URI，单步撤销`,async({page})=>{
 await ready(page);await page.evaluate(async mode=>{
  const files=await import('/src/file-service.ts'),{openDoc}=await import('/src/docs.ts');openDoc(null,'before\n','paste');
  files.setImageStoreForTests({store:async()=> 'file:///C:/drafts/abc.png'});
  const c=document.createElement('canvas');c.width=20;c.height=10;files.setAssetServiceForTests({readImage:async()=>c.toDataURL()});
  if(mode!=='wysiwyg')(await import('/src/vditor.ts')).rebuildVditor(mode);
 },mode);
 const editor=page.locator(mode==='sv'?'.vditor-sv':`.vditor-${mode} pre.vditor-reset`);await editor.click();
 await editor.evaluate(async el=>{const c=document.createElement('canvas');c.width=20;c.height=10;const blob=await new Promise<Blob>(resolve=>c.toBlob(b=>resolve(b!)));const data=new DataTransfer();data.items.add(new File([blob],'image.png',{type:'image/png'}));el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}));});
 await expect.poll(()=>page.evaluate(async()=> (await import('/src/state.ts')).activeDoc()!.content)).toContain('file:///C:/drafts/abc.png');
 const result=await page.evaluate(async()=>{const{activeDoc}=await import('/src/state.ts'),sync=await import('/src/editor-sync.ts');sync.undoDocument('undo');return activeDoc()!.content;});expect(result).toBe('before\n');
});

test('另存为图片引用文本相同也重定位历史，防止撤销后读错目录',async({page})=>{
 await ready(page);const result=await page.evaluate(async()=>{
  const files=await import('/src/file-service.ts'),{openDoc}=await import('/src/docs.ts'),sync=await import('/src/editor-sync.ts'),save=await import('/src/save.ts'),{activeDoc}=await import('/src/state.ts'),{exportHistory}=await import('/src/history.ts');
  openDoc('D:/old/a.md','![old](before.png)\n','a.md');const doc=activeDoc()!;sync.applyDocumentEdit(doc,'![new](assets/hash.png)\n');
  files.setAssetServiceForTests({readImage:async()=> 'data:image/png;base64,x'});files.setImageStoreForTests({store:async()=> 'assets/hash.png'});save.setSavePathPickerForTests(async()=> 'D:/new/b.md');
  files.setFileServiceForTests({openFile:async()=>{throw Error('unexpected');},statFile:async()=>null,saveDocx:async()=>{},saveFile:async()=>({pathKey:'d:\\new\\b.md',mtimeMs:1,size:30,fingerprint:'new'})});
  const ok=await save.saveDoc(doc,true);return{ok,undo:exportHistory(doc).undo,dirty:doc.dirty};
 });expect(result.ok).toBe(true);expect(result.dirty).toBe(false);expect(result.undo.join('')).toContain('file:///D:/old/before.png');
});
test('公式图表外部资源被拒绝，保留源代码且不联网',async({page})=>{
 await ready(page);const requests:string[]=[];page.on('request',r=>{if(r.url().includes('example.invalid'))requests.push(r.url());});
 const result=await page.evaluate(async()=>{const{specialMarkdown}=await import('/src/export-specials.ts');return specialMarkdown('```mermaid\ngraph TD\nA@{img: "https://example.invalid/a.png"}\n```');});
 expect(result.issues.length).toBe(1);expect(result.markdown).toContain('```mermaid');expect(requests).toEqual([]);
});
