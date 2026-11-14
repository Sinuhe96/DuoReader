import { describe, expect, it } from 'vitest';
import { firstPairId, progressAt } from '../src/reader/position';
import type { Book, Chapter } from '../src/reader/types';

const chapter = (index: number, pairIds: string[]): Chapter => ({
  index,
  path: `chapter-${index}.xhtml`,
  label: `Chapter ${index}`,
  pairCount: pairIds.length,
  blocks: [
    {
      type: 'pairs',
      pairs: pairIds.map((id) => ({ id, bid: id, source: id, target: id })),
    },
  ],
});

const chapters = [chapter(0, ['a', 'b']), chapter(1, ['c', 'd', 'e'])];

const book: Book = {
  id: 'book',
  title: 'Book',
  author: 'Author',
  sourceLang: 'de',
  targetLang: 'en',
  chapters,
  images: {},
  stats: {
    documents: chapters.length,
    pairs: 5,
    imageBlocks: 0,
    images: 0,
    textOnlyBlocks: 0,
  },
  warnings: [],
};

describe('reading position progress', () => {
  it('returns the first pair of a chapter', () => {
    expect(firstPairId(chapters[0])).toBe('a');
    expect(firstPairId(chapter(2, []))).toBeNull();
  });

  it('counts pairs before the current chapter', () => {
    expect(progressAt(book, 0, 'a')).toBeCloseTo(0.2);
    expect(progressAt(book, 0, 'b')).toBeCloseTo(0.4);
    expect(progressAt(book, 1, 'c')).toBeCloseTo(0.6);
    expect(progressAt(book, 1, 'e')).toBeCloseTo(1);
  });

  it('falls back to the chapter start for an unknown pair', () => {
    expect(progressAt(book, 1, null)).toBeCloseTo(0.4);
    expect(progressAt(book, 1, 'missing')).toBeCloseTo(0.4);
  });
});
