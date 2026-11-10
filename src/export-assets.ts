// Resource preparation uses only the captured source path; never reads the active editor.
import type { ExportSnapshot } from "./export-snapshot";
import { assetService } from "./file-service";
import { decodeRaster } from "./raster-image";
import { renderSpecial } from "./export-specials";
import { t } from "./i18n";
export interface AssetResult { html:string; embedded:number; issues:Array<{reference:string;reason:string}> }
const MAX_IMAGES=64, MAX_TOTAL=8*1024*1024;
export async function prepareExportAssets(snapshot: Pick<ExportSnapshot,"html"|"sourcePath">, word=false):Promise<AssetResult> {
  const template=document.createElement("template");template.innerHTML=snapshot.html;
  // Never attach untrusted markup. Keep code classes for Word's highlighting stage.
  template.content.querySelectorAll('script,iframe,object,embed,link,meta,base,style,source,video,audio').forEach(el=>el.remove());
  template.content.querySelectorAll('*').forEach(el=>{for(const attr of [...el.attributes])if(/^on/i.test(attr.name)||attr.name==='srcset')el.removeAttribute(attr.name);});
  const issues:AssetResult['issues']=[], cache=new Map<string,Promise<string>>();let count=0,total=0,embedded=0;
  let specialCount=0;
  for(const node of template.content.querySelectorAll('.language-math, .language-mermaid')) {
    if (node.parentElement?.closest('.language-math, .language-mermaid')) continue;
    const code=node.textContent||'';
    try {
      if(++specialCount>32)throw Error('At most 32 diagrams/formulas per export');
      const uri=await renderSpecial(node.classList.contains('language-mermaid')?'mermaid':'math',code,node.tagName!=='SPAN');
      const img=document.createElement('img');img.src=uri;img.alt=code;
      (node.parentElement?.tagName==='PRE'?node.parentElement:node).replaceWith(img);
    }catch(error){issues.push({reference:code.slice(0,100),reason:String(error)});}
  }
  for(const image of template.content.querySelectorAll('img')) {
    const reference=image.getAttribute('src')||'';
    try {
      if(++count>MAX_IMAGES) throw Error('At most 64 images per export');
      if(!reference || /^(?:https?:|blob:|asset:|\/\/)/i.test(reference)) throw Error('Remote or temporary image URLs are not loaded');
      let pending=cache.get(reference);
      if(!pending) {pending=(async()=>decodeRaster(/^data:/i.test(reference)?reference:await assetService().readImage(snapshot.sourcePath,reference),word))();cache.set(reference,pending);}
      const uri=await pending;
      if(total+uri.length>MAX_TOTAL) throw Error('Embedded images exceed 8 MB');
      total+=uri.length;embedded++;image.setAttribute('src',uri);
      // Never allow original CSS to distort a Word image or introduce another resource.
      image.removeAttribute('style');image.removeAttribute('width');image.removeAttribute('height');
    } catch(error) {
      cache.delete(reference);
      issues.push({reference,reason:String(error)});
      image.replaceWith(document.createTextNode(`[${image.getAttribute('alt')||'Image'}: ${reference}]`));
    }
  }
  return {html:template.innerHTML,embedded,issues};
}
export function assetNotice(result:AssetResult):string {
  if(!result.issues.length) return '';
  return `\n${t('htmlImagesOmitted')} (${result.issues.length})\n`+result.issues.slice(0,3).map(item=>`${item.reference.slice(0,180)}: ${item.reason}`).join('\n');
}
