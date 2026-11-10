import MarkdownIt from "markdown-it";
import { save } from "@tauri-apps/plugin-dialog";
import { captureExportSnapshot } from "./export-snapshot";
import { prepareExportAssets, assetNotice } from "./export-assets";
import { tokensToDocx } from "./docx-tokens";
import { fileService } from "./file-service";
import { showInfo } from "./ui";
import { t } from "./i18n";
import { esc } from "./state";
import { specialMarkdown } from "./export-specials";
import { imageReferences } from "./image-references";
type Picker = (name: string) => Promise<string | null>;
const defaultPicker: Picker = name => save({defaultPath:name,filters:[{name:"Word",extensions:["docx"]}]});
let picker = defaultPicker;
export function setTokenWordPickerForTests(value: Picker | null): void { picker=value||defaultPicker; }
export async function exportTokenWord(): Promise<void> {
  const snapshot=captureExportSnapshot(); if(!snapshot)return;
  const specials=await specialMarkdown(snapshot.markdown);
  const refs=imageReferences(specials.markdown);
  const source=document.createElement("template");
  // Preserve failed positions: build one image mapping per source, not per surviving <img> index.
  const images=new Map<string,string>();
  const original=document.createElement("template");original.innerHTML=refs.map(r=>`<span data-image-key="${esc(r.url)}"><img src="${esc(r.url)}"></span>`).join("");
  const mapped=await prepareExportAssets({...snapshot,html:original.innerHTML},true);
  source.innerHTML=mapped.html;
  source.content.querySelectorAll("[data-image-key]").forEach(el=>{const src=el.querySelector("img")?.getAttribute("src");if(src){const key=el.getAttribute("data-image-key")!;images.set(key,src);images.set(new MarkdownIt().normalizeLink(key),src);}});
  const blob=await tokensToDocx(specials.markdown,images);
  const chosen=await picker(snapshot.name.replace(/\.(md|markdown|mdown|txt)$/i,"")+".docx");if(!chosen)return;
  const path=/\.docx$/i.test(chosen)?chosen:chosen+".docx";
  const bytes=new Uint8Array(await blob.arrayBuffer());let binary="";for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  await fileService().saveDocx(path,btoa(binary));showInfo(t("exportOk")+path+assetNotice(mapped)+(specials.issues.length?"\n"+specials.issues.join("\n"):""));
}
