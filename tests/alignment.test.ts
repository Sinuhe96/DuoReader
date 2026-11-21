import { describe, expect, it } from 'vitest';
import { alignDocs } from '../tools/align/align';
import type { Doc } from '../tools/align/model';
import { splitSentences } from '../tools/align/segment';

function doc(lang: string, paragraphs: string[][]): Doc {
  return {
    lang,
    title: 'Synthetic',
    chapters: paragraphs.map((chapter, index) => ({
      index,
      label: `Chapter ${index + 1}`,
      paragraphs: chapter.map((text) => ({ text })),
    })),
    meta: { format: 'test', warnings: [] },
  };
}

describe('alignment segmentation', () => {
  it('keeps a quoted sentence and its attribution together', () => {
    expect(splitSentences('"School of herring port side!" the lookout gull announced.', 'en')).toEqual([
      '"School of herring port side!" the lookout gull announced.',
    ]);
    expect(splitSentences('"Yes," he said. "But how?"', 'en')).toEqual([
      '"Yes," he said.',
      '"But how?"',
    ]);
  });
});

describe('alignment', () => {
  it('keeps a translation-only sentence for the following source sentence', () => {
    const source = doc('en', [['"Yes," he said.', 'A sentence only in English.']]);
    const target = doc('vi', [['"Đúng," anh nói.']]);
    const result = alignDocs('test', 'Test', 'Tester', source, target);
    const pairs = result.chapters[0].paragraphs.flatMap((paragraph) => paragraph.pairs);
    expect(pairs.map((pair) => pair.source)).toEqual(['"Yes," he said.', 'A sentence only in English.']);
    expect(pairs.filter((pair) => pair.target).length).toBe(1);
    expect(pairs.some((pair) => pair.flags.includes('gap'))).toBe(true);
  });

  it('marks a one-to-two sentence merge instead of duplicating text', () => {
    const source = doc('en', [['One sentence.']]);
    const target = doc('vi', [['Một câu.', 'Hai câu.']]);
    const result = alignDocs('test', 'Test', 'Tester', source, target);
    const pairs = result.chapters[0].paragraphs.flatMap((paragraph) => paragraph.pairs);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].source).toBe('One sentence.');
    expect(pairs[0].target).toBe('Một câu. Hai câu.');
    expect(pairs[0].flags).toContain('1:2');
  });
});
