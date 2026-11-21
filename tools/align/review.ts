import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Alignment } from './model.ts';

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function reviewKey(
  chapter: number,
  paragraph: number,
  pair?: number,
): string {
  const base = `ch${String(chapter + 1).padStart(2, '0')}/p${String(paragraph + 1).padStart(3, '0')}`;
  return pair === undefined
    ? base
    : `${base}/s${String(pair + 1).padStart(3, '0')}`;
}

interface Row {
  key: string;
  source: string;
  target: string;
  flags: string[];
  chapter: string;
}

function rows(alignment: Alignment, onlyFlagged: boolean, samplePerChapter: number): Row[] {
  const out: Row[] = [];
  for (const chapter of alignment.chapters) {
    let samples = 0;
    chapter.paragraphs.forEach((paragraph, paragraphIndex) => {
      paragraph.pairs.forEach((pair, pairIndex) => {
        const flagged = pair.flags.length > 0;
        const sample = !onlyFlagged && flagged === false && samples < samplePerChapter;
        if (!flagged && !sample) return;
        if (sample) samples += 1;
        out.push({
          key: reviewKey(chapter.index, paragraphIndex, pairIndex),
          source: pair.source,
          target: pair.target,
          flags: pair.flags,
          chapter: `${chapter.index + 1}. ${chapter.sourceLabel}`,
        });
      });
    });
  }
  return out;
}

function markdown(alignment: Alignment): string {
  const lines: string[] = [];
  lines.push(`# Alignment review — ${alignment.title}`);
  lines.push('');
  lines.push(
    `${alignment.stats.pairs} pairs · ${alignment.stats.flagged} flagged · ` +
      `${alignment.stats.gaps} gaps · ${alignment.stats.merges} merges`,
  );
  lines.push('');
  lines.push('| Chapter | Pairs | Flagged |');
  lines.push('|---|---:|---:|');
  for (const chapter of alignment.chapters) {
    const pairs = chapter.paragraphs.reduce((sum, paragraph) => sum + paragraph.pairs.length, 0);
    const flagged = chapter.paragraphs.reduce(
      (sum, paragraph) => sum + paragraph.pairs.filter((pair) => pair.flags.length > 0).length,
      0,
    );
    lines.push(`| ${chapter.index + 1}. ${chapter.sourceLabel} | ${pairs} | ${flagged} |`);
  }
  lines.push('');
  for (const row of rows(alignment, true, 0)) {
    lines.push(`## ${row.key} · ${row.flags.join(', ')}`);
    lines.push('');
    lines.push(`- ${row.chapter}`);
    lines.push(`- source: ${row.source || '(empty)'}`);
    lines.push(`- target: ${row.target || '(empty)'}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function html(alignment: Alignment): string {
  const flagged = rows(alignment, true, 0);
  const samples = rows(alignment, false, 6).filter((row) => row.flags.length === 0);
  const body = [...flagged, ...samples]
    .map(
      (row) => `<tr class="${row.flags.length ? 'flagged' : ''}">
  <td><code>${escape(row.key)}</code><br><small>${escape(row.chapter)}</small></td>
  <td>${escape(row.source) || '<em>(empty)</em>'}</td>
  <td>${escape(row.target) || '<em>(empty)</em>'}</td>
  <td>${escape(row.flags.join(', ')) || 'sample'}</td>
</tr>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Alignment review — ${escape(alignment.title)}</title>
<style>
body { font: 15px/1.45 system-ui, sans-serif; margin: 24px; color: #222; }
h1 { font-size: 1.4rem; }
table { border-collapse: collapse; width: 100%; table-layout: fixed; }
th, td { border-bottom: 1px solid #ddd; padding: 8px; vertical-align: top; overflow-wrap: anywhere; }
th { text-align: left; background: #f6f6f6; }
td:nth-child(1) { width: 13rem; }
tr.flagged { background: #fff4e5; }
code { font-size: 0.85rem; }
small { color: #666; }
</style>
<h1>Alignment review — ${escape(alignment.title)}</h1>
<p>${alignment.stats.pairs} pairs · ${alignment.stats.flagged} flagged · ${alignment.stats.gaps} gaps · ${alignment.stats.merges} merges</p>
<p>Flagged rows first, then a sample of confident 1:1 pairs.</p>
<table>
<thead><tr><th>Key</th><th>Source</th><th>Target</th><th>Flags</th></tr></thead>
<tbody>
${body}
</tbody>
</table>
</html>
`;
}

export async function writeReview(alignment: Alignment, outDir: string): Promise<void> {
  await writeFile(join(outDir, 'review.md'), markdown(alignment));
  await writeFile(join(outDir, 'review.html'), html(alignment));
}
