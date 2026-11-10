// Cooperative cancellation between bounded directory/file requests, no persistent index.
import { navigationService, resourceService } from "./file-service";
export interface SearchHit { path: string; line: number; text: string }
export async function searchDirectory(root: string, query: string, namesOnly: boolean, signal: AbortSignal,
  onHit: (hit: SearchHit) => void): Promise<{visited: number; truncated: boolean; skipped: number}> {
  if (!query.trim() || query.length > 256) throw Error("Search query must contain 1–256 characters");
  const queue = [{path:root, depth:0}], seen = new Set<string>(), started = Date.now();
  let visited = 0, hits = 0, truncated = false, skipped = 0, bytes = 0;
  const cancelled = () => { if (signal.aborted) throw new DOMException("Cancelled", "AbortError"); };
  while (queue.length) {
    cancelled();
    if (visited >= 2000 || hits >= 100 || Date.now() - started > 15000 || bytes > 16 * 1024 * 1024) { truncated = true; break; }
    const current = queue.shift()!, key = current.path.toLowerCase();
    if (seen.has(key)) continue; seen.add(key);
    let listing;
    try { listing = await navigationService().list(current.path); } catch { skipped++; continue; }
    cancelled(); truncated ||= listing.truncated;
    for (const entry of listing.entries) {
      cancelled();
      if (visited++ >= 2000 || hits >= 100 || Date.now()-started > 15000 || bytes > 16*1024*1024) { truncated = true; break; }
      if (entry.directory) { if (current.depth < 8) queue.push({path:entry.path,depth:current.depth+1}); else truncated = true; continue; }
      if (namesOnly) {
        if (entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) { onHit({path:entry.path,line:0,text:entry.name}); hits++; }
      } else {
        try {
          const resource = await resourceService().inspect(entry.path); cancelled();
          if (resource.kind !== "document" && resource.kind !== "source") continue;
          const result = await resourceService().readText(entry.path); cancelled(); bytes += result.content.length * 2;
          let fileHits = 0;
          for (const [i, line] of result.content.split(/\r\n|\n|\r/).entries()) {
            if (line.toLocaleLowerCase().includes(query.toLocaleLowerCase())) {
              onHit({path:entry.path, line:i+1, text:line.slice(0,240)}); hits++; fileHits++;
              if (hits >= 100 || fileHits >= 10) { truncated = true; break; }
            }
          }
        } catch (e) { cancelled(); skipped++; }
      }
    }
  }
  return {visited, truncated, skipped};
}
