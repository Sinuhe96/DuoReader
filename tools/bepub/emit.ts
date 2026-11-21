/**
 * Neutral BePub emitter: chapters and blocks in, `reader-master.epub` out.
 *
 * Two front-ends feed it: the authored story collection (`build.ts`) and the
 * source-edition aligner (`tools/align`). The markup contract lives in
 * `DATA-FORMAT.md`; keeping one emitter means both producers get identical
 * pair ids, offsets, paragraph containers, and derived archive layout.
 */
import { createHash } from 'node:crypto';
import { strToU8, zipSync, type Zippable } from 'fflate';

const FIXED_MTIME = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
export const DEFAULT_CREATED_AT = '2026-01-01T00:00:00+00:00';

export interface EmitPair {
  source: string;
  target: string;
  pinyin?: string;
}

export interface EmitParagraph {
  type: 'pairs';
  className?: string;
  strong?: boolean;
  pairs: EmitPair[];
}

export interface EmitText {
  type: 'text';
  text: string;
  className?: string;
}

export interface EmitImage {
  type: 'image';
  /** Relative to the chapter document, e.g. `images/cover.jpg`. */
  src: string;
  alt: string;
}

export type EmitBlock = EmitParagraph | EmitText | EmitImage;

export interface EmitChapter {
  id: string;
  href: string;
  label: string;
  /** XHTML <title>; defaults to `label`. */
  title?: string;
  blocks: EmitBlock[];
}

export interface EmitImageFile {
  id: string;
  href: string;
  mediaType: string;
  bytes: Uint8Array;
}

export interface EmitBook {
  title: string;
  author: string;
  sourceLang: string;
  targetLang: string;
  identifier: string;
  chapters: EmitChapter[];
  images?: EmitImageFile[];
  createdAt?: string;
  pipelineVersion?: string;
  schemaVersion?: number;
}

export interface EmitStats {
  chapters: number;
  paragraphs: number;
  pairs: number;
  images: number;
  bytes: number;
  readerMasterBytes: number;
}

export interface EmitResult {
  title: string;
  bookId: string;
  archive: Uint8Array;
  readerMaster: Uint8Array;
  stats: EmitStats;
}

interface Counter {
  bid: number;
  paragraphs: number;
  pairs: number;
}

function fail(message: string): never {
  throw new Error(message);
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      default:
        return '&quot;';
    }
  });
}

function xmlAttr(value: string): string {
  return `"${escapeXml(value)}"`;
}

/** Chinese, Japanese, and friends do not separate sentences with a space. */
function usesWordSpaces(lang: string): boolean {
  return !/^(zh|ja|th|lo|my|km)/i.test(lang);
}

function paragraphMarkup(
  counter: Counter,
  block: EmitParagraph,
  sourceLang: string,
  targetLang: string,
): string {
  if (block.pairs.length === 0) fail('A paragraph block needs at least one pair.');
  const bid = counter.bid;
  counter.bid += 1;
  const gap = usesWordSpaces(sourceLang) ? 1 : 0;
  let offset = 0;
  const parts: string[] = [];

  for (const pair of block.pairs) {
    const source = pair.source.trim();
    const target = pair.target.trim();
    if (!source && !target) fail(`Pair ${bid} has neither source nor target text.`);

    const start = offset;
    const end = start + source.length;
    const id = `${bid}:${start}:${end}`;
    const pinyin = pair.pinyin?.replace(/\s+/g, ' ').trim();
    const pinyinAttr = pinyin ? ` data-pinyin=${xmlAttr(pinyin)}` : '';
    const wrap = (text: string): string =>
      block.strong ? `<strong>${escapeXml(text)}</strong>` : escapeXml(text);

    parts.push(
      `<span class="reader-pair" data-pair-id="${id}" data-bid="${bid}" data-start="${start}" data-end="${end}">` +
        `<span class="reader-src" lang=${xmlAttr(sourceLang)}${pinyinAttr}>${wrap(source)}</span>` +
        `<span class="reader-tgt" lang=${xmlAttr(targetLang)}>${wrap(target)}</span>` +
        '</span>',
    );
    counter.pairs += 1;
    offset = end + gap;
  }

  counter.paragraphs += 1;
  return `<p class="${block.className ?? 'story-p'}">${parts.join('')}</p>`;
}

function textMarkup(block: EmitText): string {
  return `<p class="${block.className ?? 'text-block'}">${escapeXml(block.text.trim())}</p>`;
}

function imageMarkup(block: EmitImage): string {
  return `<div class="illustration"><img src=${xmlAttr(block.src)} alt=${xmlAttr(block.alt)}/></div>`;
}

