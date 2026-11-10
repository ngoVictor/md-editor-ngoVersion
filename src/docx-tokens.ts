// Markdown tokens -> native Word structures. No editor, application state or file IPC.
import MarkdownIt from "markdown-it";
import footnote from "markdown-it-footnote";
import type Token from "markdown-it/lib/token.mjs";
import * as D from "docx";
import hljs from "highlight.js";
import { rasterSize } from "./raster-image";
const FONT = "Microsoft YaHei", WIDTH = 8306;
const BORDER = {style:D.BorderStyle.SINGLE, size:4, color:"8996A8"};
export interface WordImages { get(src: string): string | undefined }
export async function tokensToDocx(markdown: string, images: WordImages): Promise<Blob> {
  const parser = new MarkdownIt({html:false, linkify:true}).use(footnote as unknown as (md: MarkdownIt) => void);
  const tokens = parser.parse(markdown, {});
  const configs: D.INumberingOptions["config"][number][] = [];
  const footnotes: Record<string, {children:D.Paragraph[]}> = {};
  let sequence = 0;
  function inline(tokens: Token[], style: D.IRunOptions = {}): D.ParagraphChild[] {
    const out: D.ParagraphChild[] = [];
    const stack: D.IRunOptions[] = [style];
    for(let i=0;i<tokens.length;i++) {
      const token=tokens[i], current=stack[stack.length-1];
      const text=(text:string,extra:D.IRunOptions={})=>new D.TextRun({font:FONT,...current,...extra,text});
      if (["strong_open","em_open","s_open"].includes(token.type)) stack.push({...current,...(token.type==="strong_open"?{bold:true}:token.type==="em_open"?{italics:true}:{strike:true})});
      else if (["strong_close","em_close","s_close"].includes(token.type)) {if(stack.length>1)stack.pop();}
      else if(token.type==="text")out.push(text(token.content));
      else if(token.type==="code_inline")out.push(text(token.content,{font:"Consolas",color:"C7254E",shading:{fill:"F9F2F4"}}));
      else if(token.type==="softbreak")out.push(text(" "));
      else if(token.type==="hardbreak")out.push(new D.TextRun({break:1}));
      else if(token.type==="footnote_ref")out.push(new D.FootnoteReferenceRun(Number(token.meta.id)+1));
      else if(token.type==="link_open") {
        let end=i+1; while(end<tokens.length&&tokens[end].type!=="link_close")end++;
        const children=inline(tokens.slice(i+1,end),{...current,color:"2463BD"}), link=token.attrGet("href")||"";
        out.push(/^(?:https?:|mailto:|tel:)/i.test(link)?new D.ExternalHyperlink({link,children}):new D.TextRun({text:tokens.slice(i+1,end).map(t=>t.content).join(""),...current})); i=end;
      } else if(token.type==="image") {
        const src=token.attrGet("src")||"", uri=images.get(src);
        if(uri) {
          const size=rasterSize(uri), scale=Math.min(1,553/size.width,870/size.height);
          out.push(new D.ImageRun({type:"png",data:Uint8Array.from(atob(uri.split(",")[1]),c=>c.charCodeAt(0)),transformation:{width:Math.max(1,Math.round(size.width*scale)),height:Math.max(1,Math.round(size.height*scale))}}));
        } else out.push(text(`[${token.content||"Image"}: ${src}]`,{italics:true,color:"777777"}));
      } else if (token.content) out.push(text(token.content));
    }
    return out;
  }
  function codeRuns(code:string, language:string): D.TextRun[] {
    const holder=document.createElement("template");
    holder.innerHTML=language&&hljs.getLanguage(language)?hljs.highlight(code,{language,ignoreIllegals:true}).value:hljs.highlightAuto(code).value;
    const colors:Record<string,string>={"hljs-keyword":"8959A8","hljs-string":"718C00","hljs-number":"F5871F","hljs-comment":"8E908C","hljs-title":"4271AE","hljs-built_in":"C82829"};
    const out:D.TextRun[]=[];
    const visit=(node:Node,color="333333")=>{
      if(node instanceof Element) {for(const cls of node.classList)color=colors[cls]||color; node.childNodes.forEach(n=>visit(n,color));}
      else if(node.nodeType===Node.TEXT_NODE) (node.textContent||"").split("\n").forEach((text,i)=>{if(i)out.push(new D.TextRun({break:1}));if(text)out.push(new D.TextRun({text,font:"Consolas",size:18,color}));});
    }; holder.content.childNodes.forEach(n=>visit(n)); return out;
  }
  type List = {reference:string; level:number; first:boolean};
  function blocks(tokens:Token[], quote=0): Array<D.Paragraph|D.Table> {
    const out:Array<D.Paragraph|D.Table>=[], lists:List[]=[];
    const paragraph=(children:D.ParagraphChild[], extras:D.IParagraphOptions={})=> {
      const list=lists[lists.length-1];
      const numbered=list?.first;
      out.push(new D.Paragraph({children, spacing:{after:120,line:360},
        ...(quote?{indent:{left:420*quote},border:{left:{...BORDER,color:"9AA9BC",size:12,space:8}}}:list?{}:{indent:{firstLine:480}}),
        ...(list?numbered?{numbering:{reference:list.reference,level:list.level}}:{indent:{left:480*(list.level+1)}}:{}),...extras}));
      if(list)list.first=false;
    };
    for(let i=0;i<tokens.length;i++) {
      const token=tokens[i];
      if(token.type==="heading_open") {
        const level=Number(token.tag.slice(1));
        paragraph(inline(tokens[i+1]?.children||[],{bold:true,color:"244677"}),{heading:([D.HeadingLevel.HEADING_1,D.HeadingLevel.HEADING_2,D.HeadingLevel.HEADING_3,D.HeadingLevel.HEADING_4,D.HeadingLevel.HEADING_5,D.HeadingLevel.HEADING_6])[level-1],indent:{firstLine:0},spacing:{before:240,after:120},keepNext:true});i+=2;
      } else if(token.type==="inline")paragraph(inline(token.children||[]));
      else if(token.type==="bullet_list_open"||token.type==="ordered_list_open") {
        const level=Math.min(lists.length,8),reference=`list${++sequence}`,ordered=token.type==="ordered_list_open";
        configs.push({reference,levels:[{level,format:ordered?D.LevelFormat.DECIMAL:D.LevelFormat.BULLET,text:ordered?`%${level+1}.`:"•",start:Number(token.attrGet("start")||1),alignment:D.AlignmentType.START,style:{paragraph:{indent:{left:480*(level+1),hanging:300}}}}]});
        lists.push({reference,level,first:true});
      } else if(token.type==="list_item_open") {if(lists.length)lists[lists.length-1].first=true;}
      else if(token.type==="bullet_list_close"||token.type==="ordered_list_close")lists.pop();
      else if(token.type==="blockquote_open") {
        let depth=1,end=i+1; for(;end<tokens.length;end++){if(tokens[end].type==="blockquote_open")depth++;if(tokens[end].type==="blockquote_close"&&!--depth)break;}
        out.push(...blocks(tokens.slice(i+1,end),quote+1));i=end;
      } else if(token.type==="fence"||token.type==="code_block")paragraph(codeRuns(token.content,token.info.trim().split(/\s/)[0]),{indent:{firstLine:0},shading:{fill:"F5F5F5"},spacing:{before:100,after:100,line:260}});
      else if(token.type==="hr")paragraph([],{border:{bottom:BORDER},indent:{firstLine:0}});
      else if(token.type==="footnote_block_open") {
        let end=i+1;
        while(end<tokens.length&&tokens[end].type!=="footnote_block_close") {
          if(tokens[end].type==="footnote_open") {
            const id=Number(tokens[end].meta.id)+1,start=++end;
            while(end<tokens.length&&tokens[end].type!=="footnote_close")end++;
            footnotes[String(id)]={children:blocks(tokens.slice(start,end)).filter((b):b is D.Paragraph=>b instanceof D.Paragraph)};
          }end++;
        }i=end;
      } else if(token.type==="table_open") {
        const rows:Array<Array<{runs:Token[];head:boolean;align:string}>>=[];let row:typeof rows[number]=[],head=false,align="";
        let end=i+1;
        for(;end<tokens.length&&tokens[end].type!=="table_close";end++) {
          const t=tokens[end];
          if(t.type==="tr_open")row=[];
          if(t.type==="th_open"||t.type==="td_open"){head=t.type==="th_open";align=t.attrGet("style")||"";}
          if(t.type==="inline")row.push({runs:t.children||[],head,align});
          if(t.type==="tr_close")rows.push(row);
        }
        const cols=Math.max(1,...rows.map(r=>r.length)), weights=Array.from({length:cols},(_,c)=>Math.sqrt(Math.max(4,...rows.map(r=>(r[c]?.runs||[]).reduce((n,t)=>n+[...t.content].reduce((n,c)=>n+(c.charCodeAt(0)>255?2:1),0),0)))));
        const sum=weights.reduce((a,b)=>a+b,0), minimum=Math.floor(WIDTH/(cols*2));
        const widths=weights.map(w=>Math.floor(minimum+(WIDTH-minimum*cols)*w/sum));widths[cols-1]+=WIDTH-widths.reduce((a,b)=>a+b,0);
        const border={top:BORDER,bottom:BORDER,left:BORDER,right:BORDER,insideHorizontal:BORDER,insideVertical:BORDER};
        out.push(new D.Table({width:{size:WIDTH,type:D.WidthType.DXA},columnWidths:widths,layout:D.TableLayoutType.FIXED,borders:border,rows:rows.map((r,ri)=>new D.TableRow({tableHeader:ri===0,children:r.map((cell,c)=>new D.TableCell({width:{size:widths[c],type:D.WidthType.DXA},borders:border,shading:cell.head?{fill:"EDF2F7"}:undefined,margins:{top:80,bottom:80,left:100,right:100},children:[new D.Paragraph({children:inline(cell.runs,{bold:cell.head}),spacing:{after:60},alignment:cell.align.includes("right")?D.AlignmentType.RIGHT:cell.align.includes("center")?D.AlignmentType.CENTER:D.AlignmentType.LEFT})]}))}))}));i=end;
        out.push(new D.Paragraph({text:"",spacing:{after:60}}));
      }
    }
    return out;
  }
  const children=blocks(tokens);
  const wordDocument=new D.Document({styles:{default:{document:{run:{font:{ascii:FONT,hAnsi:FONT,eastAsia:FONT,cs:FONT},size:22},paragraph:{spacing:{after:120,line:360}}}}},footnotes,numbering:{config:configs},sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1200,bottom:1200,left:1800,right:1800}}},children}]});
  return D.Packer.toBlob(wordDocument);
}
