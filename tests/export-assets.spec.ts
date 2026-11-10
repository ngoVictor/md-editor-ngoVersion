import JSZip from "jszip";
import {test,expect} from '@playwright/test';
async function ready(page:any){await page.goto('/');await page.waitForSelector('#editor .vditor-wysiwyg');}
test('图片准备使用捕获路径、去重读取，HTML 产物可独立显示图片',async({page})=>{
 await ready(page);
 const result=await page.evaluate(async()=>{
  const {setAssetServiceForTests}=await import('/src/file-service.ts'),{prepareExportAssets}=await import('/src/export-assets.ts'),{buildHtmlExport}=await import('/src/html-export.ts');
  const c=document.createElement('canvas');c.width=40;c.height=20;const ctx=c.getContext('2d')!;ctx.fillStyle='red';ctx.fillRect(0,0,40,20);const uri=c.toDataURL();const calls:any[]=[];
  setAssetServiceForTests({readImage:async(...args)=>{calls.push(args);return uri;}});
  const prepared=await prepareExportAssets({sourcePath:'D:/中文 空格/doc.md',html:'<p><img src="../图 片.png" alt="截图"><img src="../图 片.png"></p>'});
  const exported=buildHtmlExport(prepared.html,'test',true);return {prepared,exported,calls};
 });
 expect(result.prepared.embedded).toBe(2);expect(result.prepared.issues).toEqual([]);expect(result.calls).toEqual([['D:/中文 空格/doc.md','../图 片.png']]);expect(result.exported.omittedImages).toBe(0);
 await page.setContent(result.exported.html);await expect.poll(()=>page.locator('img').first().evaluate((el:HTMLImageElement)=>el.naturalWidth)).toBe(40);
});
test('远程图片不联网；缺图、SVG、损坏数据和超大像素保留文字并报告',async({page})=>{
 await ready(page);const requests:string[]=[];page.on('request',r=>{if(r.url().includes('example.invalid'))requests.push(r.url());});
 const result=await page.evaluate(async()=>{
  const {setAssetServiceForTests}=await import('/src/file-service.ts'),{prepareExportAssets}=await import('/src/export-assets.ts');
  setAssetServiceForTests({readImage:async()=>{throw Error('missing image');}});
  const bytes=new Uint8Array(24);bytes.set([137,80,78,71,13,10,26,10]);bytes.set([73,72,68,82],12);new DataView(bytes.buffer).setUint32(16,100000);new DataView(bytes.buffer).setUint32(20,100000);
  const huge='data:image/png;base64,'+btoa(String.fromCharCode(...bytes));
  return prepareExportAssets({sourcePath:'D:/a.md',html:`<img alt="网络" src="https://example.invalid/a.png"><img alt="缺图" src="missing.png"><img src="data:image/svg+xml;base64,PHN2Zy8+"><img src="data:image/png;base64,aGVsbG8="><img src="${huge}">`});
 });
 expect(result.embedded).toBe(0);expect(result.issues).toHaveLength(5);expect(result.html).not.toContain('<img');expect(result.html).toContain('网络');expect(requests).toEqual([]);
});
test('超过 64 张图片时有界降级，重复图片不反复读取',async({page})=>{
 await ready(page);const result=await page.evaluate(async()=>{
  const{setAssetServiceForTests}=await import('/src/file-service.ts'),{prepareExportAssets}=await import('/src/export-assets.ts');const c=document.createElement('canvas');c.width=c.height=1;let calls=0;
  setAssetServiceForTests({readImage:async()=>{calls++;return c.toDataURL();}});const result=await prepareExportAssets({sourcePath:'D:/a.md',html:'<img src="a.png">'.repeat(67)});return {calls,embedded:result.embedded,issues:result.issues.length};
 });expect(result).toEqual({calls:1,embedded:64,issues:3});
});
for(const format of ['html','pdf','docx'])test(`${format} 图片读取等待中切换和修改文档仍使用原快照，不改变身份`,async({page})=>{
 await ready(page);const result=await page.evaluate(async format=>{
  const files=await import('/src/file-service.ts'),docs=await import('/src/docs.ts'),sync=await import('/src/editor-sync.ts'),{activeDoc}=await import('/src/state.ts');
  docs.openDoc('D:/original/doc.md','# Captured\n\n![image](图片.png)','doc.md');const original=activeDoc()!;
  const canvas=document.createElement('canvas');canvas.width=32;canvas.height=16;canvas.getContext('2d')!.fillRect(0,0,32,16);const uri=canvas.toDataURL();let written='',base:any[]=[];
  files.setAssetServiceForTests({readImage:async(...args)=>{base=args;sync.applyDocumentEdit(original,'# Later');docs.openDoc('D:/other/doc.md','# Other','other.md');return uri;}});
  let ok=false;
  if(format==='html'){const exp=await import('/src/export-html.ts');files.setExportServiceForTests({saveHtml:async(_,html)=>{written=html;}});exp.setHtmlPathPickerForTests(async()=>'D:/output.html');ok=await exp.exportActiveDocAsHtml(true);}
  else if(format==='pdf'){const exp=await import('/src/export-pdf.ts');files.setPdfServiceForTests({renderPdf:async(_,html)=>{written=html;}});exp.setPdfPathPickerForTests(async()=>'D:/output.pdf');ok=await exp.exportActiveDocAsPdf();}
  else {const exp=await import('/src/export-docx.ts');files.setFileServiceForTests({openFile:async()=>{throw Error('unexpected');},statFile:async()=>null,saveFile:async()=>{throw Error('unexpected');},saveDocx:async(_,data)=>{written=data;}});exp.setDocxPathPickerForTests(async()=>'D:/output.docx');ok=await exp.exportActiveDocAsDocx();}
  let media=0;
  return {ok,written,media,base,dirty:original.dirty,path:original.path,content:original.content};
 },format);
 if(format==='docx'&&result.ok){const zip=await JSZip.loadAsync(result.written,{base64:true});result.media=Object.keys(zip.files).filter(x=>x.startsWith('word/media/')&&!zip.files[x].dir).length;result.written=await zip.file('word/document.xml')!.async('string');}
 expect(result.ok).toBe(true);expect(result.base).toEqual(['D:/original/doc.md','图片.png']);expect(result.written).toContain('Captured');expect(result.written).not.toContain('Later');expect(result.path).toBe('D:/original/doc.md');expect(result.content).toBe('# Later');expect(result.dirty).toBe(true);
 if(format==='docx')expect(result.media).toBe(1);else expect(result.written).toContain('data:image/png;base64,');
});

test('JPEG、WebP 与 GIF 可解码并转成 Word 兼容 PNG',async({page})=>{
 await ready(page);const result=await page.evaluate(async()=>{
  const {decodeRaster}=await import('/src/raster-image.ts');const c=document.createElement('canvas');c.width=40;c.height=20;c.getContext('2d')!.fillRect(0,0,40,20);
  const inputs=[c.toDataURL('image/jpeg'),c.toDataURL('image/webp'),'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'];
  return Promise.all(inputs.map(uri=>decodeRaster(uri,true)));
 });expect(result.every(uri=>uri.startsWith('data:image/png;base64,'))).toBe(true);
});
