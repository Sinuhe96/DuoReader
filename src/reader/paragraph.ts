import type { Block, InlineRun, Pair } from './types';

export interface Paragraph {
  source: InlineRun[];
  target: InlineRun[];
}

/**
 * Inter-pair gaps are whitespace of width `start - previousEnd` in the sample
 * (0 or 1). Cap malformed widths so a corrupt offset cannot inflate a page.
 */
const MAX_GAP = 4;

type PairsBlock = Extract<Block, { type: 'pairs' }>;

function gapWidth(pair: Pair, previousEnd: number | undefined): number {
  if (pair.start === undefined || previousEnd === undefined) return 1;
  return Math.min(Math.max(pair.start - previousEnd, 0), MAX_GAP);
}

/** Appends a copy so stored pair runs are never mutated. */
function appendRun(list: InlineRun[], text: string, style?: InlineRun['style']): void {
  const run: InlineRun = style ? { text, style } : { text };
  const last = list[list.length - 1];
  if (last && !last.break && last.style === run.style) {
    last.text += run.text;
    return;
  }
  list.push(run);
}

function appendPair(list: InlineRun[], runs: InlineRun[] | undefined, fallback: string): void {
  if (!runs || runs.length === 0) {
    if (fallback) appendRun(list, fallback);
    return;
  }
  for (const run of runs) {
    if (run.break) list.push({ text: '', break: true });
    else appendRun(list, run.text, run.style);
  }
}

/**
 * Rebuild one paragraph from its sentence pairs. Source keeps the publisher's
 * exact separator widths; target is a single-space join because the archive
 * carries no target offsets. Both keep inline runs, so a `br` inside a pair
 * survives the merge.
 */
export function blockParagraph(block: PairsBlock): Paragraph {
  const source: InlineRun[] = [];
  const target: InlineRun[] = [];
  let previousEnd: number | undefined;

  for (let index = 0; index < block.pairs.length; index += 1) {
    const pair = block.pairs[index];
    if (index > 0 && source.length > 0) {
      const gap = gapWidth(pair, previousEnd);
      if (gap > 0) appendRun(source, ' '.repeat(gap));
    }
    appendPair(source, pair.sourceRuns, pair.source);
    previousEnd = pair.end;
  }

  for (const pair of block.pairs) {
    if (!pair.target) continue;
    if (target.length > 0) appendRun(target, ' ');
    appendPair(target, pair.targetRuns, pair.target);
  }

  return { source, target };
}
