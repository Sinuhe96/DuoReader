import type {
  Alignment,
  AlignmentChapter,
  AlignmentPair,
  AlignmentParagraph,
  Chapter,
  Doc,
  Paragraph,
} from './model.ts';
import { splitSentences } from './segment.ts';

interface Move {
  source: number;
  target: number;
}

const SENTENCE_MOVES: Move[] = [
  { source: 1, target: 1 },
  { source: 1, target: 2 },
  { source: 2, target: 1 },
  { source: 1, target: 0 },
  { source: 0, target: 1 },
];

const STOPWORDS: Record<string, true> = {
  the: true,
  and: true,
  but: true,
  for: true,
  from: true,
  when: true,
  then: true,
  that: true,
  this: true,
  with: true,
  what: true,
  who: true,
  why: true,
  how: true,
  his: true,
  her: true,
  their: true,
  they: true,
  she: true,
  you: true,
  not: true,
  one: true,
  two: true,
  all: true,
  was: true,
  were: true,
  had: true,
  have: true,
  has: true,
  would: true,
  could: true,
  should: true,
  there: true,
  here: true,
  into: true,
  over: true,
  after: true,
  before: true,
  because: true,
  while: true,
  just: true,
  like: true,
  some: true,
  very: true,
  more: true,
  most: true,
  only: true,
  also: true,
  said: true,
  asked: true,
  well: true,
  now: true,
  out: true,
  off: true,
  own: true,
};

function chars(text: string): number {
  return text.replace(/\s+/g, '').length;
}

