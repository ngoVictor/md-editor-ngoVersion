// Standalone HTML serializer: no application state, IO, scripts or network resources.
import { esc } from "./state";
const TAGS = new Set("p h1 h2 h3 h4 h5 h6 blockquote pre code a ul ol li table thead tbody tfoot tr th td hr br em strong b i s del span div sup sub input img".split(" "));
const DROP = new Set(["script", "style", "iframe", "object", "embed", "link", "meta", "base", "form", "svg", "math"]);
const STYLE = `body{font-family:"Microsoft YaHei",system-ui,sans-serif;color:#263244;background:#fff;line-height:1.65;max-width:960px;margin:32px auto;padding:0 24px}h1,h2,h3{color:#244677}h1,h2{border-bottom:1px solid #d9e1eb;padding-bottom:8px}table{display:block;overflow:auto;max-width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #8996a8;padding:8px 12px;text-align:left}th{background:#edf2f7}pre{padding:14px;background:#f5f5f5;overflow:auto;white-space:pre}code{font-family:Consolas,monospace}blockquote{border-left:3px solid #9aa9bc;margin-left:0;padding-left:16px;color:#536278}img{max-width:100%;height:auto}a{color:#2463bd}del,s{text-decoration:line-through}@page{size:A4;margin:18mm}@media print{body{margin:0;max-width:none}table{display:table;width:100%;table-layout:fixed}td,th{overflow-wrap:anywhere}pre{white-space:pre-wrap}thead{display:table-header-group}tr{break-inside:avoid}h1,h2,h3,h4,h5,h6{break-after:avoid}pre{overflow-wrap:anywhere}}`;
export function buildHtmlExport(html: string, title: string, styled: boolean): { html: string; omittedImages: number } {
  const source = document.createElement("template"), out = document.implementation.createHTMLDocument("");
  source.innerHTML = html; // Template contents stay inert, including remote images.
  let omittedImages = 0;
  function copy(node: Node): Node {
    if (node.nodeType === Node.TEXT_NODE) return out.createTextNode(node.textContent || "");
    if (!(node instanceof Element)) return out.createTextNode("");
    const tag = node.tagName.toLowerCase();
    if (DROP.has(tag)) return out.createTextNode("");
    if (!TAGS.has(tag)) return out.createTextNode(node.textContent || "");
    if (tag === "img" && !/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(node.getAttribute("src") || "")) {
      omittedImages++; return out.createTextNode(`[${node.getAttribute("alt") || "Image"}: ${node.getAttribute("src") || ""}]`);
    }
    const el = out.createElement(tag);
    if (tag === "a") { const href = node.getAttribute("href") || ""; if (/^(https?:|mailto:|tel:|#)/i.test(href)) { el.setAttribute("href", href); el.setAttribute("rel", "noopener noreferrer"); } }
    if (tag === "img") { el.setAttribute("src", node.getAttribute("src")!); el.setAttribute("alt", node.getAttribute("alt") || ""); }
    if (tag === "input") { el.setAttribute("type", "checkbox"); el.setAttribute("disabled", ""); if (node.hasAttribute("checked")) el.setAttribute("checked", ""); }
    for (const attr of ["id", "title"]) if (node.hasAttribute(attr)) el.setAttribute(attr, node.getAttribute(attr)!);
    for (const attr of tag === "ol" ? ["start"] : ["colspan", "rowspan"]) { const value = node.getAttribute(attr); if (value && /^\d{1,6}$/.test(value)) el.setAttribute(attr, value); }
    for (const child of node.childNodes) el.append(copy(child));
    return el;
  }
  for (const node of source.content.childNodes) out.body.append(copy(node));
  const csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  return { omittedImages, html: `<!doctype html>\n<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${esc(title)}</title>${styled ? `<style>${STYLE}</style>` : ""}</head><body>${out.body.innerHTML}</body></html>\n` };
}
