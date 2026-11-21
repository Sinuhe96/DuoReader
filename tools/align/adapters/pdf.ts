import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Chapter, Doc, Paragraph } from '../model.ts';

const run = promisify(execFile);

interface OcrLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface OcrPage {
  file: string;
  lines: OcrLine[];
}

export interface PdfOptions {
  lang: string;
  scale?: number;
  /** 1-based page where each chapter starts; the last value is the end page. */
  pageStarts?: number[];
  titles?: string[];
  replacements?: Record<string, string>;
  maxChapters?: number;
  forceOcr?: boolean;
  workDir: string;
}

function cleanOcr(value: string, replacements: Record<string, string>): string {
  let text = value.normalize('NFC').replace(/\u00ad/g, '');
  for (const [from, to] of Object.entries(replacements)) {
    text = text.split(from).join(to);
  }
  return text
    .replace(/^['"‘“]\s+['"‘“]/, '"')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?=[A-Za-zÀ-ỹ])/g, '$1 ')
    .trim();
}

function median(values: number[]): number {
  if (values.length === 0) return 40;
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
}

export async function renderPages(pdfPath: string, workDir: string, scale = 2): Promise<number> {
  const pagesDir = join(workDir, 'pages');
  await mkdir(pagesDir, { recursive: true });
  const document = await getDocument({
    data: new Uint8Array(await readFile(pdfPath)),
    useSystemFonts: false,
  }).promise;

  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    const name = `page-${String(number).padStart(3, '0')}.png`;
    await writeFile(join(pagesDir, name), canvas.toBuffer('image/png'));
  }
  return document.numPages;
}

export async function ocrPages(workDir: string, lang = 'en-US'): Promise<OcrPage[]> {
  const pagesDir = join(workDir, 'pages');
  const script = fileURLToPath(new URL('./ocr.ps1', import.meta.url));
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    script,
    '-Dir',
    resolve(pagesDir),
    '-Lang',
    lang,
  ];
  await run('powershell.exe', args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  const raw = await readFile(join(pagesDir, 'ocr.json'), 'utf8');
  return JSON.parse(raw.replace(/^\uFEFF/, '')) as OcrPage[];
}

export async function readOcr(workDir: string): Promise<OcrPage[]> {
  const raw = await readFile(join(workDir, 'pages', 'ocr.json'), 'utf8');
  return JSON.parse(raw.replace(/^\uFEFF/, '')) as OcrPage[];
}

function pageLines(page: OcrPage): OcrLine[] {
  return page.lines.filter((line) => {
    const text = line.text.trim();
    if (line.y <= 100 || text.length < 2) return false;
    if (/^\d+$/.test(text)) return false;
    // OCR reads some page numbers as TO/1O/IO; they sit alone at the bottom.
    if (/^[0-9OoIlT|]{1,4}$/.test(text) && line.y > 1000 && line.x > 250) return false;
    return true;
  });
}

interface ParagraphState {
  current?: Paragraph;
  currentX: number;
  previous?: OcrLine;
}

function paragraphText(
  lines: OcrLine[],
  startPage: number,
  replacements: Record<string, string>,
  chapterStart: boolean,
  state: ParagraphState,
): { paragraphs: Paragraph[]; heading: string[] } {
  if (lines.length === 0) return { paragraphs: [], heading: [] };
  const xs = lines.map((line) => Math.round(line.x)).filter((x) => x < 200);
  const bodyX = xs.length ? Math.min(...xs) : 103;

  let first = 0;
  if (chapterStart) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (line.y >= 310 && line.x <= bodyX + 20) {
        first = index;
        break;
      }
    }
  }
  const heading = lines.slice(0, first).map((line) => cleanOcr(line.text, replacements));
  const body = lines.slice(first);
  const gaps: number[] = [];
  for (let index = 1; index < body.length; index += 1) {
    gaps.push(body[index].y - body[index - 1].y);
  }
  const gap = median(gaps);

  if (chapterStart) {
    state.current = undefined;
    state.previous = undefined;
    state.currentX = bodyX;
  }

  const paragraphs: Paragraph[] = [];
  for (const line of body) {
    const text = cleanOcr(line.text, replacements);
    if (!text) continue;
    const verticalGap = state.previous ? line.y - state.previous.y : 0;
    const boxed = line.x >= bodyX + 80;
    const newBox = boxed && state.currentX < bodyX + 80;
    const indented = !boxed && line.x >= bodyX + 8;
    const newParagraph =
      state.current === undefined ||
      newBox ||
      indented ||
      (state.previous !== undefined && verticalGap > gap * 1.7);

    if (newParagraph) {
      if (state.current) paragraphs.push(state.current);
      state.current = { text, page: startPage };
      state.currentX = line.x;
    } else if (state.current) {
      const joined =
        /[a-zà-ỹ]-$/.test(state.current.text) && /^[a-zà-ỹ]/.test(text)
          ? state.current.text.slice(0, -1) + text
          : `${state.current.text} ${text}`;
      state.current.text = cleanOcr(joined, replacements);
    }
    state.previous = line;
  }
  return { paragraphs, heading };
}

