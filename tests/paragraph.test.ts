import { describe, expect, it } from 'vitest';
import { blockParagraph, paragraphPinyin } from '../src/reader/paragraph';
import type { Block, InlineRun, Pair } from '../src/reader/types';

type PairsBlock = Extract<Block, { type: 'pairs' }>;

function pair(overrides: Partial<Pair> & { source: string }): Pair {
  return { id: '1:0:0', bid: '1', target: '', ...overrides };
}

function block(pairs: Pair[]): PairsBlock {
  return { type: 'pairs', pairs };
}

function text(runs: InlineRun[]): string {
  return runs.map((run) => (run.break ? '\n' : run.text)).join('');
}

describe('blockParagraph', () => {
  it('rebuilds the source with the offset gap between sentences', () => {
    const paragraph = blockParagraph(
      block([
        pair({ id: '7:0:18', start: 0, end: 18, source: 'Jetzt erzähle ich', target: 'Now I tell' }),
        pair({ id: '7:19:33', start: 19, end: 33, source: 'die Geschichte.', target: 'the story.' }),
      ]),
    );

    expect(text(paragraph.source)).toBe('Jetzt erzähle ich die Geschichte.');
    expect(text(paragraph.target)).toBe('Now I tell the story.');
  });

  it('keeps punctuation tight when the gap is zero', () => {
    const paragraph = blockParagraph(
      block([
        pair({ id: '9:0:25', start: 0, end: 25, source: '»Kannst du schwimmen?«', target: 'Can you swim?' }),
        pair({ id: '9:25:37', start: 25, end: 37, source: ', fragte Oma.', target: 'asked Grandma.' }),
      ]),
    );

    expect(text(paragraph.source)).toBe('»Kannst du schwimmen?«, fragte Oma.');
    expect(text(paragraph.target)).toBe('Can you swim? asked Grandma.');
  });

  it('falls back to a single space when offsets are missing', () => {
    const paragraph = blockParagraph(
      block([
        pair({ id: '3:0:0', source: 'Erste', target: 'First' }),
        pair({ id: '3:0:0', source: 'Zeile.', target: 'line.' }),
      ]),
    );

    expect(text(paragraph.source)).toBe('Erste Zeile.');
  });

  it('renders an untranslated block as source only', () => {
    const paragraph = blockParagraph(
      block([
        pair({ id: '22:0:33', start: 0, end: 33, source: 'Die Luft bewegte sich –', target: '' }),
      ]),
    );

    expect(text(paragraph.source)).toBe('Die Luft bewegte sich –');
    expect(paragraph.target).toEqual([]);
  });

  it('joins targets with exactly one space and skips empty ones', () => {
    const paragraph = blockParagraph(
      block([
        pair({ id: '4:0:1', start: 0, end: 1, source: 'A', target: 'A' }),
        pair({ id: '4:1:2', start: 1, end: 2, source: 'B', target: '' }),
        pair({ id: '4:2:3', start: 2, end: 3, source: 'C', target: 'C' }),
      ]),
    );

    expect(text(paragraph.target)).toBe('A C');
  });

  it('carries inline runs across pairs and separates them with plain gaps', () => {
    const paragraph = blockParagraph(
      block([
        pair({
          id: '5:0:2',
          start: 0,
          end: 2,
          source: 'ab',
          sourceRuns: [{ text: 'a', style: 'em' }, { text: 'b' }],
          target: 'AB',
          targetRuns: [{ text: 'A', style: 'strong' }, { text: 'B' }],
        }),
        pair({ id: '5:3:4', start: 3, end: 4, source: 'c', target: 'C' }),
      ]),
    );

    expect(paragraph.source).toEqual([
      { text: 'a', style: 'em' },
      { text: 'b c' },
    ]);
    expect(paragraph.target).toEqual([
      { text: 'A', style: 'strong' },
      { text: 'B C' },
    ]);
    expect(text(paragraph.source)).toBe('ab c');
  });

  it('keeps a line break inside a pair', () => {
    const paragraph = blockParagraph(
      block([
        pair({
          id: '6:0:3',
          start: 0,
          end: 3,
          source: 'a b',
          sourceRuns: [{ text: 'a ' }, { text: '', break: true }, { text: 'b' }],
          target: 'A B',
        }),
      ]),
    );

    expect(paragraph.source.some((run) => run.break)).toBe(true);
    expect(text(paragraph.source)).toBe('a \nb');
  });

  it('does not mutate the stored runs', () => {
    const runs: InlineRun[] = [{ text: 'a', style: 'em' }];
    const stored = pair({ id: '8:0:1', start: 0, end: 1, source: 'a', sourceRuns: runs });
    blockParagraph(block([stored]));

    expect(runs).toEqual([{ text: 'a', style: 'em' }]);
  });
});

describe('paragraphPinyin', () => {
  it('joins the sentence pinyin with one space', () => {
    const joined = paragraphPinyin(
      block([
        pair({ id: '1:0:4', source: '很久以前', pinyin: 'Hěn jiǔ yǐqián' }),
        pair({ id: '1:4:8', source: '有一个孩子', pinyin: 'yǒu yí gè háizi' }),
      ]),
    );

    expect(joined).toBe('Hěn jiǔ yǐqián yǒu yí gè háizi');
  });

  it('skips sentences without pinyin and returns an empty line when none has it', () => {
    expect(
      paragraphPinyin(
        block([
          pair({ id: '2:0:2', source: '他叫', pinyin: 'Tā jiào' }),
          pair({ id: '2:2:4', source: '司马光' }),
        ]),
      ),
    ).toBe('Tā jiào');

    expect(paragraphPinyin(block([pair({ id: '3:0:1', source: '水' })]))).toBe('');
  });
});