function documentMarkup(title: string, lang: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang=${xmlAttr(lang)} xml:lang=${xmlAttr(lang)}>
  <head><title>${escapeXml(title)}</title></head>
  <body>${body}</body>
</html>
`;
}

function chapterMarkup(
  chapter: EmitChapter,
  counter: Counter,
  sourceLang: string,
  targetLang: string,
): string {
  const parts = chapter.blocks.map((block) => {
    switch (block.type) {
      case 'pairs':
        return paragraphMarkup(counter, block, sourceLang, targetLang);
      case 'text':
        return textMarkup(block);
      case 'image':
        return imageMarkup(block);
    }
  });
  return documentMarkup(chapter.title ?? chapter.label, sourceLang, parts.join(''));
}

function containerXml(): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
}

function contentOpf(
  book: EmitBook,
  images: EmitImageFile[],
): string {
  const chapterItems = book.chapters
    .map((chapter) => `    <item id="${chapter.id}" href="${chapter.href}" media-type="application/xhtml+xml"/>`)
    .join('\n');
  const imageItems = images
    .map(
      (image) =>
        `    <item id="${image.id}" href="${image.href}" media-type="${image.mediaType}"/>`,
    )
    .join('\n');
  const spineItems = book.chapters
    .map((chapter) => `    <itemref idref="${chapter.id}"/>`)
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${escapeXml(book.identifier)}</dc:identifier>
    <dc:title>${escapeXml(book.title)}</dc:title>
    <dc:creator>${escapeXml(book.author)}</dc:creator>
    <dc:language>${escapeXml(book.sourceLang)}</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="content.ncx" media-type="application/x-dtbncx+xml"/>
${chapterItems}
${imageItems}
  </manifest>
  <spine toc="ncx">
${spineItems}
  </spine>
</package>
`;
}

function contentNcx(book: EmitBook): string {
  const navPoints = book.chapters
    .map(
      (chapter, index) =>
        `    <navPoint id="nav${index + 1}" playOrder="${index + 1}">
      <navLabel><text>${escapeXml(chapter.label)}</text></navLabel>
      <content src="${chapter.href}"/>
    </navPoint>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(book.identifier)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(book.title)}</text></docTitle>
  <docAuthor><text>${escapeXml(book.author)}</text></docAuthor>
  <navMap>
${navPoints}
  </navMap>
</ncx>
`;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function zip(files: Zippable): Uint8Array {
  return zipSync(files, { mtime: FIXED_MTIME, level: 6 });
}

/** Builds the archive in memory. Deterministic for unchanged input. */
export function emitBook(input: EmitBook): EmitResult {
  if (input.chapters.length === 0) fail('A book needs at least one chapter.');
  const images = input.images ?? [];
  const counter: Counter = { bid: 0, paragraphs: 0, pairs: 0 };
  const files: Record<string, Uint8Array> = {};

  const writtenImages = new Set<string>();
  for (const chapter of input.chapters) {
    // Keep the story builder's entry order: the image of a chapter precedes
    // the chapter document, so unchanged input still yields the same ZIP bytes.
    for (const block of chapter.blocks) {
      if (block.type !== 'image') continue;
      const image = images.find((candidate) => candidate.href === block.src);
      if (image && !writtenImages.has(image.href)) {
        files[`OEBPS/${image.href}`] = image.bytes;
        writtenImages.add(image.href);
      }
    }
    files[`OEBPS/${chapter.href}`] = strToU8(
      chapterMarkup(chapter, counter, input.sourceLang, input.targetLang),
    );
  }
  for (const image of images) {
    if (!writtenImages.has(image.href)) files[`OEBPS/${image.href}`] = image.bytes;
  }

  files['META-INF/container.xml'] = strToU8(containerXml());
  files['OEBPS/content.opf'] = strToU8(contentOpf(input, images));
  files['OEBPS/content.ncx'] = strToU8(contentNcx(input));
  const readerMaster = zip({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    ...files,
  });

  const digest = sha256(readerMaster);
  const manifest = {
    schema_version: input.schemaVersion ?? 1,
    title: input.title,
    source_lang: input.sourceLang,
    target_lang: input.targetLang,
    pipeline_version: input.pipelineVersion ?? 'duoreader-emit-1',
    created_at: input.createdAt ?? DEFAULT_CREATED_AT,
    reader_modes: ['sentence', 'paragraph'],
    files: [
      {
        path: 'reader-master.epub',
        bytes: readerMaster.length,
        sha256: digest,
        media_type: 'application/epub+zip',
      },
    ],
  };

  const archive = zip({
    'reader-master.epub': readerMaster,
    'manifest.json': strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
  });

  return {
    title: input.title,
    bookId: `book-${digest.slice(0, 12)}`,
    archive,
    readerMaster,
    stats: {
      chapters: input.chapters.length,
      paragraphs: counter.paragraphs,
      pairs: counter.pairs,
      images: images.length,
      bytes: archive.length,
      readerMasterBytes: readerMaster.length,
    },
  };
}