function detectStarts(pages: OcrPage[]): number[] {
  const starts: number[] = [];
  for (const page of pages) {
    const lines = pageLines(page);
    if (lines.length === 0) continue;
    const xs = lines.map((line) => Math.round(line.x)).filter((x) => x < 200);
    const bodyX = xs.length ? Math.min(...xs) : 103;
    const heading = lines.some(
      (line) =>
        line.y < 330 &&
        line.x > bodyX + 20 &&
        line.text.trim().length > 2 &&
        !/^THE STORY OF/i.test(line.text),
    );
    if (heading) starts.push(Number(page.file.replace(/\D+/g, '')));
  }
  return starts;
}

export function readPdfDoc(pages: OcrPage[], options: PdfOptions): Doc {
  const starts = options.pageStarts ?? [...detectStarts(pages), pages.length + 1];
  const count = Math.min(options.maxChapters ?? starts.length - 1, starts.length - 1);
  const chapters: Chapter[] = [];

  for (let index = 0; index < count; index += 1) {
    const from = starts[index];
    const to = (starts[index + 1] ?? pages.length + 1) - 1;
    const paragraphs: Paragraph[] = [];
    const headings: string[] = [];
    const state: ParagraphState = { currentX: 103 };
    for (let pageNumber = from; pageNumber <= to; pageNumber += 1) {
      const page = pages.find(
        (candidate) => candidate.file === `page-${String(pageNumber).padStart(3, '0')}.png`,
      );
      if (!page) continue;
      const result = paragraphText(
        pageLines(page),
        pageNumber,
        options.replacements ?? {},
        pageNumber === from,
        state,
      );
      headings.push(...result.heading);
      paragraphs.push(...result.paragraphs);
    }
    if (state.current) paragraphs.push(state.current);
    const fallback = headings.filter((line) => !/^(one|two|three|four|five|six|seven|eight|nine)$/i.test(line));
    chapters.push({
      index,
      label: options.titles?.[index] ?? fallback.at(-1) ?? `Chapter ${index + 1}`,
      paragraphs,
    });
  }

  return {
    lang: options.lang,
    title: 'The Story of a Seagull and the Cat Who Taught Her to Fly',
    chapters,
    meta: { format: 'pdf-ocr', pages: pages.length, warnings: [] },
  };
}

/** Convenience for the CLI: render, OCR, and parse in one call. */
export async function readPdf(pdfPath: string, options: PdfOptions): Promise<Doc> {
  try {
    if (!options.forceOcr) {
      const cached = await readOcr(options.workDir);
      return readPdfDoc(cached, options);
    }
  } catch {
    // No cache yet.
  }
  await renderPages(pdfPath, options.workDir, options.scale ?? 2);
  const pages = await ocrPages(options.workDir);
  return readPdfDoc(pages, options);
}
