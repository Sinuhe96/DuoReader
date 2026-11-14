import {
  byLocalName,
  childByLocalName,
  descendantsByClass,
  findFile,
  firstByLocalName,
  imageFromFile,
  isExternal,
  mimeFor,
  normalizePath,
  parseXml,
  readText,
  resolveHref,
  textOf,
  unzip,
  type Files,
} from './archive';
import { ImportError, type Block, type Book, type BookImage, type Chapter, type Pair } from './types';

interface OuterManifestFile {
  path: string;
  bytes?: number;
  sha256?: string;
  media_type?: string;
}

interface OuterManifest {
  title?: string;
  source_lang?: string;
  target_lang?: string;
  files?: OuterManifestFile[];
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
}

interface ChapterParse {
  path: string;
  blocks: Block[];
  pairCount: number;
  imageBlocks: number;
  textOnlyBlocks: number;
  sourceLang?: string;
  targetLang?: string;
}

const XHTML_MEDIA_TYPES: Record<string, true> = {
  'application/xhtml+xml': true,
  'text/html': true,
};

export function parseBePubZip(input: ArrayBuffer | Uint8Array, filename = 'book.zip'): Book {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength === 0) throw new ImportError('The selected file is empty.');

  const outer = unzip(bytes, filename);
  const manifest = readOuterManifest(outer);

  let inner: Files;
  let innerName: string;
  if (looksLikeEpub(outer)) {
    inner = outer;
    innerName = filename;
  } else {
    const reader = findReaderMaster(outer, manifest);
    if (!reader) {
      throw new ImportError(
        'This ZIP has no reader-master.epub. Export the book from BePub again.',
      );
    }
    inner = unzip(reader.data, reader.path);
    innerName = reader.path;
  }

  return parseReaderMaster(inner, innerName, manifest);
}

function readOuterManifest(files: Files): OuterManifest | undefined {
  const entry = findFile(files, 'manifest.json');
  if (!entry) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(entry[1])) as OuterManifest;
  } catch {
    return undefined;
  }
}

function looksLikeEpub(files: Files): boolean {
  return Boolean(findFile(files, 'META-INF/container.xml') && findFile(files, 'mimetype'));
}

function findReaderMaster(
  files: Files,
  manifest: OuterManifest | undefined,
): { path: string; data: Uint8Array } | undefined {
  const named = manifest?.files?.find((file) => /(^|\/)reader-master\.epub$/i.test(file.path));
  if (named) {
    const found = findFile(files, named.path);
    if (found) return { path: found[0], data: found[1] };
  }

  const candidates = Object.entries(files)
    .filter(([path]) => /(^|\/)reader-master\.epub$/i.test(path))
    .sort(([a], [b]) => a.localeCompare(b));
  if (candidates.length > 0) {
    return { path: candidates[0][0], data: candidates[0][1] };
  }

  const epubs = Object.entries(files)
    .filter(([path]) => /\.epub$/i.test(path))
    .sort(([a], [b]) => a.localeCompare(b));
  if (epubs.length === 1) return { path: epubs[0][0], data: epubs[0][1] };
  return undefined;
}

