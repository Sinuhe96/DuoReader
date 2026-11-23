import type { Block, InlineRun, Pair } from './types';

export interface Paragraph {
  source: InlineRun[];
  target: InlineRun[];
  /** DOM-text ranges per pair, so a mark can map a pair onto the joined line. */
  ranges: PairRange[];
}

export interface TextRange {
  start: number;
  end: number;
}

export interface PairRange {
  pairId: string;
  source: TextRange;
  target?: TextRange;
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
 * Characters the runs put into the DOM. A `br` renders as an element, so it
 * contributes no text offset even though `pair.source` counts the break as one
 * character; pair-relative offsets are converted when a word mark is built.
 */
function renderedLength(runs: InlineRun[] | undefined, fallback: string): number {
  if (!runs || runs.length === 0) return fallback.length;
  let length = 0;
  for (const run of runs) if (!run.break) length += run.text.length;
  return length;
}

/**
 * Rebuild one paragraph from its sentence pairs. Source keeps the publisher's
 * exact separator widths; target is a single-space join because the archive
 * carries no target offsets. Both keep inline runs, so a `br` inside a pair
 * survives the merge. `ranges` records where each pair landed in DOM text.
 */
export function blockParagraph(block: PairsBlock): Paragraph {
  const source: InlineRun[] = [];
  const target: InlineRun[] = [];
  const ranges: PairRange[] = [];
  let previousEnd: number | undefined;
  let sourceOffset = 0;

  for (let index = 0; index < block.pairs.length; index += 1) {
    const pair = block.pairs[index];
    if (index > 0 && source.length > 0) {
      const gap = gapWidth(pair, previousEnd);
      if (gap > 0) {
        appendRun(source, ' '.repeat(gap));
        sourceOffset += gap;
      }
    }
    const start = sourceOffset;
    appendPair(source, pair.sourceRuns, pair.source);
    sourceOffset += renderedLength(pair.sourceRuns, pair.source);
    ranges.push({ pairId: pair.id, source: { start, end: sourceOffset } });
    previousEnd = pair.end;
  }

  let targetOffset = 0;
  for (let index = 0; index < block.pairs.length; index += 1) {
    const pair = block.pairs[index];
    if (!pair.target) continue;
    if (target.length > 0) {
      appendRun(target, ' ');
      targetOffset += 1;
    }
    const start = targetOffset;
    appendPair(target, pair.targetRuns, pair.target);
    targetOffset += renderedLength(pair.targetRuns, pair.target);
    ranges[index].target = { start, end: targetOffset };
  }

  return { source, target, ranges };
}

/**
 * One line of pinyin for a paragraph block. Pinyin is stored per sentence, so
 * a paragraph joins the parts with a single space and skips untranslated ones.
 */
export function paragraphPinyin(block: PairsBlock): string {
  const parts: string[] = [];
  for (const pair of block.pairs) {
    if (pair.pinyin) parts.push(pair.pinyin);
  }
  return parts.join(' ');
}
