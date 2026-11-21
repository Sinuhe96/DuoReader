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

  it('splits a multi-sentence quotation at its own punctuation', () => {
    expect(
      splitSentences(
        '"Dreadful story! Dreadful! Hmmm, let me think… that is it!"',
        'en',
      ),
    ).toEqual([
      '"Dreadful story!',
      'Dreadful!',
      'Hmmm, let me think… that is it!"',
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

  it('keeps a quoted opening sentence with its source paragraph', () => {
    const source = doc('en', [[
      '"Inspired! I will get volume nineteen," Einstein announced.',
      '"You see? If you stop, we will know," the Colonel said.',
    ]]);
    const target = doc('vi', [[
      '"Sáng tạo! Tôi sẽ lấy tập hai mươi," Einstein nói.',
      '"Anh thấy chưa? Nếu anh ngưng, chúng ta sẽ biết," Đại Tá nói.',
    ]]);
    const result = alignDocs('test', 'Test', 'Tester', source, target);
    const paragraphs = result.chapters[0].paragraphs;
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].pairs.every((pair) => pair.source && pair.target)).toBe(true);
    expect(paragraphs[1].pairs).toHaveLength(2);
    expect(paragraphs[1].pairs[0]).toMatchObject({
      source: '"You see?',
      target: '"Anh thấy chưa?',
    });
    expect(paragraphs[1].pairs[1].source).toContain('If you stop');
    expect(paragraphs[1].pairs[1].target).toContain('Nếu anh ngưng');
    expect(paragraphs[1].pairs.some((pair) => pair.flags.includes('0:1'))).toBe(false);
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

  it('moves a target sentence to the next pair when the boundary slipped', () => {
    const source = doc('en', [
      [
        'At the precise moment that he lazily rolled over so the sun could warm his back, ' +
          'he heard the hum of a flying object he couldn’t identify, something approaching at great speed. ' +
          'Alert, he leapt up, crouching on all four feet and ready to jump aside to avoid being hit ' +
          'by the seagull that dropped onto the balcony.',
      ],
    ]);
    const target = doc('vi', [
      [
        'Đúng vào khoảnh khắc nó đang lật người lại để phơi lưng ra dưới nắng, ' +
          'nó chợt nghe thấy tiếng vù vù từ một vật thể bay mà nó không thể xác định được, ' +
          'một cái gì đó đang lao tới với tốc độ kinh khiếp. Báo động! ' +
          'Nó nhảy dựng lên, bốn chân lấy đà, sẵn sàng nhảy sang một bên để né cô chim hải âu ' +
          'đang rơi thẳng xuống ban công.',
      ],
    ]);
    const result = alignDocs('test', 'Test', 'Tester', source, target);
    const pairs = result.chapters[0].paragraphs.flatMap((paragraph) => paragraph.pairs);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].target).not.toContain('Báo động!');
    expect(pairs[1].source).toContain('Alert, he leapt up');
    expect(pairs[1].target).toContain('Báo động!');
    expect(pairs[1].flags).toContain('1:2');
  });

  it('merges a source paragraph split inside an open quote', () => {
    const source = doc('en', [
      ['"Dreadful story!', "sick gull... that's it!"],
    ]);
    const target = doc('vi', [
      ['"Câu chuyện khủng khiếp! hải âu bị ốm... chính là nó!"'],
    ]);
    const result = alignDocs('test', 'Test', 'Tester', source, target);
    expect(result.chapters[0].paragraphs).toHaveLength(1);
    const paragraph = result.chapters[0].paragraphs[0];
    expect(paragraph.source).toBe('"Dreadful story! sick gull... that\'s it!');
    expect(paragraph.pairs.every((pair) => pair.source && pair.target)).toBe(true);
  });

  it('moves a target sentence into a source-only gap', () => {
    const source = doc('en', [
      [
        'He was nervously pacing back and forth before an enormous book that lay open on the floor, ' +
          'from time to time holding his head between his front paws. He seemed truly devastated.',
      ],
    ]);
    const target = doc('vi', [
      [
        'Nó đang căng thẳng đi tới đi lui trước cả đống sách để mở trên sàn nhà, ' +
          'thỉnh thoảng lại lấy hai chân trước ôm đầu. Nó xem chừng đang thật sự tan nát cõi lòng.',
      ],
    ]);
    const result = alignDocs('test', 'Test', 'Tester', source, target);
    const paragraph = result.chapters[0].paragraphs[0];
    expect(paragraph.pairs).toHaveLength(2);
    expect(paragraph.pairs[0].flags).toEqual([]);
    expect(paragraph.pairs[1]).toMatchObject({
      source: 'He seemed truly devastated.',
      target: 'Nó xem chừng đang thật sự tan nát cõi lòng.',
      flags: [],
    });
    expect(paragraph.flags).toEqual([]);
  });
});
