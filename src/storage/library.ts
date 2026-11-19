import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  Book,
  BookImage,
  BookStats,
  Chapter,
  ReaderSettings,
  ReadingPosition,
} from '../reader/types';
import { normalizeSettings, SETTINGS_KEY } from '../reader/settings';

const DB_NAME = 'duoreader';
const DB_VERSION = 2;

export interface LibraryBook {
  id: string;
  title: string;
  author: string;
  sourceLang: string;
  targetLang: string;
  stats: BookStats;
  warnings: string[];
  importedAt: number;
}

interface StoredContent {
  bookId: string;
  chapters: Chapter[];
}

// Safari does not reliably persist Blobs inside IndexedDB. Store bytes and
// rebuild the Blob on read. `blob` remains for records written by old builds.
interface StoredImage {
  bookId: string;
  imageId: string;
  mediaType: string;
  bytes?: ArrayBuffer;
  blob?: Blob;
}

interface DuoReaderDB extends DBSchema {
  books: { key: string; value: LibraryBook };
  content: { key: string; value: StoredContent };
  images: {
    key: [string, string];
    value: StoredImage;
    indexes: { 'by-book': string };
  };
  positions: { key: string; value: ReadingPosition };
  settings: { key: string; value: ReaderSettings };
}

let dbPromise: Promise<IDBPDatabase<DuoReaderDB>> | undefined;
let persistenceRequest: Promise<boolean> | undefined;

/**
 * Ask the browser to exempt this origin from storage eviction. Best effort:
 * WebKit decides heuristically, so a `false` result means "keep the ZIPs".
 * Memoized because the answer cannot change without a page reload.
 */
export function ensurePersistent(): Promise<boolean> {
  persistenceRequest ??= (async () => {
    const storage = navigator.storage;
    if (typeof storage?.persist !== 'function') return false;
    try {
      if (typeof storage.persisted === 'function' && (await storage.persisted())) {
        return true;
      }
      return await storage.persist();
    } catch {
      return false;
    }
  })();
  return persistenceRequest;
}

function database(): Promise<IDBPDatabase<DuoReaderDB>> {
  dbPromise ??= openDB<DuoReaderDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('books', { keyPath: 'id' });
        db.createObjectStore('content', { keyPath: 'bookId' });
        const images = db.createObjectStore('images', {
          keyPath: ['bookId', 'imageId'],
        });
        images.createIndex('by-book', 'bookId');
      }
      if (oldVersion < 2) {
        db.createObjectStore('positions', { keyPath: 'bookId' });
        db.createObjectStore('settings');
      }
    },
  }).catch((cause: unknown) => {
    // A transient failure must not poison every later call for this session.
    dbPromise = undefined;
    throw cause;
  });
  return dbPromise;
}

export async function closeDatabase(): Promise<void> {
  if (!dbPromise) return;
  const pending = dbPromise;
  dbPromise = undefined;
  try {
    (await pending).close();
  } catch {
    // A failed open has no connection to close.
  }
}

export async function saveBook(book: Book): Promise<void> {
  const storedImages = await Promise.all(
    Object.values(book.images).map(async (image) => ({
      bookId: book.id,
      imageId: image.id,
      mediaType: image.mediaType,
      bytes: await image.blob.arrayBuffer(),
    })),
  );

  const db = await database();
  const tx = db.transaction(['books', 'content', 'images'] as const, 'readwrite');
  const books = tx.objectStore('books');
  const existing = await books.get(book.id);
  const images = tx.objectStore('images');
  const imageKeys = await images.index('by-book').getAllKeys(book.id);
  for (const key of imageKeys) await images.delete(key);

  await books.put({
    id: book.id,
    title: book.title,
    author: book.author,
    sourceLang: book.sourceLang,
    targetLang: book.targetLang,
    stats: book.stats,
    warnings: book.warnings,
    importedAt: existing?.importedAt ?? Date.now(),
  });

  await tx.objectStore('content').put({
    bookId: book.id,
    chapters: book.chapters,
  });

  const imageStore = tx.objectStore('images');
  for (const image of storedImages) {
    await imageStore.put(image);
  }

  await tx.done;
}

export async function listBooks(): Promise<LibraryBook[]> {
  const db = await database();
  const books = await db.getAll('books');
  return books.sort((a, b) => b.importedAt - a.importedAt);
}

export async function loadBook(id: string): Promise<Book | null> {
  const db = await database();
  const tx = db.transaction(['books', 'content', 'images'], 'readonly');
  const [meta, content, storedImages] = await Promise.all([
    tx.objectStore('books').get(id),
    tx.objectStore('content').get(id),
    tx.objectStore('images').index('by-book').getAll(id),
  ]);
  await tx.done;

  if (!meta || !content) return null;

  const images: Record<string, BookImage> = {};
  for (const stored of storedImages) {
    const blob = stored.bytes
      ? new Blob([stored.bytes], { type: stored.mediaType })
      : stored.blob;
    if (!blob || blob.size === 0) continue;
    images[stored.imageId] = {
      id: stored.imageId,
      mediaType: stored.mediaType,
      blob,
    };
  }

  return {
    id: meta.id,
    title: meta.title,
    author: meta.author,
    sourceLang: meta.sourceLang,
    targetLang: meta.targetLang,
    chapters: content.chapters,
    images,
    stats: meta.stats,
    warnings: meta.warnings,
  };
}

export async function getPosition(bookId: string): Promise<ReadingPosition | null> {
  const db = await database();
  return (await db.get('positions', bookId)) ?? null;
}

export async function listPositions(): Promise<ReadingPosition[]> {
  const db = await database();
  return db.getAll('positions');
}

export async function savePosition(position: ReadingPosition): Promise<void> {
  const db = await database();
  await db.put('positions', position);
}

export async function loadSettings(): Promise<ReaderSettings> {
  const db = await database();
  return normalizeSettings(await db.get('settings', SETTINGS_KEY));
}

export async function saveSettings(settings: ReaderSettings): Promise<void> {
  const db = await database();
  await db.put('settings', settings, SETTINGS_KEY);
}

export async function deleteBook(id: string): Promise<void> {
  const db = await database();
  const tx = db.transaction(
    ['books', 'content', 'images', 'positions'] as const,
    'readwrite',
  );
  const images = tx.objectStore('images');
  const imageKeys = await images.index('by-book').getAllKeys(id);
  for (const key of imageKeys) await images.delete(key);
  await tx.objectStore('content').delete(id);
  await tx.objectStore('books').delete(id);
  await tx.objectStore('positions').delete(id);
  await tx.done;
}
