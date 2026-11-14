import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
} from 'idb';
import type { Book, BookImage, BookStats, Chapter } from '../reader/types';

const DB_NAME = 'duoreader';
const DB_VERSION = 1;

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
}

let dbPromise: Promise<IDBPDatabase<DuoReaderDB>> | undefined;

type LibraryTransaction = IDBPTransaction<
  DuoReaderDB,
  ['books', 'content', 'images'],
  'readwrite'
>;

function database(): Promise<IDBPDatabase<DuoReaderDB>> {
  dbPromise ??= openDB<DuoReaderDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('books', { keyPath: 'id' });
      db.createObjectStore('content', { keyPath: 'bookId' });
      const images = db.createObjectStore('images', {
        keyPath: ['bookId', 'imageId'],
      });
      images.createIndex('by-book', 'bookId');
    },
  });
  return dbPromise;
}

async function removeImages(
  tx: LibraryTransaction,
  bookId: string,
): Promise<void> {
  const images = tx.objectStore('images');
  const keys = await images.index('by-book').getAllKeys(bookId);
  for (const key of keys) await images.delete(key);
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

  await removeImages(tx, book.id);

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

  const images = tx.objectStore('images');
  for (const image of storedImages) {
    await images.put(image);
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

export async function deleteBook(id: string): Promise<void> {
  const db = await database();
  const tx = db.transaction(['books', 'content', 'images'] as const, 'readwrite');
  await removeImages(tx, id);
  await tx.objectStore('content').delete(id);
  await tx.objectStore('books').delete(id);
  await tx.done;
}
