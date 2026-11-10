// srcset is a display override. The original src stays intact for Vditor serialization.
import { S, activeDoc } from "./state";
import { assetService, imageStoreService } from "./file-service";
import { syncDocFromEditor, editorIsComposing, editorMountGeneration, withSuppressInput } from "./editor-sync";
import { showError } from "./ui";
import { t } from "./i18n";
import { subscribeDocuments } from "./document-store";
import { decodeRaster, rasterSize } from "./raster-image";

export function bindEditorImages(): void {
  const root = document.getElementById("editor")!;
  const seen = new WeakMap<HTMLImageElement, string>();
  let scheduled = false, running = false;
  const cache = new Map<string, string>();
  let cacheKey = "", cacheBytes = 0;
  async function refresh() {
    scheduled = false;
    if (running) { schedule(); return; }
    const doc = activeDoc(); if (!doc || doc.loadState !== "ready") return;
    const path = doc.path, identity = doc.id + path;
    if (cacheKey !== identity) { cache.clear(); cacheBytes = 0; cacheKey = identity; }
    running = true;
    let pixels = 0;
    try {
      for (const img of Array.from(root.querySelectorAll("img")).slice(0, 64)) {
        if (activeDoc()?.id !== doc.id || doc.path !== path) break;
        const src = img.getAttribute("src") || "", key = identity + src;
        if (!src || /^(?:data:|https?:|blob:|\/\/)/i.test(src)) continue;
        if (seen.get(img) === key) { pixels += img.naturalWidth * img.naturalHeight; continue; }
        seen.set(img, key); img.removeAttribute("srcset");
        try {
          let data = cache.get(src);
          if (!data) {
            data = await assetService().readImage(path, src);
            if (cacheBytes + data.length > 8 * 1024 * 1024) continue;
            cache.set(src, data); cacheBytes += data.length;
          }
          const size = rasterSize(data); pixels += size.width * size.height;
          if (pixels > 16_000_000) continue;
          await decodeRaster(data, false);
          if (activeDoc()?.id === doc.id && doc.path === path && root.contains(img) && img.getAttribute("src") === src) img.srcset = data;
        } catch { /* keep original alt/reference on failure */ }
      }
    } finally { running = false; }
  }
  function schedule() { if (!scheduled) { scheduled = true; window.setTimeout(() => { void refresh(); }, 50); } }
  new MutationObserver(schedule).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });
  subscribeDocuments((_,kind) => { if (kind === "structure" || kind === "disk") schedule(); });
  let pasting = false;
  root.addEventListener("paste", event => {
    const files = Array.from(event.clipboardData?.files || []).filter(f => f.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const doc = activeDoc(), editor = S.vditor;
    if (pasting || !doc || !editor || S.switchInFlight || S.windowTransfer || editorIsComposing()) return;
    syncDocFromEditor(doc); const revision = doc.revision, path = doc.path, mount = editorMountGeneration();
    const selection = window.getSelection(), range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    pasting = true;
    void (async () => {
      if (files.length > 8) throw new Error("一次最多粘贴 8 张图片");
      const links: string[] = [];
      for (const file of files) {
        if (file.size > 4 * 1024 * 1024) throw new Error("单张图片上限为 4 MB");
        const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
        await decodeRaster(data, false);
        const reference = await imageStoreService().store(path, data);
        links.push(`![${file.name.replace(/[\\\[\]<>\r\n]/g, "_")}](${reference})`);
      }
      if (activeDoc()?.id !== doc.id || S.vditor !== editor || mount !== editorMountGeneration() || S.switchInFlight || S.windowTransfer || editorIsComposing()) throw new Error(t("searchStale"));
      syncDocFromEditor(doc);
      if (doc.revision !== revision || doc.path !== path) throw new Error(t("searchStale"));
      if (range && root.contains(range.commonAncestorContainer)) { selection?.removeAllRanges(); selection?.addRange(range); }
      withSuppressInput(() => editor.insertValue(links.join("\n")));
      syncDocFromEditor(doc, {allowEmpty: true, markDirty: true});
    })().catch(e => showError(String(e))).finally(() => { pasting = false; });
  }, true);
}
