import './styles.css';
import { parseBePubZip } from './reader/parse';
import type { Book, Chapter } from './reader/types';
import { ImportError } from './reader/types';

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) throw new Error('Missing #app element.');
const app: HTMLDivElement = appRoot;

let book: Book | null = null;
let chapter: Chapter | null = null;
let imageUrls: string[] = [];
let parseDuration = 0;

function revokeImageUrls(): void {
  for (const url of imageUrls) URL.revokeObjectURL(url);
  imageUrls = [];
}

function renderImport(error?: string): void {
  revokeImageUrls();
  book = null;
  chapter = null;

  const screen = document.createElement('main');
  screen.className = 'import-screen';

  const title = document.createElement('h1');
  title.textContent = 'DuoReader';
  screen.append(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'lede';
  subtitle.textContent =
    'M0 parser spike. Choose a BePub ZIP to normalize the book and render one chapter at phone width.';
  screen.append(subtitle);

  const label = document.createElement('label');
  label.className = 'file-button';
  label.textContent = 'Choose BePub ZIP';

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.zip,application/zip,application/epub+zip';
  input.className = 'file-input';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void importFile(file);
  });
  label.append(input);
  screen.append(label);

  if (error) {
    const message = document.createElement('p');
    message.className = 'error';
    message.setAttribute('role', 'alert');
    message.textContent = error;
    screen.append(message);
  }

  const note = document.createElement('p');
  note.className = 'note';
  note.textContent =
    'The book stays in this tab for M0. Library storage, offline caching, and resume arrive in M1.';
  screen.append(note);

  app.replaceChildren(screen);
}

async function importFile(file: File): Promise<void> {
  const started = performance.now();
  try {
    const parsed = parseBePubZip(await file.arrayBuffer(), file.name);
    const firstChapter = parsed.chapters[0];
    if (!firstChapter) throw new ImportError('This book has no readable chapters.');
    book = parsed;
    chapter = firstChapter;
    parseDuration = performance.now() - started;
    renderReader();
  } catch (error) {
    renderImport(error instanceof Error ? error.message : 'Could not import this file.');
  }
}

function openChapter(next: Chapter): void {
  chapter = next;
  renderReader();
  window.scrollTo({ top: 0 });
}

function renderReader(): void {
  if (!book || !chapter) return;
  revokeImageUrls();

  const header = document.createElement('header');
  header.className = 'topbar';

  const heading = document.createElement('div');
  heading.className = 'heading';
  const title = document.createElement('h1');
  title.textContent = book.title;
  const byline = document.createElement('p');
  byline.textContent = book.author;
  heading.append(title, byline);

  const controls = document.createElement('div');
  controls.className = 'controls';

  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Chapter');
  for (const candidate of book.chapters) {
    const option = document.createElement('option');
    option.value = String(candidate.index);
    option.textContent =
      candidate.pairCount > 0 ? `${candidate.label} · ${candidate.pairCount}` : candidate.label;
    option.selected = candidate.index === chapter?.index;
    select.append(option);
  }
  select.addEventListener('change', () => {
    const next = book?.chapters.find((candidate) => candidate.index === Number(select.value));
    if (next) openChapter(next);
  });

  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'secondary';
  again.textContent = 'New ZIP';
  again.addEventListener('click', () => renderImport());

  controls.append(select, again);
  header.append(heading, controls);

  const main = document.createElement('main');
  main.className = 'reader';
  main.lang = book.sourceLang;

  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.textContent = [
    `${book.sourceLang} → ${book.targetLang}`,
    `${book.stats.pairs.toLocaleString()} pairs`,
    `${book.stats.imageBlocks} image blocks`,
    `${book.stats.textOnlyBlocks} source-only`,
    `parsed in ${Math.round(parseDuration)} ms`,
  ].join(' · ');
  main.append(meta);

  if (book.warnings.length > 0) {
    const warnings = document.createElement('ul');
    warnings.className = 'warnings';
    for (const warning of book.warnings) {
      const item = document.createElement('li');
      item.textContent = warning;
      warnings.append(item);
    }
    main.append(warnings);
  }

  const article = document.createElement('article');
  article.className = 'chapter';
  article.setAttribute('aria-label', chapter.label);

  for (const block of chapter.blocks) {
    if (block.type === 'pairs') {
      for (const pair of block.pairs) {
        const pairElement = document.createElement('div');
        pairElement.className = 'pair';
        pairElement.dataset.pairId = pair.id;

        const source = document.createElement('p');
        source.className = 'src';
        source.lang = book.sourceLang;
        source.textContent = pair.source;
        pairElement.append(source);

        if (pair.target) {
          const target = document.createElement('p');
          target.className = 'tgt';
          target.lang = book.targetLang;
          target.textContent = pair.target;
          pairElement.append(target);
        }

        article.append(pairElement);
      }
    } else if (block.type === 'image') {
      const image = book.images[block.imageId];
      if (!image) continue;
      const figure = document.createElement('figure');
      const element = document.createElement('img');
      const url = URL.createObjectURL(image.blob);
      imageUrls.push(url);
      element.src = url;
      element.alt = block.alt;
      element.loading = 'lazy';
      element.decoding = 'async';
      figure.append(element);
      article.append(figure);
    } else {
      const paragraph = document.createElement('p');
      paragraph.className = 'text-only';
      paragraph.lang = book.sourceLang;
      paragraph.textContent = block.text;
      article.append(paragraph);
    }
  }

  main.append(article);

  const end = document.createElement('p');
  end.className = 'chapter-end';
  end.textContent = 'End of chapter';
  main.append(end);

  const currentIndex = chapter.index;
  const nextChapter = book.chapters.find(
    (candidate) => candidate.index === currentIndex + 1,
  );
  if (nextChapter) {
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'next-chapter';
    next.textContent = 'Next Chapter';
    next.setAttribute('aria-label', `Next chapter: ${nextChapter.label}`);
    next.addEventListener('click', () => openChapter(nextChapter));
    main.append(next);
  }

  app.replaceChildren(header, main);
}

renderImport();
