import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
const evidence = process.env.MD_EDITOR_TEST_EVIDENCE_DIR || "test-results/theme-evidence";

const source = "# 一级标题 · Heading 1\n\n正文与 [链接](https://example.com) 和 `行内代码`。\n\n## 二级标题 · Heading 2\n\n### 三级标题 · Heading 3\n\n#### 四级标题 · Heading 4\n\n##### 五级标题 · Heading 5\n\n###### 六级标题 · Heading 6\n\n> 引用：柔和底色与清晰文字。\n\n| 项目 | 内容 |\n| --- | --- |\n| 表格 | 中文 English 123 |\n\n```ts\nconst message = 'Hello, 世界';\nconsole.log(message);\n```\n";
async function ready(page: Page) {
  await page.goto("/");
  await page.waitForFunction(async () => !!document.querySelector("#editor .vditor-wysiwyg") && !(await import("/src/state.ts")).S.switchInFlight);
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const doc = (await import("/src/state.ts")).activeDoc()!;
    return {content:doc.content, revision:doc.revision, dirty:doc.dirty, path:doc.path, history:(await import("/src/history.ts")).exportHistory(doc)};
  });
}
function contrast(foreground: string, background: string): number {
  const luminance = (s: string) => s.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v => {v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
  const a=luminance(foreground),b=luminance(background); return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
}
for (const theme of ["light", "dark", "eye", "paper", "claude"]) test(`${theme}: 三模式六级配色、可读性与文档状态保持`, async ({page, baseURL}) => {
  const origin = new URL(baseURL!).origin;
  const remote:string[]=[];page.on("request",r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).origin!==origin)remote.push(r.url());});
  await ready(page);
  await page.evaluate(async source => {
    const doc=(await import("/src/docs.ts")).openDoc("D:/theme/sample.md",source,"主题样例.md");
    (await import("/src/editor-sync.ts")).applyDocumentEdit(doc,source+"\n未保存草稿。\n");
  },source);
  const before=await snapshot(page);
  for (const mode of ["wysiwyg","ir","sv"]) {
    await page.selectOption("#btn-mode", mode);
    await page.waitForFunction(async()=>!(await import("/src/state.ts")).S.switchInFlight);
    await page.selectOption("#pref-theme",theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme",theme);
    const content=page.locator(mode==="sv"?".vditor-preview .vditor-reset":`.vditor-${mode} .vditor-reset`).first();
    await expect(content.locator("h6")).toBeVisible();
    const colors=await content.evaluate(el=>({headings:[1,2,3,4,5,6].map(n=>getComputedStyle(el.querySelector(`h${n}`)!).color),background:getComputedStyle(el).backgroundColor,text:getComputedStyle(el).color,table:getComputedStyle(el.querySelector("td")!).backgroundColor}));
    expect(new Set(colors.headings).size).toBe(6);
    for(const color of [...colors.headings,colors.text])expect(contrast(color,colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(colors.table).toBe(colors.background);
    if(theme==="claude") await expect.poll(()=>page.locator(".outline-item").first().evaluate(el=>{
      const css=getComputedStyle(el), panel=getComputedStyle(document.getElementById("outline-panel")!);
      return [css.color,panel.backgroundColor];
    }).then(([fg,bg])=>contrast(fg,bg))).toBeGreaterThanOrEqual(4.5);
    expect(await snapshot(page)).toEqual(before);
    await page.evaluate(async()=>{(window as any).__themeEditor=(await import("/src/state.ts")).S.vditor;});
    await page.selectOption("#pref-theme",theme==="dark"?"light":"dark");
    await page.selectOption("#pref-theme",theme);
    expect(await page.evaluate(async()=>(window as any).__themeEditor===(await import("/src/state.ts")).S.vditor)).toBe(true);
    expect(await snapshot(page)).toEqual(before);
    if(mode==="wysiwyg"){mkdirSync(evidence,{recursive:true});await page.screenshot({path:`${evidence}/${theme}.png`});}
  }
  expect(remote).toEqual([]);
  await page.reload(); await expect(page.locator("#pref-theme")).toHaveValue(theme);
  await expect(page.locator("html")).toHaveAttribute("data-theme",theme);
});

test("主题跨编辑器/预览同步，保留其他偏好，系统主题随系统变化",async({page,context})=>{
 await ready(page);
 const other=await context.newPage();await ready(other);
 const preview=await context.newPage();await preview.goto("/preview.html");
 await expect(preview.locator("html")).toHaveAttribute("data-theme","light");
 await page.evaluate(async()=>{const p=await import("/src/preferences.ts");p.setPreference("sourceEditor","D:/Tools/editor.exe");p.setPreference("outlineWidth",310);});
 for(const theme of ["eye","paper","dark","claude"]){
  await page.selectOption("#pref-theme",theme);
  await expect(other.locator("#pref-theme")).toHaveValue(theme);
  await expect(preview.locator("html")).toHaveAttribute("data-theme",theme);
  expect(await preview.locator("body").evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(await page.locator("#editor .vditor-wysiwyg .vditor-reset").evaluate(el=>getComputedStyle(el).backgroundColor));
 }
 await other.selectOption("#pref-theme","paper");await expect(page.locator("#pref-theme")).toHaveValue("paper");
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("alei-editor.preferences.v1")!))).toMatchObject({theme:"paper",sourceEditor:"D:/Tools/editor.exe",outlineWidth:310});
 await page.selectOption("#pref-theme","system");await page.emulateMedia({colorScheme:"dark"});await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
 await page.emulateMedia({colorScheme:"light"});await expect(page.locator("html")).toHaveAttribute("data-theme","light");
 await page.selectOption("#pref-theme","eye");await page.emulateMedia({colorScheme:"dark"});await expect(page.locator("html")).toHaveAttribute("data-theme","eye");
});

test("语言重建后保留暖纸、Claude Code 与三语选项，非法旧偏好安全回落",async({page})=>{
 await page.addInitScript(()=>localStorage.setItem("alei-editor.preferences.v1",JSON.stringify({theme:"unknown"})));
 await ready(page);await expect(page.locator("#pref-theme")).toHaveValue("light");
 await page.selectOption("#pref-theme","paper");
 for(const [lang,label] of [["en","Warm paper"],["zh-TW","暖紙"],["zh-CN","暖纸"]]){
  await page.selectOption("#lang-select",lang);await page.waitForFunction(async()=>!(await import("/src/state.ts")).S.switchInFlight);
  await expect(page.locator("#pref-theme option[value=paper]")).toHaveText(label);await expect(page.locator("html")).toHaveAttribute("data-theme","paper");
 }
 await page.selectOption("#pref-theme","claude");
 for(const lang of ["en","zh-TW","zh-CN"]){
  await page.selectOption("#lang-select",lang);await page.waitForFunction(async()=>!(await import("/src/state.ts")).S.switchInFlight);
  await expect(page.locator("#pref-theme option[value=claude]")).toHaveText("Claude Code");
  await expect(page.locator("html")).toHaveAttribute("data-theme","claude");
  expect(await page.evaluate(async()=>(await import("/src/state.ts")).S.vditor?.vditor.options.theme)).toBe("dark");
 }
});
