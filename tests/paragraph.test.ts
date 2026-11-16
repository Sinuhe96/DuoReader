import { describe, expect, it } from 'vitest';
import { blockParagraph } from '../src/reader/paragraph';
import type { Block, Pair } from '../src/reader/types';

type PairsBlock = Extract<Block, { type: 'pairs' }>;

function pair(overrides: Partial<Pair> & { source: string }): Pair {
  return { id: '1:0:0', bid: '1', target: '', ...overrides };
}

function block(pairs: Pair[]): PairsBlock {
  return { type: 'pairs', pairs };
}

describe('blockParagraph', () => {
  it('rebuilds the source with the offset gap between sentences', () => {
    const paragraph = blockParagraph(
      block([
        pair({ id: '7:0:18', start: 0, end: 18, source: 'Jetzt erzähle ich', target: 'Now I tell' }),
        pair({ id: '7:19:33', start: 19, end: 33, source: 'die Geschichte.', target: 'the story.' }),
      ]),
    );

    expect(paragraph.source).toBe('Jetzt erzähle ich die Geschichte.');
    expect(paragraph.target).toBe('Now I tell the story.');
  });

  it('keeps punctuation tight when the gap is zero', () => {
    const paragraph = blockParagraph(
      block([
        pair({ id: '9:0:25', start: 0, end: 25, source: '»Kannst du schwimmen?«', target: 'Can you swim?' }),
        pair({ id: '9:25:37', start: 25, end: 37, source: ', fragte Oma.', target: 'asked Grandma.' }),
      ]),
    );

    expect(paragraph.source).toBe('»Kannst du schwimmen?«, fragte Oma.');
    expect(paragraph.target).toBe('Can you swim? asked Grandma.');
  });

  it('falls back to a single space when offsets are missing', () => {
    const paragraph = blockParagraph(
      block([
        pair({ id: '3:0:0', source: 'Erste', target: 'First' }),
        pair({ id: '3:0:0', source: 'Zeile.', target: 'line.' }),
      ]),
    );

    expect(paragraph.source).toBe('Erste Zeile.');
  });

  it('renders an untranslated block as source only', () => {
    const paragraph = blockParagraph(
      block([
        pair({ id: '22:0:33', start: 0, end: 33, source: 'Die Luft bewegte sich –', target: '' }),
      ]),
    );

    expect(paragraph).toEqual({ source: 'Die Luft bewegte sich –', target: '' });
  });

  it('joins targets with exactly one space and skips empty ones', () => {
    const paragraph = blockParagraph(
      block([
        pair({ id: '4:0:1', start: 0, end: 1, source: 'A', target: 'A' }),
        pair({ id: '4:1:2', start: 1, end: 2, source: 'B', target: '' }),
        pair({ id: '4:2:3', start: 2, end: 3, source: 'C', target: 'C' }),
      ]),
    );

    expect(paragraph.target).toBe('A C');
  });
});
