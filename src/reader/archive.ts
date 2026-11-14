import { unzipSync } from 'fflate';
import { ImportError, type BookImage } from './types';

export type Files = Record<string, Uint8Array>;

const decoder = new TextDecoder('utf-8');

export function unzip(data: Uint8Array, label: string): Files {
  try {
    return unzipSync(data);
  } catch (cause) {
    throw new ImportError(`Could not read ${label} as a ZIP archive.`, { cause });
  }
}

export function normalizePath(path: string): string {
  const parts = path.replaceAll('\\', '/').split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

export function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

export function resolveHref(baseFile: string, href: string): string {
  const clean = href.split('#')[0].split('?')[0];
  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    // Keep the raw value when the percent-encoding is malformed.
  }
  if (decoded.startsWith('/')) return normalizePath(decoded);
  return normalizePath(`${dirname(baseFile)}/${decoded}`);
}

export function isExternal(href: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(href) || /^data:/i.test(href);
}

export function findFile(files: Files, path: string): [string, Uint8Array] | undefined {
  const wanted = normalizePath(path);
  for (const [candidate, data] of Object.entries(files)) {
    if (normalizePath(candidate) === wanted) return [candidate, data];
  }
  const lower = wanted.toLowerCase();
  for (const [candidate, data] of Object.entries(files)) {
    if (normalizePath(candidate).toLowerCase() === lower) return [candidate, data];
  }
  return undefined;
}

export function readText(files: Files, path: string): string {
  const entry = findFile(files, path);
  if (!entry) throw new ImportError(`Missing ${path} in the EPUB.`);
  return decoder.decode(entry[1]);
}

export function parseXml(text: string, label: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xhtml+xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new ImportError(`Could not parse ${label}.`);
  }
  return doc;
}

export function allElements(root: Document | Element): Element[] {
  return Array.from(root.getElementsByTagName('*'));
}

export function byLocalName(root: Document | Element, name: string): Element[] {
  return allElements(root).filter((element) => element.localName === name);
}

export function firstByLocalName(root: Document | Element, name: string): Element | undefined {
  return byLocalName(root, name)[0];
}

export function childByLocalName(root: Element, name: string): Element | undefined {
  return Array.from(root.children).find((child) => child.localName === name);
}

export function hasClass(element: Element, name: string): boolean {
  return (element.getAttribute('class') ?? '').split(/\s+/).includes(name);
}

export function descendantsByClass(root: Element, name: string): Element[] {
  return allElements(root).filter((element) => hasClass(element, name));
}

export function firstDescendantByClass(root: Element, name: string): Element | undefined {
  return descendantsByClass(root, name)[0];
}

export function textOf(element: Element | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

export function mimeFor(path: string): string | undefined {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return undefined;
  return MIME_BY_EXTENSION[path.slice(dot + 1).toLowerCase()];
}

export function imageFromFile(files: Files, path: string): BookImage | undefined {
  const entry = findFile(files, path);
  if (!entry) return undefined;
  const mediaType = mimeFor(entry[0]);
  if (!mediaType) return undefined;
  return {
    id: normalizePath(entry[0]),
    mediaType,
    blob: new Blob([new Uint8Array(entry[1])], { type: mediaType }),
  };
}
