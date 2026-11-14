export interface Pair {
  id: string;
  bid: string;
  source: string;
  target: string;
}

export type Block =
  | { type: 'pairs'; pairs: Pair[] }
  | { type: 'image'; imageId: string; alt: string }
  | { type: 'text'; text: string };

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

export interface ReaderSettings {
  fontSize: number;
  lineHeight: number;
  theme: ReaderTheme;
  fontFamily: string;
}

export interface ReadingPosition {
  bookId: string;
  chapterIndex: number;
  pairId: string | null;
  progress: number;
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
