import { describe, expect, it } from 'vitest';
import type { VocabularyEntry } from '../src/reader/types';
import {
  filterVocabulary,
  groupVocabulary,
  pairTitle,
  statusCounts,
  vocabularyCsv,
  vocabularyFileName,
} from '../src/reader/vocabulary';

function entry(overrides: Partial<VocabularyEntry> = {}): VocabularyEntry {
  return {
    id: 'w1',
    bookId: 'book-de',
    bookTitle: 'Das Haus am Meer',
    sourceLang: 'de',
    targetLang: 'en',
    chapterLabel: 'Kap. 2',
    pairId: 'p1',
    side: 'source',
    start: 0,
    end: 4,
    term: 'Haus',
    surface: 'Haus',
    context: 'Das Haus am Meer.',
    translation: 'The house by the sea.',
    entry: 'house',
    status: 'new',
    tags: [],
    createdAt: new Date(2026, 10, 18, 12).getTime(),
    ...overrides,
  };
}

describe('vocabulary groups', () => {
  it('separates pairs and orders the largest group first', () => {
    const groups = groupVocabulary([
      entry(),
      entry({ id: 'w2', pairId: 'p2' }),
      entry({
        id: 'w3',
        bookId: 'book-vi',
        bookTitle: 'Chú mèo dạy hải âu bay',
        sourceLang: 'vi',
        targetLang: 'en',
        term: 'mèo',
        entry: 'cat',
      }),
      entry({
        id: 'w4',
        bookId: 'book-old',
        sourceLang: 'und',
        targetLang: 'und',
        term: 'orphan',
      }),
    ]);

    expect(groups.map((group) => group.entries.length)).toEqual([2, 1, 1]);
    expect(groups[0]).toMatchObject({ sourceLang: 'de', targetLang: 'en' });
    expect(groups.map((group) => group.sourceLang)).toContain('und');
  });

  it('lists the newest word first inside a pair', () => {
    const groups = groupVocabulary([
      entry({ id: 'old', createdAt: 10 }),
      entry({ id: 'new', createdAt: 20 }),
    ]);
    expect(groups[0].entries.map((row) => row.id)).toEqual(['new', 'old']);
  });

  it('keeps the newest export timestamp for the pair card', () => {
    const groups = groupVocabulary([
      entry({ exportedAt: 100 }),
      entry({ id: 'w2', exportedAt: 300 }),
      entry({ id: 'w3', exportedAt: 200 }),
    ]);
    expect(groups[0].exportedAt).toBe(300);
  });

  it('names a pair and an unknown language for the card', () => {
    expect(pairTitle('de', 'en')).toBe('German → English');
    expect(pairTitle('und', 'und')).toBe('Unknown → Unknown');
  });
});

describe('vocabulary search and status', () => {
  it('searches the surface, the gloss, and the book, not just the headword', () => {
    const entries = [
      entry(),
      entry({ id: 'w2', term: 'Häuser', surface: 'Häuser', entry: '', bookTitle: 'Ein anderes Buch' }),
      entry({ id: 'w3', term: 'verfluchen', surface: 'verfluchen', entry: 'to curse', bookTitle: 'Noch ein Buch' }),
      entry({ id: 'w4', term: 'Möwe', surface: 'Möwe', bookTitle: 'Ein anderes Buch', entry: '' }),
    ];

    expect(filterVocabulary(entries, 'house', 'all').map((row) => row.id)).toEqual(['w1']);
    expect(filterVocabulary(entries, 'häu', 'all').map((row) => row.id)).toEqual(['w2']);
    expect(filterVocabulary(entries, 'curse', 'all').map((row) => row.id)).toEqual(['w3']);
    expect(filterVocabulary(entries, 'anderes', 'all').map((row) => row.id)).toEqual([
      'w2',
      'w4',
    ]);
    expect(filterVocabulary(entries, 'HAUS', 'all').map((row) => row.id)).toEqual(['w1']);
  });

  it('counts statuses over the search result', () => {
    const entries = [
      entry(),
      entry({ id: 'w2', status: 'learning' }),
      entry({ id: 'w3', status: 'exported' }),
      entry({ id: 'w4', term: 'Möwe', status: 'known' }),
    ];

    expect(statusCounts(entries, '')).toEqual({
      all: 4,
      new: 1,
      learning: 1,
      exported: 1,
      known: 1,
    });
    expect(statusCounts(entries, 'mö').all).toBe(1);
    expect(filterVocabulary(entries, '', 'exported').map((row) => row.id)).toEqual(['w3']);
  });
});

describe('Anki CSV', () => {
  it('writes the fixed field order with a note, quoted where needed', () => {
    const note = 'A house, not "home".';
    const csv = vocabularyCsv(
      [entry({ context: 'Das Haus,\nam Meer.', entry: 'house by the sea' })],
      new Map([['book-de\u0000p1', note]]),
    );
    const lines = csv.trimEnd().split('\r\n');

    expect(lines[0]).toBe(
      'Word,Surface,Context,Translation,Entry,Book,Chapter,Created,Note',
    );
    expect(lines[1]).toBe(
      'Haus,Haus,"Das Haus,\nam Meer.",The house by the sea.,house by the sea,Das Haus am Meer,Kap. 2,2026-11-18,"A house, not ""home""."',
    );
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('leaves the note empty when the pair has none', () => {
    const csv = vocabularyCsv([entry()]);
    expect(csv).toContain('Kap. 2,2026-11-18,\r\n');
  });

  it('names the file after the pair and the local date', () => {
    expect(vocabularyFileName('de', 'en', new Date(2026, 10, 25))).toBe(
      'de-en-words-2026-11-25.csv',
    );
  });
});