function anchors(text: string): Set<string> {
  const found = text.match(/\b[\p{Lu}][\p{L}\p{M}'’-]{2,}\b|\d+/gu) ?? [];
  const out = new Set<string>();
  for (const value of found) {
    const lower = value.toLowerCase();
    if (STOPWORDS[lower]) continue;
    out.add(lower);
  }
  return out;
}

function sharedAnchors(source: string, target: string): number {
  const left = anchors(source);
  if (left.size === 0) return 0;
  const right = anchors(target);
  let shared = 0;
  for (const value of left) if (right.has(value)) shared += 1;
  return Math.min(shared, 3);
}

function ratio(source: string, target: string): number {
  return (chars(target) + 1) / (chars(source) + 1);
}

function lengthCost(source: string, target: string, expected: number): number {
  const observed = ratio(source, target);
  return (Math.log(observed) - Math.log(expected)) ** 2;
}

function groupCost(
  source: Paragraph[],
  target: Paragraph[],
  expected: number,
  gapCost: number,
): number {
  if (source.length === 0 || target.length === 0) return gapCost;
  const sourceText = source.map((paragraph) => paragraph.text).join(' ');
  const targetText = target.map((paragraph) => paragraph.text).join(' ');
  const movePenalty = source.length === target.length ? 0 : 0.45;
  return (
    lengthCost(sourceText, targetText, expected) +
    movePenalty -
    sharedAnchors(sourceText, targetText) * 0.12
  );
}

interface Cell {
  cost: number;
  move?: Move;
}

function dp(
  sourceCount: number,
  targetCount: number,
  moves: Move[],
  cost: (sourceStart: number, targetStart: number, move: Move) => number,
): Move[] {
  const width = targetCount + 1;
  const cells = new Array<Cell>((sourceCount + 1) * width);
  cells.fill({ cost: Number.POSITIVE_INFINITY });
  cells[0] = { cost: 0 };

  for (let source = 0; source <= sourceCount; source += 1) {
    for (let target = 0; target <= targetCount; target += 1) {
      const index = source * width + target;
      if (source === 0 && target === 0) continue;
      let best = cells[index];
      for (const move of moves) {
        const previousSource = source - move.source;
        const previousTarget = target - move.target;
        if (previousSource < 0 || previousTarget < 0) continue;
        const previous = cells[previousSource * width + previousTarget];
        if (!Number.isFinite(previous.cost)) continue;
        const nextCost =
          previous.cost + cost(previousSource, previousTarget, move);
        if (nextCost < best.cost) {
          best = { cost: nextCost, move };
          cells[index] = best;
        }
      }
    }
  }

  const steps: Move[] = [];
  let source = sourceCount;
  let target = targetCount;
  while (source > 0 || target > 0) {
    const cell = cells[source * width + target];
    if (!cell.move) throw new Error(`Alignment DP lost at ${source}/${target}.`);
    steps.push(cell.move);
    source -= cell.move.source;
    target -= cell.move.target;
  }
  return steps.reverse();
}

function median(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function expectedRatio(source: Chapter, target: Chapter): number {
  const values: number[] = [];
  const count = Math.min(source.paragraphs.length, target.paragraphs.length);
  for (let index = 0; index < count; index += 1) {
    const left = source.paragraphs[index];
    const right = target.paragraphs[index];
    if (left.text.length === 0 || right.text.length === 0) continue;
    values.push(ratio(left.text, right.text));
  }
  if (values.length === 0) return 1;
  const totalSource = source.paragraphs.reduce((sum, paragraph) => sum + chars(paragraph.text), 0);
  const totalTarget = target.paragraphs.reduce((sum, paragraph) => sum + chars(paragraph.text), 0);
  const totals = totalSource > 0 && totalTarget > 0 ? (totalTarget + 1) / (totalSource + 1) : 1;
  return Math.min(5, Math.max(0.2, (median(values) + totals) / 2));
}

function pairFlags(source: string, target: string, expected: number): string[] {
  const flags: string[] = [];
  if (!source) flags.push('gap');
  if (!target) flags.push('gap');
  if (source && target) {
    const observed = ratio(source, target);
    if (observed < expected * 0.45 || observed > expected * 2.2) flags.push('ratio');
  }
  return flags;
}

interface FlatSentence {
  text: string;
  paragraph: number;
}

function flatten(chapter: Chapter, lang: string): FlatSentence[] {
  const out: FlatSentence[] = [];
  chapter.paragraphs.forEach((paragraph, index) => {
    for (const sentence of splitSentences(paragraph.text, lang)) {
      out.push({ text: sentence, paragraph: index });
    }
  });
  return out;
}

function alignChapterParagraphs(
  source: Chapter,
  target: Chapter | undefined,
  sourceLang: string,
  targetLang: string,
): AlignmentParagraph[] {
  if (!target) {
    return source.paragraphs.map((paragraph) => ({
      source: paragraph.text,
      target: '',
      pairs: [{ source: paragraph.text, target: '', flags: ['1:0', 'gap'] }],
      flags: ['1:0', 'gap'],
      page: paragraph.page,
    }));
  }

  const expected = expectedRatio(source, target);
  const left = flatten(source, sourceLang);
  const right = flatten(target, targetLang);
  const steps = dp(left.length, right.length, SENTENCE_MOVES, (s, t, move) => {
    const sourceText = left
      .slice(s, s + move.source)
      .map((sentence) => sentence.text)
      .join(' ');
    const targetText = right
      .slice(t, t + move.target)
      .map((sentence) => sentence.text)
      .join(' ');
    if (!sourceText || !targetText) return 0.2;
    const sourceParagraphs = new Set(left.slice(s, s + move.source).map((sentence) => sentence.paragraph));
    const targetParagraphs = new Set(right.slice(t, t + move.target).map((sentence) => sentence.paragraph));
    const boundaryPenalty =
      (sourceParagraphs.size > 1 ? 0.35 : 0) + (targetParagraphs.size > 1 ? 0.35 : 0);
    return (
      groupCost(
        [{ text: sourceText }],
        [{ text: targetText }],
        expected,
        0.2,
      ) + boundaryPenalty
    );
  });

  const grouped = new Map<number, AlignmentPair[]>();
  const add = (paragraph: number, pair: AlignmentPair): void => {
    const list = grouped.get(paragraph);
    if (list) list.push(pair);
    else grouped.set(paragraph, [pair]);
  };

  let sourceIndex = 0;
  let targetIndex = 0;
  let lastParagraph = 0;
  let pendingTarget = '';
  for (const move of steps) {
    const sourceSentences = left.slice(sourceIndex, sourceIndex + move.source);
    const targetSentences = right.slice(targetIndex, targetIndex + move.target);
    sourceIndex += move.source;
    targetIndex += move.target;
    const previousParagraph = lastParagraph;
    const paragraph = sourceSentences[0]?.paragraph ?? lastParagraph;
    lastParagraph = paragraph;

    if (sourceSentences.length === 0) {
      const text = targetSentences.map((sentence) => sentence.text).join(' ');
      pendingTarget = `${pendingTarget} ${text}`.trim();
      continue;
    }

    const sourceText = sourceSentences.map((sentence) => sentence.text).join(' ');
    let targetText = targetSentences.map((sentence) => sentence.text).join(' ');
    let usedPending = false;
    if (pendingTarget) {
      const pending = pendingTarget;
      pendingTarget = '';
      const previousPair = grouped.get(previousParagraph)?.at(-1);
      const previousCost = previousPair?.source
        ? groupCost([{ text: previousPair.source }], [{ text: pending }], expected, 0.2)
        : Number.POSITIVE_INFINITY;
      const currentCost = groupCost([{ text: sourceText }], [{ text: pending }], expected, 0.2);
      if (previousPair && previousCost <= currentCost) {
        previousPair.target = `${previousPair.target} ${pending}`.trim();
        previousPair.flags.push('0:1', 'merge');
      } else {
        targetText = `${pending} ${targetText}`.trim();
        usedPending = true;
      }
    }

    if (!targetText) {
      add(paragraph, { source: sourceText, target: '', flags: ['1:0', 'gap'] });
      continue;
    }

    if (
      sourceSentences.length === 1 &&
      targetSentences.length === 1 &&
      !usedPending
    ) {
      add(paragraph, {
        source: sourceText,
        target: targetText,
        flags: pairFlags(sourceText, targetText, expected),
      });
      continue;
    }

    const targetCount = targetSentences.length + (usedPending ? 1 : 0);
    // A folded source can still contain two sentences: an unquoted lowercase
    // attribution (`He's the best! he corrected himself.`) is kept in the same
    // pair, but the pair is honestly two sentences on each side. Report it as
    // `2:2`; do not split it into a standalone lowercase fragment.
    const sourceCount =
      sourceSentences.length === 1 && /[.!?]\s+\p{Ll}/u.test(sourceText)
        ? 2
        : sourceSentences.length;
    const flags: string[] = [];
    if (sourceCount > 1 || targetCount > 1) {
      flags.push(`${sourceCount}:${targetCount}`, 'merge');
    }
    flags.push(...pairFlags(sourceText, targetText, expected));
    add(paragraph, {
      source: sourceText,
      target: targetText,
      flags: [...new Set(flags)],
    });
  }
  if (pendingTarget) {
    let best: AlignmentPair | undefined;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const pairs of grouped.values()) {
      for (const pair of pairs) {
        if (!pair.source) continue;
        const cost = groupCost([{ text: pair.source }], [{ text: pendingTarget }], expected, 0.2);
        if (cost < bestCost) {
          best = pair;
          bestCost = cost;
        }
      }
    }
    if (best) {
      best.target = `${best.target} ${pendingTarget}`.trim();
      best.flags.push('0:1', 'merge');
    } else {
      add(lastParagraph, { source: '', target: pendingTarget, flags: ['0:1', 'gap'] });
    }
  }

  return source.paragraphs.map((paragraph, index) => {
    const pairs = grouped.get(index);
    if (pairs) {
      repairCrossedMerges(pairs, sourceLang, targetLang, expected);
      repairTwoByTwo(pairs, sourceLang, targetLang, expected);
    }
    if (!pairs || pairs.length === 0) {
      return {
        source: paragraph.text,
        target: '',
        pairs: [{ source: paragraph.text, target: '', flags: ['1:0', 'gap'] }],
        flags: ['1:0', 'gap'],
        page: paragraph.page,
      };
    }
    const flags = new Set<string>();
    for (const pair of pairs) for (const flag of pair.flags) flags.add(flag);
    if (pairs.every((pair) => !pair.target)) flags.add('gap');
    return {
      source: paragraph.text,
      target: pairs
        .map((pair) => pair.target)
        .filter(Boolean)
        .join(' '),
      pairs,
      flags: [...flags],
      page: paragraph.page,
    };
  });
}


/**
 * A `1:2` followed by a `2:1`, or the mirror `2:1` followed by `1:2`, is the
 * signature of a crossed boundary: one sentence on each side belongs with the
 * neighbor. Split the two groups into three `1:1` pairs when that is cheaper
 * than the crossed merge.
 */
function repairCrossedMerges(
  pairs: AlignmentPair[],
  sourceLang: string,
  targetLang: string,
  expected: number,
): void {
  for (let index = 0; index + 1 < pairs.length; index += 1) {
    const left = pairs[index];
    const right = pairs[index + 1];
    const sourceLeft = splitSentences(left.source, sourceLang);
    const targetLeft = splitSentences(left.target, targetLang);
    const sourceRight = splitSentences(right.source, sourceLang);
    const targetRight = splitSentences(right.target, targetLang);
    const oneThenTwo =
      sourceLeft.length === 1 &&
      targetLeft.length === 2 &&
      sourceRight.length === 2 &&
      targetRight.length === 1;
    const twoThenOne =
      sourceLeft.length === 2 &&
      targetLeft.length === 1 &&
      sourceRight.length === 1 &&
      targetRight.length === 2;
    if (!oneThenTwo && !twoThenOne) continue;

    let current: number;
    let split: number;
    let first: { source: string; target: string };
    let second: { source: string; target: string };
    let third: { source: string; target: string };
    if (oneThenTwo) {
      current =
        groupCost(
          [{ text: left.source }],
          targetLeft.map((text) => ({ text })),
          expected,
          0.2,
        ) +
        groupCost(
          sourceRight.map((text) => ({ text })),
          [{ text: right.target }],
          expected,
          0.2,
        );
      split =
        groupCost([{ text: sourceLeft[0] }], [{ text: targetLeft[0] }], expected, 0.2) +
        groupCost([{ text: sourceRight[0] }], [{ text: targetLeft[1] }], expected, 0.2) +
        groupCost([{ text: sourceRight[1] }], [{ text: targetRight[0] }], expected, 0.2);
      first = { source: sourceLeft[0], target: targetLeft[0] };
      second = { source: sourceRight[0], target: targetLeft[1] };
      third = { source: sourceRight[1], target: targetRight[0] };
    } else {
      current =
        groupCost(
          sourceLeft.map((text) => ({ text })),
          [{ text: left.target }],
          expected,
          0.2,
        ) +
        groupCost(
          [{ text: right.source }],
          targetRight.map((text) => ({ text })),
          expected,
          0.2,
        );
      split =
        groupCost([{ text: sourceLeft[0] }], [{ text: targetLeft[0] }], expected, 0.2) +
        groupCost([{ text: sourceLeft[1] }], [{ text: targetRight[0] }], expected, 0.2) +
        groupCost([{ text: sourceRight[0] }], [{ text: targetRight[1] }], expected, 0.2);
      first = { source: sourceLeft[0], target: targetLeft[0] };
      second = { source: sourceLeft[1], target: targetRight[0] };
      third = { source: sourceRight[0], target: targetRight[1] };
    }
    if (split + 0.15 >= current) continue;

    pairs.splice(
      index,
      2,
      {
        ...first,
        flags: pairFlags(first.source, first.target, expected),
      },
      {
        ...second,
        flags: pairFlags(second.source, second.target, expected),
      },
      {
        ...third,
        flags: pairFlags(third.source, third.target, expected),
      },
    );
    index += 2;
  }
}


/** A `2:2` group is usually two independent sentences; split it when cheaper. */
function repairTwoByTwo(
  pairs: AlignmentPair[],
  sourceLang: string,
  targetLang: string,
  expected: number,
): void {
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    const source = splitSentences(pair.source, sourceLang);
    const target = splitSentences(pair.target, targetLang);
    if (source.length !== 2 || target.length !== 2) continue;
    // A 2:2 never comes from a single DP move; it is two moves that shared a
    // paragraph block. Splitting preserves the sentence order and gives the
    // reader one pair per sentence.
    pairs.splice(
      index,
      1,
      {
        source: source[0],
        target: target[0],
        flags: pairFlags(source[0], target[0], expected),
      },
      {
        source: source[1],
        target: target[1],
        flags: pairFlags(source[1], target[1], expected),
      },
    );
    index += 1;
  }
}

export function alignDocs(
  id: string,
  title: string,
  author: string,
  sourceDoc: Doc,
  targetDoc: Doc,
): Alignment {
  const chapters: AlignmentChapter[] = [];
  const count = Math.max(sourceDoc.chapters.length, targetDoc.chapters.length);
  for (let index = 0; index < count; index += 1) {
    const source = sourceDoc.chapters[index];
    const target = targetDoc.chapters[index];
    if (!source) {
      chapters.push({
        index,
        sourceLabel: '',
        targetLabel: target?.label ?? `Chapter ${index + 1}`,
        paragraphs: target.paragraphs.map((paragraph) => ({
          source: '',
          target: paragraph.text,
          pairs: [{ source: '', target: paragraph.text, flags: ['0:1', 'gap'] }],
          flags: ['0:1', 'gap'],
          page: paragraph.page,
        })),
        flags: ['missing-source'],
      });
      continue;
    }
    chapters.push({
      index,
      sourceLabel: source.label,
      targetLabel: target?.label ?? '',
      paragraphs: alignChapterParagraphs(source, target, sourceDoc.lang, targetDoc.lang),
      flags: target ? [] : ['missing-target'],
    });
  }

  const allPairs = chapters.flatMap((chapter) =>
    chapter.paragraphs.flatMap((paragraph) => paragraph.pairs),
  );
  const stats = {
    sourceChapters: sourceDoc.chapters.length,
    targetChapters: targetDoc.chapters.length,
    paragraphs: chapters.reduce((sum, chapter) => sum + chapter.paragraphs.length, 0),
    pairs: allPairs.length,
    flagged: allPairs.filter((pair) => pair.flags.length > 0).length,
    gaps: allPairs.filter((pair) => !pair.source || !pair.target).length,
    merges: allPairs.filter((pair) => pair.flags.includes('merge')).length,
  };

  return {
    id,
    title,
    author,
    sourceLang: sourceDoc.lang,
    targetLang: targetDoc.lang,
    chapters,
    stats,
  };
}
