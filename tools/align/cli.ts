import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { alignDocs } from './align.ts';
import { readEpub } from './adapters/epub.ts';
import { readPdf, type PdfOptions } from './adapters/pdf.ts';
import { buildAligned } from './emit.ts';
import type { Doc } from './model.ts';
import { writeReview } from './review.ts';

interface CaseSource {
  kind: 'pdf-ocr' | 'pdf' | 'epub';
  path: string;
  lang?: string;
  scale?: number;
  page_starts?: number[];
  titles?: string[];
  replacements?: Record<string, string>;
  max_chapters?: number;
}

interface CaseTarget {
  kind: 'epub';
  path: string;
  lang?: string;
  skip_until?: string;
  replacements?: Record<string, string>;
  titles?: string[];
  max_chapters?: number;
}

interface CaseFile {
  id: string;
  title: string;
  author: string;
  source_lang: string;
  target_lang: string;
  source: CaseSource;
  target: CaseTarget;
}

async function extract(source: CaseSource, workDir: string, forceOcr: boolean): Promise<Doc> {
  const path = resolve(source.path);
  if (source.kind === 'epub') {
    return readEpub(path, {
      lang: source.lang ?? 'vi',
      maxChapters: source.max_chapters,
    });
  }
  const options: PdfOptions = {
    lang: source.lang ?? 'en',
    workDir,
    scale: source.scale,
    pageStarts: source.page_starts,
    titles: source.titles,
    replacements: source.replacements,
    maxChapters: source.max_chapters,
    forceOcr,
  };
  return readPdf(path, options);
}

async function main(): Promise<void> {
  const casePath = resolve(process.argv[2] ?? 'out/align/seagull/case.json');
  const forceOcr = process.argv.includes('--force-ocr');
  const outDir = dirname(casePath);
  const raw = JSON.parse(await readFile(casePath, 'utf8')) as CaseFile;

  const source = await extract(raw.source, outDir, forceOcr);
  const target = await readEpub(resolve(raw.target.path), {
    lang: raw.target.lang ?? raw.target_lang,
    skipUntil: raw.target.skip_until,
    maxChapters: raw.target.max_chapters,
  });
  if (raw.target.titles) {
    target.chapters.forEach((chapter, index) => {
      const title = raw.target.titles?.[index];
      if (title) chapter.label = title;
    });
  }

  const alignment = alignDocs(raw.id, raw.title, raw.author, source, target);
  await mkdir(outDir, { recursive: true });
  await writeFile(
    `${outDir}/alignment.json`,
    `${JSON.stringify(alignment, null, 2)}\n`,
  );
  await writeReview(alignment, outDir);
  const built = await buildAligned(alignment, outDir);

  console.log(
    `${alignment.title} · ${alignment.stats.pairs} pairs · ` +
      `${alignment.stats.flagged} flagged · ${alignment.stats.gaps} gaps · ` +
      `${alignment.stats.merges} merges`,
  );
  console.log(
    `${source.chapters.length} source chapters · ${target.chapters.length} target chapters · ` +
      `${alignment.stats.paragraphs} aligned paragraphs`,
  );
  console.log(`${built.bookId} · ${built.path}`);
  console.log(`${outDir}/alignment.json · ${outDir}/review.html`);
}

await main();
