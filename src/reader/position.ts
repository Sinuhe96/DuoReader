import type { Book, Chapter } from './types';

export function firstPairId(chapter: Chapter): string | null {
  for (const block of chapter.blocks) {
    if (block.type === 'pairs' && block.pairs.length > 0) return block.pairs[0].id;
  }
  return null;
}

function pairOffset(chapter: Chapter, pairId: string | null): number {
  if (!pairId) return 0;
  let offset = 0;
  for (const block of chapter.blocks) {
    if (block.type !== 'pairs') continue;
    for (const pair of block.pairs) {
      offset += 1;
      if (pair.id === pairId) return offset;
    }
  }
  return 0;
}

export function progressAt(
  book: Book,
  chapterIndex: number,
  pairId: string | null,
): number {
  if (book.stats.pairs <= 0) return 0;

  let preceding = 0;
  for (const chapter of book.chapters) {
    if (chapter.index === chapterIndex) {
      const offset = pairOffset(chapter, pairId);
      return Math.min(1, (preceding + offset) / book.stats.pairs);
    }
    preceding += chapter.pairCount;
  }
  return 0;
}
