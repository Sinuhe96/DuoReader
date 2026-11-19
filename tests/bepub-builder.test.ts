import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { blockParagraph } from '../src/reader/paragraph';
import { parseBePubZip } from '../src/reader/parse';
import type { Block, Book, Pair } from '../src/reader/types';
import { buildCollection, type StoryFile } from '../tools/bepub/build.ts';

const collectionDir = join(process.cwd(), 'stories', 'sima-guang');

function pairBlocks(book: Book): Block[] {
  return book.chapters.flatMap((chapter) =>
    chapter.blocks.filter((block) => block.type === 'pairs'),
  );
}

function allPairs(book: Book): Pair[] {
  return book.chapters.flatMap((chapter) =>
    chapter.blocks.flatMap((block) => (block.type === 'pairs' ? block.pairs : [])),
  );
}

function textOfBlock(block: Block): string {
  if (block.type !== 'pairs') return '';
  return blockParagraph(block)
    .source.map((run) => run.text)
    .join('');
}

describe('sima-guang collection', () => {
  it('builds a two-chapter book the parser reads as produced', async () => {
    const meta = JSON.parse(await readFile(join(collectionDir, 'book.json'), 'utf8'));
    const story = JSON.parse(
      await readFile(join(collectionDir, meta.stories[0].file), 'utf8'),
    ) as StoryFile;
    const result = await buildCollection(collectionDir);
    const book = parseBePubZip(result.archive, 'sima-guang.zip');

    expect(book.id).toBe(result.bookId);
    expect(book.title).toBe(meta.title);
    expect(book.author).toBe(meta.author);
    expect(book.sourceLang).toBe(meta.source_lang);
    expect(book.targetLang).toBe(meta.target_lang);
    expect(book.chapters.map((chapter) => chapter.label)).toEqual([
      meta.stories[0].label,
      '词汇 · Vocabulary',
    ]);
    expect(book.stats.documents).toBe(2);
    expect(book.stats.pairs).toBe(
      1 + story.sentences.length + 1 + (story.key_vocabulary ?? []).length,
    );
    expect(book.stats.imageBlocks).toBe(1);
    expect(book.stats.images).toBe(1);
    expect(book.stats.textOnlyBlocks).toBe(0);
    expect(book.warnings).toEqual([]);
  });

  it('puts a strong, pinyin-annotated title pair first and the image after it', async () => {
    const meta = JSON.parse(await readFile(join(collectionDir, 'book.json'), 'utf8'));
    const story = JSON.parse(
      await readFile(join(collectionDir, meta.stories[0].file), 'utf8'),
    ) as StoryFile;
    const book = parseBePubZip((await buildCollection(collectionDir)).archive, 'sima-guang.zip');
    const [title, image, ...paragraphs] = book.chapters[0].blocks;

    expect(title.type).toBe('pairs');
    if (title.type !== 'pairs') return;
    const pair = title.pairs[0];
    expect(pair.source).toBe(story.title_zh);
    expect(pair.target).toBe(story.title_en);
    expect(pair.pinyin).toBe(meta.stories[0].pinyin);
    expect(pair.sourceRuns).toEqual([{ text: story.title_zh, style: 'strong' }]);
    expect(pair.targetRuns).toEqual([{ text: story.title_en, style: 'strong' }]);

    expect(image.type).toBe('image');
    if (image.type === 'image') {
      expect(image.alt).toBe(meta.stories[0].alt);
      expect(book.images[image.imageId]?.blob.size).toBeGreaterThan(0);
    }
    expect(paragraphs.map((block) => block.type)).toEqual(['pairs', 'pairs', 'pairs']);
  });

  it('rebuilds every paragraph exactly from its sentence pairs', async () => {
    const meta = JSON.parse(await readFile(join(collectionDir, 'book.json'), 'utf8'));
    const story = JSON.parse(
      await readFile(join(collectionDir, meta.stories[0].file), 'utf8'),
    ) as StoryFile;
    const book = parseBePubZip((await buildCollection(collectionDir)).archive, 'sima-guang.zip');

    const expected: string[] = [];
    let cursor = 0;
    for (const length of meta.stories[0].paragraphs as number[]) {
      expected.push(story.sentences.slice(cursor, cursor + length).map((s) => s.zh).join(''));
      cursor += length;
    }

    const built = book.chapters[0].blocks
      .filter((block) => block.type === 'pairs')
      .slice(1)
      .map(textOfBlock);
    expect(built).toEqual(expected);
  });

  it('annotates every sentence and every vocabulary entry with its pinyin', async () => {
    const meta = JSON.parse(await readFile(join(collectionDir, 'book.json'), 'utf8'));
    const story = JSON.parse(
      await readFile(join(collectionDir, meta.stories[0].file), 'utf8'),
    ) as StoryFile;
    const book = parseBePubZip((await buildCollection(collectionDir)).archive, 'sima-guang.zip');

    const glossary = book.chapters[1].blocks.filter((block) => block.type === 'pairs');
    const entries = glossary.slice(1);
    expect(entries.map(textOfBlock)).toEqual(
      (story.key_vocabulary ?? []).map((entry) => entry.zh),
    );
    const expectedPinyin =
      1 +
      story.sentences.filter((sentence) => sentence.pinyin).length +
      (story.key_vocabulary ?? []).filter((entry) => entry.pinyin).length;
    const withPinyin = allPairs(book).filter((pair) => pair.pinyin);
    expect(withPinyin.length).toBe(expectedPinyin);
  });

  it('keeps block ids contiguous and pair ids unique', async () => {
    const book = parseBePubZip((await buildCollection(collectionDir)).archive, 'sima-guang.zip');
    const blocks = pairBlocks(book);
    expect(blocks.map((block) => (block.type === 'pairs' ? block.pairs[0].bid : ''))).toEqual(
      blocks.map((_, index) => String(index)),
    );
    const ids = allPairs(book).map((pair) => pair.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is byte-identical when rebuilt from the same input', async () => {
    const first = await buildCollection(collectionDir);
    const second = await buildCollection(collectionDir);
    expect(second.bookId).toBe(first.bookId);
    expect(second.archive).toEqual(first.archive);
  });

  it('stores the EPUB mimetype uncompressed as the first entry', async () => {
    const result = await buildCollection(collectionDir);
    const epub = result.readerMaster;
    expect(String.fromCharCode(...epub.slice(0, 2))).toBe('PK');
    expect(String.fromCharCode(...epub.slice(30, 38))).toBe('mimetype');
    // Local file header: compression method 0 means stored.
    expect(epub[8] | (epub[9] << 8)).toBe(0);
  });
});

describe('collection rules', () => {
  let directory = '';
  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('groups by `p`, prefixes labels, spaces spaced languages, and anchors images', async () => {
    directory = await mkdtemp(join(tmpdir(), 'duoreader-book-'));
    await mkdir(join(directory, 'images'), { recursive: true });
    await writeFile(
      join(directory, 'a.json'),
      JSON.stringify({
        title_zh: 'Erster Teil',
        title_en: 'First Part',
        sentences: [
          { zh: 'Erste', en: 'First', p: 1 },
          { zh: 'Zeile.', en: 'line.', p: 1 },
          { zh: 'Zweiter', en: 'Second', p: 2 },
        ],
        key_vocabulary: [{ zh: 'Zeile', en: 'line' }],
      }),
    );
    await writeFile(
      join(directory, 'b.json'),
      JSON.stringify({
        title_zh: 'Zweiter Teil',
        title_en: 'Second Part',
        sentences: [{ zh: 'Dritte', en: 'Third' }],
      }),
    );
    // 1×1 transparent PNG.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    await writeFile(join(directory, 'images', 'a.png'), png);
    await writeFile(
      join(directory, 'book.json'),
      JSON.stringify({
        title: 'Zwei Teile',
        author: 'Tester',
        source_lang: 'de',
        target_lang: 'en',
        stories: [
          { file: 'a.json', label: 'Teil A', image: 'images/a.png', alt: 'A', image_after_paragraph: 1 },
          { file: 'b.json', paragraphs: [1] },
        ],
      }),
    );

    const book = parseBePubZip((await buildCollection(directory)).archive, 'two.zip');

    expect(book.chapters.map((chapter) => chapter.label)).toEqual([
      '1 · Teil A',
      '2 · Zweiter Teil',
      '词汇 · Vocabulary',
    ]);
    expect(book.sourceLang).toBe('de');
    expect(book.chapters[0].blocks.map((block) => block.type)).toEqual([
      'pairs',
      'pairs',
      'image',
      'pairs',
    ]);
    // `p` grouped the first two sentences; the German gap is one space.
    expect(textOfBlock(book.chapters[0].blocks[1])).toBe('Erste Zeile.');
    expect(textOfBlock(book.chapters[0].blocks[3])).toBe('Zweiter');
    expect(book.stats.images).toBe(1);
    expect(book.stats.imageBlocks).toBe(1);

    const glossary = book.chapters[2].blocks.filter((block) => block.type === 'pairs');
    expect(glossary.map(textOfBlock)).toEqual(['词汇', 'Erster Teil', 'Zeile']);
  });
});
