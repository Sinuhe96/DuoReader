/**
 * LLM-assisted review without a built-in provider.
 *
 * The deterministic aligner writes `review.json` and `review-prompt.md` for the
 * flagged paragraphs. An external model or human returns `decisions.json`: a
 * grouping of the paragraph's existing source and target sentences. This module
 * validates that grouping and applies it before emission, so every rebuild is
 * reproducible and reading stays offline.
 */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Alignment, AlignmentPair, AlignmentParagraph } from './model.ts';
import { reviewKey } from './review.ts';
import { splitSentences } from './segment.ts';

export interface ReviewGroup {
  source: number[];
  target: number[];
  flags: string[];
}

export interface ReviewCase {
  key: string;
  chapter: string;
  source: string[];
  target: string[];
  current: ReviewGroup[];
  flags: string[];
  source_hash: string;
  target_hash: string;
}

export interface ReviewFile {
  schema_version: 1;
  id: string;
  title: string;
  source_lang: string;
  target_lang: string;
  cases: ReviewCase[];
}

export interface DecisionGroup {
  source: number[];
  target: number[];
}

export interface Decision {
  key: string;
  source_hash?: string;
  target_hash?: string;
  groups: DecisionGroup[];
}

export interface DecisionsFile {
  schema_version: 1;
  decisions: Decision[];
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function range(start: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => start + index);
}

function currentGroups(
  paragraph: AlignmentParagraph,
  sourceLang: string,
  targetLang: string,
): ReviewGroup[] {
  let sourceIndex = 0;
  let targetIndex = 0;
  return paragraph.pairs.map((pair) => {
    const sourceCount = splitSentences(pair.source, sourceLang).length;
    const targetCount = splitSentences(pair.target, targetLang).length;
    const group: ReviewGroup = {
      source: range(sourceIndex, sourceCount),
      target: range(targetIndex, targetCount),
      flags: pair.flags,
    };
    sourceIndex += sourceCount;
    targetIndex += targetCount;
    return group;
  });
}

export function buildReviewFile(alignment: Alignment): ReviewFile {
  const cases: ReviewCase[] = [];
  for (const chapter of alignment.chapters) {
    chapter.paragraphs.forEach((paragraph, paragraphIndex) => {
      if (!paragraph.pairs.some((pair) => pair.flags.length > 0)) return;
      const source = splitSentences(paragraph.source, alignment.sourceLang);
      const target = splitSentences(paragraph.target, alignment.targetLang);
      const current = currentGroups(
        paragraph,
        alignment.sourceLang,
        alignment.targetLang,
      );
      const sourceCursor = current.reduce(
        (sum, group) => sum + group.source.length,
        0,
      );
      const targetCursor = current.reduce(
        (sum, group) => sum + group.target.length,
        0,
      );
      if (sourceCursor !== source.length || targetCursor !== target.length) {
        throw new Error(
          `${reviewKey(chapter.index, paragraphIndex)} cannot map its pairs back to sentences.`,
        );
      }
      cases.push({
        key: reviewKey(chapter.index, paragraphIndex),
        chapter: `${chapter.index + 1}. ${chapter.sourceLabel}`,
        source,
        target,
        current,
        flags: paragraph.flags,
        source_hash: hashText(paragraph.source),
        target_hash: hashText(paragraph.target),
      });
    });
  }
  return {
    schema_version: 1,
    id: alignment.id,
    title: alignment.title,
    source_lang: alignment.sourceLang,
    target_lang: alignment.targetLang,
    cases,
  };
}

