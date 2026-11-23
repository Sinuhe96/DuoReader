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
