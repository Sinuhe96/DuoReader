import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseBePubZip } from '../src/reader/parse';

const testDataDir = join(process.cwd(), 'test_data');
const sampleName = existsSync(testDataDir)
  ? readdirSync(testDataDir)
      .filter((name) => name.endsWith('.zip') && name !== 'sample.zip')
      .sort()[0]
  : undefined;
const sample = sampleName
  ? new Uint8Array(readFileSync(join(testDataDir, sampleName)))
  : undefined;

(sample ? describe : describe.skip)('BePub sample', () => {
  if (!sample) return;
  const book = parseBePubZip(sample, sampleName);

  it('reads the package metadata', () => {
    expect(book.title).toBe('Anton taucht ab');
    expect(book.author).toBe('Milena Baisch');
    expect(book.sourceLang).toBe('de');
    expect(book.targetLang).toBe('en');
  });

  it('normalizes every spine document', () => {
    expect(book.stats.documents).toBe(25);
    expect(book.chapters).toHaveLength(25);
    expect(book.stats.pairs).toBe(1877);
    expect(book.stats.imageBlocks).toBe(43);
    expect(book.stats.images).toBe(25);
    expect(book.stats.textOnlyBlocks).toBe(1);
  });

  it('keeps NCX labels and numbers unlabelled chapters', () => {
    const label = (suffix: string) =>
      book.chapters.find((chapter) => chapter.path.endsWith(`/${suffix}`))?.label;

    expect(label('d_003.xhtml')).toBe('Über die Autorin');
    expect(label('d_006.xhtml')).toBe('Chapter 1');
    expect(label('d_007.xhtml')).toBe('Chapter 2');
    expect(label('d_022.xhtml')).toBe('Chapter 17');
    expect(label('d_025.xhtml')).toBe('Danksagung');
  });

  it('renders the untranslated paragraph instead of dropping it', () => {
    const chapter = book.chapters.find((candidate) => candidate.path.endsWith('/d_022.xhtml'));
    const text = chapter?.blocks.flatMap((block) =>
      block.type === 'text' ? [block.text] : [],
    );

    expect(text).toContain('Die Luft um mich herum bewegte sich –');
  });

  it('resolves illustration blobs', () => {
    const chapter = book.chapters.find((candidate) => candidate.path.endsWith('/d_022.xhtml'));
    const imageId = chapter?.blocks.find(
      (block) => block.type === 'image' && block.imageId.endsWith('/bild_s103.jpg'),
    );

    expect(imageId).toBeDefined();
    if (!imageId || imageId.type !== 'image') return;
    const image = book.images[imageId.imageId];
    expect(image?.mediaType).toBe('image/jpeg');
    expect(image.blob.size).toBeGreaterThan(0);
  });

  it('has globally unique sentence ids', () => {
    const ids = book.chapters.flatMap((chapter) =>
      chapter.blocks.flatMap((block) =>
        block.type === 'pairs' ? block.pairs.map((pair) => pair.id) : [],
      ),
    );

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('invalid input', () => {
  it('rejects an archive without reader-master.epub', () => {
    const archive = zipSync({ 'manifest.json': strToU8('{}') });
    expect(() => parseBePubZip(archive, 'empty.zip')).toThrow(/reader-master\.epub/);
  });
});
