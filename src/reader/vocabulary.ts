import type { VocabularyEntry, VocabularyStatus } from './types';

/** One row per status, in the order the sheet shows them. */
export const VOCABULARY_STATUSES: {
  id: VocabularyStatus;
  label: string;
  glyph: string;
}[] = [
  { id: 'new', label: 'New', glyph: '○' },
  { id: 'learning', label: 'Learning', glyph: '◐' },
  { id: 'exported', label: 'Exported', glyph: '●' },
  { id: 'known', label: 'Known', glyph: '✓' },
];

export type StatusFilter = 'all' | VocabularyStatus;

export interface LanguageGroup {
  sourceLang: string;
  targetLang: string;
  entries: VocabularyEntry[];
  /** Newest export in the group, for the pair card's meta line. */
  exportedAt?: number;
}

function groupKey(sourceLang: string, targetLang: string): string {
  return `${sourceLang}\u0000${targetLang}`;
}

/**
 * One group per language pair, largest first. A reader can hold books in
 * several pairs and a headword is only meaningful inside one: `Haus` in a
 * German book never shares a list, a dedupe key, or a deck with another
 * language. A pair whose languages could not be recovered is `und`.
 */
export function groupVocabulary(entries: VocabularyEntry[]): LanguageGroup[] {
  const groups = new Map<string, LanguageGroup>();
  for (const entry of entries) {
    const key = groupKey(entry.sourceLang, entry.targetLang);
    let group = groups.get(key);
    if (!group) {
      group = {
        sourceLang: entry.sourceLang,
        targetLang: entry.targetLang,
        entries: [],
      };
      groups.set(key, group);
    }
    group.entries.push(entry);
    if (entry.exportedAt && (!group.exportedAt || entry.exportedAt > group.exportedAt)) {
      group.exportedAt = entry.exportedAt;
    }
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      entries: [...group.entries].sort(
        (left, right) =>
          right.createdAt - left.createdAt || left.term.localeCompare(right.term),
      ),
    }))
    .sort(
      (left, right) =>
        right.entries.length - left.entries.length ||
        groupKey(left.sourceLang, left.targetLang).localeCompare(
          groupKey(right.sourceLang, right.targetLang),
        ),
    );
}

/**
 * Search matches the headword, the inflected form, the gloss, and the book,
 * so `house` finds `Haus` even when the gloss came from the edition. Case is
 * folded; diacritics are not, because a Vietnamese reader looking for `mèo`
 * does not mean `meo`.
 */
export function filterVocabulary(
  entries: VocabularyEntry[],
  query: string,
  status: StatusFilter,
): VocabularyEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  return entries.filter((entry) => {
    if (status !== 'all' && entry.status !== status) return false;
    if (needle.length === 0) return true;
    return [entry.term, entry.surface, entry.entry, entry.bookTitle].some((value) =>
      value.toLocaleLowerCase().includes(needle),
    );
  });
}

/** Counts for the status chips, over the group as narrowed by the search. */
export function statusCounts(
  entries: VocabularyEntry[],
  query: string,
): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = {
    all: 0,
    new: 0,
    learning: 0,
    exported: 0,
    known: 0,
  };
  for (const entry of filterVocabulary(entries, query, 'all')) {
    counts.all += 1;
    counts[entry.status] += 1;
  }
  return counts;
}

/** Human names for the pair card: `de` → `German`, `und` → `Unknown`. */
export function languageName(code: string): string {
  if (!code || code === 'und') return 'Unknown';
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

export function pairTitle(sourceLang: string, targetLang: string): string {
  return `${languageName(sourceLang)} → ${languageName(targetLang)}`;
}

export function pairCodes(sourceLang: string, targetLang: string): string {
  return `${sourceLang} → ${targetLang}`;
}

/** `YYYY-MM-DD` in the reader's local calendar. */
function localDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** `de-en-words-2026-11-25.csv`, in the reader's local calendar. */
export function vocabularyFileName(
  sourceLang: string,
  targetLang: string,
  date: Date,
): string {
  return `${sourceLang}-${targetLang}-words-${localDate(date)}.csv`;
}

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * The Anki preset: a fixed field order the user maps once per deck. The
 * language pair is the deck, so it is the filename, not a column. Notes are
 * joined per pair by the caller. No BOM here; the download adds it.
 */
export function vocabularyCsv(
  entries: VocabularyEntry[],
  notes: Map<string, string> = new Map(),
): string {
  const header = [
    'Word',
    'Surface',
    'Context',
    'Translation',
    'Entry',
    'Book',
    'Chapter',
    'Created',
    'Note',
  ];
  const rows = entries.map((entry) =>
    [
      entry.term,
      entry.surface,
      entry.context,
      entry.translation,
      entry.entry,
      entry.bookTitle,
      entry.chapterLabel,
      localDate(new Date(entry.createdAt)),
      notes.get(`${entry.bookId}\u0000${entry.pairId}`) ?? '',
    ].map(csvField),
  );
  return [header, ...rows].map((row) => row.join(',')).join('\r\n') + '\r\n';
}
