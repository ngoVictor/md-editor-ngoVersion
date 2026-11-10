// docx.ts —— HTML → .docx 纯函数 + docx 排版后处理（无状态：node/浏览器均可测，不依赖应用状态）
// html-to-docx 动态 import：点击导出时才加载，避免增大首屏包体。
//
// html-to-docx 的能力盲区（margin/中文字体/代码底纹），本模块用 jszip 直接改 OOXML 补上：
//   1. 每个段落都带 <w:spacing w:lineRule="auto"/> 空 spacing，覆盖了 docDefaults 的段后间距 → 段落挤在一起；
//      这里按段落类型（标题/正文/列表/引用/代码块）重写 spacing 与缩进。
//   2. styles.xml 的中文字体是 eastAsiaTheme="minorHAnsi"（Word 默认字体），改为显式微软雅黑。
//   3. 代码块段落加浅灰底纹。
import JSZip from "jszip";
type HtmlToDocx = (html: string, header?: string | null, options?: Record<string, unknown>, footer?: string) => Promise<Blob | Uint8Array>;

// 页面配置：A4、常规页边距、微软雅黑（中文友好）
const DOCX_OPTIONS = {
  font: "Microsoft YaHei",
  pageSize: { width: 11906, height: 16838 }, // A4（twips）
  margins: { top: 1440, right: 1800, bottom: 1440, left: 1800 },
};

export async function htmlToDocxBlob(html: string): Promise<Blob> {
  const mod = await import("html-to-docx");
  const convert = (mod.default ?? mod) as unknown as HtmlToDocx;
  const out = await convert(html, null, DOCX_OPTIONS);
  if (out instanceof Blob) return out;
  // node 环境返回 Uint8Array（Buffer 子类）：Blob 构造器接受 TypedArray view，
  // 会按 byteOffset/byteLength 复制正确字节（不能传 .buffer，那是底层大池子）
  const u8 = out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
  return new Blob([u8], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

// ---- OOXML 排版后处理（绕开 html-to-docx 的 margin 盲区）----

// 标题段前/段后间距（按级别递减；w:before/w:after 单位为 twips，1pt=20）
const HEADING_SPACING: Record<string, string> = {
  "1": ' w:before="240" w:after="120"',
  "2": ' w:before="180" w:after="90"',
  "3": ' w:before="120" w:after="60"',
  "4": ' w:before="60" w:after="40"',
  "5": ' w:before="60" w:after="40"',
  "6": ' w:before="60" w:after="40"',
};

// 单段落排版：按类型重写 spacing，正文加首行缩进，代码块加底纹
function beautifyParagraph(p: string): string {
  const headingMatch = p.match(/<w:pStyle w:val="Heading(\d)"/);
  const headingLevel = headingMatch ? headingMatch[1] : null;
  const isList = /<w:numPr>/.test(p); // 列表项（有序/无序）
  const isCode = /<w:rFonts w:ascii="Courier"/.test(p); // 代码块行（等宽字体）
  const isQuote = /<w:ind w:left=/.test(p); // 引用块（beautifyForWord 已降级为缩进段落）

  let spacing: string;
  if (headingLevel) {
    spacing = `<w:spacing${HEADING_SPACING[headingLevel] ?? ""} w:line="360" w:lineRule="auto"/>`;
  } else if (isCode) {
    spacing = '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>'; // 代码行紧凑（auto 行高，避免中文被裁剪）
  } else if (isList || isQuote) {
    spacing = '<w:spacing w:after="60" w:line="360" w:lineRule="auto"/>';
  } else {
    spacing = '<w:spacing w:after="120" w:line="360" w:lineRule="auto"/>'; // 正文：6pt 段后 + 1.5 倍行距
  }
  p = p.replace(/<w:spacing[^>]*\/>/, spacing);

  // 首行缩进 2 字符：仅正文段落（标题/列表/引用/代码不加）
  if (!headingLevel && !isList && !isQuote && !isCode) {
    p = p.replace(/(<w:pPr[^>]*>)/, '$1<w:ind w:firstLineChars="200" w:firstLine="480"/>');
  }
  // 引用块左竖线（html-to-docx 忽略 border-left，这里在 OOXML 层补灰色引用条）
  if (isQuote) {
    p = p.replace(/(<w:pPr[^>]*>)/, '$1<w:pBdr><w:left w:val="single" w:sz="18" w:space="4" w:color="d0d7de"/></w:pBdr>');
  }
  // 代码块浅灰底纹
  if (isCode) {
    p = p.replace(/(<w:pPr[^>]*>)/, '$1<w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/>');
  }
  return p;
}

// 表格：单元格内段落紧凑（单倍行距 + 段后 0）；仅当首行确实含加粗（<w:b/>，即 markdown 表头）
// 时才加表头浅灰底纹——无 thead 的普通表格首行不应被误当成表头。
function beautifyTable(tbl: string): string {
  // Explicit cell borders override the converter's nil/zero borders in Word/WPS.
  const edges = ["top", "left", "bottom", "right", "insideH", "insideV"];
  const borders = edges.map(edge => `<w:${edge} w:val="single" w:sz="6" w:color="808080"/>`).join("");
  tbl = tbl.replace(/<w:tblBorders>[\s\S]*?<\/w:tblBorders>/g, "")
    .replace(/<w:tcBorders>[\s\S]*?<\/w:tcBorders>/g, "")
    .replace(/<w:tblPr>/, `<w:tblPr><w:tblBorders>${borders}</w:tblBorders>`)
    .replace(/<w:tcPr>/g, `<w:tcPr><w:tcBorders>${borders}</w:tcBorders>`);
  tbl = tbl.replace(/<w:p>[\s\S]*?<\/w:p>/g, (p) =>
    p.replace(/<w:spacing[^>]*\/>/, '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>')
  );
  const firstTr = tbl.match(/<w:tr>[\s\S]*?<\/w:tr>/);
  if (firstTr && /<w:b\/>/.test(firstTr[0])) {
    const shaded = firstTr[0].replace(/(<w:tcPr>)/g, '$1<w:shd w:val="clear" w:color="auto" w:fill="EDF2F7"/>');
    tbl = tbl.replace(/<w:tr>[\s\S]*?<\/w:tr>/, shaded);
  }
  return tbl;
}

// 中文字体：styles.xml docDefaults 里 eastAsiaTheme="minorHAnsi" → 显式微软雅黑（全部出现处）
function fixEastAsiaFont(stylesXml: string): string {
  return stylesXml.replace(/w:eastAsiaTheme="minorHAnsi"/g, 'w:eastAsia="Microsoft YaHei"');
}

// 表格列宽：html-to-docx 只等分列宽，按 beautifyForWord 算好的比例改写 gridCol
function adjustTableWidths(xml: string, colWidths: number[][]): string {
  if (colWidths.length === 0) return xml;
  const TOTAL_W = DOCX_OPTIONS.pageSize.width - DOCX_OPTIONS.margins.left - DOCX_OPTIONS.margins.right;
  let idx = 0;
  return xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (tbl) => {
    const widths = colWidths[idx++];
    if (!widths) return tbl;
    const sizes = widths.map(w => Math.round(w * TOTAL_W));
    sizes[sizes.length - 1] += TOTAL_W - sizes.reduce((a, b) => a + b, 0);
    const cols = sizes.map(w => `<w:gridCol w:w="${w}"/>`).join("");
    // html-to-docx 对 thead/tbody 各生成一个 tblGrid（畸形），去掉全部后只在 tblPr 后插入唯一正确的 grid
    const grid = `<w:tblGrid>${cols}</w:tblGrid>`;
    let t = tbl.replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/g, "");
    if (/<w:tblPr>[\s\S]*?<\/w:tblPr>/.test(t)) {
      t = t.replace(/(<w:tblPr>[\s\S]*?<\/w:tblPr>)/, `$1${grid}`);
    } else {
      t = t.replace(/(<w:tbl[^>]*>)/, `$1${grid}`);
    }
    t = t.replace(/<w:tblW[^>]*\/>/, `<w:tblW w:w="${TOTAL_W}" w:type="dxa"/>`);
    // Grid and cell widths must agree; changing only tblGrid leaves conflicting widths.
    return t.replace(/<w:tr>[\s\S]*?<\/w:tr>/g, row => {
      let column = 0;
      return row.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, cell => {
        const span = Number(cell.match(/<w:gridSpan w:val="(\d+)"/)?.[1] || 1);
        const width = sizes.slice(column, column + span).reduce((a, b) => a + b, 0);
        column += span;
        if (!width) return cell;
        const tcWidth = `<w:tcW w:w="${width}" w:type="dxa"/>`;
        return /<w:tcW/.test(cell) ? cell.replace(/<w:tcW[^>]*\/>/, tcWidth) : cell.replace(/<w:tcPr>/, `<w:tcPr>${tcWidth}`);
      });
    });
  });
}

