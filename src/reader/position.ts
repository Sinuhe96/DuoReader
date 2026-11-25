import type { Book, Chapter } from './types';

/**
 * A text-only block has no publisher pair, so it borrows the pair contract:
 * the block itself is the "pair", its text the source, and the path plus block
 * ordinal make the id stable across a reload and a re-import of the edition.
 */
export function textPairId(path: string, blockIndex: number): string {
  return `text:${path}@${blockIndex}`;
}

export function firstPairId(chapter: Chapter): string | null {
  let firstText: string | null = null;
  for (const [index, block] of chapter.blocks.entries()) {
    if (block.type === 'pairs' && block.pairs.length > 0) return block.pairs[0].id;
    if (block.type === 'text' && firstText === null) firstText = textPairId(chapter.path, index);
  }
  return firstText;
}

/**
 * The chapter that owns a pair. A stored position (or a vocabulary record) can
 * outlive a chapter index when a re-import merges a continuation split; the
 * pair id is the stable handle.
 */
export function chapterForPair(book: Book, pairId: string): Chapter | undefined {
  for (const chapter of book.chapters) {
    for (const [index, block] of chapter.blocks.entries()) {
      if (block.type === 'pairs') {
        if (block.pairs.some((pair) => pair.id === pairId)) return chapter;
      } else if (textPairId(chapter.path, index) === pairId) {
        return chapter;
      }
    }
  }
  return undefined;
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
