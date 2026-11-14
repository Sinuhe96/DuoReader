import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { BUILD_INFO, formatBuildTag } from './build-info';
import { fontStack, READER_FONTS } from './reader/fonts';
import { parseBePubZip } from './reader/parse';
import { firstPairId, progressAt } from './reader/position';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  THEMES,
  THEME_COLORS,
} from './reader/settings';
import {
  ImportError,
  type Book,
  type Chapter,
  type ReaderSettings,
  type ReadingPosition,
} from './reader/types';
import {
  deleteBook,
  ensurePersistent,
  getPosition,
  listBooks,
  listPositions,
  loadBook,
  loadSettings,
  saveBook,
  savePosition,
  saveSettings,
  type LibraryBook,
} from './storage/library';

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) throw new Error('Missing #app element.');
const app: HTMLDivElement = appRoot;

let book: Book | null = null;
let chapter: Chapter | null = null;
let imageUrls: string[] = [];
let renderedPairs: HTMLElement[] = [];
let settings: ReaderSettings = { ...DEFAULT_SETTINGS };
let settingsSaveTimer: number | undefined;
let settingsSave: Promise<void> = Promise.resolve();
let settingsDirty = false;
let currentPairId: string | null = null;
let positionTimer: number | undefined;
let scrollFrame: number | undefined;
let restoring = false;

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

function applySettings(): void {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.style.setProperty('--reader-size', `${settings.fontSize}px`);
  root.style.setProperty('--reader-line-height', String(settings.lineHeight));
  root.style.setProperty('--reader-font', fontStack(settings.fontFamily));
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLORS[settings.theme]);
}

function updateSettings(patch: Partial<ReaderSettings>): void {
  settings = normalizeSettings({ ...settings, ...patch });
  applySettings();
  settingsDirty = true;
  if (settingsSaveTimer !== undefined) window.clearTimeout(settingsSaveTimer);
  settingsSaveTimer = window.setTimeout(() => {
    settingsSaveTimer = undefined;
    void flushSettings();
  }, 200);
}

function flushSettings(): Promise<void> {
  if (settingsSaveTimer !== undefined) {
    window.clearTimeout(settingsSaveTimer);
    settingsSaveTimer = undefined;
  }
  if (!settingsDirty) return settingsSave;

  settingsDirty = false;
  const snapshot = settings;
  settingsSave = settingsSave
    .catch(() => undefined)
    .then(() => saveSettings(snapshot))
    .catch((cause: unknown) => {
      console.warn('Could not save reader settings.', cause);
    });
  return settingsSave;
}

