// Pure classification: local paths never inherit the WebView's http origin.
export type LinkTarget =
  | { kind: "anchor"; hash: string }
  | { kind: "external"; href: string }
  | { kind: "document"; path: string; hash: string }
  | { kind: "local"; path: string; hash: string; line: number | null; column: number | null }
  | { kind: "invalid"; reason: "linkUnsupported" | "linkNeedsPath" };
export function resolveLinkTarget(raw: string, sourcePath: string | null): LinkTarget {
  const href = raw.trim();
  const invalid = { kind: "invalid", reason: "linkUnsupported" } as const;
  if (!href || /[\u0000-\u001f]/.test(href)) return invalid;
  if (href.startsWith("#")) return { kind: "anchor", hash: href };
  if (/^(https?:|mailto:|tel:)/i.test(href)) {
    try { new URL(href); return { kind: "external", href }; } catch { return invalid; }
  }
  let slash = href.replace(/\\/g, "/");
  // Network shares and device paths are not document links in this offline editor.
  if (slash.startsWith("//")) return invalid;
  const drive = /^[a-z]:\//i.test(slash);
  // A bare file.ts:12 is a relative filename with a line, not a URI scheme.
  if (!drive && /^[^/:]+\.[^/:]+:\d+(?::\d+)?(?:#.*)?$/.test(slash)) slash = "./" + slash;
  if (!drive && /^[a-z][a-z\d+.-]*:/i.test(slash) && !/^file:/i.test(slash)) return invalid;
  try {
    let url: URL;
    if (/^file:/i.test(slash)) url = new URL(slash);
    else if (drive) url = new URL(`file:///${slash}`);
    else {
      if (!sourcePath) return { kind: "invalid", reason: "linkNeedsPath" };
      const base = sourcePath.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/").replace(/^([a-z])%3A/i, "$1:");
      url = new URL(slash, `file:///${base}`);
    }
    if (url.hostname || url.search) return invalid;
    let path = decodeURIComponent(url.pathname).replace(/^\/([a-z]:\/)/i, "$1");
    let line: number | null = null, column: number | null = null;
    const suffix = path.match(/:(\d+)(?::(\d+))?$/);
    if (suffix) { line = Number(suffix[1]); column = suffix[2] ? Number(suffix[2]) : 1; path = path.slice(0, -suffix[0].length); }
    const fragment = url.hash.match(/^#L(\d+)(?:C(\d+)|-L?\d+)?$/i);
    if (fragment && line === null) { line = Number(fragment[1]); column = fragment[2] ? Number(fragment[2]) : 1; }
    if ((line !== null && (!Number.isSafeInteger(line) || line < 1 || line > 10_000_000)) || (column !== null && (!Number.isSafeInteger(column) || column < 1 || column > 1_000_000))) return invalid;
    if (!/^[a-z]:\//i.test(path) || /[\u0000-\u001f<>"|?*]/.test(path) || path.slice(2).includes(":")) return invalid;
    if (/\.(md|markdown|mdown|txt)$/i.test(path) && !suffix) return { kind: "document", path, hash: url.hash };
    return { kind: "local", path, hash: fragment ? "" : url.hash, line, column };
  } catch { return invalid; }
}
