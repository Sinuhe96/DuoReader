import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as library from '../src/storage/library';
import type { Annotation, Book, Chapter, ReadingPosition } from '../src/reader/types';

const DB_NAME = 'duoreader';

const chapter: Chapter = {
  index: 0,
  path: 'OEBPS/c1.xhtml',
  label: 'Chapter 1',
  pairCount: 2,
  blocks: [
    {
      type: 'pairs',
      pairs: [
        { id: 'p1', bid: 'b1', source: 'Hallo.', target: 'Hello.' },
        { id: 'p2', bid: 'b2', source: 'Welt.', target: 'World.' },
      ],
    },
  ],
};

const book: Book = {
  id: 'book-1',
  title: 'Test Book',
  author: 'Test Author',
  sourceLang: 'de',
  targetLang: 'en',
  chapters: [chapter],
  images: {
    'OEBPS/cover.png': {
      id: 'OEBPS/cover.png',
      mediaType: 'image/png',
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    },
  },
  stats: {
    documents: 1,
    pairs: 2,
    imageBlocks: 1,
    images: 1,
    textOnlyBlocks: 0,
  },
  warnings: [],
};

const position: ReadingPosition = {
  bookId: book.id,
  chapterIndex: 0,
  pairId: 'p2',
  progress: 1,
  updatedAt: 123,
};

const annotation: Annotation = {
  id: 'annotation-1',
  bookId: book.id,
  chapterIndex: 0,
  pairId: 'p1',
  side: 'source',
  start: 0,
  end: 6,
  text: 'Hallo.',
  kind: 'sentence',
  color: 'yellow',
  createdAt: 10,
  updatedAt: 10,
};

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB delete was blocked.'));
  });
}

function openV1(): Promise<IDBDatabase> {
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    db.createObjectStore('books', { keyPath: 'id' });
    db.createObjectStore('content', { keyPath: 'bookId' });
    const images = db.createObjectStore('images', {
      keyPath: ['bookId', 'imageId'],
    });
    images.createIndex('by-book', 'bookId');
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  return promise;
}

function openV2(): Promise<IDBDatabase> {
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();
  const request = indexedDB.open(DB_NAME, 2);
  request.onupgradeneeded = () => {
    const db = request.result;
    db.createObjectStore('books', { keyPath: 'id' });
    db.createObjectStore('content', { keyPath: 'bookId' });
    const images = db.createObjectStore('images', {
      keyPath: ['bookId', 'imageId'],
    });
    images.createIndex('by-book', 'bookId');
    db.createObjectStore('positions', { keyPath: 'bookId' });
    db.createObjectStore('settings');
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  return promise;
}

function openV3(): Promise<IDBDatabase> {
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();
  const request = indexedDB.open(DB_NAME, 3);
  request.onupgradeneeded = () => {
    const db = request.result;
    db.createObjectStore('books', { keyPath: 'id' });
    db.createObjectStore('content', { keyPath: 'bookId' });
    const images = db.createObjectStore('images', {
      keyPath: ['bookId', 'imageId'],
    });
    images.createIndex('by-book', 'bookId');
    db.createObjectStore('positions', { keyPath: 'bookId' });
    db.createObjectStore('settings');
    const annotations = db.createObjectStore('annotations', { keyPath: 'id' });
    annotations.createIndex('by-book', 'bookId');
    annotations.createIndex('by-book-pair', ['bookId', 'pairId']);
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  return promise;
}

function countImages(bookId: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('images', 'readonly');
      const keys = tx.objectStore('images').index('by-book').getAllKeys(bookId);
      keys.onsuccess = () => {
        db.close();
        resolve(keys.result.length);
      };
      keys.onerror = () => {
        db.close();
        reject(keys.error);
      };
    };
    request.onerror = () => reject(request.error);
  });
}

beforeEach(async () => {
  await library.closeDatabase();
  await deleteDatabase();
});

afterEach(async () => {
  await library.closeDatabase();
  await deleteDatabase();
});

