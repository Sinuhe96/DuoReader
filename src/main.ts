import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { parseBePubZip } from './reader/parse';
import { ImportError, type Book, type Chapter } from './reader/types';
import {
  deleteBook,
  listBooks,
  loadBook,
  saveBook,
  type LibraryBook,
} from './storage/library';

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) throw new Error('Missing #app element.');
const app: HTMLDivElement = appRoot;

let book: Book | null = null;
let chapter: Chapter | null = null;
let imageUrls: string[] = [];

function revokeImageUrls(): void {
  for (const url of imageUrls) URL.revokeObjectURL(url);
  imageUrls = [];
}

function importError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatImportDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(timestamp);
}

async function renderLibrary(error?: string): Promise<void> {
  revokeImageUrls();
  book = null;
  chapter = null;

  const screen = document.createElement('main');
  screen.className = 'library-screen';

  const header = document.createElement('header');
  header.className = 'library-header';
  const title = document.createElement('h1');
  title.textContent = 'DuoReader';
  const subtitle = document.createElement('p');
  subtitle.className = 'lede';
  subtitle.textContent = 'Your offline bilingual library.';
  header.append(title, subtitle);
  screen.append(header);

  const addRow = document.createElement('div');
  addRow.className = 'library-actions';
  const add = document.createElement('label');
  add.className = 'file-button';
  add.textContent = 'Add BePub ZIP';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.zip,application/zip,application/epub+zip';
  input.className = 'file-input';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void importFile(file);
    input.value = '';
  });
  add.append(input);
  addRow.append(add);
  screen.append(addRow);

  let loadError = error;
  let books: LibraryBook[] = [];
  try {
    books = await listBooks();
  } catch (cause) {
    loadError = importError(cause, 'The library could not be opened.');
  }

  if (loadError) {
    const message = document.createElement('p');
    message.className = 'error';
    message.setAttribute('role', 'alert');
    message.textContent = loadError;
    screen.append(message);
  }

  if (books.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = loadError
      ? 'No books are available until storage opens.'
      : 'No books yet. Add a BePub ZIP to start reading.';
    screen.append(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'book-list';

    for (const item of books) {
      const card = document.createElement('li');
      card.className = 'book-card';

      const info = document.createElement('div');
      info.className = 'book-info';
      const bookTitle = document.createElement('h2');
      bookTitle.textContent = item.title;
      const author = document.createElement('p');
      author.className = 'book-author';
      author.textContent = item.author;
      const meta = document.createElement('p');
      meta.className = 'book-meta';
      meta.textContent = [
        `${item.sourceLang} → ${item.targetLang}`,
        `${item.stats.pairs.toLocaleString()} pairs`,
        `${item.stats.documents} chapters`,
        `${item.stats.images} images`,
      ].join(' · ');
      const imported = document.createElement('p');
      imported.className = 'book-note';
      imported.textContent = `Imported ${formatImportDate(item.importedAt)}`;
      info.append(bookTitle, author, meta, imported);

      const actions = document.createElement('div');
      actions.className = 'book-actions';
      const read = document.createElement('button');
      read.type = 'button';
      read.className = 'read-button';
      read.textContent = 'Read';
      read.addEventListener('click', () => void openBook(item.id));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'delete-button';
      remove.textContent = 'Delete';
      remove.addEventListener('click', async () => {
        if (!window.confirm(`Delete “${item.title}” from this device?`)) return;
        try {
          await deleteBook(item.id);
          await renderLibrary();
        } catch (cause) {
          await renderLibrary(importError(cause, 'Could not delete this book.'));
        }
      });
      actions.append(read, remove);

      card.append(info, actions);
      list.append(card);
    }

    screen.append(list);
  }

  app.replaceChildren(screen);
}

function renderImporting(fileName: string): void {
  revokeImageUrls();
  book = null;
  chapter = null;

  const screen = document.createElement('main');
  screen.className = 'import-screen';
  screen.setAttribute('aria-busy', 'true');

  const title = document.createElement('h1');
  title.textContent = 'DuoReader';
  const status = document.createElement('p');
  status.className = 'lede';
  status.textContent = `Importing ${fileName}…`;
  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = 'Normalizing chapters and storing the book on this device.';

  screen.append(title, status, note);
  app.replaceChildren(screen);
}

async function importFile(file: File): Promise<void> {
  renderImporting(file.name);
  try {
    const parsed = parseBePubZip(await file.arrayBuffer(), file.name);
    if (parsed.chapters.length === 0) {
      throw new ImportError('This book has no readable chapters.');
    }
    await saveBook(parsed);
    await openBook(parsed.id);
  } catch (error) {
    await renderLibrary(importError(error, 'Could not import this file.'));
  }
}

async function openBook(id: string): Promise<void> {
  try {
    const loaded = await loadBook(id);
    if (!loaded) throw new Error('This book is no longer in the library.');
    if (loaded.chapters.length === 0) throw new Error('This book has no readable chapters.');
    book = loaded;
    chapter = loaded.chapters[0];
    renderReader();
    window.scrollTo({ top: 0 });
  } catch (error) {
    await renderLibrary(importError(error, 'Could not open this book.'));
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

  const library = document.createElement('button');
  library.type = 'button';
  library.className = 'secondary';
  library.textContent = 'Library';
  library.setAttribute('aria-label', 'Back to library');
  library.addEventListener('click', () => void renderLibrary());

  controls.append(select, library);
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

void renderLibrary();
registerSW({ immediate: true });
