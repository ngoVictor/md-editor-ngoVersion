import {test,expect,type Page} from '@playwright/test';
async function ready(page:Page){await page.goto('/');await expect(page.locator('#file-title')).toContainText(/欢迎|Welcome/);}
async function fixture(page:Page){await ready(page);await page.evaluate(async()=>{
  const {openDoc}=await import('/src/docs.ts'),{setResourceServiceForTests}=await import('/src/file-service.ts');
  (window as any).actions=[];
  const {setSourcePreviewOpenerForTests}=await import('/src/source-preview.ts');
  const {mountSourcePreview}=await import('/src/source-preview-view.ts');
  setSourcePreviewOpenerForTests(async request=>{
    const view=document.createElement('section');view.id='source-preview';view.style.cssText='position:fixed;inset:30px;background:white;z-index:999;overflow:auto';document.body.append(view);
    // Browser component harness. Native independent windows are verified by the release script.
    void mountSourcePreview(view,()=>view.remove(),request.path,request.line,request.column,request.initialError);
  });

  setResourceServiceForTests({inspect:async path=>({path,kind:path.endsWith('.pdf')?'external':path.endsWith('/folder')?'directory':'source'}),readText:async path=>({path,content:Array.from({length:1500},(_,i)=>`line ${i+1} <script>alert(1)</script>`).join('\r\n'),encoding:'UTF-8'}),openDefault:async path=>{(window as any).actions.push(['default',path]);},openEditor:async(...args)=>{(window as any).actions.push(['editor',...args]);}});
  openDoc('D:/project/doc/index.md','[源码](../main.ts:1094:3)\n\n[PDF](../file.pdf)\n\n[目录](../folder)','index.md');
});}
test('解析源码行列后缀、URL 编码和文件夹，拒绝非法位置与流路径',async({page})=>{
  await ready(page);const actual=await page.evaluate(async()=>{const{resolveLinkTarget:r}=await import('/src/link-target.ts');return ['../main.ts:1094:3','../%E4%B8%AD%20%E6%96%87.rs#L24','../folder','file:///D:/src/main.ts:42','../main.ts:0','../main.ts:999999999999','D:/main.ts:ads','../a.ts#L3-L6','main.ts:12'].map(x=>r(x,'D:/project/doc/index.md'));});
  expect(actual[0]).toMatchObject({kind:'local',path:'D:/project/main.ts',line:1094,column:3,hash:''});expect(actual[1]).toMatchObject({path:'D:/project/中 文.rs',line:24});expect(actual[2]).toMatchObject({path:'D:/project/folder',line:null});expect(actual[3]).toMatchObject({path:'D:/src/main.ts',line:42});expect(actual.slice(4,7).every(x=>x.kind==='invalid')).toBe(true);expect(actual[7]).toMatchObject({line:3,hash:''});expect(actual[8]).toMatchObject({kind:'local',path:'D:/project/doc/main.ts',line:12});
});
for(const mode of ['wysiwyg','ir','sv']) test(`${mode} 源码链接打开只读预览并定位第 1094 行`,async({page})=>{
  await fixture(page);if(mode!=='wysiwyg')await page.selectOption('#btn-mode',mode);
  const link=mode==='ir'?'.vditor-ir span[data-type="a"]':mode==='sv'?'.vditor-preview a':'.vditor-wysiwyg a';
  await page.locator(link).first().click();await expect(page.locator('#source-preview')).toBeVisible();await expect(page.locator('#source-lines .source-selected')).toHaveText('line 1094 <script>alert(1)</script>');
  await expect(page.locator('#source-lines li')).toHaveCount(400);await expect(page.locator('#source-lines script')).toHaveCount(0);await expect(page.locator('#file-title')).toHaveText('index.md');
  await page.keyboard.press('Control+s');await expect(page.locator('#file-title')).toHaveText('index.md');await page.keyboard.press('Escape');await expect(page.locator('#source-preview')).not.toBeVisible();
});
test('PDF 和目录分别交给受限默认应用接口，不创建 Markdown 标签',async({page})=>{
  await fixture(page);await page.locator('.vditor-wysiwyg a').nth(1).click();await page.locator('.vditor-wysiwyg a').nth(2).click();expect(await page.evaluate(()=>(window as any).actions)).toEqual([['default','D:/project/file.pdf'],['default','D:/project/folder']]);await expect(page.locator('.tab')).toHaveCount(2);
});
test('指定编辑器后保留行列参数；Shift 点击可预览并恢复默认预览',async({page})=>{
  await fixture(page);await page.evaluate(async()=>{(await import('/src/source-preview-view.ts')).setSourceEditorPickerForTests(async()=>'D:/Tools/Code.exe');});
  await page.locator('.vditor-wysiwyg a').first().click();await page.click('#source-choose-editor');await expect.poll(()=>page.evaluate(()=>(window as any).actions.length)).toBe(1);expect(await page.evaluate(()=>(window as any).actions[0])).toEqual(['editor','D:/project/main.ts','D:/Tools/Code.exe',1094,3]);await page.click('#source-close');
  await page.locator('.vditor-wysiwyg a').first().click();await expect.poll(()=>page.evaluate(()=>(window as any).actions.length)).toBe(2);await expect(page.locator('#source-preview')).not.toBeVisible();
  await page.locator('.vditor-wysiwyg a').first().click({modifiers:['Shift']});await expect(page.locator('#source-preview')).toBeVisible();await page.click('#source-forget-editor');await page.click('#source-close');await page.locator('.vditor-wysiwyg a').first().click();await expect(page.locator('#source-preview')).toBeVisible();expect(await page.evaluate(()=>(window as any).actions.length)).toBe(2);
});
test('失效编辑器回退只读预览，源码草稿不进入 Markdown 集合',async({page})=>{
  await fixture(page);await page.evaluate(async()=>{const{setPreference}=await import('/src/preferences.ts'),{resourceService}=await import('/src/file-service.ts');setPreference('sourceEditor','D:/missing/Code.exe');resourceService().openEditor=async()=>{throw Error('editor missing');};});
  await page.locator('.vditor-wysiwyg a').first().click();await expect(page.locator('#source-status')).toContainText('editor missing');await expect(page.locator('.source-selected')).toContainText('line 1094');await expect(page.locator('.tab')).toHaveCount(2);
});
test('预览取消与换文档使迟到读取失效；大文件读取失败仍可选择编辑器',async({page})=>{
  await fixture(page);await page.evaluate(async()=>{const{resourceService}=await import('/src/file-service.ts');resourceService().readText=()=>new Promise(resolve=>(window as any).finish=resolve);});
  await page.locator('.vditor-wysiwyg a').first().click();await page.click('#source-close');await page.evaluate(()=>(window as any).finish({path:'D:/project/main.ts',content:'LATE',encoding:'UTF-8'}));await expect(page.locator('#source-preview')).not.toBeVisible();await expect(page.locator('#source-lines')).toHaveCount(0);
  await page.evaluate(async()=>{const{resourceService}=await import('/src/file-service.ts');resourceService().readText=async()=>{throw Error('Preview exceeds 2 MB');};});await page.locator('.vditor-wysiwyg a').first().click();await expect(page.locator('#source-status')).toContainText('2 MB');await expect(page.locator('#source-choose-editor')).toBeEnabled();
});
test('行号超出范围会提示且定位末行，预览时的 Ctrl+S 不触发 Markdown 保存',async({page})=>{
  await fixture(page);await page.evaluate(async()=>{const{resourceService,setFileServiceForTests}=await import('/src/file-service.ts');resourceService().readText=async path=>({path,content:'one\r\n  two',encoding:'UTF-8'});setFileServiceForTests({openFile:async()=>{throw Error('unexpected');},statFile:async()=>null,saveDocx:async()=>{},saveFile:async()=>{(window as any).actions.push('SAVE');throw Error('unexpected');}});});
  await page.locator('.vditor-wysiwyg a').first().click();await expect(page.locator('.source-selected')).toHaveText('  two');await expect(page.locator('#source-status')).toContainText(/末行|last line/);await page.keyboard.press('Control+s');expect(await page.evaluate(()=>(window as any).actions)).toEqual([]);
});

