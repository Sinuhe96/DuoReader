/**
 * Builds an importable BePub ZIP from a story collection.
 *
 * Input: a directory holding `book.json` (order, labels, images, paragraph
 * grouping) and the adapted story JSON files it names, plus their images.
 * Output: `out/books/<slug>.zip` — `manifest.json` + `reader-master.epub`,
 * the only two entries the reader parses (`DATA-FORMAT.md` §1–§4).
 *
 * The story JSON stays verbatim model output: editorial facts (order, label,
 * image placement, paragraph grouping when the model did not emit `p`) live in
 * `book.json`.
 *
 * Windows-safe, dependency-free beyond `fflate`, and deterministic: every ZIP
 * entry gets a fixed mtime and `created_at` is a constant, so rebuilding
 * unchanged input produces the same bytes, the same `reader-master` sha256,
 * and therefore the same `book.id` (AGENTS.md invariant 3).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync, type Zippable } from 'fflate';

/** A DOS timestamp fflate encodes; fixed so rebuilds are byte-identical. */
const FIXED_MTIME = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
const DEFAULT_CREATED_AT = '2026-01-01T00:00:00+00:00';
const PIPELINE = 'duoreader-stories-1';

export interface StorySentence {
  id?: number;
  zh: string;
  en: string;
  pinyin?: string;
  /** 1-based paragraph number; optional when `book.json` gives paragraph lengths. */
  p?: number;
}

export interface VocabularyEntry {
  zh: string;
  pinyin?: string;
  en: string;
}

export interface StoryFile {
  title_zh: string;
  title_en: string;
  level?: string;
  sentences: StorySentence[];
  key_vocabulary?: VocabularyEntry[];
}

export interface StoryEntry {
  /** Story JSON, relative to the collection directory. */
  file: string;
  /** Chapter label; defaults to the story's `title_zh`. */
  label?: string;
  /** Pinyin of the title pair; the model does not emit one. */
  pinyin?: string;
  /** Paragraph lengths in sentences, used when the story has no `p`. */
  paragraphs?: number[];
  /** Illustration, relative to the collection directory. */
  image?: string;
  alt?: string;
  /** Put the image after this 1-based paragraph; `0` puts it before the text. */
  image_after_paragraph?: number;
}

export interface Collection {
  title: string;
  author?: string;
  source_lang?: string;
  target_lang?: string;
  created_at?: string;
  stories: StoryEntry[];
}

export interface BuildStats {
  chapters: number;
  paragraphs: number;
  pairs: number;
  images: number;
  bytes: number;
  /** Byte length of `reader-master.epub`, the edition identity. */
  readerMasterBytes: number;
}

export interface BuildResult {
  title: string;
  bookId: string;
  archive: Uint8Array;
  readerMaster: Uint8Array;
  stats: BuildStats;
}

interface LoadedStory {
  entry: StoryEntry;
  data: StoryFile;
  directory: string;
  imageName?: string;
  imageBytes?: Uint8Array;
  imageMediaType?: string;
}

interface Counter {
  bid: number;
  paragraphs: number;
  pairs: number;
}

const MEDIA_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

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

function mediaTypeFor(name: string): string | undefined {
  return MEDIA_TYPES[name.split('.').pop()?.toLowerCase() ?? ''];
}

function safeName(value: string): string {
  const cleaned = value.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'image';
}

/** Groups sentences into paragraphs from `p`, or the declared lengths. */
function paragraphsOf(story: StoryFile, entry: StoryEntry): StorySentence[][] {
  const { sentences } = story;
  if (sentences.length === 0) return [];

  const numbered = sentences.every((sentence) => sentence.p !== undefined);
  if (numbered) {
    const groups = new Map<number, StorySentence[]>();
    for (const sentence of sentences) {
      const key = sentence.p as number;
      const group = groups.get(key);
      if (group) group.push(sentence);
      else groups.set(key, [sentence]);
    }
    const keys = [...groups.keys()].sort((a, b) => a - b);
    return keys.map((key) => groups.get(key) as StorySentence[]);
  }

  if (entry.paragraphs) {
    const total = entry.paragraphs.reduce((sum, length) => sum + length, 0);
    if (total !== sentences.length) {
      fail(
        `${entry.file}: paragraphs cover ${total} sentences but the story has ${sentences.length}.`,
      );
    }
    const groups: StorySentence[][] = [];
    let cursor = 0;
    for (const length of entry.paragraphs) {
      groups.push(sentences.slice(cursor, cursor + length));
      cursor += length;
    }
    return groups;
  }

  if (sentences.some((sentence) => sentence.p !== undefined)) {
    fail(`${entry.file}: either every sentence gets "p" or none does.`);
  }
  return [sentences];
}

