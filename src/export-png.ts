import html2canvas from "html2canvas";
import { save } from "@tauri-apps/plugin-dialog";
import { captureExportSnapshot } from "./export-snapshot";
import { prepareExportAssets, assetNotice } from "./export-assets";
import { buildHtmlExport } from "./html-export";
import { outputService } from "./file-service";
import { showInfo } from "./ui";
import { t } from "./i18n";
export async function renderHtmlPng(html: string): Promise<string> {
  const frame=document.createElement("iframe");frame.setAttribute("sandbox","allow-same-origin");
  frame.style.cssText="position:fixed;left:-12000px;top:0;width:1000px;height:900px;border:0;pointer-events:none";
  try {
    await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error("PNG layout timed out")),15000);frame.onload=()=>{clearTimeout(timer);resolve();};frame.srcdoc=html;document.body.append(frame);});
    const doc=frame.contentDocument!; await doc.fonts.ready;
    await Promise.all([...doc.images].map(image=>image.decode().catch(()=>{})));
    const width=1000,height=Math.ceil(Math.max(doc.body.scrollHeight,doc.documentElement.scrollHeight));
    if(height>16000 || width*height>16_000_000)throw Error("PNG 上限为 1600 万像素；请拆分文档或使用 PDF。");
    frame.style.height=height+"px";
    const canvas=await html2canvas(doc.body,{backgroundColor:"#ffffff",scale:1,width,height,windowWidth:width,windowHeight:height,logging:false,useCORS:false});
    try{return canvas.toDataURL("image/png").split(",")[1];}finally{canvas.width=canvas.height=0;}
  } finally {frame.remove();}
}
export async function exportPng(): Promise<void> {
  const snapshot=captureExportSnapshot();if(!snapshot)return;
  const assets=await prepareExportAssets(snapshot),html=buildHtmlExport(assets.html,snapshot.name,true).html;
  const dataBase64=await renderHtmlPng(html);
  const chosen=await save({defaultPath:snapshot.name.replace(/\.(md|markdown|mdown|txt)$/i,"")+".png",filters:[{name:"PNG",extensions:["png"]}]});if(!chosen)return;
  const path=/\.png$/i.test(chosen)?chosen:chosen+".png";
  await outputService().savePng(path,dataBase64);showInfo(t("exportOk")+path+assetNotice(assets));
}