function parseReaderMaster(files: Files, innerName: string, outer: OuterManifest | undefined): Book {
  const containerText = readText(files, 'META-INF/container.xml');
  const container = parseXml(containerText, 'META-INF/container.xml');
  const rootfile = firstByLocalName(container, 'rootfile');
  const opfPath = rootfile?.getAttribute('full-path');
  if (!opfPath) throw new ImportError('The EPUB has no package document.');

  const opf = parseXml(readText(files, opfPath), opfPath);
  const metadata = firstByLocalName(opf, 'metadata');
  const title =
    textOf(firstByLocalName(metadata ?? opf, 'title')) || outer?.title || 'Untitled book';
  const opfAuthor = textOf(firstByLocalName(metadata ?? opf, 'creator'));
  const opfLang = textOf(firstByLocalName(metadata ?? opf, 'language'));

  const items = byLocalName(opf, 'item').map<ManifestItem>((item) => ({
    id: item.getAttribute('id') ?? '',
    href: resolveHref(opfPath, item.getAttribute('href') ?? ''),
    mediaType: item.getAttribute('media-type') ?? '',
  }));
  const itemsById = new Map(items.map((item) => [item.id, item]));

  const spine = firstByLocalName(opf, 'spine');
  const spinePaths = Array.from(spine?.children ?? [])
    .filter((child) => child.localName === 'itemref')
    .map((child) => itemsById.get(child.getAttribute('idref') ?? ''))
    .filter((item): item is ManifestItem => Boolean(item))
    .filter(
      (item) => XHTML_MEDIA_TYPES[item.mediaType] === true || /\.x?html?$/i.test(item.href),
    )
    .map((item) => item.href);

  const documentPaths =
    spinePaths.length > 0
      ? spinePaths
      : items
          .filter((item) => XHTML_MEDIA_TYPES[item.mediaType] === true)
          .map((item) => item.href);

  let ncx: { labels: Map<string, string>; author?: string } = { labels: new Map() };
  const ncxItem =
    itemsById.get(spine?.getAttribute('toc') ?? '') ??
    items.find((item) => item.mediaType === 'application/x-dtbncx+xml');
  if (ncxItem) ncx = parseNcx(files, ncxItem);

  const images: Record<string, BookImage> = {};
  const missingImages = new Set<string>();
  const warnings: string[] = [];
  const parsed: ChapterParse[] = [];

  for (const path of documentPaths) {
    const chapter = parseChapter(files, path, images, missingImages);
    parsed.push(chapter);
  }

  const detectedSource = parsed.find((chapter) => chapter.sourceLang)?.sourceLang;
  const detectedTarget = parsed.find((chapter) => chapter.targetLang)?.targetLang;
  const sourceLang = opfLang || outer?.source_lang || detectedSource || 'und';
  const targetLang = outer?.target_lang || detectedTarget || 'und';
  const author = (ncx.author || opfAuthor).replace(/\s*\([^)]*\)\s*$/, '').trim();

  let chapterNumber = 0;
  let chapterIndex = 0;
  const chapters: Chapter[] = [];
  for (const chapter of parsed) {
    if (chapter.blocks.length === 0) continue;
    const ncxLabel = ncx.labels.get(normalizePath(chapter.path));
    let label = ncxLabel;
    if (!label) {
      if (chapter.pairCount > 0) label = `Chapter ${++chapterNumber}`;
      else if (chapter.imageBlocks > 0) label = 'Illustration';
      else label = `Section ${chapterIndex + 1}`;
    }
    chapters.push({
      index: chapterIndex++,
      path: chapter.path,
      label,
      blocks: chapter.blocks,
      pairCount: chapter.pairCount,
    });
  }

  const pairIds = new Set<string>();
  let duplicatePairIds = 0;
  let textOnlyBlocks = 0;
  let imageBlocks = 0;
  let pairCount = 0;
  for (const chapter of chapters) {
    for (const block of chapter.blocks) {
      if (block.type === 'pairs') {
        for (const pair of block.pairs) {
          pairCount += 1;
          if (pairIds.has(pair.id)) duplicatePairIds += 1;
          pairIds.add(pair.id);
        }
      } else if (block.type === 'image') {
        imageBlocks += 1;
      } else {
        textOnlyBlocks += 1;
      }
    }
  }

  if (textOnlyBlocks > 0) {
    warnings.push(
      `${textOnlyBlocks} paragraph${textOnlyBlocks === 1 ? ' has' : 's have'} no translation and will be shown in the source language.`,
    );
  }
  if (missingImages.size > 0) {
    warnings.push(
      `${missingImages.size} image${missingImages.size === 1 ? '' : 's'} could not be found in the EPUB.`,
    );
  }
  if (duplicatePairIds > 0) {
    warnings.push(`${duplicatePairIds} duplicate sentence ids were ignored for position tracking.`);
  }
  if (pairCount === 0) {
    warnings.push('No bilingual sentence pairs were found in this book.');
  }
  if (chapters.length === 0) {
    warnings.push('No readable chapters were found in this book.');
  }

  const sourceHash = outer?.files?.find((file) => /reader-master\.epub$/i.test(file.path))?.sha256;
  const id = `book-${sourceHash?.slice(0, 12) ?? hashString(`${title}|${chapters[0]?.path ?? innerName}`)}`;

  return {
    id,
    title,
    author: author || 'Unknown author',
    sourceLang,
    targetLang,
    chapters,
    images,
    stats: {
      documents: documentPaths.length,
      pairs: pairCount,
      imageBlocks,
      images: Object.keys(images).length,
      textOnlyBlocks,
    },
    warnings,
  };
}

