import {chromium,expect} from '@playwright/test';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const root=resolve(process.argv[2]),label=process.argv[3],evidence=resolve(process.env.MD_EDITOR_TEST_EVIDENCE_DIR || 'test-results/native-evidence/io');
if(!root.startsWith(resolve('test-results/native-size-'))||!['baseline','optimized'].includes(label))throw Error('Invalid benchmark arguments');
let browser;
for(let i=0;i<80;i++){try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${process.env.MD_EDITOR_TEST_CDP_PORT}`);break;}catch(error){if(i===79)throw error;await new Promise(r=>setTimeout(r,150));}}
const context=browser.contexts()[0],page=context.pages()[0]||await context.waitForEvent('page',{timeout:15000});
try{
 await expect(page.locator('#file-title')).toContainText('start.md');
 const samples=await page.evaluate(async root=>{
  const invoke=(cmd,args)=>window.__TAURI_INTERNALS__.invoke(cmd,args),samples=[];
  const content='save benchmark\n'.repeat(65536);
  for(let i=0;i<8;i++){
   let start=performance.now();const opened=await invoke('open_file',{path:root+'/large.md'});const openMs=performance.now()-start;
   if(opened[0].length!==5242875)throw Error('Incomplete file read');
   start=performance.now();const saved=await invoke('save_file',{path:root+`/saved-${i}.md`,content,allowEmpty:false,expectedFingerprint:null,force:false});const saveMs=performance.now()-start;
   if(saved[1]!==content.length)throw Error('Incomplete file write');
   if(i) samples.push({openMs,saveMs});
  }
  return samples;
 },root);
 for(let i=0;i<8;i++)expect(readFileSync(join(root,`saved-${i}.md`),'utf8')).toBe('save benchmark\n'.repeat(65536));
 const median=key=>samples.map(s=>s[key]).sort((a,b)=>a-b)[3];
 const result={label,openBytes:5242875,saveBytes:983040,samples,medianOpenMs:median('openMs'),medianSaveMs:median('saveMs'),note:'Single process per version; first warm-up omitted, seven warm-cache IPC samples. Not a cold-start or whole-app performance benchmark.'};
 mkdirSync(evidence,{recursive:true});writeFileSync(join(evidence,`io-${label}.json`),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
