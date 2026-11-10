// html-to-docx 类型声明（库未附带类型）
declare module "html-to-docx" {
  interface DocxOptions {
    orientation?: "portrait" | "landscape";
    pageSize?: { width?: number; height?: number };
    margins?: { top?: number; right?: number; bottom?: number; left?: number; header?: number; footer?: number; gutter?: number };
    title?: string;
    subject?: string;
    creator?: string;
    keywords?: string[];
    description?: string;
    lastModifiedBy?: string;
    revision?: number;
    createdAt?: Date;
    modifiedAt?: Date;
    header?: boolean;
    footer?: boolean;
    headerType?: "default" | "first" | "even";
    footerType?: "default" | "first" | "even";
    font?: string;
    fontSize?: number;
    complexScriptFontSize?: number;
    table?: { row?: { cantSplit?: boolean } };
    pageNumber?: boolean;
    skipFirstHeaderFooter?: boolean;
    lineNumber?: boolean;
    lineNumberOptions?: Record<string, unknown>;
    numbering?: Record<string, unknown>;
    decodeUnicode?: boolean;
    lang?: string;
  }
  export default function HTMLtoDOCX(
    htmlString: string,
    headerHTMLString?: string | null,
    documentOptions?: DocxOptions,
    footerHTMLString?: string
  ): Promise<Blob | Uint8Array>;
}
