import { describe, expect, it } from 'vitest';
import {
  adjacentWords,
  countWords,
  extendWordRange,
  glossAt,
  glossSpanAt,
  pairTextMap,
  wordAt,
} from '../src/reader/words';
import type { BookGloss, InlineRun } from '../src/reader/types';

function gloss(overrides: Partial<BookGloss> & { gloss: string }): BookGloss {
  return {
    id: `g-${overrides.gloss}`,
    pairId: 'p1',
    side: 'source',
    start: 0,
    end: 1,
    term: 'x',
    ...overrides,
  };
}

describe('wordAt', () => {
  const sentence = 'Der Leser bleibt an dieser Stelle stehen.';

  it('expands a caret inside a word to its boundaries', () => {
    const at = sentence.indexOf('bleibt') + 2;
    expect(wordAt(sentence, at, 'de')).toEqual({
      start: sentence.indexOf('bleibt'),
      end: sentence.indexOf('bleibt') + 'bleibt'.length,
      text: 'bleibt',
    });
  });

  it('takes the word before a caret that landed on the following space', () => {
    const at = sentence.indexOf('bleibt') + 'bleibt'.length;
    expect(wordAt(sentence, at, 'de')?.text).toBe('bleibt');
  });

  it('falls back to the word after a leading punctuation caret', () => {
    expect(wordAt('»Kannst du schwimmen?«', 1, 'de')?.text).toBe('Kannst');
  });

  it('returns null on punctuation with no adjacent word', () => {
    expect(wordAt('... ...', 1, 'de')).toBeNull();
  });

  it('segments a script without spaces', () => {
    const text = '很久以前有一个孩子';
    const word = wordAt(text, 2, 'zh-Hans');
    expect(word).not.toBeNull();
    expect(text.slice(word!.start, word!.end)).toBe(word!.text);
    expect(2).toBeGreaterThanOrEqual(word!.start);
    expect(2).toBeLessThan(word!.end);
  });
});

describe('phrase ranges', () => {
  const line = 'Tôi thích nghi với thành phố mới.';
  const thich = { start: 4, end: 9, text: 'thích' };

  it('finds the words on both sides of a syllable', () => {
    expect(adjacentWords(line, 4, 9, 'vi')).toEqual({
      before: { start: 0, end: 3, text: 'Tôi' },
      after: { start: 10, end: 14, text: 'nghi' },
    });
    expect(adjacentWords(line, 10, 14, 'vi')).toEqual({
      before: thich,
      after: { start: 15, end: 18, text: 'với' },
    });
  });

  it('extends one word at a time and keeps the separator', () => {
    expect(extendWordRange(line, thich, 'after', 'vi')).toEqual({
      start: 4,
      end: 14,
      text: 'thích nghi',
    });
    expect(
      extendWordRange(
        line,
        { start: 10, end: 14, text: 'nghi' },
        'before',
        'vi',
      ),
    ).toEqual({ start: 4, end: 14, text: 'thích nghi' });
    expect(extendWordRange(line, thich, 'before', 'vi')).toEqual({
      start: 0,
      end: 9,
      text: 'Tôi thích',
    });
    expect(extendWordRange('thích', { start: 0, end: 5, text: 'thích' }, 'before', 'vi')).toBeNull();
  });

  it('builds a three-syllable term one word at a time', () => {
    const term = 'Hợp tác xã';
    const first = extendWordRange(
      term,
      { start: 0, end: 3, text: 'Hợp' },
      'after',
      'vi',
    );
    expect(first).toEqual({ start: 0, end: 7, text: 'Hợp tác' });
    const second = first
      ? extendWordRange(term, first, 'after', 'vi')
      : null;
    expect(second).toEqual({ start: 0, end: 10, text: 'Hợp tác xã' });
    const third = second
      ? extendWordRange(term, second, 'after', 'vi')
      : null;
    expect(third).toBeNull();
  });

  it('counts word-like segments, not spaces alone', () => {
    expect(countWords('thích nghi', 'vi')).toBe(2);
    expect(countWords(line, 'vi')).toBe(7);
    expect(countWords('', 'vi')).toBe(0);
  });
});

describe('pairTextMap', () => {
  it('is the identity when there are no runs', () => {
    const map = pairTextMap('bleibt', undefined);
    expect(map.toDom(2)).toBe(2);
    expect(map.toPair(2)).toBe(2);
  });

  it('keeps a break with no character aligned', () => {
    const runs: InlineRun[] = [{ text: 'a' }, { text: '', break: true }, { text: 'b' }];
    const map = pairTextMap('ab', runs);
    expect(map.toDom(0)).toBe(0);
    expect(map.toDom(1)).toBe(1);
    expect(map.toDom(2)).toBe(2);
    expect(map.toPair(2)).toBe(2);
  });

  it('lets a break consume the producer’s space', () => {
    const runs: InlineRun[] = [{ text: 'a' }, { text: '', break: true }, { text: 'b' }];
    const map = pairTextMap('a b', runs);
    expect(map.toDom(1)).toBe(1);
    expect(map.toPair(1)).toBe(2);
    expect(map.toDom(2)).toBe(1);
    expect(map.toDom(3)).toBe(2);
  });

  it('falls back to the identity when runs disagree with the string', () => {
    const runs: InlineRun[] = [{ text: 'a' }, { text: 'c' }];
    const map = pairTextMap('ab', runs);
    expect(map.toPair(2)).toBe(2);
    expect(map.toDom(1)).toBe(1);
  });
});

describe('glossAt', () => {
  const glossary = [
    gloss({ id: 'shared', pairId: 'p1', side: 'source', start: 4, end: 9, term: 'Haus', gloss: 'house' }),
    gloss({ id: 'other-pair', pairId: 'p2', side: 'source', start: 0, end: 4, term: 'Haus', gloss: 'wrong pair' }),
    gloss({ id: 'target', pairId: 'p1', side: 'target', start: 0, end: 4, term: 'Haus', gloss: 'wrong side' }),
  ];

  it('prefers an overlapping range on the same pair and side', () => {
    expect(glossAt(glossary, 'p1', 'source', 5, 8, 'aus')?.id).toBe('shared');
  });

  it('falls back to an exact case-insensitive term', () => {
    expect(glossAt(glossary, 'p1', 'source', 0, 0, 'HAUS')?.id).toBe('shared');
  });

  it('never matches a different pair, side, or substring', () => {
    expect(glossAt(glossary, 'p2', 'source', 0, 0, 'HAUS')?.id).toBe('other-pair');
    expect(glossAt(glossary, 'p1', 'target', 0, 0, 'HAUS')?.id).toBe('target');
    expect(glossAt(glossary, 'p1', 'source', 0, 0, 'Häuser')).toBeUndefined();
  });

  it('snaps a tap to the longest covering gloss range', () => {
    const nested = [
      gloss({ id: 'syllable', pairId: 'p1', side: 'source', start: 4, end: 9, term: 'thích', gloss: 'like' }),
      gloss({ id: 'phrase', pairId: 'p1', side: 'source', start: 4, end: 14, term: 'thích nghi', gloss: 'adapt' }),
      gloss({ id: 'outside', pairId: 'p1', side: 'source', start: 20, end: 25, term: 'mới', gloss: 'new' }),
    ];

    expect(glossSpanAt(nested, 'p1', 'source', 4, 9)?.id).toBe('phrase');
    expect(glossSpanAt(nested, 'p1', 'source', 10, 14)?.id).toBe('phrase');
    expect(glossSpanAt(nested, 'p1', 'source', 0, 1)).toBeUndefined();
  });
});
