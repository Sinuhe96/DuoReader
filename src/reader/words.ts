import type { BookGloss, InlineRun } from './types';

export interface WordRange {
  start: number;
  end: number;
  text: string;
}

/**
 * A pair string and its inline runs are two coordinate systems: runs carry
 * whitelisted markup, and a `<br>` contributes no text. They agree character
 * for character except when the producer wrote a space for the break; this map
 * walks both and lets a break consume one whitespace character.
 */
export interface PairTextMap {
  /** Pair character offset → DOM text offset in the rendered line. */
  toDom(pairOffset: number): number;
  /** DOM text offset in the rendered line → pair character offset. */
  toPair(domOffset: number): number;
}

function clamp(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max);
}

function identityMap(length: number): PairTextMap {
  return {
    toDom: (pairOffset) => clamp(pairOffset, length),
    toPair: (domOffset) => clamp(domOffset, length),
  };
}

export function pairTextMap(text: string, runs: InlineRun[] | undefined): PairTextMap {
  if (!runs || runs.length === 0) return identityMap(text.length);

  const boundaries: number[] = [0];
  let pairIndex = 0;
  for (const run of runs) {
    if (run.break) {
      if (/\s/.test(text[pairIndex] ?? '')) {
        pairIndex += 1;
        boundaries[boundaries.length - 1] = pairIndex;
      }
      continue;
    }
    for (const character of run.text) {
      if (text[pairIndex] !== character) return identityMap(text.length);
      pairIndex += 1;
      boundaries.push(pairIndex);
    }
  }
  if (pairIndex !== text.length) return identityMap(text.length);

  return {
    toDom(pairOffset) {
      const wanted = clamp(pairOffset, text.length);
      for (let index = 0; index < boundaries.length; index += 1) {
        if (boundaries[index] >= wanted) return index;
      }
      return boundaries.length - 1;
    },
    toPair(domOffset) {
      return boundaries[clamp(domOffset, boundaries.length - 1)];
    },
  };
}

function isWordLike(segment: { segment: string; isWordLike?: boolean }): boolean {
  if (segment.isWordLike === true) return true;
  return /[\p{L}\p{N}]/u.test(segment.segment);
}

/**
 * The word under a caret. `offset` is a character position in `text`; a
 * boundary inside punctuation falls back to the word ending there, then to the
 * word starting there. No word means the caller keeps the sentence sheet.
 */
export function wordAt(text: string, offset: number, lang: string): WordRange | null {
  if (!text || typeof Intl.Segmenter !== 'function') return null;
  const at = clamp(offset, text.length);
  let segmenter: Intl.Segmenter;
  try {
    segmenter = new Intl.Segmenter(lang || undefined, { granularity: 'word' });
  } catch {
    return null;
  }

  const segments = Array.from(segmenter.segment(text));
  let index = segments.findIndex(
    (segment) => at >= segment.index && at < segment.index + segment.segment.length,
  );
  if (index < 0) index = segments.length - 1;

  if (!isWordLike(segments[index])) {
    const before = segments[index - 1];
    const after = segments[index + 1];
    if (before && isWordLike(before) && before.index + before.segment.length === at) {
      index -= 1;
    } else if (after && isWordLike(after) && after.index === at) {
      index += 1;
    } else {
      return null;
    }
  }

  const segment = segments[index];
  if (!isWordLike(segment)) return null;
  return {
    start: segment.index,
    end: segment.index + segment.segment.length,
    text: segment.segment,
  };
}

/**
 * The nearest word on each side of a range. `Intl.Segmenter` finds one
 * syllable in Vietnamese, not one lexical word, so these are the candidates a
 * reader extends a phrase with: `thích` + `nghi` is one word even though the
 * engine sees two. Punctuation between the range and a candidate stays inside
 * the chosen slice.
 */
export interface AdjacentWords {
  before: WordRange | null;
  after: WordRange | null;
}

export function adjacentWords(
  text: string,
  start: number,
  end: number,
  lang: string,
): AdjacentWords {
  if (!text || typeof Intl.Segmenter !== 'function') {
    return { before: null, after: null };
  }
  let segmenter: Intl.Segmenter;
  try {
    segmenter = new Intl.Segmenter(lang || undefined, { granularity: 'word' });
  } catch {
    return { before: null, after: null };
  }

  let before: WordRange | null = null;
  let after: WordRange | null = null;
  const from = clamp(start, text.length);
  const to = clamp(end, text.length);
  for (const segment of segmenter.segment(text)) {
    if (!isWordLike(segment)) continue;
    const segmentStart = segment.index;
    const segmentEnd = segment.index + segment.segment.length;
    if (segmentEnd <= from) {
      before = { start: segmentStart, end: segmentEnd, text: segment.segment };
    } else if (segmentStart >= to && !after) {
      after = { start: segmentStart, end: segmentEnd, text: segment.segment };
    }
  }
  return { before, after };
}

export function extendWordRange(
  text: string,
  range: WordRange,
  direction: 'before' | 'after',
  lang: string,
): WordRange | null {
  const neighbour = adjacentWords(text, range.start, range.end, lang)[direction];
  if (!neighbour) return null;
  const start = direction === 'before' ? neighbour.start : range.start;
  const end = direction === 'after' ? neighbour.end : range.end;
  return { start, end, text: text.slice(start, end) };
}

/** How many word-like segments a slice holds; used to keep a gloss snap sane. */
export function countWords(text: string, lang: string): number {
  if (!text) return 0;
  if (typeof Intl.Segmenter === 'function') {
    try {
      const segmenter = new Intl.Segmenter(lang || undefined, { granularity: 'word' });
      let count = 0;
      for (const segment of segmenter.segment(text)) {
        if (isWordLike(segment)) count += 1;
      }
      return count;
    } catch {
      // Fall through to the whitespace count.
    }
  }
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Edition gloss for a tapped word: same pair and side with overlapping offsets
 * first, then an exact case-insensitive term. Never a substring match, so a
 * `Haus` gloss does not fire on `Häuser`.
 */
export function glossAt(
  glossary: BookGloss[] | undefined,
  pairId: string,
  side: 'source' | 'target',
  start: number,
  end: number,
  surface: string,
): BookGloss | undefined {
  if (!glossary || glossary.length === 0) return undefined;
  const overlap = glossary.find(
    (entry) =>
      entry.pairId === pairId &&
      entry.side === side &&
      entry.start < end &&
      entry.end > start,
  );
  if (overlap) return overlap;
  const wanted = surface.toLocaleLowerCase();
  return glossary.find(
    (entry) =>
      entry.pairId === pairId &&
      entry.side === side &&
      entry.term.toLocaleLowerCase() === wanted,
  );
}

/**
 * The edition's own multi-syllable term around a tap. A Vietnamese gloss for
 * `thích nghi` should select both syllables even though `Intl.Segmenter`
 * returns only one; the longest covering range wins when glosses nest.
 */
export function glossSpanAt(
  glossary: BookGloss[] | undefined,
  pairId: string,
  side: 'source' | 'target',
  start: number,
  end: number,
): BookGloss | undefined {
  if (!glossary || glossary.length === 0) return undefined;
  let best: BookGloss | undefined;
  for (const entry of glossary) {
    if (entry.pairId !== pairId || entry.side !== side) continue;
    if (entry.start < 0 || entry.end <= entry.start) continue;
    if (entry.start > start || entry.end < end) continue;
    if (!best || entry.end - entry.start > best.end - best.start) best = entry;
  }
  return best;
}
