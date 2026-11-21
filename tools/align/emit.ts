import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { emitBook, type EmitBlock, type EmitChapter } from '../bepub/emit.ts';
import type { Alignment, AlignmentPair } from './model.ts';

function pairsFor(paragraphPairs: AlignmentPair[]) {
  return paragraphPairs.map((pair) => ({
    source: pair.source,
    target: pair.target,
  }));
}

export interface AlignedBuild {
  bookId: string;
  archive: Uint8Array;
  path: string;
  pairs: number;
}

export async function buildAligned(alignment: Alignment, outDir: string): Promise<AlignedBuild> {
  const chapters: EmitChapter[] = alignment.chapters.map((chapter) => {
    const blocks: EmitBlock[] = [
      {
        type: 'pairs',
        className: 'title-pair',
        strong: true,
        pairs: [{ source: chapter.sourceLabel, target: chapter.targetLabel }],
      },
    ];
    for (const paragraph of chapter.paragraphs) {
      if (paragraph.pairs.length === 0) continue;
      blocks.push({
        type: 'pairs',
        className: 'story-p',
        pairs: pairsFor(paragraph.pairs),
      });
    }
    return {
      id: `c${chapter.index + 1}`,
      href: `c${chapter.index + 1}.xhtml`,
      label: `${chapter.index + 1} · ${chapter.sourceLabel || chapter.targetLabel}`,
      blocks,
    };
  });

  const result = emitBook({
    title: alignment.title,
    author: alignment.author,
    sourceLang: alignment.sourceLang,
    targetLang: alignment.targetLang,
    identifier: `urn:duoreader:${alignment.id}`,
    chapters,
    createdAt: '2026-01-01T00:00:00+00:00',
    pipelineVersion: 'duoreader-align-1',
    schemaVersion: 1,
  });

  const booksDir = join(outDir, '..', '..', 'books');
  await mkdir(booksDir, { recursive: true });
  const path = join(booksDir, `${alignment.id}.zip`);
  await writeFile(path, result.archive);
  return { bookId: result.bookId, archive: result.archive, path, pairs: result.stats.pairs };
}
