import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { blockParagraph } from '../src/reader/paragraph';
import { parseBePubZip } from '../src/reader/parse';
import type { InlineRun } from '../src/reader/types';

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

function makeArchive(body: string, lang = 'de'): Uint8Array {
  return zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:duoreader:offsets</dc:identifier>
    <dc:title>Offset Probe</dc:title>
    <dc:language>${lang}</dc:language>
  </metadata>
  <manifest>
    <item id="chapter-1" href="c1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter-1"/>
  </spine>
</package>`),
    'OEBPS/c1.xhtml': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${lang}">
  <head><title>Offsets</title></head>
  <body>${body}</body>
</html>`),
  });
}

describe('pair offsets', () => {
  it('reads data-start and data-end and ignores malformed values', () => {
    const book = parseBePubZip(
      makeArchive(`
        <div class="standard_oe">
          <span class="reader-pair" data-pair-id="5:0:5" data-bid="5" data-start="0" data-end="5">
            <span class="reader-src" lang="de">Erste</span>
            <span class="reader-tgt" lang="en">First</span>
          </span><span class="normal"> </span><span class="reader-pair" data-pair-id="5:6:15" data-bid="5" data-start="6" data-end="15">
            <span class="reader-src" lang="de">Zeile.</span>
            <span class="reader-tgt" lang="en">line.</span>
          </span>
        </div>
        <div class="standard_oe">
          <span class="reader-pair" data-pair-id="6:0:4" data-bid="6" data-start="junk" data-end="-2">
            <span class="reader-src" lang="de">Drei</span>
            <span class="reader-tgt" lang="en">Three</span>
          </span>
        </div>
      `),
      'offsets.zip',
    );

    const pairs = book.chapters[0].blocks.flatMap((block) =>
      block.type === 'pairs' ? block.pairs : [],
    );

    expect(pairs.map((pair) => [pair.start, pair.end])).toEqual([
      [0, 5],
      [6, 15],
      [undefined, undefined],
    ]);
    expect(pairs.map((pair) => pair.bid)).toEqual(['5', '5', '6']);
  });
});

describe('inline runs', () => {
  it('keeps whitelisted markup, flattens the rest, and omits plain runs', () => {
    const book = parseBePubZip(
      makeArchive(`
        <div class="standard_oe">
          <span class="reader-pair" data-pair-id="7:0:11" data-bid="7">
            <span class="reader-src" lang="de">  Erste <i>Kursiv <b>fett</b></i><br/> <em>ende</em> </span>
            <span class="reader-tgt" lang="en">First <strong>bold</strong></span>
          </span>
        </div>
        <div class="standard_oe">
          <span class="reader-pair" data-pair-id="8:0:5" data-bid="8">
            <span class="reader-src" lang="de">Plain</span>
            <span class="reader-tgt" lang="en">Klartext</span>
          </span>
        </div>
      `),
      'runs.zip',
    );

    const pairs = book.chapters[0].blocks.flatMap((block) =>
      block.type === 'pairs' ? block.pairs : [],
    );

    expect(pairs[0].source).toBe('Erste Kursiv fett ende');
    expect(pairs[0].sourceRuns).toEqual([
      { text: 'Erste ' },
      { text: 'Kursiv ', style: 'em' },
      { text: 'fett', style: 'strong' },
      { text: '', break: true },
      { text: ' ' },
      { text: 'ende', style: 'em' },
    ]);
    expect(pairs[0].targetRuns).toEqual([
      { text: 'First ' },
      { text: 'bold', style: 'strong' },
    ]);
    expect(pairs[1].sourceRuns).toBeUndefined();
    expect(pairs[1].targetRuns).toBeUndefined();
  });
});

function runsToText(runs: InlineRun[]): string {
  return runs.map((run) => (run.break ? '\n' : run.text)).join('');
}

