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

  it('keeps a Vietnamese sentence that starts with uppercase Đ', () => {
    const paragraph =
      'Kengah nuốt chửng con cá trích thứ ba. Đã thành thông lệ hàng năm, chúng lắng nghe chuyện kể.';
    expect(splitSentences(paragraph, 'vi')).toEqual([
      'Kengah nuốt chửng con cá trích thứ ba.',
      'Đã thành thông lệ hàng năm, chúng lắng nghe chuyện kể.',
    ]);
  });

  it('folds a lowercase attribution after an exclamation', () => {
    expect(splitSentences("He's the best! he corrected himself as he swallowed.", 'en')).toEqual([
      "He's the best! he corrected himself as he swallowed.",
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

  it('keeps a quote attribution with its two target sentences', () => {
    const source = doc('en', [
      [
        'He is a good kid, the cat thought, his mouth filled with crumbs. ' +
          'What do I mean, a “good kid”? He’s the best! he corrected himself as he swallowed.',
      ],
    ]);
    const target = doc('vi', [
      [
        'Cậu chủ quả là tốt bụng, con mèo nghĩ, miệng đầy những mảnh vụn. ' +
          'Ý ta là gì ấy nhỉ, một cậu nhóc tốt bụng thôi ư? ' +
          'Cậu chủ phải là xịn nhất ấy chứ! Nó tự đính chính khi nuốt thức ăn.',
      ],
    ]);
    const result = alignDocs('test', 'Test', 'Tester', source, target);
    const pairs = result.chapters[0].paragraphs.flatMap((paragraph) => paragraph.pairs);
    expect(pairs).toHaveLength(3);
    expect(pairs[1]).toMatchObject({
      source: 'What do I mean, a “good kid”?',
      target: 'Ý ta là gì ấy nhỉ, một cậu nhóc tốt bụng thôi ư?',
    });
    expect(pairs[2]).toMatchObject({
      source: 'He’s the best! he corrected himself as he swallowed.',
      target: 'Cậu chủ phải là xịn nhất ấy chứ! Nó tự đính chính khi nuốt thức ăn.',
      flags: ['2:2', 'merge'],
    });
  });
});