/**
 * One paragraph container owning its `reader-pair` spans. Offsets are
 * cumulative inside the block; for spaced source languages the sentence gap is
 * one character, which `blockParagraph` turns back into a single space.
 */
function paragraphMarkup(
  counter: Counter,
  sentences: StorySentence[],
  options: { lang: string; targetLang: string; className: string; strong?: boolean },
): string {
  const bid = counter.bid;
  counter.bid += 1;
  const gap = usesWordSpaces(options.lang) ? 1 : 0;
  let offset = 0;
  const parts: string[] = [];

  for (const sentence of sentences) {
    const source = sentence.zh.trim();
    const target = sentence.en.trim();
    if (!source) fail(`Sentence ${sentence.id ?? '?'} has no Chinese text.`);
    if (!target) fail(`Sentence ${sentence.id ?? '?'} has no English text.`);

    const start = offset;
    const end = start + source.length;
    const id = `${bid}:${start}:${end}`;
    const pinyin = sentence.pinyin?.replace(/\s+/g, ' ').trim();
    const pinyinAttr = pinyin ? ` data-pinyin=${xmlAttr(pinyin)}` : '';
    const wrap = (text: string): string => (options.strong ? `<strong>${escapeXml(text)}</strong>` : escapeXml(text));

    parts.push(
      `<span class="reader-pair" data-pair-id="${id}" data-bid="${bid}" data-start="${start}" data-end="${end}">` +
        `<span class="reader-src" lang=${xmlAttr(options.lang)}${pinyinAttr}>${wrap(source)}</span>` +
        `<span class="reader-tgt" lang=${xmlAttr(options.targetLang)}>${wrap(target)}</span>` +
        '</span>',
    );
    counter.pairs += 1;
    offset = end + gap;
  }

  counter.paragraphs += 1;
  return `<p class="${options.className}">${parts.join('')}</p>`;
}