function promptFor(file: ReviewFile): string {
  const lines: string[] = [];
  lines.push('# Alignment adjudication prompt');
  lines.push('');
  lines.push(
    'Choose the best grouping for each flagged paragraph. Use the sentence ' +
      'indices shown; do not rewrite text. Every source and target index must ' +
      'appear exactly once, in ascending order, and every group must contain at ' +
      'least one sentence. A source-only or target-only group is allowed.',
  );
  lines.push('');
  lines.push(
    'Reply with one JSON object matching `decisions.json`; copy each `key`, ' +
      '`source_hash`, and `target_hash` exactly.',
  );
  lines.push('');
  for (const item of file.cases) {
    lines.push(`## ${item.key}`);
    lines.push('');
    lines.push(`- Chapter: ${item.chapter}`);
    lines.push(`- Flags: ${item.flags.join(', ') || '(none)'}`);
    lines.push(`- Source hash: \`${item.source_hash}\``);
    lines.push(`- Target hash: \`${item.target_hash}\``);
    lines.push('');
    lines.push('Source sentences:');
    item.source.forEach((text, index) => lines.push(`- S${index}: ${text}`));
    lines.push('');
    lines.push('Target sentences:');
    item.target.forEach((text, index) => lines.push(`- T${index}: ${text}`));
    lines.push('');
    lines.push('Current groups:');
    item.current.forEach((group) => {
      const source =
        group.source.length > 0 ? group.source.map((index) => `S${index}`).join(', ') : '(empty)';
      const target =
        group.target.length > 0 ? group.target.map((index) => `T${index}`).join(', ') : '(empty)';
      lines.push(`- ${source} -> ${target} · ${group.flags.join(', ') || '1:1'}`);
    });
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

export async function writeReviewJson(
  alignment: Alignment,
  outDir: string,
): Promise<void> {
  const file = buildReviewFile(alignment);
  await writeFile(`${join(outDir, 'review.json')}`, `${JSON.stringify(file, null, 2)}\n`);
  await writeFile(join(outDir, 'review-prompt.md'), promptFor(file));
}

function pairFlags(sourceCount: number, targetCount: number): string[] {
  if (sourceCount === 0) return targetCount === 0 ? ['0:0', 'gap'] : [`0:${targetCount}`, 'gap'];
  if (targetCount === 0) return [`${sourceCount}:0`, 'gap'];
  if (sourceCount > 1 || targetCount > 1) {
    return [`${sourceCount}:${targetCount}`, 'merge'];
  }
  return [];
}

function takeSequence(
  indices: number[],
  expected: number,
  key: string,
  side: string,
): number {
  for (let offset = 0; offset < indices.length; offset += 1) {
    const value = indices[offset];
    if (!Number.isInteger(value) || value !== expected + offset) {
      throw new Error(
        `${key}: ${side} indices must be consecutive and in order (expected ${expected + offset}, got ${value}).`,
      );
    }
  }
  return expected + indices.length;
}

function applyDecision(
  alignment: Alignment,
  paragraph: AlignmentParagraph,
  decision: Decision,
): void {
  if (decision.source_hash && decision.source_hash !== hashText(paragraph.source)) {
    throw new Error(`${decision.key}: source_hash no longer matches the paragraph.`);
  }
  if (decision.target_hash && decision.target_hash !== hashText(paragraph.target)) {
    throw new Error(`${decision.key}: target_hash no longer matches the paragraph.`);
  }
  if (!Array.isArray(decision.groups) || decision.groups.length === 0) {
    throw new Error(`${decision.key}: groups must be a non-empty array.`);
  }

  const source = splitSentences(paragraph.source, alignment.sourceLang);
  const target = splitSentences(paragraph.target, alignment.targetLang);
  let sourceCursor = 0;
  let targetCursor = 0;
  const pairs: AlignmentPair[] = [];

  for (const group of decision.groups) {
    if (!Array.isArray(group.source) || !Array.isArray(group.target)) {
      throw new Error(`${decision.key}: every group needs source and target arrays.`);
    }
    if (group.source.length === 0 && group.target.length === 0) {
      throw new Error(`${decision.key}: an empty group is not allowed.`);
    }
    sourceCursor = takeSequence(group.source, sourceCursor, decision.key, 'source');
    targetCursor = takeSequence(group.target, targetCursor, decision.key, 'target');
    const sourceText = group.source.map((index) => source[index]).join(' ');
    const targetText = group.target.map((index) => target[index]).join(' ');
    pairs.push({
      source: sourceText,
      target: targetText,
      flags: pairFlags(group.source.length, group.target.length),
    });
  }

  if (sourceCursor !== source.length || targetCursor !== target.length) {
    throw new Error(
      `${decision.key}: groups cover ${sourceCursor}/${source.length} source and ` +
        `${targetCursor}/${target.length} target sentences.`,
    );
  }

  paragraph.pairs = pairs;
  paragraph.source = source.join(' ');
  paragraph.target = target.join(' ');
  const flags = new Set<string>();
  for (const pair of pairs) for (const flag of pair.flags) flags.add(flag);
  if (pairs.every((pair) => !pair.target)) flags.add('gap');
  paragraph.flags = [...flags];
}

function recomputeStats(alignment: Alignment): void {
  const pairs = alignment.chapters.flatMap((chapter) =>
    chapter.paragraphs.flatMap((paragraph) => paragraph.pairs),
  );
  alignment.stats.paragraphs = alignment.chapters.reduce(
    (sum, chapter) => sum + chapter.paragraphs.length,
    0,
  );
  alignment.stats.pairs = pairs.length;
  alignment.stats.flagged = pairs.filter((pair) => pair.flags.length > 0).length;
  alignment.stats.gaps = pairs.filter((pair) => !pair.source || !pair.target).length;
  alignment.stats.merges = pairs.filter((pair) => pair.flags.includes('merge')).length;
}

export function applyDecisions(
  alignment: Alignment,
  file: DecisionsFile,
): number {
  if (file.schema_version !== 1 || !Array.isArray(file.decisions)) {
    throw new Error('decisions.json must have schema_version 1 and a decisions array.');
  }
  const paragraphs = new Map<string, AlignmentParagraph>();
  for (const chapter of alignment.chapters) {
    chapter.paragraphs.forEach((paragraph, paragraphIndex) => {
      paragraphs.set(reviewKey(chapter.index, paragraphIndex), paragraph);
    });
  }
  const seen = new Set<string>();
  for (const decision of file.decisions) {
    if (seen.has(decision.key)) {
      throw new Error(`Duplicate decision for ${decision.key}.`);
    }
    seen.add(decision.key);
    const paragraph = paragraphs.get(decision.key);
    if (!paragraph) {
      throw new Error(`Decision key ${decision.key} does not exist in this alignment.`);
    }
    applyDecision(alignment, paragraph, decision);
  }
  recomputeStats(alignment);
  return file.decisions.length;
}
