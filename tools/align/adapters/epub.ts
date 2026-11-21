import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { unzipSync, type Unzipped } from 'fflate';
import { JSDOM } from 'jsdom';
import type { Chapter, Doc, Paragraph } from '../model.ts';

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
}

interface EpubOptions {
  lang: string;
  /** Skip this many content chapters before collecting any. */
  startChapter?: number;
  /** First paragraph of the first retained chapter must match this. */
  skipUntil?: string;
  /** Keep at most this many spine documents. */
  maxChapters?: number;
  title?: string;
}

const decoder = new TextDecoder('utf-8');

function file(files: Unzipped, path: string): Uint8Array | undefined {
  if (files[path]) return files[path];
  const wanted = path.toLowerCase();
  const key = Object.keys(files).find((candidate) => candidate.toLowerCase() === wanted);
  return key ? files[key] : undefined;
}

function text(files: Unzipped, path: string): string {
  const bytes = file(files, path);
  if (!bytes) throw new Error(`EPUB is missing ${path}.`);
  return decoder.decode(bytes);
}

function normalisePath(path: string): string {
  return posix.normalize(path.replaceAll('\\', '/')).replace(/^\/+/, '');
}

function resolveHref(base: string, href: string): string {
  const clean = decodeURIComponent(href.split('#')[0].split('?')[0]);
  return normalisePath(posix.join(posix.dirname(base), clean));
}

function elements(root: Document | Element, localName: string): Element[] {
  const namespaced = Array.from(root.getElementsByTagNameNS('*', localName));
  if (namespaced.length > 0) return namespaced;
  return Array.from(root.getElementsByTagName(localName));
}

function textOf(element: Element | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function clean(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\u00ad/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits a paragraph element at `<br><br>`; a single `<br>` is a space. */
function paragraphsFrom(element: Element): string[] {
  const out: string[] = [];
  let buffer = '';
  let breaks = 0;

  const flush = (): void => {
    const value = clean(buffer);
    if (value) out.push(value);
    buffer = '';
  };

  const walk = (node: Node): void => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        buffer += child.textContent ?? '';
        breaks = 0;
      } else if (child.nodeName === 'BR') {
        breaks += 1;
        if (breaks >= 2) {
          flush();
        } else {
          buffer += ' ';
        }
      } else {
        walk(child);
      }
    }
  };

  walk(element);
  flush();
  return out;
}

function findOpf(files: Unzipped): string {
  const container = file(files, 'META-INF/container.xml');
  if (container) {
    const dom = new JSDOM(decoder.decode(container), { contentType: 'application/xml' });
    const rootfile = elements(dom.window.document, 'rootfile')[0];
    const path = rootfile?.getAttribute('full-path');
    if (path) return path;
  }
  const candidate = Object.keys(files).find((path) => path.toLowerCase().endsWith('.opf'));
  if (!candidate) throw new Error('EPUB has no package document.');
  return candidate;
}

function readPackage(files: Unzipped, opfPath: string) {
  const opf = new JSDOM(text(files, opfPath), { contentType: 'application/xml' }).window.document;
  const title = textOf(elements(opf, 'title')[0]);
  const lang = textOf(elements(opf, 'language')[0]);
  const items = new Map<string, ManifestItem>();
  for (const item of elements(opf, 'item')) {
    const id = item.getAttribute('id') ?? '';
    const href = item.getAttribute('href') ?? '';
    if (!id || !href) continue;
    items.set(id, {
      id,
      href: resolveHref(opfPath, href),
      mediaType: item.getAttribute('media-type') ?? '',
    });
  }
  const spine = elements(opf, 'itemref')
    .filter((item) => item.getAttribute('linear') !== 'no')
    .map((item) => items.get(item.getAttribute('idref') ?? ''))
    .filter((item): item is ManifestItem => Boolean(item))
    .filter((item) => /\.x?html?$/i.test(item.href) || /xhtml/i.test(item.mediaType));
  return { title, lang, items, spine };
}

function readNcx(files: Unzipped, items: Map<string, ManifestItem>): Map<string, string> {
  const ncxItem = [...items.values()].find((item) => /ncx/i.test(item.mediaType) || /\.ncx$/i.test(item.href));
  if (!ncxItem) return new Map();
  const ncxPath = ncxItem.href;
  const bytes = file(files, ncxPath);
  if (!bytes) return new Map();
  // This package's NCX is malformed (one `navPoint` is left open); the HTML
  // parser recovers the tree, and the labels are what the aligner needs.
  const ncx = new JSDOM(decoder.decode(bytes), { contentType: 'text/html' }).window.document;
  const labels = new Map<string, string>();
  for (const navPoint of elements(ncx, 'navPoint')) {
    const label = textOf(elements(navPoint, 'text')[0]);
    const content = elements(navPoint, 'content')[0];
    const src = content?.getAttribute('src') ?? '';
    if (!label || !src) continue;
    labels.set(resolveHref(ncxPath, src), label);
  }
  return labels;
}

export async function readEpub(path: string, options: EpubOptions): Promise<Doc> {
  const files = unzipSync(new Uint8Array(await readFile(path)));
  const opfPath = findOpf(files);
  const pkg = readPackage(files, opfPath);
  const labels = readNcx(files, pkg.items);

  const chapters: Chapter[] = [];
  let chaptersToSkip = options.startChapter ?? 0;
  let skipped = false;
  for (const item of pkg.spine) {
    if (options.maxChapters !== undefined && chapters.length >= options.maxChapters) break;
    const bytes = file(files, item.href);
    if (!bytes) continue;
    const dom = new JSDOM(decoder.decode(bytes), { contentType: 'text/html' });
    const body = dom.window.document.body;
    if (!body) continue;

    let paragraphs: string[] = [];
    for (const paragraph of Array.from(body.querySelectorAll('p'))) {
      paragraphs.push(...paragraphsFrom(paragraph));
    }
    if (paragraphs.length === 0) continue;
    if (chaptersToSkip > 0) {
      chaptersToSkip -= 1;
      continue;
    }

    if (!skipped && options.skipUntil) {
      const pattern = new RegExp(options.skipUntil, 'iu');
      const start = paragraphs.findIndex((paragraph) => pattern.test(paragraph));
      if (start > 0) paragraphs = paragraphs.slice(start);
      skipped = start >= 0;
    } else {
      skipped = true;
    }

    const label = labels.get(item.href) ?? `Chapter ${chapters.length + 1}`;
    chapters.push({
      index: chapters.length,
      label,
      paragraphs: paragraphs.map<Paragraph>((value) => ({ text: value })),
    });
  }

  return {
    lang: options.lang || pkg.lang || 'vi',
    title: options.title || pkg.title || 'Untitled',
    chapters,
    meta: { format: 'epub', warnings: [] },
  };
}