// 统一后处理入口：段落间距/缩进/底纹 + 中文字体 + 表格列宽（一次解包/打包）
export async function beautifyDocx(blob: Blob, colWidths: number[][]): Promise<Blob> {
  // 用 arrayBuffer 而非 Blob 传入：jszip 在 Node 环境读 Blob 有兼容问题（读 ArrayBuffer 稳定）
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());

  // 1. Match whole tables before paragraphs so cell paragraphs keep their own policy.
  // No sentinel substitution: literal document text must never become XML.
  let docXml = await zip.file("word/document.xml")!.async("string");
  // html-to-docx 会给 pgMar 写 header/footer/gutter="undefined"（非法属性），清理掉
  docXml = docXml.replace(/ w:(header|footer|gutter)="undefined"/g, "");
  docXml = docXml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p>[\s\S]*?<\/w:p>/g,
    block => block.startsWith("<w:tbl>") ? beautifyTable(block) : beautifyParagraph(block));
  if (colWidths.length > 0) docXml = adjustTableWidths(docXml, colWidths);
  zip.file("word/document.xml", docXml);

  // 2. styles.xml：中文字体
  const stylesFile = zip.file("word/styles.xml");
  if (stylesFile) {
    const stylesXml = await stylesFile.async("string");
    zip.file("word/styles.xml", fixEastAsiaFont(stylesXml));
  }

  return (await zip.generateAsync({ type: "blob" })) as Blob;
}
