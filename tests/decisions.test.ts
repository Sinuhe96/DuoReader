import { describe, expect, it } from 'vitest';
import {
  applyDecisions,
  buildReviewFile,
  type DecisionsFile,
} from '../tools/align/decisions';
import type { Alignment } from '../tools/align/model';

function alignment(): Alignment {
  return {
    id: 'test',
    title: 'Test',
    author: 'Tester',
    sourceLang: 'en',
    targetLang: 'vi',
    chapters: [
      {
        index: 0,
        sourceLabel: 'One',
        targetLabel: 'Một',
        flags: [],
        paragraphs: [
          {
            source: 'One. Two.',
            target: 'Một. Hai.',
            page: 1,
            pairs: [
              {
                source: 'One. Two.',
                target: 'Một. Hai.',
                flags: ['2:2', 'merge'],
              },
            ],
            flags: ['2:2', 'merge'],
          },
        ],
      },
    ],
    stats: {
      sourceChapters: 1,
      targetChapters: 1,
      paragraphs: 1,
      pairs: 1,
      flagged: 1,
      gaps: 0,
      merges: 1,
    },
  };
}

function decisions(groups: DecisionsFile['decisions'][number]['groups']): DecisionsFile {
  return {
    schema_version: 1,
    decisions: [{ key: 'ch01/p001', groups }],
  };
}

describe('LLM decisions', () => {
  it('exports a flagged paragraph with sentence indices and hashes', () => {
    const file = buildReviewFile(alignment());
    expect(file.cases).toHaveLength(1);
    expect(file.cases[0]).toMatchObject({
      key: 'ch01/p001',
      source: ['One.', 'Two.'],
      target: ['Một.', 'Hai.'],
      current: [{ source: [0, 1], target: [0, 1] }],
    });
    expect(file.cases[0].source_hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('applies a grouping and recomputes pair and flag counts', () => {
    const doc = alignment();
    const count = applyDecisions(
      doc,
      decisions([
        { source: [0], target: [0] },
        { source: [1], target: [1] },
      ]),
    );
    expect(count).toBe(1);
    expect(doc.chapters[0].paragraphs[0].pairs).toEqual([
      { source: 'One.', target: 'Một.', flags: [] },
      { source: 'Two.', target: 'Hai.', flags: [] },
    ]);
    expect(doc.stats).toMatchObject({ pairs: 2, flagged: 0, merges: 0 });
  });

  it('rejects a grouping that skips or reorders a sentence', () => {
    expect(() =>
      applyDecisions(
        alignment(),
        decisions([{ source: [1], target: [1] }]),
      ),
    ).toThrow(/source indices must be consecutive/);
  });

  it('rejects a stale decision when the paragraph hash changed', () => {
    const file: DecisionsFile = {
      schema_version: 1,
      decisions: [
        {
          key: 'ch01/p001',
          source_hash: '0000000000000000',
          groups: [
            { source: [0], target: [0] },
            { source: [1], target: [1] },
          ],
        },
      ],
    };
    expect(() => applyDecisions(alignment(), file)).toThrow(/source_hash no longer matches/);
  });
});
