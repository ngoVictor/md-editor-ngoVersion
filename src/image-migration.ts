import { assetService, imageStoreService } from "./file-service";
import { imageReferences, rewriteImageReferences } from "./image-references";
// A failed save can leave reusable content-addressed assets, but never modifies the source.
export async function migrateImages(markdown: string, sourcePath: string | null, targetPath: string): Promise<string> {
  const replacements = new Map<string, string>();
  const refs = imageReferences(markdown);
  if (refs.length > 64) throw new Error("另存为图片迁移上限为 64 张");
  for (const {url} of refs) {
    if (/^(?:https?:|\/\/)/i.test(url) || replacements.has(url)) continue;
    const data = url.startsWith("data:") ? url : await assetService().readImage(sourcePath, url);
    replacements.set(url, await imageStoreService().store(targetPath, data));
  }
  return rewriteImageReferences(markdown, url => replacements.get(url) || url);
}