describe('wrapped paragraphs', () => {
  it('splits a container at its paragraph elements and keeps the other lines', () => {
    const book = parseBePubZip(
      makeArchive(
        `
        <div class="jacket">
          <p><b>TRẠI HOA VÀNG</b></p>
          <p><span class="reader-pair" data-pair-id="0:0:24" data-bid="0" data-start="0" data-end="24"><span class="reader-src" lang="vi">Tác giả: Nguyễn Nhật Ánh</span><span class="reader-tgt" lang="en">Author: Nguyen Nhat Anh</span></span></p>
          <p><span class="reader-pair" data-pair-id="1:0:13" data-bid="1" data-start="0" data-end="13"><span class="reader-src" lang="vi">Thể loại: Tình Yêu</span><span class="reader-tgt" lang="en">Genre: Romance</span></span></p>
          <p>—★—</p>
        </div>
      `,
        'vi',
      ),
      'wrapper.zip',
    );

    const blocks = book.chapters[0].blocks;
    expect(blocks.map((block) => block.type)).toEqual(['text', 'pairs', 'pairs', 'text']);
    expect(blocks[0]).toEqual({ type: 'text', text: 'TRẠI HOA VÀNG' });
    expect(blocks[3]).toEqual({ type: 'text', text: '—★—' });
    expect(book.stats.pairs).toBe(2);
    expect(book.stats.textOnlyBlocks).toBe(2);
    expect(book.sourceLang).toBe('vi');
    expect(book.targetLang).toBe('en');

    // Separate blocks: paragraph mode must not glue the lines together.
    const first = blocks[1];
    const second = blocks[2];
    if (first.type !== 'pairs' || second.type !== 'pairs') return;
    expect(runsToText(blockParagraph(first).source)).toBe('Tác giả: Nguyễn Nhật Ánh');
    expect(runsToText(blockParagraph(second).source)).toBe('Thể loại: Tình Yêu');
  });
});

describe('vietnamese text', () => {
  it('keeps diacritics and đ exactly, precomposed or decomposed', () => {
    const decomposed = 'Tie\u0302\u0301ng Vie\u0302\u0323t';
    const book = parseBePubZip(
      makeArchive(
        `
        <div class="standard_oe">
          <span class="reader-pair" data-pair-id="3:0:40" data-bid="3" data-start="0" data-end="40">
            <span class="reader-src" lang="vi">Tôi <i>đã</i> đến Trại Hoa Vàng — ế ộ ữ.</span>
            <span class="reader-tgt" lang="en">I <i>have</i> been to the Golden Flower Camp.</span>
          </span>
          <span class="reader-pair" data-pair-id="4:0:12" data-bid="4" data-start="0" data-end="12">
            <span class="reader-src" lang="vi">${decomposed}</span>
            <span class="reader-tgt" lang="en">Vietnamese</span>
          </span>
        </div>
      `,
        'vi',
      ),
      'vietnamese.zip',
    );

    const block = book.chapters[0].blocks[0];
    if (block.type !== 'pairs') throw new Error('expected a pairs block');
    const [precomposed, raw] = block.pairs;

    expect(precomposed.source).toBe('Tôi đã đến Trại Hoa Vàng — ế ộ ữ.');
    expect(precomposed.source.normalize('NFC')).toBe(precomposed.source);
    expect(precomposed.sourceRuns).toEqual([
      { text: 'Tôi ' },
      { text: 'đã', style: 'em' },
      { text: ' đến Trại Hoa Vàng — ế ộ ữ.' },
    ]);
    expect(precomposed.targetRuns).toEqual([
      { text: 'I ' },
      { text: 'have', style: 'em' },
      { text: ' been to the Golden Flower Camp.' },
    ]);

    // Decomposed input is stored as written: the parser never normalizes.
    expect(raw.source).toBe(decomposed);
    expect(raw.source).not.toBe(decomposed.normalize('NFC'));
  });
});

const vietnameseName = existsSync(testDataDir)
  ? readdirSync(testDataDir).find((name) => name.startsWith('Tra'))
  : undefined;

(vietnameseName ? describe : describe.skip)('Vietnamese sample', () => {
  if (!vietnameseName) return;
  const book = parseBePubZip(
    new Uint8Array(readFileSync(join(testDataDir, vietnameseName))),
    vietnameseName,
  );

  it('reads the package metadata and counts', () => {
    expect(book.title).toBe('Trại Hoa Vàng');
    expect(book.sourceLang).toBe('vi');
    expect(book.targetLang).toBe('en');
    expect(book.stats.pairs).toBe(4803);
    expect(book.stats.imageBlocks).toBe(588);
    expect(book.stats.textOnlyBlocks).toBe(3);
  });

  it('keeps every jacket line as its own block', () => {
    const chapter = book.chapters.find((candidate) =>
      candidate.path.endsWith('dtv-ebook-ngon.xhtml'),
    );

    expect(chapter?.blocks.map((block) => block.type)).toEqual([
      'text',
      'pairs',
      'pairs',
      'text',
      'text',
    ]);
    expect(chapter?.blocks[0]).toEqual({ type: 'text', text: 'TRẠI HOA VÀNG' });
  });
});
