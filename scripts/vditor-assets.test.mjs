import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { planRuntimeAssets, source } from "./copy-vditor-assets.mjs";
const files=planRuntimeAssets();
test("all optional renderers, languages, themes and icons retain their original bytes",()=>{
 function walk(path){for(const e of readdirSync(path,{withFileTypes:true})){const p=join(path,e.name);if(e.isDirectory())walk(p);else{
  const name=relative(source,p).replaceAll("\\","/");
  if(name==='js/katex/katex.min.css'||/^js\/katex\/fonts\/.*\.(woff|ttf)$/.test(name))continue;
  assert.deepEqual(files.get(name),readFileSync(p),name);
 }}}
 for(const dir of ['js','css','images'])walk(join(source,dir));
});
test("no duplicated editor entrypoints or TypeScript declarations are shipped",()=>{
 for(const name of files.keys()){assert.ok(!name.endsWith('.d.ts'));assert.ok(!['index.js','index.min.js','index.css','method.js'].includes(name));}
 assert.ok(files.has('method.min.js'));
});
test("every KaTeX font face resolves to the original WOFF2 with no removed fallback URLs",()=>{
 const css=files.get('js/katex/katex.min.css').toString();
 const faces=[...css.matchAll(/@font-face\{[^}]+\}/g)];assert.ok(faces.length>=20);
 for(const [face] of faces){const urls=[...face.matchAll(/url\(([^)]+)\)/g)];assert.equal(urls.length,1);assert.ok(urls[0][1].endsWith('.woff2'));assert.ok(files.has('js/katex/'+urls[0][1]));}
});
