// Only generated runtime resources belong in public; editor JS/CSS are bundled by Vite.
// Keep every optional renderer, locale, icon, theme and highlight language offline.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const source = join(root, "node_modules", "vditor", "dist");
const target = join(root, "public", "vditor-assets", "dist");

export function planRuntimeAssets(input = source) {
  const files = new Map();
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes:true })) {
      const full = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Unexpected linked Vditor resource: ${full}`);
      if (entry.isDirectory()) { walk(full); continue; }
      const name = relative(input, full).replaceAll("\\", "/");
      if (!/^(?:js|css|images)\//.test(name) && name !== "method.min.js") continue;
      // WebView2 supports WOFF2; remove only redundant KaTeX fallback encodings.
      if (/^js\/katex\/fonts\/.*\.(woff|ttf)$/.test(name)) {
        if (!existsSync(full.replace(/\.(woff|ttf)$/, ".woff2"))) throw new Error(`Missing WOFF2 counterpart: ${name}`);
        continue;
      }
      let content = readFileSync(full);
      if (name === "js/katex/katex.min.css") {
        content = Buffer.from(content.toString("utf8").replace(/,url\(fonts\/[^)]+\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)/g, ""));
      }
      files.set(name, content);
    }
  }
  walk(input);
  for (const required of ["js/lute/lute.min.js", "js/mermaid/mermaid.min.js", "js/mathjax/tex-svg-full.js", "js/katex/katex.min.css", "js/highlight.js/highlight.min.js", "css/content-theme/light.css", "css/content-theme/dark.css"]) {
    if (!files.has(required)) throw new Error(`Missing Vditor runtime asset: ${required}`);
  }
  const css = files.get("js/katex/katex.min.css").toString("utf8");
  for (const match of css.matchAll(/url\(([^)]+)\)/g)) {
    if (!files.has("js/katex/" + match[1])) throw new Error(`Unresolved KaTeX font URL: ${match[1]}`);
  }
  return files;
}

export function copyRuntimeAssets() {
  if (!existsSync(source)) throw new Error("Missing node_modules/vditor/dist; run npm install first.");
  const files = planRuntimeAssets(); // validate before removing any generated files
  // Recursive cleanup is limited to this exact generated directory; reject redirected parents.
  const realRoot = realpathSync(root);
  for (const part of ["public", "public/vditor-assets", "public/vditor-assets/dist"]) {
    const path = join(root, part);
    if (existsSync(path) && (lstatSync(path).isSymbolicLink() || realpathSync(path) !== resolve(realRoot, part))) {
      throw new Error(`Refusing redirected generated asset directory: ${path}`);
    }
  }
  if (resolve(target) !== resolve(root, "public/vditor-assets/dist")) throw new Error("Unsafe asset destination");
  rmSync(target, {recursive:true, force:true});
  for (const [name, content] of files) {
    const output = join(target, name);
    mkdirSync(dirname(output), {recursive:true});
    writeFileSync(output, content);
  }
  const bytes = [...files.values()].reduce((n, data) => n + data.length, 0);
  console.log(`[copy-vditor-assets] ${files.size} runtime files, ${bytes} bytes (offline renderers retained)`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) copyRuntimeAssets();
