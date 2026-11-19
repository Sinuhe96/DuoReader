import {
  byLocalName,
  childByLocalName,
  descendantsByClass,
  findFile,
  firstByLocalName,
  hasClass,
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
import {
  ImportError,
  type Block,
  type Book,
  type BookImage,
  type Chapter,
  type InlineRun,
  type InlineStyle,
  type Pair,
} from './types';

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

  const withBlocks = parsed.filter((chapter) => chapter.blocks.length > 0);
  const labelAt = (chapter: ChapterParse): string | undefined =>
    ncx.labels.get(normalizePath(chapter.path));

  let chapterNumber = 0;
  const chapters: Chapter[] = [];
  for (const [position, chapter] of withBlocks.entries()) {
    let label = labelAt(chapter);
    if (!label) {
      if (chapter.pairCount > 0) {
        // A lone file without a navPoint, between two labelled ones, is the
        // second half of a chapter: generators drop continuation splits from
        // the NCX. Merge it into its chapter so the list shows one entry.
        // Several unlabelled files in a row are chapters the producer simply
        // did not label, so they keep their own numbers.
        const continues =
          position > 0 &&
          position + 1 < withBlocks.length &&
          labelAt(withBlocks[position - 1]) !== undefined &&
          labelAt(withBlocks[position + 1]) !== undefined;
        const host = continues ? chapters[chapters.length - 1] : undefined;
        if (host) {
          host.blocks.push(...chapter.blocks);
          host.pairCount += chapter.pairCount;
          continue;
        }
        label = `Chapter ${++chapterNumber}`;
      } else if (chapter.imageBlocks > 0) {
        label = 'Illustration';
      } else {
        label = `Section ${chapters.length + 1}`;
      }
    }
    chapters.push({
      index: chapters.length,
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

function offsetAttr(element: Element, name: string): number | undefined {
  const raw = element.getAttribute(name);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * HTML elements that start a new paragraph. A text-only container is split at
 * each of these instead of being flattened with `textContent`, which carries
 * no boundary between them.
 */
const BLOCK_LEVEL: Record<string, true> = {
  address: true,
  article: true,
  aside: true,
  blockquote: true,
  caption: true,
  center: true,
  dd: true,
  details: true,
  div: true,
  dl: true,
  dt: true,
  fieldset: true,
  figcaption: true,
  figure: true,
  footer: true,
  form: true,
  h1: true,
  h2: true,
  h3: true,
  h4: true,
  h5: true,
  h6: true,
  header: true,
  li: true,
  main: true,
  nav: true,
  ol: true,
  p: true,
  pre: true,
  section: true,
  summary: true,
  table: true,
  tbody: true,
  td: true,
  tfoot: true,
  th: true,
  thead: true,
  tr: true,
  ul: true,
};

function pushText(runs: InlineRun[], value: string | null, style?: InlineStyle): void {
  const text = (value ?? '').replace(/\s+/g, ' ');
  if (!text) return;
  const last = runs[runs.length - 1];
  if (last && !last.break && last.style === style) {
    last.text += text;
    return;
  }
  runs.push(style ? { text, style } : { text });
}

/**
 * Flattens one `reader-src`/`reader-tgt` span into runs: `i`/`em` become `em`,
 * `b`/`strong` become `strong`, `br` becomes a break, and every other element
 * contributes only its text, inheriting the surrounding style.
 */
function collectRuns(element: Element): InlineRun[] {
  const runs: InlineRun[] = [];
  const visit = (node: Element, style?: InlineStyle): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === ELEMENT_NODE) {
        const nested = child as Element;
        switch (nested.localName) {
          case 'br':
            runs.push({ text: '', break: true });
            break;
          case 'i':
          case 'em':
            visit(nested, 'em');
            break;
          case 'b':
          case 'strong':
            visit(nested, 'strong');
            break;
          default:
            visit(nested, style);
        }
      } else if (child.nodeType === TEXT_NODE) {
        pushText(runs, child.textContent, style);
      }
    }
  };
  visit(element);
  return trimRuns(runs);
}

/** Drops the whitespace that padded the element and any breaks at its edges. */
function trimRuns(runs: InlineRun[]): InlineRun[] {
  for (let index = 0; index < runs.length; index += 1) {
    if (runs[index].break) continue;
    runs[index].text = runs[index].text.replace(/^ /, '');
    break;
  }
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    if (runs[index].break) continue;
    runs[index].text = runs[index].text.replace(/ $/, '');
    break;
  }
  while (runs.length > 0 && runs[0].break) runs.shift();
  while (runs.length > 0 && runs[runs.length - 1].break) runs.pop();

  return runs.filter((run) => run.break === true || run.text.length > 0);
}

/** One line of the same runs, for the plain-text fallback. */
function plainText(runs: InlineRun[]): string {
  return runs
    .map((run) => (run.break ? ' ' : run.text))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Runs are kept only when they carry formatting; plain text stays in `source`/`target`. */
function inlineRuns(element: Element | undefined): InlineRun[] | undefined {
  if (!element) return undefined;
  const runs = collectRuns(element);
  if (runs.length === 0) return undefined;
  if (runs.length === 1 && !runs[0].break && !runs[0].style) return undefined;
  return runs;
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

  const addPairs = (pairElements: Element[]): void => {
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
        start: offsetAttr(pairElement, 'data-start'),
        end: offsetAttr(pairElement, 'data-end'),
        source,
        target,
        sourceRuns: inlineRuns(sourceElement),
        targetRuns: inlineRuns(targetElement),
      });
    }
    if (pairs.length > 0) {
      blocks.push({ type: 'pairs', pairs });
      pairCount += pairs.length;
    }
  };

  const addImage = (imageElement: Element): void => {
    const src = imageElement.getAttribute('src');
    if (!src || isExternal(src)) return;
    const imagePath = resolveHref(path, src);
    if (!mimeFor(imagePath)) {
      missingImages.add(imagePath);
      return;
    }
    const image = imageFromFile(files, imagePath);
    if (!image) {
      missingImages.add(imagePath);
      return;
    }
    if (!images[image.id]) images[image.id] = image;
    blocks.push({
      type: 'image',
      imageId: image.id,
      alt: imageElement.getAttribute('alt') ?? '',
    });
    imageBlocks += 1;
  };

  const addImages = (root: Element): void => {
    for (const imageElement of Array.from(root.getElementsByTagName('img'))) {
      addImage(imageElement);
    }
  };

  /**
   * Emits the element's inline content as text blocks, splitting at each image
   * so a picture keeps its place in the flow. `<br>` becomes a break and
   * `i`/`em`/`b`/`strong` become runs, as in a pair.
   */
  const addInlineFlow = (element: Element): void => {
    let runs: InlineRun[] = [];
    const flush = (): void => {
      const trimmed = trimRuns(runs);
      runs = [];
      const text = plainText(trimmed);
      if (!text) return;
      const styled = trimmed.some((run) => run.break || run.style);
      blocks.push(styled ? { type: 'text', text, runs: trimmed } : { type: 'text', text });
      textOnlyBlocks += 1;
    };
    const visit = (node: Element, style?: InlineStyle): void => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === ELEMENT_NODE) {
          const nested = child as Element;
          switch (nested.localName) {
            case 'img':
              flush();
              addImage(nested);
              break;
            case 'br':
              runs.push({ text: '', break: true });
              break;
            case 'i':
            case 'em':
              visit(nested, 'em');
              break;
            case 'b':
            case 'strong':
              visit(nested, 'strong');
              break;
            default:
              visit(nested, style);
          }
        } else if (child.nodeType === TEXT_NODE) {
          pushText(runs, child.textContent, style);
        }
      }
    };
    visit(element);
    flush();
  };

  const hasBlockChild = (element: Element): boolean =>
    Array.from(element.children).some((child) => BLOCK_LEVEL[child.localName] === true);

  /**
   * Text-only content: a plain EPUB chapter, the jacket lines of a BePub
   * export. A container that wraps block-level elements is descended into,
   * because `textContent` would fuse every paragraph into one block; a leaf
   * keeps its runs and its images in document order.
   */
  const walkText = (element: Element): void => {
    if (element.localName === 'img') {
      addImage(element);
      return;
    }
    if (element.localName === 'hr') return;
    if (!hasBlockChild(element)) {
      addInlineFlow(element);
      return;
    }
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === TEXT_NODE) {
        const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        blocks.push({ type: 'text', text });
        textOnlyBlocks += 1;
        continue;
      }
      if (node.nodeType !== ELEMENT_NODE) continue;
      const child = node as Element;
      if (BLOCK_LEVEL[child.localName] === true) walkText(child);
      else if (child.localName === 'img') addImage(child);
      else addInlineFlow(child);
    }
  };

  /**
   * A paragraph is the element that directly owns `reader-pair` spans. A
   * container that wraps several paragraph elements (e.g. a jacket `<div>`
   * holding `<p>`s) is descended into instead, so its paragraphs stay separate
   * and its text-only lines are kept in document order. Content with no pair at
   * all is text-only and split by `walkText`.
   */
  const walk = (element: Element): void => {
    if (element.localName === 'img') {
      addImage(element);
      return;
    }
    const pairElements = descendantsByClass(element, 'reader-pair');
    if (pairElements.length === 0) {
      walkText(element);
      return;
    }
    if (Array.from(element.children).some((child) => hasClass(child, 'reader-pair'))) {
      addPairs(pairElements);
      addImages(element);
      return;
    }
    for (const child of Array.from(element.children)) walk(child);
  };

  for (const element of Array.from(body.children)) walk(element);

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
