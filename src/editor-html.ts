// Display-only support for HTML alignment containers split across Markdown blocks.
// Keep Vditor's source nodes and sanitized previews intact for editing/serialization.
type Alignment = "left" | "center" | "right";
interface Container { tag: string; start: number; align: Alignment | null }

function decorate(root: HTMLElement): void {
  const blocks = Array.from(root.children) as HTMLElement[];
  const stack: Container[] = [];
  const alignments = new Map<HTMLElement, Alignment>();
  const boundaries = new Set<HTMLElement>();
  for (const [index, block] of blocks.entries()) {
    if (block.dataset.type !== "html-block") continue;
    const source = block.querySelector(":scope > pre:first-child > code")?.textContent?.trim() || "";
    const opening = /^<(div|center)\b[^<>]*>$/i.exec(source);
    if (opening) {
      const template = document.createElement("template");
      template.innerHTML = source; // Inert: never attach document HTML to the live DOM.
      const tag = opening[1].toLowerCase();
      const value = template.content.firstElementChild?.getAttribute("align")?.toLowerCase();
      const align = tag === "center" ? "center" : /^(left|center|right)$/.test(value || "") ? value as Alignment : null;
      stack.push({ tag, start: index, align });
    } else {
      const closing = /^<\/(div|center)\s*>$/i.exec(source);
      if (!closing || stack[stack.length - 1]?.tag !== closing[1].toLowerCase()) continue;
      const container = stack.pop()!;
      if (!container.align) continue;
      boundaries.add(block); boundaries.add(blocks[container.start]);
      // Inner explicit alignment wins over an enclosing container.
      for (let i = container.start + 1; i < index; i++) {
        if (!alignments.has(blocks[i])) alignments.set(blocks[i], container.align);
      }
    }
  }
  for (const block of blocks) {
    const align = alignments.get(block);
    if (align) block.dataset.htmlAlign = align;
    else block.removeAttribute("data-html-align");
    // Empty HTML comments and paired container markers have no rendered content.
    const source = block.dataset.type === "html-block" ? block.querySelector(":scope > pre:first-child > code")?.textContent || "" : "";
    const commentOnly = source.trim().startsWith("<!--") && source.replace(/<!--[\s\S]*?-->/g, "").trim() === "";
    block.toggleAttribute("data-html-hidden", boundaries.has(block) || commentOnly);
  }
}

export function bindEditorHtml(): void {
  const editor = document.getElementById("editor")!;
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      editor.querySelectorAll<HTMLElement>(".vditor-wysiwyg .vditor-reset, .vditor-ir .vditor-reset").forEach(decorate);
    });
  });
  // Decorations are attributes, so they cannot retrigger this observer.
  observer.observe(editor, { subtree: true, childList: true, characterData: true });
}