describe('library storage', () => {
  it('round-trips books, images, positions, and settings', async () => {
    await library.saveBook(book);

    const shelf = await library.listBooks();
    expect(shelf).toHaveLength(1);
    expect(shelf[0]).toMatchObject({
      id: book.id,
      title: book.title,
      author: book.author,
      stats: book.stats,
    });

    const loaded = await library.loadBook(book.id);
    expect(loaded?.chapters).toEqual(book.chapters);
    expect(loaded?.images['OEBPS/cover.png']?.blob.size).toBe(3);
    expect(loaded?.images['OEBPS/cover.png']?.mediaType).toBe('image/png');

    await library.savePosition(position);
    expect(await library.getPosition(book.id)).toEqual(position);

    await library.saveSettings({
      fontSize: 22,
      lineHeight: 1.7,
      theme: 'dark',
      fontFamily: 'georgia',
      displayMode: 'paragraph',
      languages: 'target',
      languageOrder: 'target-first',
      pinyin: 'sentence',
    });
    expect(await library.loadSettings()).toEqual({
      fontSize: 22,
      lineHeight: 1.7,
      theme: 'dark',
      fontFamily: 'georgia',
      displayMode: 'paragraph',
      languages: 'target',
      languageOrder: 'target-first',
      pinyin: 'sentence',
    });
  });

  it('round-trips annotations per book', async () => {
    await library.saveAnnotation(annotation);
    await library.saveAnnotation({ ...annotation, id: 'annotation-2', bookId: 'other' });

    expect(await library.listChapterAnnotations(book.id, 0)).toEqual([annotation]);

    await library.deleteAnnotation(annotation.id);
    expect(await library.listChapterAnnotations(book.id, 0)).toEqual([]);
  });

  it('loads only the requested chapter, not the whole book', async () => {
    const second = { ...annotation, id: 'annotation-2', chapterIndex: 1 };
    const otherBook = { ...annotation, id: 'annotation-3', bookId: 'other' };
    await library.saveAnnotation(annotation);
    await library.saveAnnotation(second);
    await library.saveAnnotation(otherBook);

    expect(await library.listChapterAnnotations(book.id, 0)).toEqual([annotation]);
    expect(await library.listChapterAnnotations(book.id, 1)).toEqual([second]);
    expect(await library.listChapterAnnotations(book.id, 2)).toEqual([]);
  });

  it('keeps annotations on re-import and removes them with the book', async () => {
    await library.saveBook(book);
    await library.saveAnnotation(annotation);
    await library.saveBook(book);
    expect(await library.listChapterAnnotations(book.id, 0)).toEqual([annotation]);

    await library.deleteBook(book.id);
    expect(await library.listChapterAnnotations(book.id, 0)).toEqual([]);
  });

  it('deletes the image records together with the book', async () => {
    await library.saveBook(book);
    await library.savePosition(position);
    await library.saveAnnotation(annotation);

    await library.deleteBook(book.id);

    expect(await library.listBooks()).toEqual([]);
    expect(await library.loadBook(book.id)).toBeNull();
    expect(await library.getPosition(book.id)).toBeNull();
    expect(await library.listChapterAnnotations(book.id, 0)).toEqual([]);
    expect(await countImages(book.id)).toBe(0);
  });

  it('keeps a v1 library while upgrading to the current stores', async () => {
    const db = await openV1();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['books', 'content', 'images'], 'readwrite');
      tx.objectStore('books').put({
        id: 'legacy',
        title: 'Legacy Book',
        author: 'Legacy Author',
        sourceLang: 'de',
        targetLang: 'en',
        stats: book.stats,
        warnings: [],
        importedAt: 456,
      });
      tx.objectStore('content').put({ bookId: 'legacy', chapters: [chapter] });
      tx.objectStore('images').put({
        bookId: 'legacy',
        imageId: 'OEBPS/cover.png',
        mediaType: 'image/png',
        bytes: new Uint8Array([4, 5, 6]).buffer,
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    const shelf = await library.listBooks();
    expect(shelf).toHaveLength(1);
    expect(shelf[0].id).toBe('legacy');
    expect(shelf[0].importedAt).toBe(456);

    const loaded = await library.loadBook('legacy');
    expect(loaded?.chapters).toEqual([chapter]);
    expect(loaded?.images['OEBPS/cover.png']?.blob.size).toBe(3);

    expect(await library.getPosition('legacy')).toBeNull();
    await library.savePosition({ ...position, bookId: 'legacy' });
    expect((await library.getPosition('legacy'))?.pairId).toBe('p2');
    expect(await library.loadSettings()).toEqual({
      fontSize: 18,
      lineHeight: 1.5,
      theme: 'system',
      fontFamily: 'new-york',
      displayMode: 'sentence',
      languages: 'both',
      languageOrder: 'source-first',
      pinyin: 'off',
    });
    expect(await library.listChapterAnnotations('legacy', 0)).toEqual([]);
  });

  it('keeps a v2 library while adding the annotation store', async () => {
    const db = await openV2();
    const { promise: written, resolve: done, reject: failed } =
      Promise.withResolvers<void>();
    const tx = db.transaction(
      ['books', 'content', 'positions', 'settings'],
      'readwrite',
    );
    tx.objectStore('books').put({
      id: 'legacy',
      title: 'Legacy Book',
      author: 'Legacy Author',
      sourceLang: 'de',
      targetLang: 'en',
      stats: book.stats,
      warnings: [],
      importedAt: 456,
    });
    tx.objectStore('content').put({ bookId: 'legacy', chapters: [chapter] });
    tx.objectStore('positions').put({ ...position, bookId: 'legacy' });
    tx.objectStore('settings').put({ fontSize: 22 }, 'reader');
    tx.oncomplete = () => done();
    tx.onerror = () => failed(tx.error);
    await written;
    db.close();

    const legacyAnnotation: Annotation = {
      ...annotation,
      id: 'annotation-legacy',
      bookId: 'legacy',
    };
    expect(await library.listChapterAnnotations('legacy', 0)).toEqual([]);
    await library.saveAnnotation(legacyAnnotation);
    expect(await library.listChapterAnnotations('legacy', 0)).toEqual([legacyAnnotation]);
    expect((await library.getPosition('legacy'))?.pairId).toBe('p2');
    expect((await library.loadSettings()).fontSize).toBe(22);
  });

  it('keeps a v3 annotation while adding the chapter index', async () => {
    const db = await openV3();
    const legacyAnnotation: Annotation = {
      ...annotation,
      id: 'annotation-legacy',
      bookId: 'legacy',
      chapterIndex: 2,
    };
    const { promise: written, resolve: done, reject: failed } =
      Promise.withResolvers<void>();
    const tx = db.transaction('annotations', 'readwrite');
    tx.objectStore('annotations').put(legacyAnnotation);
    tx.oncomplete = () => done();
    tx.onerror = () => failed(tx.error);
    await written;
    db.close();

    expect(await library.listChapterAnnotations('legacy', 2)).toEqual([legacyAnnotation]);
    expect(await library.listChapterAnnotations('legacy', 0)).toEqual([]);
  });
});