test('切换标签后迟到的资源检查不启动应用或打开预览',async({page})=>{
  await fixture(page);await page.evaluate(async()=>{const{resourceService}=await import('/src/file-service.ts');resourceService().inspect=()=>new Promise(resolve=>(window as any).finishInspect=resolve);});
  await page.locator('.vditor-wysiwyg a').first().click();await page.click('#btn-new');
  await page.evaluate(()=>(window as any).finishInspect({path:'D:/project/main.ts',kind:'source'}));
  await expect(page.locator('#source-preview')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).actions)).toEqual([]);
});


test('独立窗口偏好变更同步，修改编辑器选择不覆盖其他窗口主题设置',async({page,context})=>{
  await ready(page);const other=await context.newPage();await ready(other);
  await page.evaluate(async()=>{(await import('/src/preferences.ts')).setPreference('theme','dark');});
  await expect.poll(()=>other.evaluate(async()=>(await import('/src/preferences.ts')).preferences.theme)).toBe('dark');
  await other.evaluate(async()=>{(await import('/src/preferences.ts')).setPreference('sourceEditor','D:/Tools/Code.exe');});
  await expect.poll(()=>page.evaluate(async()=>(await import('/src/preferences.ts')).preferences.sourceEditor)).toBe('D:/Tools/Code.exe');
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('alei-editor.preferences.v1')||'{}').theme)).toBe('dark');await other.close();
});
