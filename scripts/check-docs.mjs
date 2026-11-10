// Read-only checks for current documentation links and source-backed limits.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const relative = file => path.relative(root, file).replaceAll('\\', '/');
const parser = new MarkdownIt();
const errors = [], checked = [], sourceFacts = [];
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw Error('Unexpected linked path: ' + file);
    return entry.isDirectory() ? files(file) : [file];
  });
}
const slugs = new Map();
function slug(text) { return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s-]/gu, "").trim().replace(/\s+/g, "-"); }
function headings(file) {
  if (slugs.has(file)) return slugs.get(file);
  const tokens = parser.parse(fs.readFileSync(file, "utf8"), {}), used = new Set(), counts = new Map();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "heading_open") continue;
    const children = tokens[i + 1]?.children || [];
    const text = children.filter(token => ["text", "code_inline", "image"].includes(token.type)).map(token => token.content).join("");
    const base = slug(text); let count = counts.get(base) || 0, value = count ? `${base}-${count}` : base;
    while (used.has(value)) { count++; value = `${base}-${count}`; }
    used.add(value); counts.set(base, count + 1);
  }
  slugs.set(file, used); return used;
}
function visit(tokens, action) { for (const token of tokens) { action(token); if (token.children) visit(token.children, action); } }
const currentDocs = files(path.join(root, 'doc')).filter(file => file.endsWith('.md'));
for (const file of [...currentDocs, path.join(root, 'README.md'), path.join(root, 'AGENTS.md')]) {
  visit(parser.parse(fs.readFileSync(file, 'utf8'), {}), token => {
    if (!['link_open', 'image'].includes(token.type)) return;
    const href = token.attrGet(token.type === 'image' ? 'src' : 'href');
    if (!href || /^(?:https?:|mailto:|tel:|data:)/i.test(href)) return;
    let decoded;
    try { decoded = decodeURIComponent(href); } catch { errors.push({ file: relative(file), href, reason: 'invalid-url-encoding' }); return; }
    const index = decoded.indexOf('#');
    const raw = index < 0 ? decoded : decoded.slice(0, index);
    const hash = index < 0 ? '' : decoded.slice(index + 1);
    const target = raw ? path.resolve(path.dirname(file), raw.replace(/:\d+(?::\d+)?$/, '')) : file;
    const result = { file: relative(file), href };
    checked.push(result);
    if (!fs.existsSync(target)) errors.push({ ...result, reason: 'missing-path' });
    else if (hash && target.endsWith('.md') && !/^L\d/.test(hash) && !headings(target).has(slug(hash))) errors.push({ ...result, reason: 'missing-anchor' });
  });
}
if (!/^## 9\. 快捷键与常见处理$/m.test(read("doc/使用指南.md"))) errors.push({ kind: "guide-test-anchor-changed" });
const limits = read("doc/能力边界与限制.md");
function fact(name, source, regex, rowName, format) {
  const match = read(source).match(regex), row = limits.split("\n").find(line => line.startsWith(`| ${rowName} |`));
  const ok = !!match && !!row && row.includes(format(match[1]));
  sourceFacts.push({ name, source, row: rowName, value: match?.[1] ?? null, passed: ok });
  if (!ok) errors.push({ kind: "source-document-fact", name, source, rowName });
}
fact("Markdown byte limit", "src-tauri/src/lib.rs", /MAX_OPEN_BYTES: u64 = (\d+) \*/, "Markdown 打开/保存", value => `${value} MiB`);
fact("Export Markdown limit", "src/export-snapshot.ts", /byteLength > (\d+) \*/, "所有导出入口", value => `${value} MiB`);
fact("Preview byte limit", "src-tauri/src/resources.rs", /MAX_PREVIEW: u64 = (\d+) \*/, "源码预览", value => `${value} MiB`);
fact("Preview window count", "src-tauri/src/preview_windows.rs", /MAX_WINDOWS: usize = (\d+)/, "源码预览", value => `${value} 个`);
fact("PDF wait", "src-tauri/src/pdf_webview.rs", /Duration::from_secs\((\d+)\)/, "PDF", value => `${value} 秒`);
fact("Image byte limit", "src-tauri/src/assets.rs", /MAX_IMAGE: u64 = (\d+) \*/, "本地嵌图", value => `${value} MiB`);
fact("Embedded image positions", "src/export-assets.ts", /MAX_IMAGES=(\d+)/, "导出嵌图预算", value => `${value} 个`);
fact("Autosave interval", "src/autosave.ts", /}, (\d+)\)/, "自动保存/外改", value => `${Number(value) / 1000} 秒`);
fact("Session path count", "src/session.ts", /entries\.slice\(0, (\d+)\)/, "会话", value => `${value} 个`);
fact("Undo snapshot count", "src/history.ts", /MAX_STEPS = (\d+)/, "撤销", value => `${value} 个`);
fact("Find match count", "src/find-engine.ts", /matches\.length === (\d+)/, "源码查找", value => Number(value).toLocaleString("en-US"));
fact("Special source characters", "src/export-specials.ts", /source\.length>(\d+)/, "公式/Mermaid", value => `${value} 个 JS 字符`);
fact("PNG height", "src/export-png.ts", /height>(\d+)/, "PNG", value => `${value} px`);
fact("Tab transfer payload", "src-tauri/src/windows.rs", /> (\d+) \* 1024/, "窗口转移", value => `${value} MiB`);
const config = JSON.parse(read("src-tauri/tauri.conf.json"));
if (config.identifier !== "com.alei.md-editor.integration" || config.version !== "0.1.0") errors.push({ kind: "application-baseline-changed" });
const formats = [...read("src/export.ts").matchAll(/id: "([^"]+)"/g)].map(match => match[1]);
if (formats.join(",") !== "html-styled,html-plain,docx,docx-legacy,png,print,pdf") errors.push({ kind: "export-registry-changed", formats });
if (!read("vite.config.ts").includes('preview: "preview.html"')) errors.push({ kind: "preview-build-entry" });
console.log(JSON.stringify({ passed: !errors.length, markdownFiles: currentDocs.length + 2, linksChecked: checked.length, sourceFacts, errors }, null, 2));
process.exitCode = errors.length ? 1 : 0;
