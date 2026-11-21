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
 * `book.json`. The neutral emitter lives in `tools/bepub/emit.ts`.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  emitBook,
  type EmitBlock,
  type EmitChapter,
  type EmitImageFile,
  type EmitResult,
  type EmitStats,
} from './emit.ts';

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

export type BuildStats = EmitStats;

export type BuildResult = EmitResult;

interface LoadedStory {
  entry: StoryEntry;
  data: StoryFile;
  directory: string;
  imageName?: string;
  imageBytes?: Uint8Array;
  imageMediaType?: string;
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

function sentencePair(sentence: StorySentence) {
  return { source: sentence.zh, target: sentence.en, pinyin: sentence.pinyin };
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

function storyChapter(
  story: LoadedStory,
  index: number,
  total: number,
): { chapter: EmitChapter; image?: EmitImageFile } {
  const { data, entry } = story;
  const id = `s${index + 1}`;
  const href = `${id}.xhtml`;
  let label = entry.label ?? data.title_zh;
  if (total > 1) label = `${index + 1} · ${label}`;

  const blocks: EmitBlock[] = [
    {
      type: 'pairs',
      className: 'title-pair',
      strong: true,
      pairs: [{ source: data.title_zh, target: data.title_en, pinyin: entry.pinyin }],
    },
  ];

  let image: EmitImageFile | undefined;
  if (story.imageBytes && story.imageName && story.imageMediaType) {
    const name = `${id}-${story.imageName}`;
    image = {
      id: `img${index + 1}`,
      href: `images/${name}`,
      mediaType: story.imageMediaType,
      bytes: story.imageBytes,
    };
    story.imageName = name;
  }

  const anchor = entry.image_after_paragraph ?? 0;
  const paragraphs = paragraphsOf(data, entry);
  if (anchor < 0 || anchor > paragraphs.length) {
    fail(`${entry.file}: image_after_paragraph ${anchor} is outside 0…${paragraphs.length}.`);
  }
  const imageBlock: EmitBlock | undefined = image
    ? { type: 'image', src: image.href, alt: entry.alt ?? '' }
    : undefined;

  paragraphs.forEach((sentences, paragraphIndex) => {
    if (paragraphIndex === anchor && imageBlock) blocks.push(imageBlock);
    blocks.push({
      type: 'pairs',
      className: 'story-p',
      pairs: sentences.map(sentencePair),
    });
  });
  if (anchor === paragraphs.length && imageBlock) blocks.push(imageBlock);

  return {
    chapter: { id, href, label, blocks },
    image,
  };
}

function glossaryChapter(stories: LoadedStory[]): EmitChapter | undefined {
  const withVocabulary = stories.filter((story) => (story.data.key_vocabulary ?? []).length > 0);
  if (withVocabulary.length === 0) return undefined;

  const blocks: EmitBlock[] = [
    {
      type: 'pairs',
      className: 'title-pair',
      strong: true,
      pairs: [{ source: '词汇', target: 'Vocabulary' }],
    },
  ];

  const grouped = stories.length > 1;
  for (const story of withVocabulary) {
    if (grouped) {
      blocks.push({
        type: 'pairs',
        className: 'glossary-group',
        pairs: [{ source: story.data.title_zh, target: story.data.title_en }],
      });
    }
    for (const item of story.data.key_vocabulary ?? []) {
      blocks.push({
        type: 'pairs',
        className: 'glossary-entry',
        pairs: [{ source: item.zh, target: item.en, pinyin: item.pinyin }],
      });
    }
  }

  return {
    id: 'glossary',
    href: 'glossary.xhtml',
    label: '词汇 · Vocabulary',
    title: '词汇 Vocabulary',
    blocks,
  };
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

  const chapters: EmitChapter[] = [];
  const images: EmitImageFile[] = [];
  const usedImageNames = new Set<string>();

  stories.forEach((story, index) => {
    const { chapter, image } = storyChapter(story, index, stories.length);
    chapters.push(chapter);
    if (image) {
      const name = image.href.slice('images/'.length);
      if (usedImageNames.has(name)) fail(`Duplicate image name ${name}.`);
      usedImageNames.add(name);
      images.push(image);
    }
  });

  const glossary = glossaryChapter(stories);
  if (glossary) chapters.push(glossary);

  return emitBook({
    title: collection.title,
    author,
    sourceLang: lang,
    targetLang,
    identifier,
    chapters,
    images,
    createdAt: collection.created_at,
    pipelineVersion: PIPELINE,
    schemaVersion: 1,
  });
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