function openSettings(): void {
  if (document.querySelector('.settings-dialog[open]')) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'settings-dialog';
  dialog.setAttribute('aria-labelledby', 'settings-title');

  const heading = document.createElement('h2');
  heading.id = 'settings-title';
  heading.textContent = 'Reading settings';

  const familyRow = document.createElement('label');
  familyRow.className = 'setting setting-select';
  const familyLabel = document.createElement('span');
  familyLabel.textContent = 'Font';
  const familySelect = document.createElement('select');
  for (const font of READER_FONTS) {
    const option = document.createElement('option');
    option.value = font.id;
    option.textContent = font.label;
    option.style.fontFamily = font.stack;
    option.selected = font.id === settings.fontFamily;
    familySelect.append(option);
  }
  familySelect.addEventListener('change', () => {
    updateSettings({ fontFamily: familySelect.value });
  });
  familyRow.append(familyLabel, familySelect);

  const fontRow = document.createElement('label');
  fontRow.className = 'setting';
  const fontLabel = document.createElement('span');
  fontLabel.textContent = 'Text size';
  const fontValue = document.createElement('output');
  fontValue.value = `${settings.fontSize} px`;
  const fontInput = document.createElement('input');
  fontInput.type = 'range';
  fontInput.min = '16';
  fontInput.max = '24';
  fontInput.step = '1';
  fontInput.value = String(settings.fontSize);
  fontInput.addEventListener('input', () => {
    const value = Number(fontInput.value);
    fontValue.value = `${value} px`;
    updateSettings({ fontSize: value });
  });
  fontRow.append(fontLabel, fontValue, fontInput);

  const lineRow = document.createElement('label');
  lineRow.className = 'setting';
  const lineLabel = document.createElement('span');
  lineLabel.textContent = 'Line height';
  const lineValue = document.createElement('output');
  lineValue.value = settings.lineHeight.toFixed(1);
  const lineInput = document.createElement('input');
  lineInput.type = 'range';
  lineInput.min = '1.3';
  lineInput.max = '1.9';
  lineInput.step = '0.1';
  lineInput.value = String(settings.lineHeight);
  lineInput.addEventListener('input', () => {
    const value = Number(lineInput.value);
    lineValue.value = value.toFixed(1);
    updateSettings({ lineHeight: value });
  });
  lineRow.append(lineLabel, lineValue, lineInput);

  const themeRow = document.createElement('label');
  themeRow.className = 'setting setting-select';
  const themeLabel = document.createElement('span');
  themeLabel.textContent = 'Theme';
  const themeSelect = document.createElement('select');
  for (const theme of THEMES) {
    const option = document.createElement('option');
    option.value = theme.id;
    option.textContent = theme.label;
    option.selected = theme.id === settings.theme;
    themeSelect.append(option);
  }
  themeSelect.addEventListener('change', () => {
    const theme = THEMES.find((candidate) => candidate.id === themeSelect.value);
    if (theme) updateSettings({ theme: theme.id });
  });
  themeRow.append(themeLabel, themeSelect);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'settings-close';
  close.textContent = 'Done';

  let closing = false;
  const closeSettings = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    close.disabled = true;
    await flushSettings();
    dialog.close();
  };

  close.addEventListener('click', () => void closeSettings());

  dialog.append(heading, familyRow, fontRow, lineRow, themeRow, close);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    void closeSettings();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) void closeSettings();
  });
  document.body.append(dialog);
  dialog.showModal();
}

async function renderLibrary(error?: string): Promise<void> {
  clearPositionTimer();
  revokeImageUrls();
  book = null;
  chapter = null;
  renderedPairs = [];
  currentPairId = null;
  restoring = false;

  const screen = document.createElement('main');
  screen.className = 'library-screen';

  const header = document.createElement('header');
  header.className = 'library-header';
  const title = document.createElement('h1');
  title.textContent = 'DuoReader';
  const subtitle = document.createElement('p');
  subtitle.className = 'lede';
  subtitle.textContent = 'Your offline bilingual library.';
  const buildTag = document.createElement('p');
  buildTag.className = 'build-tag';
  buildTag.textContent = formatBuildTag(BUILD_INFO);
  buildTag.dataset.version = BUILD_INFO.version;
  buildTag.dataset.build = String(BUILD_INFO.build);
  buildTag.dataset.commit = BUILD_INFO.commit;
  buildTag.dataset.dirty = String(BUILD_INFO.dirty);
  buildTag.title = [
    `DuoReader ${BUILD_INFO.version}`,
    `build ${BUILD_INFO.build}${BUILD_INFO.dirty ? ' (uncommitted changes)' : ''}`,
    `commit ${BUILD_INFO.commit}`,
  ].join(' · ');
  header.append(title, subtitle, buildTag);
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
  let positions = new Map<string, ReadingPosition>();
  let persistent = true;
  try {
    const [shelf, savedPositions] = await Promise.all([listBooks(), listPositions()]);
    books = shelf;
    positions = new Map(savedPositions.map((position) => [position.bookId, position]));
    persistent = await ensurePersistent();
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
      const saved = positions.get(item.id);
      const percent = saved ? Math.round(saved.progress * 100) : 0;
      const progress = document.createElement('div');
      progress.className = 'book-progress';
      const progressLabel = document.createElement('span');
      progressLabel.className = 'book-progress-label';
      progressLabel.textContent = saved ? `${percent}% read` : 'Not started';
      const progressTrack = document.createElement('span');
      progressTrack.className = 'book-progress-track';
      progressTrack.setAttribute('role', 'progressbar');
      progressTrack.setAttribute('aria-label', 'Reading progress');
      progressTrack.setAttribute('aria-valuemin', '0');
      progressTrack.setAttribute('aria-valuemax', '100');
      progressTrack.setAttribute('aria-valuenow', String(percent));
      progressTrack.setAttribute('aria-valuetext', progressLabel.textContent);
      const progressFill = document.createElement('span');
      progressFill.className = 'book-progress-fill';
      progressFill.style.width = `${percent}%`;
      progressTrack.append(progressFill);
      progress.append(progressLabel, progressTrack);
      const imported = document.createElement('p');
      imported.className = 'book-note';
      imported.textContent = `Imported ${formatImportDate(item.importedAt)}`;
      info.append(bookTitle, author, meta, progress, imported);

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

  if (!persistent && books.length > 0) {
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent =
      'This browser may clear stored books when space runs low. Keep your BePub ZIPs so you can import them again.';
    screen.append(note);
  }

  app.replaceChildren(screen);
}

function renderImporting(fileName: string): void {
  clearPositionTimer();
  revokeImageUrls();
  book = null;
  chapter = null;
  renderedPairs = [];
  currentPairId = null;
  restoring = false;

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
    await ensurePersistent();
    await saveBook(parsed);
    await openBook(parsed.id);
  } catch (error) {
    await renderLibrary(importError(error, 'Could not import this file.'));
  }
}

