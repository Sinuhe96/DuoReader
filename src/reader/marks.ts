/**
 * Marks are built from text nodes, never `innerHTML`: the reader's text stays
 * the archive's text, and a mark only splits a node and wraps the slice.
 * Offsets are DOM-text offsets (a `<br>` contributes nothing); the pinyin line
 * is skipped, so it is never marked when its sentence is.
 */

function textNodes(line: HTMLElement): Text[] {
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (!text.parentElement?.closest('.pinyin')) nodes.push(text);
  }
  return nodes;
}

/**
 * Wraps `[start, end)` of the line's text in `<mark class="…">`. A range that
 * crosses an inline element (`i`, `b`, `br`) becomes one mark per text node,
 * which keeps line breaking and native selection intact.
 */
export function markTextRange(
  line: HTMLElement,
  start: number,
  end: number,
  className: string,
): void {
  if (end <= start) return;
  const pieces: { node: Text; from: number; to: number }[] = [];
  let offset = 0;
  for (const node of textNodes(line)) {
    const nodeStart = offset;
    const nodeEnd = offset + node.data.length;
    offset = nodeEnd;
    const from = Math.max(start, nodeStart) - nodeStart;
    const to = Math.min(end, nodeEnd) - nodeStart;
    if (to > from) pieces.push({ node, from, to });
  }

  for (const { node, from, to } of pieces) {
    const target = from > 0 ? node.splitText(from) : node;
    if (to - from < target.data.length) target.splitText(to - from);
    const mark = document.createElement('mark');
    mark.className = className;
    mark.textContent = target.data;
    target.replaceWith(mark);
  }
}
