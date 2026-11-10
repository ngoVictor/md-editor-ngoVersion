// Validate raster dimensions before asking the browser to allocate decoded pixels.
export function rasterSize(uri: string): {width:number; height:number} {
  const match = uri.match(/^data:image\/(png|jpeg|gif|webp);base64,([a-z0-9+/=\s]+)$/i);
  if (!match || match[2].length > 6 * 1024 * 1024) throw Error("Unsupported image or image exceeds 4 MB");
  const binary = atob(match[2].replace(/\s/g,""));
  if (binary.length > 4 * 1024 * 1024) throw Error("Image exceeds 4 MB");
  const bytes = Uint8Array.from(binary, c=>c.charCodeAt(0)), view = new DataView(bytes.buffer);
  const ascii = (a:number,b:number) => binary.slice(a,b);
  let width=0,height=0;
  if (bytes.length>=24 && ascii(0,8)==="\x89PNG\r\n\x1a\n" && ascii(12,16)==="IHDR") {width=view.getUint32(16);height=view.getUint32(20);}
  else if (bytes.length>=10 && /^GIF8[79]a$/.test(ascii(0,6))) {width=view.getUint16(6,true);height=view.getUint16(8,true);}
  else if (bytes[0]===255 && bytes[1]===216) {
    let offset=2;
    while(offset+4<=bytes.length) {
      if (bytes[offset++]!==255) break;
      while(bytes[offset]===255) offset++;
      const marker=bytes[offset++];
      if(marker===0xda || marker===0xd9) break;
      if(marker===1 || (marker>=0xd0 && marker<=0xd7)) continue;
      if(offset+2>bytes.length) break;
      const length=view.getUint16(offset);
      if(length<2 || offset+length>bytes.length) break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length>=7) {height=view.getUint16(offset+3);width=view.getUint16(offset+5);break;}
      offset+=length;
    }
  } else if(bytes.length>=30 && ascii(0,4)==="RIFF" && ascii(8,12)==="WEBP") {
    const le24=(at:number)=>bytes[at]+bytes[at+1]*256+bytes[at+2]*65536;
    if(ascii(12,16)==="VP8X") {width=le24(24)+1;height=le24(27)+1;}
    else if(ascii(12,16)==="VP8 " && ascii(23,26)==="\x9d\x01\x2a") {width=view.getUint16(26,true)&0x3fff;height=view.getUint16(28,true)&0x3fff;}
    else if(ascii(12,16)==="VP8L" && bytes[20]===0x2f) {const bits=view.getUint32(21,true);width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;}
  }
  if(!width || !height || width>8192 || height>8192 || width*height>16_000_000) throw Error("Invalid image or dimensions exceed 8192 / 16 megapixels");
  return {width,height};
}
export async function decodeRaster(uri:string, word:boolean):Promise<string> {
  rasterSize(uri);
  const img = new Image();
  await new Promise<void>((resolve,reject)=>{
    const done=(error?:Error)=>{clearTimeout(timer);img.onload=null;img.onerror=null;if(error){img.src="";reject(error);}else resolve();};
    const timer=window.setTimeout(()=>done(Error("Image decode timed out")),10000);
    img.onload=()=>done();img.onerror=()=>done(Error("Invalid image content"));img.src=uri;
  });
  if(!word) return uri;
  const canvas=document.createElement("canvas");canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
  try {const context=canvas.getContext("2d");if(!context) throw Error("Image canvas unavailable");context.drawImage(img,0,0);return canvas.toDataURL("image/png");}
  finally {canvas.width=canvas.height=0;}
}