async function openBook(id: string): Promise<void> {
  clearPositionTimer();
  try {
    const [loaded, saved] = await Promise.all([
      loadBook(id),
      getPosition(id).catch(() => null),
    ]);
    if (!loaded) throw new Error('This book is no longer in the library.');
    if (loaded.chapters.length === 0) throw new Error('This book has no readable chapters.');

    book = loaded;
    const savedChapter = saved
      ? loaded.chapters.find((candidate) => candidate.index === saved.chapterIndex)
      : undefined;
    chapter = savedChapter ?? loaded.chapters[0];
    const restorePair = savedChapter && saved?.pairId ? saved.pairId : null;
    currentPairId = restorePair ?? firstPairId(chapter);
    restoring = Boolean(restorePair);

    renderReader({ eagerImages: Boolean(restorePair) });

    let fallback = false;
    if (restorePair) {
      await nextPaint();
      await decodeImages();
      if (book !== loaded || chapter !== savedChapter) return;
      const found = scrollToPair(restorePair);
      if (!found) {
        window.scrollTo({ top: 0 });
        currentPairId = firstPairId(chapter);
        fallback = true;
      }
    } else {
      window.scrollTo({ top: 0 });
      void persistPosition();
    }

    await nextPaint();
    if (book !== loaded) return;
    restoring = false;
    if (fallback) void persistPosition();
  } catch (error) {
    await renderLibrary(importError(error, 'Could not open this book.'));
  }
}

function openChapter(next: Chapter): void {
  clearPositionTimer();
  chapter = next;
  currentPairId = firstPairId(next);
  restoring = false;
  renderReader();
  window.scrollTo({ top: 0 });
  void persistPosition();
}

function clearPositionTimer(): void {
  if (positionTimer !== undefined) {
    window.clearTimeout(positionTimer);
    positionTimer = undefined;
  }
}

async function nextPaint(): Promise<void> {
  await new Promise<number>(requestAnimationFrame);
  await new Promise<number>(requestAnimationFrame);
}

async function decodeImages(): Promise<void> {
  await Promise.all(
    Array.from(document.images).map((image) => image.decode().catch(() => undefined)),
  );
}

function pairElement(pairId: string): HTMLElement | null {
  return renderedPairs.find((pair) => pair.dataset.pairId === pairId) ?? null;
}

function scrollToPair(pairId: string): boolean {
  const element = pairElement(pairId);
  if (!element) return false;
  const header = document.querySelector<HTMLElement>('.topbar');
  const offset = (header?.getBoundingClientRect().height ?? 0) + 8;
  const top = window.scrollY + element.getBoundingClientRect().top - offset;
  window.scrollTo({ top: Math.max(0, top) });
  currentPairId = pairId;
  return true;
}

