import type { Block, Pair } from './types';

export interface Paragraph {
  source: string;
  target: string;
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

/**
 * Rebuild one paragraph from its sentence pairs. Source keeps the publisher's
 * exact separator widths; target is a single-space join because the archive
 * carries no target offsets.
 */
export function blockParagraph(block: PairsBlock): Paragraph {
  const { pairs } = block;
  let source = '';
  let previousEnd: number | undefined;
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    if (index > 0) source += ' '.repeat(gapWidth(pair, previousEnd));
    source += pair.source;
    previousEnd = pair.end;
  }

  const target = pairs
    .map((pair) => pair.target)
    .filter((text) => text.length > 0)
    .join(' ');

  return { source, target };
}
