import { isDetachedWindow } from "./window-context";
import { S } from "./state";
import { activateDocument, addDocument, createDocument, findDocumentByPath, setDocumentStatus, subscribeDocuments } from "./document-store";
import { preferences, setPreference } from "./preferences";
import { t } from "./i18n";

const KEY = "alei-editor.session.v1";
interface SessionEntry { path: string; pathKey: string | null }
interface Session { version: 1; entries: SessionEntry[]; activePath: string | null }
export function readSession(value: string | null): Session | null {
  try {
    const parsed = JSON.parse(value || "null");
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) return null;
    const entries = parsed.entries.slice(0, 50).filter((e: unknown): e is SessionEntry => {
      if (!e || typeof e !== "object") return false;
      const item = e as SessionEntry;
      return typeof item.path === "string" && item.path.length < 32768 && /\.(md|markdown|mdown|txt)$/i.test(item.path) && (item.pathKey === null || typeof item.pathKey === "string");
    });
    return { version: 1, entries, activePath: typeof parsed.activePath === "string" ? parsed.activePath : null };
  } catch { return null; }
}
export function persistSession(): void {
  if (isDetachedWindow || !preferences.restoreSession) return;
  const entries = S.docs.filter(doc => doc.path).slice(0, 50).map(doc => ({ path: doc.path!, pathKey: doc.pathKey }));
  const activePath = S.docs.find(doc => doc.id === S.activeId)?.path || null;
  try { localStorage.setItem(KEY, JSON.stringify({ version: 1, entries, activePath })); } catch { /* do not block editing */ }
}
export function bindSession(): void {
  if (!isDetachedWindow && preferences.restoreSession) {
    let saved: Session | null = null;
    try { saved = readSession(localStorage.getItem(KEY)); } catch { /* unavailable */ }
    for (const entry of saved?.entries || []) {
      if (findDocumentByPath(entry.path, entry.pathKey)) continue;
      const doc = createDocument({ ...entry, name: entry.path.split(/[\\/]/).pop() || t("untitled"), content: "" });
      setDocumentStatus(doc, { loadState: "unloaded" }); addDocument(doc);
      if (!S.activeId || entry.path === saved?.activePath) activateDocument(doc.id);
    }
  }
  const checkbox = document.getElementById("pref-session") as HTMLInputElement;
  checkbox.checked = !isDetachedWindow && preferences.restoreSession;
  checkbox.disabled = isDetachedWindow;
  checkbox.parentElement!.title = t("sessionHint");
  checkbox.onchange = () => {
    setPreference("restoreSession", checkbox.checked);
    if (checkbox.checked) persistSession();
    else { try { localStorage.removeItem(KEY); } catch { /* unavailable */ } }
  };
  subscribeDocuments((_doc, kind) => { if (kind === "structure" || kind === "disk") persistSession(); });
}
