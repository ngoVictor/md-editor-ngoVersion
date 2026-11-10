// Pointer capture works with Tauri OS file drag/drop enabled, unlike HTML5 DnD.
import { t } from "./i18n";
export function bindTabDrag(detach: (id: string) => void, select: (id: string) => void): void {
  const bar = document.getElementById("tabs")!;
  let drag: { id: string; pointer: number; x: number; y: number; moved: boolean } | null = null;
  let suppressClickUntil = 0;
  const hint = document.createElement("div"); hint.className = "tab-drag-hint"; hint.hidden = true; document.body.append(hint);
  const reset = () => { drag = null; hint.hidden = true; };
  bar.addEventListener("pointerdown", e => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>(".tab");
    if (e.button !== 0 || !tab || (e.target as HTMLElement).closest(".tab-close") || bar.children.length < 2) return;
    drag = { id: tab.dataset.docId!, pointer: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    bar.setPointerCapture(e.pointerId);
  });
  bar.addEventListener("pointermove", e => {
    if (!drag || drag.pointer !== e.pointerId) return;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 12) drag.moved = true;
    if (drag.moved) { hint.textContent = t("detachHint"); hint.hidden = false; hint.style.left = `${Math.max(8, Math.min(innerWidth - 270, e.clientX + 12))}px`; hint.style.top = `${Math.max(8, Math.min(innerHeight - 40, e.clientY + 12))}px`; }
  });
  bar.addEventListener("pointerup", e => {
    if (!drag || drag.pointer !== e.pointerId) return;
    const { id, moved } = drag;
    if (moved) suppressClickUntil = Date.now() + 300;
    reset(); bar.releasePointerCapture(e.pointerId);
    if (!moved) select(id);
    if (moved && (e.clientX < 0 || e.clientY < 0 || e.clientX >= innerWidth || e.clientY >= innerHeight)) detach(id);
  });
  bar.addEventListener("click", e => { if (Date.now() < suppressClickUntil) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  bar.addEventListener("pointercancel", reset); bar.addEventListener("lostpointercapture", reset);
  window.addEventListener("keydown", e => { if (e.key === "Escape") reset(); });
}
