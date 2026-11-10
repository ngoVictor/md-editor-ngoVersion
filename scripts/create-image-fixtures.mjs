import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {deflateSync} from 'node:zlib';
const root=resolve(process.argv[2]);if(!root.startsWith(resolve('test-results/native-images-')) && !root.startsWith(resolve('test-results/native-p4p5-')))throw Error('Unsafe fixture root');
const dir=join(root,'图片 资源');mkdirSync(dir);
function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([len,name,data,crc]);}
const w=480,h=160,header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=2;
const raw=Buffer.alloc((w*3+1)*h);const colors=[[36,70,119],[51,145,110],[239,182,60]];
for(let y=0;y<h;y++)for(let x=0;x<w;x++){const at=y*(w*3+1)+1+x*3;const color=colors[Math.floor(x/160)];for(let k=0;k<3;k++)raw[at+k]=(y<12||y>147)?255:color[k];}
writeFileSync(join(dir,'色块.png'),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
writeFileSync(join(dir,'fake.png'),'<svg onload="alert(1)"/>');
const md=join(root,'README.md');let text=readFileSync(md,'utf8');text=text.replace('## 代码与排版','![本地图片验证](<./图片 资源/色块.png>)\n\n![缺图说明](missing.png)\n\n## 代码与排版');writeFileSync(md,text);