function parseNcx(
  files: Files,
  item: ManifestItem,
): { labels: Map<string, string>; author?: string } {
  const entry = findFile(files, item.href);
  if (!entry) return { labels: new Map() };
  const doc = parseXml(new TextDecoder().decode(entry[1]), item.href);
  const labels = new Map<string, string>();
  for (const navPoint of byLocalName(doc, 'navPoint')) {
    const navLabel = childByLocalName(navPoint, 'navLabel');
    const label = navLabel ? textOf(firstByLocalName(navLabel, 'text')) : '';
    const content = childByLocalName(navPoint, 'content');
    const src = content?.getAttribute('src');
    if (label && src) labels.set(resolveHref(item.href, src), label);
  }
  const author = textOf(firstByLocalName(doc, 'docAuthor'));
  return { labels, author };
}

function parseChapter(
  files: Files,
  path: string,
  images: Record<string, BookImage>,
  missingImages: Set<string>,
): ChapterParse {
  const entry = findFile(files, path);
  if (!entry) {
    return {
      path,
      blocks: [],
      pairCount: 0,
      imageBlocks: 0,
      textOnlyBlocks: 0,
    };
  }

  const doc = parseXml(new TextDecoder().decode(entry[1]), path);
  const body = firstByLocalName(doc, 'body');
  const blocks: Block[] = [];
  let pairCount = 0;
  let imageBlocks = 0;
  let textOnlyBlocks = 0;
  let sourceLang: string | undefined;
  let targetLang: string | undefined;

  if (!body) {
    return {
      path,
      blocks,
      pairCount,
      imageBlocks,
      textOnlyBlocks,
    };
  }

  for (const element of Array.from(body.children)) {
    const pairElements = descendantsByClass(element, 'reader-pair');
    if (pairElements.length > 0) {
      const pairs: Pair[] = [];
      for (const pairElement of pairElements) {
        const sourceElement = descendantsByClass(pairElement, 'reader-src')[0];
        const targetElement = descendantsByClass(pairElement, 'reader-tgt')[0];
        const source = textOf(sourceElement);
        const target = textOf(targetElement);
        if (!source && !target) continue;
        sourceLang ||= sourceElement?.getAttribute('lang') ?? undefined;
        targetLang ||= targetElement?.getAttribute('lang') ?? undefined;
        const id = pairElement.getAttribute('data-pair-id');
        if (!id) continue;
        pairs.push({
          id,
          bid: pairElement.getAttribute('data-bid') ?? id.split(':')[0],
          source,
          target,
        });
      }
      if (pairs.length > 0) {
        blocks.push({ type: 'pairs', pairs });
        pairCount += pairs.length;
      }
    }

    const imageElements = Array.from(element.getElementsByTagName('img'));
    for (const imageElement of imageElements) {
      const src = imageElement.getAttribute('src');
      if (!src || isExternal(src)) continue;
      const imagePath = resolveHref(path, src);
      if (!mimeFor(imagePath)) {
        missingImages.add(imagePath);
        continue;
      }
      const image = imageFromFile(files, imagePath);
      if (!image) {
        missingImages.add(imagePath);
        continue;
      }
      if (!images[image.id]) images[image.id] = image;
      blocks.push({
        type: 'image',
        imageId: image.id,
        alt: imageElement.getAttribute('alt') ?? '',
      });
      imageBlocks += 1;
    }

    if (pairElements.length === 0 && imageElements.length === 0) {
      const text = textOf(element);
      if (text) {
        blocks.push({ type: 'text', text });
        textOnlyBlocks += 1;
      }
    }
  }

  return {
    path,
    blocks,
    pairCount,
    imageBlocks,
    textOnlyBlocks,
    sourceLang,
    targetLang,
  };
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
