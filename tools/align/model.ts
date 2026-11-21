/** Neutral source-edition model used by the aligner, independent of EPUB/PDF. */
export interface Paragraph {
  text: string;
  page?: number;
}

export interface Chapter {
  index: number;
  label: string;
  paragraphs: Paragraph[];
}

export interface Doc {
  lang: string;
  title: string;
  chapters: Chapter[];
  meta: {
    format: string;
    pages?: number;
    warnings: string[];
  };
}

export interface AlignmentPair {
  source: string;
  target: string;
  flags: string[];
}

export interface AlignmentParagraph {
  source: string;
  target: string;
  pairs: AlignmentPair[];
  flags: string[];
  page?: number;
}

export interface AlignmentChapter {
  index: number;
  sourceLabel: string;
  targetLabel: string;
  paragraphs: AlignmentParagraph[];
  flags: string[];
}

export interface Alignment {
  id: string;
  title: string;
  author: string;
  sourceLang: string;
  targetLang: string;
  chapters: AlignmentChapter[];
  stats: {
    sourceChapters: number;
    targetChapters: number;
    paragraphs: number;
    pairs: number;
    flagged: number;
    gaps: number;
    merges: number;
  };
}