function topPairId(): string | null {
  const header = document.querySelector<HTMLElement>('.topbar');
  const threshold = (header?.getBoundingClientRect().height ?? 0) + 4;
  let last: string | null = null;
  for (const pair of renderedPairs) {
    last = pair.dataset.pairId ?? null;
    if (pair.getBoundingClientRect().bottom > threshold) return last;
  }
  return last;
}

function handleScroll(): void {
  if (!book || !chapter || restoring || scrollFrame !== undefined) return;
  scrollFrame = window.requestAnimationFrame(() => {
    scrollFrame = undefined;
    if (!book || !chapter || restoring) return;
    const pairId = topPairId();
    if (pairId !== currentPairId) schedulePositionSave(pairId);
  });
}

function schedulePositionSave(pairId: string | null): void {
  currentPairId = pairId;
  if (restoring) return;
  clearPositionTimer();
  positionTimer = window.setTimeout(() => {
    positionTimer = undefined;
    void persistPosition();
  }, 400);
}

async function persistPosition(): Promise<void> {
  const activeBook = book;
  const activeChapter = chapter;
  if (!activeBook || !activeChapter || restoring) return;

  const position: ReadingPosition = {
    bookId: activeBook.id,
    chapterIndex: activeChapter.index,
    pairId: currentPairId,
    progress: progressAt(activeBook, activeChapter.index, currentPairId),
    updatedAt: Date.now(),
  };

  try {
    await savePosition(position);
  } catch (cause) {
    console.warn('Could not save the reading position.', cause);
  }
}

async function flushPosition(): Promise<void> {
  clearPositionTimer();
  await persistPosition();
}

async function leaveReader(): Promise<void> {
  await flushPosition();
  await renderLibrary();
}

function renderReader(options: { eagerImages?: boolean } = {}): void {
  if (!book || !chapter) return;
  revokeImageUrls();
  renderedPairs = [];

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

  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.className = 'settings-button';
  settingsButton.textContent = 'Aa';
  settingsButton.setAttribute('aria-label', 'Reading settings');
  settingsButton.addEventListener('click', openSettings);

  const library = document.createElement('button');
  library.type = 'button';
  library.className = 'secondary';
  library.textContent = 'Library';
  library.setAttribute('aria-label', 'Back to library');
  library.addEventListener('click', () => void leaveReader());

  controls.append(select, settingsButton, library);
  const bar = document.createElement('div');
  bar.className = 'topbar-inner';
  bar.append(heading, controls);
  header.append(bar);

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
        renderedPairs.push(pairElement);
      }
    } else if (block.type === 'image') {
      const image = book.images[block.imageId];
      if (!image) continue;
      const figure = document.createElement('figure');
      const element = document.createElement('img');
      const url = URL.createObjectURL(image.blob);
      imageUrls.push(url);
      element.alt = block.alt;
      element.loading = options.eagerImages ? 'eager' : 'lazy';
      element.decoding = 'async';
      element.src = url;
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

async function boot(): Promise<void> {
  try {
    settings = await loadSettings();
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
  applySettings();

  window.addEventListener('scroll', handleScroll, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flushPosition();
      void flushSettings();
    }
  });
  window.addEventListener('pagehide', () => {
    void flushPosition();
    void flushSettings();
  });

  await renderLibrary();
}

function showUpdateToast(applyUpdate: () => Promise<void>): void {
  if (document.querySelector('.update-toast')) return;

  const toast = document.createElement('div');
  toast.className = 'update-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  const message = document.createElement('p');
  message.textContent = 'A new version of DuoReader is ready.';

  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = 'Reload';
  reload.addEventListener('click', async () => {
    reload.disabled = true;
    reload.textContent = 'Reloading…';
    try {
      await applyUpdate();
    } catch (cause) {
      console.warn('Could not apply the app update.', cause);
      reload.disabled = false;
      reload.textContent = 'Reload';
    }
  });

  toast.append(message, reload);
  document.body.append(toast);
}

registerSW({
  immediate: true,
  onNeedReload() {
    showUpdateToast(async () => {
      await Promise.all([flushPosition(), flushSettings()]);
      window.location.reload();
    });
  },
  onRegisterError(cause) {
    console.warn('Could not register the service worker.', cause);
  },
});

void boot();
