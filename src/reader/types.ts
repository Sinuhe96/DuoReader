export type InlineStyle = 'em' | 'strong';

export interface InlineRun {
  text: string;
  style?: InlineStyle;
  /** A `br`: `text` is ignored, the renderer emits a line break. */
  break?: true;
}

export interface Pair {
  id: string;
  bid: string;
  /** Character offset of the pair inside the block's source text; absent on old imports. */
  start?: number;
  end?: number;
  source: string;
  target: string;
  /** Pinyin of the source sentence, from `data-pinyin`; absent when the archive has none. */
  pinyin?: string;
  /** Present only when the span carries whitelisted inline markup or a line break. */
  sourceRuns?: InlineRun[];
  targetRuns?: InlineRun[];
}

export type Block =
  | { type: 'pairs'; pairs: Pair[] }
  | { type: 'image'; imageId: string; alt: string }
  | { type: 'text'; text: string; runs?: InlineRun[] };

export interface Chapter {
  index: number;
  path: string;
  label: string;
  blocks: Block[];
  pairCount: number;
}

export interface BookImage {
  id: string;
  mediaType: string;
  blob: Blob;
}

export interface BookStats {
  documents: number;
  pairs: number;
  imageBlocks: number;
  images: number;
  textOnlyBlocks: number;
}

export type ReaderTheme = 'light' | 'sepia' | 'dark' | 'system';
export type ReaderPalette = Exclude<ReaderTheme, 'system'>;

export type DisplayMode = 'sentence' | 'paragraph';
export type LanguageOrder = 'source-first' | 'target-first';
export type LanguagesMode = 'both' | 'source' | 'target';
/** Romanization of the source line: hidden, or one line above each sentence. */
export type PinyinMode = 'off' | 'sentence';

export interface ReaderSettings {
  fontSize: number;
  lineHeight: number;
  theme: ReaderTheme;
  fontFamily: string;
  displayMode: DisplayMode;
  /** Which languages render: both, source only, or translation only. */
  languages: LanguagesMode;
  languageOrder: LanguageOrder;
  pinyin: PinyinMode;
}

export interface ReadingPosition {
  bookId: string;
  chapterIndex: number;
  pairId: string | null;
  progress: number;
  updatedAt: number;
}

/**
 * One stored mark. Offsets are character positions into the pair's source or
 * target string, and `text` is the exact slice so a re-import that changed the
 * sentence can skip the mark instead of highlighting the wrong words.
 */
export type AnnotationKind = 'word' | 'phrase' | 'sentence' | 'passage' | 'note';
export type AnnotationColor = 'yellow' | 'green' | 'blue' | 'pink';

export interface Annotation {
  id: string;
  bookId: string;
  chapterIndex: number;
  pairId: string;
  side: 'source' | 'target';
  start: number;
  end: number;
  text: string;
  kind: AnnotationKind;
  color: AnnotationColor;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  sourceLang: string;
  targetLang: string;
  chapters: Chapter[];
  images: Record<string, BookImage>;
  stats: BookStats;
  warnings: string[];
}

export class ImportError extends Error {}
