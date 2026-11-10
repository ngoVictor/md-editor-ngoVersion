// Source-position edits preserve every byte outside real Markdown image nodes.
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";
export interface ImageReference { start: number; end: number; url: string; render(url: string): string }
export function imageReferences(markdown: string): ImageReference[] {
  const tree = fromMarkdown(markdown), references = new Set<string>(), out: ImageReference[] = [];
  const visit = (node: Nodes, fn: (node: Nodes) => void) => { fn(node); if ("children" in node) node.children.forEach(n => visit(n, fn)); };
  visit(tree, n => { if (n.type === "imageReference") references.add(n.identifier); });
  const quote = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  visit(tree, n => {
    if (n.type !== "image" && !(n.type === "definition" && references.has(n.identifier))) return;
    const start = n.position?.start.offset, end = n.position?.end.offset;
    if (start === undefined || end === undefined) return;
    const title = n.title ? ` "${quote(n.title)}"` : "";
    out.push({start, end, url: n.url, render: url => n.type === "image"
      ? `![${(n.alt || "").replace(/[\\[\]]/g, "\\$&")}](${url.replace(/[()<>]/g, c => "%"+c.charCodeAt(0).toString(16)).replace(/\s/g, encodeURIComponent)}${title})`
      : `[${n.label || n.identifier}]: <${url}>${title}`});
  });
  return out;
}
export function rewriteImageReferences(markdown: string, convert: (url: string) => string): string {
  for (const item of imageReferences(markdown).reverse()) {
    const url = convert(item.url);
    if (url !== item.url) markdown = markdown.slice(0, item.start) + item.render(url) + markdown.slice(item.end);
  }
  return markdown;
}
export function absoluteImageReference(sourcePath: string | null, reference: string): string {
  if (/^(?:data:|https?:|file:|[a-z]:[\\/]|\/\/)/i.test(reference) || !sourcePath) return reference;
  const base=new URL("file:///");base.pathname="/"+sourcePath.replace(/\\/g,"/");
  return new URL(reference.replace(/\\/g, "/"), base).href;
}
