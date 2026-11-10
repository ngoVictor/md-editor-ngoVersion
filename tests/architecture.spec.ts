import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import ts from "typescript";

const srcDir = join(process.cwd(), "src");

test("本地 TypeScript import 图无循环", () => {
  const files = readdirSync(srcDir).filter((name) => name.endsWith(".ts"));
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const text = readFileSync(join(srcDir, file), "utf8");
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const references: string[] = [];
    const visitReferences = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) references.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) references.push(node.arguments[0].text);
      ts.forEachChild(node, visitReferences);
    };
    visitReferences(source);
    const imports = references.filter(name => name.startsWith("./"))
      .map(name => name.slice(2).replace(/\.ts$/, "") + ".ts")
      .filter((name) => files.includes(name));
    graph.set(file, imports);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (file: string, trail: string[]) => {
    if (visiting.has(file)) throw new Error(`循环依赖: ${[...trail, file].join(" -> ")}`);
    if (visited.has(file)) return;
    visiting.add(file);
    for (const dep of graph.get(file) || []) visit(dep, [...trail, file]);
    visiting.delete(file);
    visited.add(file);
  };
  for (const file of files) visit(file, []);
  expect(visited.size).toBe(files.length);
});

test("核心文档集合与 activeId 只由 document-store 修改", () => {
  const offenders: string[] = [];
  for (const name of readdirSync(srcDir).filter((file) => file.endsWith(".ts"))) {
    if (["state.ts", "document-store.ts"].includes(name)) continue;
    const text = readFileSync(join(srcDir, name), "utf8");
    if (/S\.docs\.(push|splice|pop|shift|unshift)|S\.activeId\s*=(?!=)/.test(text)) offenders.push(name);
  }
  expect(offenders).toEqual([]);
});

test("文件 IO IPC 只存在于 file-service 适配器", () => {
  const offenders: string[] = [];
  for (const name of readdirSync(srcDir).filter((file) => file.endsWith(".ts"))) {
    const text = readFileSync(join(srcDir, name), "utf8");
    if (/invoke(?:<[^>]+>)?\(\s*["'](?:open_file|file_path_key|file_stat|save_file|save_docx|save_html|render_pdf|inspect_link_resource|read_link_text|read_export_image|store_image|list_directory|save_png|print_html|open_link_resource|open_link_in_editor|list_versions|read_version)["']/.test(text) && basename(name) !== "file-service.ts") offenders.push(name);
  }
  expect(offenders).toEqual([]);
});

test("源码预览不依赖文档写入与编辑器生命周期", () => {
  const text = ["source-preview.ts", "source-preview-main.ts", "source-preview-view.ts"].map(name => readFileSync(join(srcDir, name), "utf8")).join("\n");
  expect(text).not.toMatch(/from\s+["']\.\/(?:docs|save|document-store|editor-sync|vditor|history)["']/);
});