function imageMarkup(story: LoadedStory, chapterPath: string): string {
  const image = story.imageName;
  if (!image) return '';
  const src = `${dirname(chapterPath)}/images/${image}`.replace(/^OEBPS\//, '');
  const alt = story.entry.alt ?? '';
  return `<div class="illustration"><img src=${xmlAttr(src)} alt=${xmlAttr(alt)}/></div>`;
}

function documentMarkup(
  title: string,
  lang: string,
  body: string,
): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang=${xmlAttr(lang)} xml:lang=${xmlAttr(lang)}>
  <head><title>${escapeXml(title)}</title></head>
  <body>${body}</body>
</html>
`;
}

function storyDocument(
  story: LoadedStory,
  counter: Counter,
  chapterPath: string,
  lang: string,
  targetLang: string,
): string {
  const { data, entry } = story;
  const parts: string[] = [];

  parts.push(
    paragraphMarkup(
      counter,
      [{ zh: data.title_zh, en: data.title_en, pinyin: entry.pinyin }],
      { lang, targetLang, className: 'title-pair', strong: true },
    ),
  );

  const anchor = entry.image_after_paragraph ?? 0;
  const paragraphs = paragraphsOf(data, entry);
  if (anchor < 0 || anchor > paragraphs.length) {
    fail(
      `${entry.file}: image_after_paragraph ${anchor} is outside 0…${paragraphs.length}.`,
    );
  }

  paragraphs.forEach((sentences, index) => {
    if (index === anchor) parts.push(imageMarkup(story, chapterPath));
    parts.push(paragraphMarkup(counter, sentences, { lang, targetLang, className: 'story-p' }));
  });
  if (anchor === paragraphs.length) parts.push(imageMarkup(story, chapterPath));

  return documentMarkup(entry.label ?? data.title_zh, lang, parts.join(''));
}

function glossaryDocument(
  stories: LoadedStory[],
  counter: Counter,
  lang: string,
  targetLang: string,
): string | undefined {
  const withVocabulary = stories.filter((story) => (story.data.key_vocabulary ?? []).length > 0);
  if (withVocabulary.length === 0) return undefined;

  const parts: string[] = [];
  parts.push(
    paragraphMarkup(counter, [{ zh: '词汇', en: 'Vocabulary' }], {
      lang,
      targetLang,
      className: 'title-pair',
      strong: true,
    }),
  );

  const grouped = stories.length > 1;
  for (const story of withVocabulary) {
    if (grouped) {
      parts.push(
        paragraphMarkup(
          counter,
          [{ zh: story.data.title_zh, en: story.data.title_en }],
          { lang, targetLang, className: 'glossary-group' },
        ),
      );
    }
    for (const item of story.data.key_vocabulary ?? []) {
      parts.push(
        paragraphMarkup(
          counter,
          [{ zh: item.zh, en: item.en, pinyin: item.pinyin }],
          { lang, targetLang, className: 'glossary-entry' },
        ),
      );
    }
  }

  return documentMarkup('词汇 Vocabulary', lang, parts.join(''));
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

interface ChapterRef {
  id: string;
  href: string;
  label: string;
}

function contentOpf(
  title: string,
  author: string,
  lang: string,
  chapters: ChapterRef[],
  images: { id: string; href: string; mediaType: string }[],
  identifier: string,
): string {
  const chapterItems = chapters
    .map((chapter) => `    <item id="${chapter.id}" href="${chapter.href}" media-type="application/xhtml+xml"/>`)
    .join('\n');
  const imageItems = images
    .map(
      (image) =>
        `    <item id="${image.id}" href="${image.href}" media-type="${image.mediaType}"/>`,
    )
    .join('\n');
  const spineItems = chapters
    .map((chapter) => `    <itemref idref="${chapter.id}"/>`)
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${escapeXml(identifier)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:language>${escapeXml(lang)}</dc:language>
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

function contentNcx(title: string, author: string, chapters: ChapterRef[], identifier: string): string {
  const navPoints = chapters
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
    <meta name="dtb:uid" content="${escapeXml(identifier)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <docAuthor><text>${escapeXml(author)}</text></docAuthor>
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

async function loadStory(directory: string, entry: StoryEntry): Promise<LoadedStory> {
  const path = join(directory, entry.file);
  let data: StoryFile;
  try {
    data = JSON.parse(await readFile(path, 'utf8')) as StoryFile;
  } catch (cause) {
    fail(`${entry.file}: could not read the story JSON (${(cause as Error).message}).`);
  }
  if (!data.title_zh || !data.title_en) fail(`${entry.file}: title_zh and title_en are required.`);
  if (!Array.isArray(data.sentences) || data.sentences.length === 0) {
    fail(`${entry.file}: sentences must be a non-empty array.`);
  }

  const story: LoadedStory = { entry, data, directory };
  if (entry.image) {
    const bytes = new Uint8Array(await readFile(join(directory, entry.image)));
    const mediaType = mediaTypeFor(entry.image);
    if (!mediaType) fail(`${entry.image}: unsupported image type.`);
    story.imageBytes = bytes;
    story.imageMediaType = mediaType;
    story.imageName = safeName(basename(entry.image));
  }
  return story;
}

/**
 * Builds the archive in memory. Deterministic for unchanged input: fixed mtime
 * per ZIP entry and a constant `created_at`.
 */
export async function buildCollection(directory: string): Promise<BuildResult> {
  const bookPath = join(directory, 'book.json');
  let collection: Collection;
  try {
    collection = JSON.parse(await readFile(bookPath, 'utf8')) as Collection;
  } catch (cause) {
    fail(`book.json: could not read the collection (${(cause as Error).message}).`);
  }
  if (!collection.title) fail('book.json: title is required.');
  if (!Array.isArray(collection.stories) || collection.stories.length === 0) {
    fail('book.json: stories must be a non-empty array.');
  }

  const lang = collection.source_lang ?? 'zh-Hans';
  const targetLang = collection.target_lang ?? 'en';
  const author = collection.author ?? 'Graded reader';
  const slug = safeName(basename(resolve(directory))).toLowerCase();
  const identifier = `urn:duoreader:${slug}`;

  const stories: LoadedStory[] = [];
  for (const entry of collection.stories) stories.push(await loadStory(directory, entry));

  const counter: Counter = { bid: 0, paragraphs: 0, pairs: 0 };
  const chapters: ChapterRef[] = [];
  const files: Record<string, Uint8Array> = {};
  const images: { id: string; href: string; mediaType: string }[] = [];
  const usedImageNames = new Set<string>();

  stories.forEach((story, index) => {
    const id = `s${index + 1}`;
    const href = `${id}.xhtml`;
    let label = story.entry.label ?? story.data.title_zh;
    if (stories.length > 1) label = `${index + 1} · ${label}`;
    chapters.push({ id, href, label });

    if (story.imageBytes && story.imageName && story.imageMediaType) {
      // Prefix the file so two stories cannot collide in one images/ folder.
      const name = `${id}-${story.imageName}`;
      if (usedImageNames.has(name)) fail(`Duplicate image name ${name}.`);
      usedImageNames.add(name);
      story.imageName = name;
      images.push({ id: `img${index + 1}`, href: `images/${name}`, mediaType: story.imageMediaType });
      files[`OEBPS/images/${name}`] = story.imageBytes;
    }

    files[`OEBPS/${href}`] = strToU8(
      storyDocument(story, counter, `OEBPS/${href}`, lang, targetLang),
    );
  });

  const glossary = glossaryDocument(stories, counter, lang, targetLang);
  if (glossary) {
    const label = '词汇 · Vocabulary';
    chapters.push({ id: 'glossary', href: 'glossary.xhtml', label });
    files['OEBPS/glossary.xhtml'] = strToU8(glossary);
  }

  files['META-INF/container.xml'] = strToU8(containerXml());
  files['OEBPS/content.opf'] = strToU8(
    contentOpf(collection.title, author, lang, chapters, images, identifier),
  );
  files['OEBPS/content.ncx'] = strToU8(
    contentNcx(collection.title, author, chapters, identifier),
  );
  // `mimetype` must be the first entry and stored, per the EPUB spec.
  const readerMaster = zip({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    ...files,
  });

  const digest = sha256(readerMaster);
  const manifest = {
    schema_version: 1,
    title: collection.title,
    source_lang: lang,
    target_lang: targetLang,
    pipeline_version: PIPELINE,
    created_at: collection.created_at ?? DEFAULT_CREATED_AT,
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
    title: collection.title,
    bookId: `book-${digest.slice(0, 12)}`,
    archive,
    readerMaster,
    stats: {
      chapters: chapters.length,
      paragraphs: counter.paragraphs,
      pairs: counter.pairs,
      images: images.length,
      bytes: archive.length,
      readerMasterBytes: readerMaster.length,
    },
  };
}

/** `npm run book -- stories/<collection>` writes `out/books/<slug>.zip`. */
async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: npm run book -- stories/<collection> [--out out/books]');
    process.exitCode = 1;
    return;
  }
  const directory = resolve(target);
  const outIndex = process.argv.indexOf('--out');
  const outDir = resolve(outIndex === -1 ? 'out/books' : (process.argv[outIndex + 1] ?? 'out/books'));
  const slug = safeName(basename(directory)).toLowerCase();

  const result = await buildCollection(directory);
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, `${slug}.zip`);
  await writeFile(path, result.archive);

  console.log(
    `${result.title} · ${result.stats.chapters} chapters · ${result.stats.pairs} pairs · ` +
      `${result.stats.paragraphs} paragraphs · ${result.stats.images} image(s)`,
  );
  console.log(
    `${result.bookId} · ${result.stats.readerMasterBytes.toLocaleString('en')} B epub · ` +
      `${result.stats.bytes.toLocaleString('en')} B zip`,
  );
  console.log(path);
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
if (invoked === fileURLToPath(import.meta.url)) {
  await main();
}
