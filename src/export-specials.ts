// Rasterize offline diagrams/formulas from source, never from a possibly stale editor DOM.
import { fromMarkdown } from "mdast-util-from-markdown";
import { math } from "micromark-extension-math";
import { mathFromMarkdown } from "mdast-util-math";
import type { Nodes } from "mdast";
interface Mermaid { initialize(options: object):void; render(id:string, source:string):Promise<{svg:string}> }
interface MathEngine { tex2svgPromise(source:string, options:object):Promise<Element>; startup:{promise:Promise<void>} }
const libraries = new Map<string,Promise<void>>();
let sequence=0, tail:Promise<unknown>=Promise.resolve();
async function library(name:string, url:string, ready:()=>boolean):Promise<void> {
  if(ready())return;
  let pending=libraries.get(name);
  if(!pending){pending=new Promise<void>((resolve,reject)=>{
    let script=document.getElementById(name) as HTMLScriptElement|null;
    const started=Date.now();const poll=window.setInterval(()=>{if(ready()){clearInterval(poll);resolve();}else if(Date.now()-started>15000){clearInterval(poll);reject(Error("Offline renderer load timed out"));}},30);
    if(!script){script=document.createElement("script");script.id=name;script.src=url;script.onerror=()=>{clearInterval(poll);libraries.delete(name);script?.remove();reject(Error("Offline renderer unavailable"));};document.head.append(script);}
  });libraries.set(name,pending);}
  await pending;
}
async function svgPng(svg:SVGSVGElement):Promise<string> {
  const box=svg.viewBox.baseVal;
  const rect=svg.getBoundingClientRect();
  const width=Math.ceil(rect.width||box.width),height=Math.ceil(rect.height||box.height);
  if(width<=0||height<=0||width*height>4_000_000||width>8192||height>8192)throw Error("Diagram exceeds raster limits");
  const clone=svg.cloneNode(true) as SVGSVGElement;clone.setAttribute("xmlns","http://www.w3.org/2000/svg");clone.setAttribute("width",String(width));clone.setAttribute("height",String(height));
  clone.querySelectorAll("script,foreignObject,image").forEach(el=>el.remove());
  clone.querySelectorAll("*").forEach(el=>{for(const attr of [...el.attributes])if(/^on/i.test(attr.name)||(/href$/i.test(attr.name)&&!attr.value.startsWith("#")))el.removeAttribute(attr.name);});
  const image=new Image();
  const data=new TextEncoder().encode(new XMLSerializer().serializeToString(clone));let binary="";for(let i=0;i<data.length;i+=32768)binary+=String.fromCharCode(...data.subarray(i,i+32768));
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("Diagram raster timed out")),10000);image.onload=()=>{clearTimeout(timer);resolve();};image.onerror=()=>{clearTimeout(timer);reject(Error("Diagram raster failed"));};image.src="data:image/svg+xml;base64,"+btoa(binary);});
  const scale=Math.min(1,1100/width,1600/height),canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.ceil(width*scale));canvas.height=Math.max(1,Math.ceil(height*scale));
  try{const ctx=canvas.getContext("2d")!;ctx.fillStyle="white";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL("image/png");}finally{canvas.width=canvas.height=0;}
}
export function renderSpecial(kind:"mermaid"|"math",source:string,display=true):Promise<string> {
  const run=async()=>{
    if(/(?:https?:|file:|data:|blob:|asset:)|\bimg\s*:|\\includegraphics|\\require/i.test(source))throw Error("External resources are disabled in exported diagrams/formulas");
    if(!source.trim()||source.length>16000)throw Error("Formula/diagram source limit: 16 KB");
    const host=document.createElement("div");host.style.cssText="position:fixed;left:-10000px;top:0;width:1000px;background:white;color:black;font-size:20px";document.body.append(host);
    try{
      if(kind==="mermaid"){
        await library("vditorMermaidScript","/vditor-assets/dist/js/mermaid/mermaid.min.js",()=>!!(window as unknown as {mermaid:Mermaid}).mermaid);
        const engine=(window as unknown as {mermaid:Mermaid}).mermaid;
        engine.initialize({startOnLoad:false,securityLevel:"strict",theme:"default",htmlLabels:false,flowchart:{htmlLabels:false},maxTextSize:16000,maxEdges:200});
        const id=`aleiDiagram${sequence++}`;
        try{const result=await engine.render(id,source);host.innerHTML=result.svg;}finally{document.getElementById("d"+id)?.remove();}
      }else{
        const w=window as unknown as {MathJax:MathEngine|object};
        if(!w.MathJax)w.MathJax={loader:{paths:{mathjax:"/vditor-assets/dist/js/mathjax"}},startup:{typeset:false},svg:{fontCache:"none"},tex:{maxBuffer:16000}};
        await library("protyleMathJaxScript","/vditor-assets/dist/js/mathjax/tex-svg-full.js",()=>!!(w.MathJax as MathEngine).tex2svgPromise);
        const engine=w.MathJax as MathEngine;await engine.startup.promise;
        const node=await engine.tex2svgPromise(source,{display});host.append(node);
        if(host.querySelector('[data-mml-node="merror"]'))throw Error("Invalid formula");
      }
      const svg=host.querySelector("svg");if(!svg)throw Error("Renderer did not produce an SVG");return await svgPng(svg);
    }finally{host.remove();}
  };
  const next=tail.catch(()=>{}).then(run);tail=next;return next;
}
export async function specialMarkdown(markdown:string):Promise<{markdown:string;issues:string[]}> {
  const root=fromMarkdown(markdown,{extensions:[math()],mdastExtensions:[mathFromMarkdown()]}),nodes:Nodes[]=[];
  const visit=(node:Nodes)=>{if(node.type==="math"||node.type==="inlineMath"||(node.type==="code"&&node.lang==="mermaid"))nodes.push(node);else if("children" in node)node.children.forEach(visit);};visit(root);
  const changes:Array<{start:number;end:number;text:string}>=[],issues:string[]=[];
  for(const [index,node] of nodes.entries()){
    if(!("value" in node))continue;
    try{if(index>=32)throw Error("At most 32 diagrams/formulas per export");const uri=await renderSpecial(node.type==="code"?"mermaid":"math",node.value,node.type!=="inlineMath");changes.push({start:node.position!.start.offset!,end:node.position!.end.offset!,text:`![${node.type==="code"?"Mermaid":"Formula"}](${uri})`});}
    catch(error){issues.push(String(error));}
  }
  for(const c of changes.reverse())markdown=markdown.slice(0,c.start)+c.text+markdown.slice(c.end);
  return {markdown,issues};
}
