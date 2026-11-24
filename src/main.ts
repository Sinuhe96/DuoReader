import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import { BUILD_INFO, formatBuildTag } from './build-info';
import { fontStack, READER_FONTS } from './reader/fonts';
import { markTextRange } from './reader/marks';
import { parseBePubZip } from './reader/parse';
import { blockParagraph, paragraphPinyin, type PairRange } from './reader/paragraph';
import { firstPairId, progressAt, textPairId } from './reader/position';
import { glossAt, pairTextMap, wordAt } from './reader/words';
import {
  DEFAULT_SETTINGS,
  DISPLAY_MODES,
  LANGUAGE_MODES,
  LANGUAGE_ORDERS,
  normalizeSettings,
  PINYIN_MODES,
  resolveTheme,
  THEMES,
  THEME_COLORS,
  THEME_HINT_KEY,
} from './reader/settings';
import {
  ImportError,
  type Annotation,
  type AnnotationKind,
  type Book,
  type Chapter,
  type InlineRun,
  type InlineStyle,
  type Pair,
  type ReaderSettings,
  type ReadingPosition,
  type VocabularyEntry,
} from './reader/types';
import {
  deleteAnnotation,
  deleteBook,
  ensurePersistent,
  findVocabularyEntry,
  getPosition,
  listChapterAnnotations,
  listBooks,
  listPositions,
  loadBook,
  loadSettings,
  saveAnnotation,
  saveBook,
  savePosition,
  saveSettings,
  saveVocabularyEntry,
  type LibraryBook,
} from './storage/library';

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) throw new Error('Missing #app element.');
const app: HTMLDivElement = appRoot;

/**
 * The app is a scroll pane, not the document: the viewport is fixed and
 * `#app` scrolls. That is what makes a modal sheet safe — a top-layer
 * `<dialog>`'s scroll ancestor is the viewport, and the viewport cannot move,
 * so a gesture on the sheet can never reach the story behind it. Every scroll
 * in the app goes through these three helpers; nothing may touch
 * `window.scrollY` or `window.scrollTo` directly.
 */
function scrollTop(): number {
  return app.scrollTop;
}

function scrollTo(top: number): void {
  app.scrollTop = Math.max(0, top);
}

let book: Book | null = null;
let chapter: Chapter | null = null;
let imageUrls: string[] = [];
let renderedBlocks: HTMLElement[] = [];
let settings: ReaderSettings = { ...DEFAULT_SETTINGS };
let settingsSaveTimer: number | undefined;
let settingsSave: Promise<void> = Promise.resolve();
let settingsDirty = false;
let currentPairId: string | null = null;
let positionTimer: number | undefined;
let scrollFrame: number | undefined;
let restoring = false;
let annotations: Annotation[] = [];
let annotationsByPair = new Map<string, Annotation[]>();
let annotationsDirty = false;
let pairsById = new Map<string, Pair>();
let paragraphRanges = new WeakMap<HTMLElement, PairRange[]>();
let tapOrigin: { x: number; y: number; at: number } | null = null;
let learningOpening = false;

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

const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');

function applySettings(): void {
  const root = document.documentElement;
  const palette = resolveTheme(settings.theme, darkScheme.matches);
  root.dataset.theme = palette;
  root.dataset.display = settings.displayMode;
  root.dataset.languages = settings.languages;
  root.dataset.order = settings.languageOrder;
  root.style.setProperty('--reader-size', `${settings.fontSize}px`);
  root.style.setProperty('--reader-line-height', String(settings.lineHeight));
  root.style.setProperty('--reader-font', fontStack(settings.fontFamily));
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLORS[palette]);
  try {
    localStorage.setItem(THEME_HINT_KEY, palette);
  } catch {
    // Storage blocked: the boot shim falls back to the OS preference.
  }
}

darkScheme.addEventListener('change', () => {
  if (settings.theme === 'system') applySettings();
});

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

/**
 * A modal sheet owns the gesture, and the safety is structural rather than
 * event-based: the viewport cannot scroll (`html` is fixed) and the story lives
 * in `#app`, a scroll pane that is not an ancestor of the dialog, so a gesture
 * on the sheet has no chain that reaches the story.
 *
 * This listener therefore only keeps the sheet's own behaviour sane. A
 * `touchmove` that starts on a control is never cancelled, so a range slider
 * keeps the gesture and follows the finger from anywhere on its track. A
 * `touchmove` that starts on a box inside the sheet which can scroll — the
 * sheet itself when it overflows, the chapter list — is left alone too, so the
 * sheet still scrolls. Everything else on the sheet's surface is cancelled:
 * a drag there is neither a page pan nor a text selection.
 */
function sheetGestureGuard(): void {
  document.addEventListener(
    'touchmove',
    (event) => {
      if (!document.querySelector('dialog[open]')) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target && sheetOwnsGesture(target)) return;
      event.preventDefault();
    },
    { passive: false },
  );
}

/**
 * Whether the gesture belongs to the sheet: a control that drags itself, or a
 * box inside the sheet that can scroll.
 */
function sheetOwnsGesture(target: Element): boolean {
  for (
    let node: Element | null = target;
    node && node !== document.body;
    node = node.parentElement
  ) {
    if (node.matches('input, select, textarea, button')) return true;
    const style = window.getComputedStyle(node);
    if (
      (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
      node.scrollHeight - node.clientHeight > 1
    ) {
      return true;
    }
  }
  return false;
}

interface ChoiceRow<T extends string> {
  /** Group id, also the prefix of the label id. */
  id: string;
  label: string;
  options: readonly { id: T; label: string }[];
  current: T;
  apply: (id: T) => void;
}

/**
 * One choice row as segmented buttons, never a native `<select>`.
 *
 * The sheet used six `<select>`s until 0.12.6. Inside a modal sheet on iOS 26
 * the native picker took about a second to finish presenting (its shadow
 * arrived late), and the first tap on a control sometimes opened the picker and
 * closed it again. Both are the platform picker's, not the page's: a sheet that
 * owns its controls is one plain click, with no presentation to wait for.
 */
function choiceRow<T extends string>(row: ChoiceRow<T>): HTMLElement {
  const element = document.createElement('div');
  element.className = 'setting-choice';
  const name = document.createElement('span');
  name.className = 'setting-name';
  name.id = `${row.id}-label`;
  name.textContent = row.label;

  const group = document.createElement('div');
  group.className = 'segmented';
  group.id = row.id;
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', name.id);

  for (const option of row.options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'segment';
    button.dataset.value = option.id;
    button.textContent = option.label;
    button.setAttribute('aria-pressed', String(option.id === row.current));
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-pressed') === 'true') return;
      for (const other of Array.from(group.children)) {
        other.setAttribute('aria-pressed', String(other === button));
      }
      row.apply(option.id);
    });
    group.append(button);
  }

  element.append(name, group);
  return element;
}

/**
 * Paint the track up to the thumb. The sheet's sliders are custom-drawn (a
 * 28 px knob, iOS-sized), so `accent-color` no longer supplies the fill.
 */
function rangeFill(input: HTMLInputElement): void {
  const min = Number(input.min);
  const max = Number(input.max);
  const ratio = max > min ? (Number(input.value) - min) / (max - min) : 0;
  input.style.setProperty('--fill', `${Math.min(1, Math.max(0, ratio)) * 100}%`);
}

function openSettings(): void {
  if (document.querySelector('.settings-dialog[open]')) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'settings-dialog';
  dialog.setAttribute('aria-labelledby', 'settings-title');

  const heading = document.createElement('h2');
  heading.id = 'settings-title';
  heading.textContent = 'Reading settings';
  // `showModal` would land on the first control — now a segment button — so
  // start on the heading: the thumb is not on a choice it did not make.
  heading.tabIndex = -1;

  const displayRow = choiceRow({
    id: 'settings-display',
    label: 'Display',
    options: DISPLAY_MODES,
    current: settings.displayMode,
    apply: (id) => {
      updateSettings({ displayMode: id });
      rerenderReader();
      void flushSettings();
    },
  });

  const languagesRow = choiceRow({
    id: 'settings-languages',
    label: 'Languages',
    options: LANGUAGE_MODES,
    current: settings.languages,
    apply: (id) => {
      updateSettings({ languages: id });
      rerenderReader();
      void flushSettings();
    },
  });

  const orderRow = choiceRow({
    id: 'settings-order',
    label: 'Order',
    options: LANGUAGE_ORDERS,
    current: settings.languageOrder,
    apply: (id) => {
      updateSettings({ languageOrder: id });
      rerenderReader();
      void flushSettings();
    },
  });

  const pinyinRow = choiceRow({
    id: 'settings-pinyin',
    label: 'Pinyin',
    options: PINYIN_MODES,
    current: settings.pinyin,
    apply: (id) => {
      updateSettings({ pinyin: id });
      rerenderReader();
      void flushSettings();
    },
  });

  /* The font row is a disclosure, not a palette of chips: Apple Books shows
     `Font  Iowan ›` and pushes a list, which keeps the sheet short enough to
     fit a phone. The list is a second panel of this same dialog — plain
     buttons, no native picker — so one tap swaps the body and nothing waits
     on the platform. */
  const fontRow = document.createElement('button');
  fontRow.type = 'button';
  fontRow.className = 'setting-disclosure';
  fontRow.id = 'settings-font';
  const fontRowName = document.createElement('span');
  fontRowName.className = 'setting-disclosure-name';
  fontRowName.textContent = 'Font';
  const fontValue = document.createElement('span');
  fontValue.className = 'setting-disclosure-value';
  fontValue.id = 'settings-font-value';
  fontValue.textContent =
    READER_FONTS.find((font) => font.id === settings.fontFamily)?.label ?? settings.fontFamily;
  const chevron = document.createElement('span');
  chevron.className = 'setting-chevron';
  chevron.textContent = '›';
  chevron.setAttribute('aria-hidden', 'true');
  fontRow.append(fontRowName, fontValue, chevron);

  const mainPanel = document.createElement('section');
  mainPanel.className = 'sheet-panel';
  mainPanel.append(heading, displayRow, languagesRow, orderRow, pinyinRow, fontRow);

  const fontPanel = document.createElement('section');
  fontPanel.className = 'sheet-panel';
  fontPanel.id = 'settings-font-panel';
  fontPanel.hidden = true;

  const fontBack = document.createElement('button');
  fontBack.type = 'button';
  fontBack.className = 'sheet-back';
  fontBack.textContent = '‹ Reading settings';

  const fontHeading = document.createElement('h2');
  fontHeading.id = 'settings-font-title';
  fontHeading.textContent = 'Font';
  fontHeading.tabIndex = -1;

  const fontList = document.createElement('div');
  fontList.className = 'font-list';
  fontList.id = 'settings-font-list';
  fontList.setAttribute('role', 'group');
  fontList.setAttribute('aria-labelledby', 'settings-font-title');

  for (const font of READER_FONTS) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'font-option';
    option.dataset.value = font.id;
    option.textContent = font.label;
    option.style.fontFamily = font.stack;
    option.setAttribute('aria-pressed', String(font.id === settings.fontFamily));
    option.addEventListener('click', () => {
      if (option.getAttribute('aria-pressed') !== 'true') {
        for (const other of Array.from(fontList.children)) {
          other.setAttribute('aria-pressed', String(other === option));
        }
        updateSettings({ fontFamily: font.id });
        fontValue.textContent = font.label;
      }
      showPanel(false);
    });
    fontList.append(option);
  }

  fontPanel.append(fontBack, fontHeading, fontList);

  const showPanel = (font: boolean): void => {
    mainPanel.hidden = font;
    fontPanel.hidden = !font;
    dialog.setAttribute('aria-labelledby', font ? 'settings-font-title' : 'settings-title');
    (font ? fontHeading : heading).focus();
  };
  fontRow.addEventListener('click', () => showPanel(true));
  fontBack.addEventListener('click', () => showPanel(false));

  const sizeRow = document.createElement('label');
  sizeRow.className = 'setting';
  const sizeLabel = document.createElement('span');
  sizeLabel.textContent = 'Text size';
  const sizeValue = document.createElement('output');
  sizeValue.value = `${settings.fontSize} px`;
  const sizeInput = document.createElement('input');
  sizeInput.type = 'range';
  sizeInput.min = '16';
  sizeInput.max = '24';
  sizeInput.step = '1';
  sizeInput.value = String(settings.fontSize);
  rangeFill(sizeInput);
  sizeInput.addEventListener('input', () => {
    const value = Number(sizeInput.value);
    sizeValue.value = `${value} px`;
    rangeFill(sizeInput);
    updateSettings({ fontSize: value });
  });
  sizeRow.append(sizeLabel, sizeValue, sizeInput);
  mainPanel.append(sizeRow);

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
  rangeFill(lineInput);
  lineInput.addEventListener('input', () => {
    const value = Number(lineInput.value);
    lineValue.value = value.toFixed(1);
    rangeFill(lineInput);
    updateSettings({ lineHeight: value });
  });
  lineRow.append(lineLabel, lineValue, lineInput);
  mainPanel.append(lineRow);

  const themeRow = choiceRow({
    id: 'settings-theme',
    label: 'Theme',
    options: THEMES,
    current: settings.theme,
    apply: (id) => {
      updateSettings({ theme: id });
      void flushSettings();
    },
  });
  mainPanel.append(themeRow);

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

  dialog.append(mainPanel, fontPanel, close);
  dialog.addEventListener('close', () => {
    dialog.remove();
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    void closeSettings();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) void closeSettings();
  });
  document.body.append(dialog);
  dialog.showModal();
  heading.focus();
}

function openChapters(): void {
  if (!book || document.querySelector('.chapters-dialog[open]')) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'settings-dialog chapters-dialog';
  dialog.setAttribute('aria-labelledby', 'chapters-title');

  const heading = document.createElement('h2');
  heading.id = 'chapters-title';
  heading.textContent = 'Chapters';
  heading.tabIndex = -1;

  const list = document.createElement('div');
  list.className = 'chapter-list';
  for (const candidate of book.chapters) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'chapter-item';
    const current = candidate.index === chapter?.index;
    if (current) {
      item.classList.add('current');
      item.setAttribute('aria-current', 'true');
    }
    const name = document.createElement('span');
    name.textContent = candidate.label;
    item.append(name);
    item.addEventListener('click', () => {
      dialog.close();
      const next = book?.chapters.find((entry) => entry.index === candidate.index);
      if (next) void openChapter(next);
    });
    list.append(item);
  }

  dialog.append(heading, list);
  dialog.addEventListener('close', () => {
    dialog.remove();
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dialog.close();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
  heading.focus();
  list.querySelector('.current')?.scrollIntoView({ block: 'center' });
}

async function renderLibrary(error?: string): Promise<void> {
  clearPositionTimer();
  revokeImageUrls();
  book = null;
  chapter = null;
  renderedBlocks = [];
  currentPairId = null;
  restoring = false;
  annotations = [];
  annotationsByPair = new Map();
  annotationsDirty = false;
  pairsById = new Map();
  paragraphRanges = new WeakMap();
  tapOrigin = null;

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
  renderedBlocks = [];
  currentPairId = null;
  restoring = false;
  annotations = [];
  annotationsByPair = new Map();
  annotationsDirty = false;
  pairsById = new Map();
  paragraphRanges = new WeakMap();
  tapOrigin = null;

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
    // The stored chapter index can shift when a re-import merges a continuation
    // split; the pair id survives that, so it picks the chapter first.
    const pairOwner = saved?.pairId
      ? loaded.chapters.find((candidate) =>
          candidate.blocks.some(
            (block) =>
              block.type === 'pairs' &&
              block.pairs.some((pair) => pair.id === saved.pairId),
          ),
        )
      : undefined;
    const savedChapter =
      pairOwner ??
      (saved
        ? loaded.chapters.find((candidate) => candidate.index === saved.chapterIndex)
        : undefined);
    chapter = savedChapter ?? loaded.chapters[0];
    // Only the rendered chapter's marks are needed, so a book with thousands
    // of notes elsewhere pays nothing for them on open.
    annotations = await listChapterAnnotations(id, chapter.index);
    annotationsDirty = false;
    indexAnnotations();
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
        scrollTo(0);
        currentPairId = firstPairId(chapter);
        fallback = true;
      }
    } else {
      scrollTo(0);
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

async function openChapter(next: Chapter): Promise<void> {
  if (!book || !chapter) return;
  const activeBook = book;
  const previous = chapter;
  clearPositionTimer();
  let stored: Annotation[];
  try {
    stored = await listChapterAnnotations(activeBook.id, next.index);
  } catch (cause) {
    console.warn('Could not load this chapter’s notes.', cause);
    stored = [];
  }
  if (book !== activeBook || chapter !== previous) return;
  chapter = next;
  annotations = stored;
  annotationsDirty = false;
  indexAnnotations();
  currentPairId = firstPairId(next);
  restoring = false;
  renderReader();
  scrollTo(0);
  void persistPosition();
}

function rerenderReader(): void {
  if (!book || !chapter) return;
  const activeBook = book;
  const activeChapter = chapter;
  const anchor = currentPairId ?? topPairId();
  restoring = true;
  renderReader({ eagerImages: true });
  if (!anchor) {
    restoring = false;
    return;
  }
  void (async () => {
    await nextPaint();
    await decodeImages();
    if (book === activeBook && chapter === activeChapter) scrollToPair(anchor);
    restoring = false;
  })();
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
  const exact = renderedBlocks.find((block) => block.dataset.pairId === pairId);
  if (exact) return exact;
  // Paragraph mode renders one element per block; fall back to the block id.
  const bid = pairId.split(':')[0];
  if (!bid) return null;
  return renderedBlocks.find((block) => block.dataset.bid === bid) ?? null;
}

function scrollToPair(pairId: string): boolean {
  const element = pairElement(pairId);
  if (!element) return false;
  const header = document.querySelector<HTMLElement>('.topbar');
  const offset = (header?.getBoundingClientRect().height ?? 0) + 8;
  const top = scrollTop() + element.getBoundingClientRect().top - offset;
  scrollTo(top);
  currentPairId = pairId;
  return true;
}

function topPairId(): string | null {
  const header = document.querySelector<HTMLElement>('.topbar');
  const threshold = (header?.getBoundingClientRect().height ?? 0) + 4;
  let last: string | null = null;
  for (const pair of renderedBlocks) {
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

const RUN_ELEMENTS: Record<InlineStyle, 'em' | 'strong'> = { em: 'em', strong: 'strong' };

/** Builds text nodes only: the parser's whitelist is the only source of elements. */
function appendRuns(
  parent: HTMLElement,
  runs: InlineRun[] | undefined,
  fallback: string,
): void {
  if (!runs || runs.length === 0) {
    if (fallback) parent.append(document.createTextNode(fallback));
    return;
  }
  for (const run of runs) {
    if (run.break) {
      parent.append(document.createElement('br'));
      continue;
    }
    if (!run.style) {
      parent.append(document.createTextNode(run.text));
      continue;
    }
    const element = document.createElement(RUN_ELEMENTS[run.style]);
    element.textContent = run.text;
    parent.append(element);
  }
}

function languageParagraph(lang: string, className: 'src' | 'tgt'): HTMLParagraphElement {
  const element = document.createElement('p');
  element.className = className;
  element.lang = lang;
  return element;
}

/**
 * Pinyin rides inside the source paragraph, so language order, the language
 * mode, and the paragraph grid all treat it as part of the source line.
 */
function appendPinyin(source: HTMLElement, pinyin: string | undefined): void {
  if (settings.pinyin !== 'sentence' || !pinyin) return;
  const element = document.createElement('span');
  element.className = 'pinyin';
  element.lang = 'zh-Latn';
  element.textContent = pinyin;
  source.prepend(element);
}

/** Applies the language mode and order, then appends whichever languages exist. */
function appendLanguages(
  container: HTMLElement,
  source: HTMLElement,
  target: HTMLElement | null,
): void {
  const sourceVisible = settings.languages !== 'target';
  const targetVisible = settings.languages !== 'source' && target !== null;
  if (settings.languageOrder === 'target-first') {
    if (target && targetVisible) container.append(target);
    if (sourceVisible) container.append(source);
  } else {
    if (sourceVisible) container.append(source);
    if (target && targetVisible) container.append(target);
  }
}

/** Groups the open book's annotations by pair; rebuilt on every write. */
function indexAnnotations(): void {
  annotationsByPair = new Map();
  for (const annotation of annotations) {
    const list = annotationsByPair.get(annotation.pairId);
    if (list) list.push(annotation);
    else annotationsByPair.set(annotation.pairId, [annotation]);
  }
}

/**
 * One class per annotation. `text` is the drift check for a ranged mark: a
 * stored slice that no longer matches the edition is skipped, never painted on
 * other words. Sentence marks cover both lines; a word marks only its side.
 */
function markClass(annotation: Annotation): string | null {
  if (annotation.kind === 'word') return 'reader-mark reader-word';
  if (annotation.kind === 'sentence' || annotation.kind === 'passage') {
    return 'reader-mark reader-highlight';
  }
  if (annotation.kind === 'note' && annotation.note?.trim()) {
    return 'reader-mark reader-note';
  }
  return null;
}

/**
 * Paints a pair's annotations inside one rendered line. `lineStart` is the
 * pair's DOM offset when the line is a joined paragraph; it is 0 in sentence
 * mode. Full-line marks are painted for both languages, word marks only on the
 * side that was captured.
 */
function paintLineMarks(
  line: HTMLElement,
  pair: Pair,
  side: 'source' | 'target',
  lineStart = 0,
): void {
  const list = annotationsByPair.get(pair.id);
  if (!list) return;
  const text = side === 'source' ? pair.source : pair.target;
  if (!text) return;
  const map = pairTextMap(
    text,
    side === 'source' ? pair.sourceRuns : pair.targetRuns,
  );
  const fullEnd = lineStart + map.toDom(text.length);

  for (const annotation of list) {
    if (annotation.kind === 'word') continue;
    const className = markClass(annotation);
    if (!className) continue;
    if (
      annotation.side === side &&
      text.slice(annotation.start, annotation.end) !== annotation.text
    ) {
      continue;
    }
    markTextRange(line, lineStart, fullEnd, className);
  }

  for (const annotation of list) {
    if (annotation.kind !== 'word' || annotation.side !== side) continue;
    if (text.slice(annotation.start, annotation.end) !== annotation.text) continue;
    const className = markClass(annotation);
    if (!className) continue;
    const marks = markTextRange(
      line,
      lineStart + map.toDom(annotation.start),
      lineStart + map.toDom(annotation.end),
      className,
    );
    for (const mark of marks) mark.dataset.annotationId = annotation.id;
  }
}

/** Sentence mode: the pair is the line, so the whole text of both sides is marked. */
function paintPairMarks(element: HTMLElement, pair: Pair): void {
  const source = element.querySelector<HTMLElement>(':scope > .src');
  const target = element.querySelector<HTMLElement>(':scope > .tgt');
  if (source) paintLineMarks(source, pair, 'source');
  if (target) paintLineMarks(target, pair, 'target');
}

/** A text-only block is its own "pair"; the whole block is the annotated unit. */
function paintTextMarks(paragraph: HTMLElement, pair: Pair): void {
  paintLineMarks(paragraph, pair, 'source');
}

/** Paragraph mode: the pair is a slice of the joined line, at its stored range. */
function paintParagraphMarks(
  element: HTMLElement,
  ranges: PairRange[],
): void {
  const source = element.querySelector<HTMLElement>(':scope > .src');
  const target = element.querySelector<HTMLElement>(':scope > .tgt');
  for (const range of ranges) {
    const pair = pairsById.get(range.pairId);
    if (!pair) continue;
    if (source) paintLineMarks(source, pair, 'source', range.source.start);
    if (target && range.target) {
      paintLineMarks(target, pair, 'target', range.target.start);
    }
  }
}

/**
 * A caret at the tap point, as a DOM-text offset inside one line. WebKit calls
 * the first API, Gecko the second; both ignore the pinyin line, which is not
 * part of any pair's sentence.
 */
function caretOffset(line: HTMLElement, x: number, y: number): number | null {
  const fallback = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };
  let node: Node | null = null;
  let offset = 0;
  const range = document.caretRangeFromPoint(x, y);
  if (range) {
    node = range.startContainer;
    offset = range.startOffset;
  } else {
    const position = fallback.caretPositionFromPoint?.(x, y);
    if (position) {
      node = position.offsetNode;
      offset = position.offset;
    }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const text = node as Text;
  if (!line.contains(text) || text.parentElement?.closest('.pinyin')) return null;

  let total = 0;
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    const candidate = current as Text;
    if (candidate.parentElement?.closest('.pinyin')) continue;
    if (candidate === text) return total + offset;
    total += candidate.data.length;
  }
  return null;
}

interface WordTarget {
  side: 'source' | 'target';
  start: number;
  end: number;
  text: string;
}

interface TapTarget {
  pair: Pair;
  side: 'source' | 'target';
  passage: boolean;
  word: WordTarget | null;
}

function pairAt(line: HTMLElement): Pair | null {
  const pairElement = line.closest<HTMLElement>('.pair');
  if (pairElement?.dataset.pairId) {
    return pairsById.get(pairElement.dataset.pairId) ?? null;
  }
  const textBlock = line.closest<HTMLElement>('.text-only[data-pair-id]');
  if (textBlock?.dataset.pairId) {
    return pairsById.get(textBlock.dataset.pairId) ?? null;
  }
  return null;
}

/** Which pair sits under the tap, with the caret's pair offset and its word. */
function tapTargetAt(line: HTMLElement, x: number, y: number): TapTarget | null {
  if (!book) return null;
  const offset = caretOffset(line, x, y);
  if (offset === null) return null;

  const textBlock = line.closest<HTMLElement>('.text-only[data-pair-id]');
  if (textBlock?.dataset.pairId) {
    const pair = pairsById.get(textBlock.dataset.pairId);
    if (!pair) return null;
    const pairOffset = pairTextMap(pair.source, pair.sourceRuns).toPair(offset);
    const word = wordAt(pair.source, pairOffset, book.sourceLang);
    return {
      pair,
      side: 'source',
      passage: true,
      word: word ? { side: 'source', ...word } : null,
    };
  }

  const pairElement = line.closest<HTMLElement>('.pair');
  if (pairElement?.dataset.pairId) {
    const pair = pairsById.get(pairElement.dataset.pairId);
    if (!pair) return null;
    const side: 'source' | 'target' = line.classList.contains('src') ? 'source' : 'target';
    const text = side === 'source' ? pair.source : pair.target;
    const runs = side === 'source' ? pair.sourceRuns : pair.targetRuns;
    const pairOffset = pairTextMap(text, runs).toPair(offset);
    const language = side === 'source' ? book.sourceLang : book.targetLang;
    const word = wordAt(text, pairOffset, language);
    return {
      pair,
      side,
      passage: false,
      word: word ? { side, ...word } : null,
    };
  }

  const paragraph = line.closest<HTMLElement>('.paragraph');
  const ranges = paragraph ? paragraphRanges.get(paragraph) : undefined;
  if (!ranges) return null;
  const side: 'source' | 'target' = line.classList.contains('src') ? 'source' : 'target';
  const language = side === 'source' ? book.sourceLang : book.targetLang;
  for (const range of ranges) {
    const slice = side === 'source' ? range.source : range.target;
    if (!slice || offset < slice.start || offset > slice.end) continue;
    const pair = pairsById.get(range.pairId);
    if (!pair) return null;
    const text = side === 'source' ? pair.source : pair.target;
    const runs = side === 'source' ? pair.sourceRuns : pair.targetRuns;
    const localOffset = offset - slice.start;
    const pairOffset = pairTextMap(text, runs).toPair(localOffset);
    const word = wordAt(text, pairOffset, language);
    return {
      pair,
      side,
      passage: false,
      word: word ? { side, ...word } : null,
    };
  }
  return null;
}

/**
 * A tap is ours; a long-press or drag belongs to the platform. Selection is
 * the giveaway: while the system menu has a range, the app stays out of it.
 */
function handleReaderTap(event: MouseEvent, reader: HTMLElement): void {
  const selection = document.getSelection();
  if (selection && !selection.isCollapsed) return;
  if (event.detail === 0) return;
  const origin = tapOrigin;
  tapOrigin = null;
  if (
    origin &&
    (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 12 ||
      performance.now() - origin.at > 800)
  ) {
    return;
  }
  if (!book || !chapter) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest('.pinyin')) return;
  const line = target.closest<HTMLElement>('.src, .tgt, .text-only');
  if (!line || !reader.contains(line)) return;
  const passage = line.classList.contains('text-only');

  const wordMark = target.closest<HTMLElement>('mark[data-annotation-id]');
  if (wordMark?.dataset.annotationId) {
    const annotation = annotations.find(
      (candidate) => candidate.id === wordMark.dataset.annotationId,
    );
    const pair = annotation ? pairsById.get(annotation.pairId) : undefined;
    if (annotation?.kind === 'word' && pair) {
      void openLearning(pair, {
        passage,
        word: {
          side: annotation.side,
          start: annotation.start,
          end: annotation.end,
          text: annotation.text,
        },
      });
      return;
    }
  }

  const hit = tapTargetAt(line, event.clientX, event.clientY);
  if (hit) {
    void openLearning(hit.pair, {
      passage: hit.passage,
      ...(hit.word ? { word: hit.word } : {}),
    });
    return;
  }
  const pair = pairAt(line);
  if (pair) void openLearning(pair, { passage });
}

/**
 * The learning sheet. A word tap opens it on the Word segment: the word as the
 * title, a one-line context, an editable base form, the edition gloss, a word
 * highlight, and Save. The second segment keeps L0's sentence/passage
 * highlight, both languages, and the pair note, so a tap never loses the older
 * action and neither job scrolls past the other. A caret that yields no word
 * (punctuation, or no Intl.Segmenter) has only the sentence, so that sheet
 * gets no segments.
 *
 * The note is committed when the sheet closes (Done, Escape, backdrop), so one
 * write carries what the reader typed; Remove note deletes immediately and is
 * only reachable on the sentence segment. Marks repaint after close, never
 * under a thumb. Vocabulary is user state and is never written by an import.
 */
async function openLearning(
  pair: Pair,
  options: { passage?: boolean; word?: WordTarget } = {},
): Promise<void> {
  if (!book || !chapter) return;
  if (learningOpening || document.querySelector('.learning-dialog[open]')) return;
  const activeBook = book;
  const activeChapter = chapter;
  const passage = Boolean(options.passage);
  const word = options.word;
  const existing = annotationsByPair.get(pair.id) ?? [];
  const textOf = (annotation: Annotation): string =>
    annotation.side === 'source' ? pair.source : pair.target;
  const highlightKind: AnnotationKind = passage ? 'passage' : 'sentence';
  let highlight =
    existing.find(
      (annotation) => annotation.kind === highlightKind && annotation.text === textOf(annotation),
    ) ?? null;
  let note =
    existing.find(
      (annotation) => annotation.kind === 'note' && annotation.text === textOf(annotation),
    ) ?? null;
  let wordHighlight = word
    ? existing.find(
        (annotation) =>
          annotation.kind === 'word' &&
          annotation.side === word.side &&
          annotation.start === word.start &&
          annotation.end === word.end &&
          annotation.text === word.text,
      ) ?? null
    : null;
  const gloss = word
    ? glossAt(activeBook.glossary, pair.id, word.side, word.start, word.end, word.text)
    : undefined;
  let saved: VocabularyEntry | undefined;

  learningOpening = true;
  if (word) {
    try {
      saved = await findVocabularyEntry(
        activeBook.id,
        pair.id,
        word.side,
        word.start,
        word.end,
      );
    } catch (cause) {
      console.warn('Could not read the saved word.', cause);
    }
  }
  if (
    book !== activeBook ||
    chapter !== activeChapter ||
    document.querySelector('.learning-dialog[open]')
  ) {
    learningOpening = false;
    return;
  }
  learningOpening = false;

  const dialog = document.createElement('dialog');
  dialog.className = 'settings-dialog learning-dialog';
  dialog.setAttribute('aria-labelledby', 'learning-title');

  // A word tap titles the sheet with the word itself and splits its two jobs
  // into segments, Apple's segmented control: the word on the left, the
  // sentence it sits in on the right. A tap that resolves no word has only the
  // sentence, so it gets no segments and no word panel.
  const heading = document.createElement('h2');
  heading.id = 'learning-title';
  heading.tabIndex = -1;

  const sentenceLabel = passage ? 'Passage' : 'Sentence';
  const wordLang = word?.side === 'target' ? activeBook.targetLang : activeBook.sourceLang;
  if (word) {
    heading.classList.add('learning-title-word');
    heading.lang = wordLang;
    heading.textContent = word.text;
  } else {
    heading.textContent = sentenceLabel;
  }

  let activeTab: 'word' | 'sentence' = word ? 'word' : 'sentence';
  let wordTab: HTMLButtonElement | null = null;
  let sentenceTab: HTMLButtonElement | null = null;

  const tabs = document.createElement('div');
  tabs.className = 'learning-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Word and sentence');

  const makeTab = (id: string, label: string, controls: string): HTMLButtonElement => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'learning-tab';
    tab.id = id;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', controls);
    tab.textContent = label;
    tabs.append(tab);
    return tab;
  };

  const wordPanel = document.createElement('div');
  wordPanel.className = 'learning-panel';
  wordPanel.id = 'learning-panel-word';
  wordPanel.setAttribute('role', 'tabpanel');
  wordPanel.setAttribute('aria-labelledby', 'learning-tab-word');

  const sentencePanel = document.createElement('div');
  sentencePanel.className = 'learning-panel';
  sentencePanel.id = 'learning-panel-sentence';
  sentencePanel.setAttribute('role', 'tabpanel');
  sentencePanel.setAttribute('aria-labelledby', 'learning-tab-sentence');

  const quote = document.createElement('p');
  quote.className = 'learning-quote';
  quote.lang = activeBook.sourceLang;
  quote.textContent = pair.source;

  let baseInput: HTMLInputElement | null = null;
  let wordHighlightButton: HTMLButtonElement | null = null;
  let saveButton: HTMLButtonElement | null = null;
  if (word) {
    wordTab = makeTab('learning-tab-word', 'Word', wordPanel.id);
    sentenceTab = makeTab('learning-tab-sentence', sentenceLabel, sentencePanel.id);

    // The line the word sits in: the sentence tab carries both languages, this
    // one only the context the base form is judged against.
    const context = document.createElement('p');
    context.className = 'learning-context';
    context.lang = wordLang;
    context.textContent = word.side === 'target' ? pair.target : pair.source;
    wordPanel.append(context);

    const baseLabel = document.createElement('label');
    baseLabel.className = 'learning-base';
    const baseCaption = document.createElement('span');
    baseCaption.textContent = 'Base form';
    baseInput = document.createElement('input');
    baseInput.type = 'text';
    baseInput.maxLength = 80;
    baseInput.value = saved?.lemma ?? '';
    baseInput.placeholder = word.text;
    baseInput.autocomplete = 'off';
    baseInput.autocapitalize = 'off';
    baseInput.spellcheck = false;
    baseLabel.append(baseCaption, baseInput);
    wordPanel.append(baseLabel);

    if (gloss) {
      const glossLine = document.createElement('p');
      glossLine.className = 'learning-gloss';
      glossLine.lang =
        word.side === 'target' ? activeBook.targetLang : activeBook.sourceLang;
      const glossLabel = document.createElement('span');
      glossLabel.className = 'learning-gloss-label';
      glossLabel.textContent = 'Book gloss';
      const glossValue = document.createElement('span');
      const parts: string[] = [];
      if (gloss.pinyin) parts.push(gloss.pinyin);
      if (gloss.lemma && gloss.lemma !== word.text) parts.push(gloss.lemma);
      parts.push(gloss.gloss);
      glossValue.textContent = parts.join(' · ');
      glossLine.append(glossLabel, glossValue);
      wordPanel.append(glossLine);
    }

    const wordActions = document.createElement('div');
    wordActions.className = 'learning-actions';
    wordHighlightButton = document.createElement('button');
    wordHighlightButton.type = 'button';
    wordHighlightButton.className = 'learning-action';
    wordHighlightButton.textContent = 'Highlight word';
    wordHighlightButton.setAttribute(
      'aria-pressed',
      String(Boolean(wordHighlight)),
    );
    saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'learning-action learning-save';
    saveButton.textContent = 'Save';
    wordActions.append(wordHighlightButton, saveButton);
    wordPanel.append(wordActions);
  }

  sentencePanel.append(quote);
  if (pair.target) {
    const translation = document.createElement('p');
    translation.className = 'learning-quote learning-translation';
    translation.lang = activeBook.targetLang;
    translation.textContent = pair.target;
    sentencePanel.append(translation);
  }

  const actions = document.createElement('div');
  actions.className = 'learning-actions';
  const highlightButton = document.createElement('button');
  highlightButton.type = 'button';
  highlightButton.className = 'learning-action';
  highlightButton.textContent = `Highlight ${passage ? 'passage' : 'sentence'}`;
  highlightButton.setAttribute('aria-pressed', String(Boolean(highlight)));
  actions.append(highlightButton);
  sentencePanel.append(actions);

  const noteLabel = document.createElement('label');
  noteLabel.className = 'learning-note';
  noteLabel.textContent = 'Note';
  const textarea = document.createElement('textarea');
  textarea.rows = 4;
  textarea.maxLength = 500;
  textarea.placeholder = 'Add a note…';
  textarea.value = note?.note ?? '';
  noteLabel.append(textarea);
  sentencePanel.append(noteLabel);

  const status = document.createElement('p');
  status.className = 'learning-status';
  status.setAttribute('role', 'status');

  const showStatus = (text: string, tone: 'success' | 'error' | '' = ''): void => {
    status.textContent = text;
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  };
  if (saved) showStatus('Saved ✓', 'success');
  baseInput?.addEventListener('input', () => {
    if (status.dataset.tone === 'success') showStatus('');
  });

  const footer = document.createElement('div');
  footer.className = 'learning-footer';
  const removeNote = document.createElement('button');
  removeNote.type = 'button';
  removeNote.className = 'learning-remove';
  removeNote.textContent = 'Remove note';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'settings-close learning-done';
  done.textContent = 'Done';
  footer.append(removeNote, done);

  let storedNote = note?.note?.trim() ?? '';
  let busy = false;
  let closing = false;

  const refreshNoteControls = (): void => {
    removeNote.hidden = activeTab !== 'sentence' || !note;
  };

  const selectTab = (next: 'word' | 'sentence', moveFocus = true): void => {
    activeTab = next;
    wordPanel.hidden = next !== 'word';
    sentencePanel.hidden = next !== 'sentence';
    if (wordTab) {
      wordTab.setAttribute('aria-selected', String(next === 'word'));
      wordTab.tabIndex = next === 'word' ? 0 : -1;
    }
    if (sentenceTab) {
      sentenceTab.setAttribute('aria-selected', String(next === 'sentence'));
      sentenceTab.tabIndex = next === 'sentence' ? 0 : -1;
    }
    refreshNoteControls();
    if (moveFocus) (next === 'word' ? wordTab : sentenceTab)?.focus();
  };

  dialog.append(heading);
  if (word) dialog.append(tabs, wordPanel, sentencePanel);
  else dialog.append(sentencePanel);
  dialog.append(status, footer);
  selectTab(activeTab, false);

  const newId = (prefix: string): string =>
    globalThis.crypto?.randomUUID?.() ??
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  const newAnnotation = (kind: AnnotationKind, range?: WordTarget): Annotation => {
    const side = range?.side ?? (pair.source ? 'source' : 'target');
    const text = range?.text ?? (side === 'source' ? pair.source : pair.target);
    const now = Date.now();
    return {
      id: newId('annotation'),
      bookId: activeBook.id,
      chapterIndex: activeChapter.index,
      pairId: pair.id,
      side,
      start: range?.start ?? 0,
      end: range?.end ?? text.length,
      text,
      kind,
      color: 'yellow',
      createdAt: now,
      updatedAt: now,
    };
  };

  const toggleHighlight = async (): Promise<void> => {
    if (busy) return;
    busy = true;
    highlightButton.disabled = true;
    showStatus('');
    try {
      if (highlight) {
        const id = highlight.id;
        await deleteAnnotation(id);
        annotations = annotations.filter((entry) => entry.id !== id);
        highlight = null;
      } else {
        const annotation = newAnnotation(highlightKind);
        await saveAnnotation(annotation);
        annotations = [...annotations, annotation];
        highlight = annotation;
      }
      indexAnnotations();
      annotationsDirty = true;
      highlightButton.setAttribute('aria-pressed', String(Boolean(highlight)));
    } catch (cause) {
      console.warn('Could not save the highlight.', cause);
      showStatus('Could not save the highlight.', 'error');
    } finally {
      busy = false;
      highlightButton.disabled = false;
    }
  };

  const toggleWordHighlight = async (): Promise<void> => {
    const target = word;
    const button = wordHighlightButton;
    if (!target || !button || busy) return;
    busy = true;
    button.disabled = true;
    showStatus('');
    try {
      if (wordHighlight) {
        const id = wordHighlight.id;
        await deleteAnnotation(id);
        annotations = annotations.filter((entry) => entry.id !== id);
        wordHighlight = null;
      } else {
        const annotation = newAnnotation('word', target);
        await saveAnnotation(annotation);
        annotations = [...annotations, annotation];
        wordHighlight = annotation;
      }
      indexAnnotations();
      annotationsDirty = true;
      button.setAttribute('aria-pressed', String(Boolean(wordHighlight)));
    } catch (cause) {
      console.warn('Could not save the word highlight.', cause);
      showStatus('Could not save the word highlight.', 'error');
    } finally {
      busy = false;
      button.disabled = false;
    }
  };

  const saveWord = async (): Promise<void> => {
    const target = word;
    const input = baseInput;
    const button = saveButton;
    if (!target || !input || !button || busy) return;
    busy = true;
    button.disabled = true;
    showStatus('');
    try {
      const base = input.value.trim().slice(0, 80);
      const existingEntry = saved;
      const record: VocabularyEntry = existingEntry
        ? { ...existingEntry }
        : {
            id: newId('word'),
            bookId: activeBook.id,
            bookTitle: activeBook.title,
            chapterLabel: activeChapter.label,
            pairId: pair.id,
            side: target.side,
            start: target.start,
            end: target.end,
            term: target.text,
            surface: target.text,
            context: pair.source,
            translation: pair.target,
            entry: '',
            status: 'new',
            tags: [],
            createdAt: Date.now(),
          };

      record.bookTitle = activeBook.title;
      record.chapterLabel = activeChapter.label;
      record.pairId = pair.id;
      record.side = target.side;
      record.start = target.start;
      record.end = target.end;
      record.surface = target.text;
      record.context = pair.source;
      record.translation = pair.target;
      record.term = base || target.text;
      if (base) {
        record.lemma = base;
        record.lemmaSource = 'user';
      } else {
        delete record.lemma;
        delete record.lemmaSource;
      }
      if (gloss) {
        if (!record.entry) record.entry = gloss.gloss;
        if (!record.glossSource) record.glossSource = 'book';
        if (!record.glossId) record.glossId = gloss.id;
      }

      await saveVocabularyEntry(record);
      saved = record;
      showStatus('Saved ✓', 'success');
    } catch (cause) {
      console.warn('Could not save the word.', cause);
      showStatus('Could not save the word.', 'error');
    } finally {
      busy = false;
      button.disabled = false;
    }
  };

  let noteSaving: Promise<boolean> | null = null;
  const queueNote = (task: () => Promise<boolean>): Promise<boolean> => {
    const run = (noteSaving ?? Promise.resolve(true)).then(task, task);
    noteSaving = run;
    run.then(
      () => {
        if (noteSaving === run) noteSaving = null;
      },
      () => {
        if (noteSaving === run) noteSaving = null;
      },
    );
    return run;
  };

  const saveNoteValue = (): Promise<boolean> =>
    queueNote(async () => {
      const value = textarea.value.trim().slice(0, 500);
      if (value === storedNote) return true;
      showStatus('');
      try {
        if (value.length === 0) {
          if (note) {
            const id = note.id;
            await deleteAnnotation(id);
            annotations = annotations.filter((entry) => entry.id !== id);
            note = null;
          }
        } else if (note) {
          const updated: Annotation = { ...note, note: value, updatedAt: Date.now() };
          await saveAnnotation(updated);
          annotations = annotations.map((entry) => (entry.id === updated.id ? updated : entry));
          note = updated;
        } else {
          const annotation = newAnnotation('note');
          annotation.note = value;
          await saveAnnotation(annotation);
          annotations = [...annotations, annotation];
          note = annotation;
        }
        storedNote = value;
        indexAnnotations();
        annotationsDirty = true;
        refreshNoteControls();
        return true;
      } catch (cause) {
        console.warn('Could not save the note.', cause);
        showStatus('Could not save the note.', 'error');
        return false;
      }
    });

  const removeNoteValue = (): Promise<boolean> =>
    queueNote(async () => {
      showStatus('');
      if (!note) {
        textarea.value = '';
        storedNote = '';
        refreshNoteControls();
        return true;
      }
      try {
        const id = note.id;
        await deleteAnnotation(id);
        annotations = annotations.filter((entry) => entry.id !== id);
        note = null;
        storedNote = '';
        textarea.value = '';
        indexAnnotations();
        annotationsDirty = true;
        refreshNoteControls();
        return true;
      } catch (cause) {
        console.warn('Could not remove the note.', cause);
        showStatus('Could not remove the note.', 'error');
        return false;
      }
    });

  const finish = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    if (await saveNoteValue()) dialog.close();
    else closing = false;
  };

  if (wordTab) wordTab.addEventListener('click', () => selectTab('word'));
  if (sentenceTab) {
    sentenceTab.addEventListener('click', () => selectTab('sentence'));
    tabs.addEventListener('keydown', (event: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next =
        event.key === 'Home'
          ? 'word'
          : event.key === 'End'
            ? 'sentence'
            : activeTab === 'word'
              ? 'sentence'
              : 'word';
      selectTab(next);
    });
  }
  highlightButton.addEventListener('click', () => void toggleHighlight());
  if (wordHighlightButton) {
    wordHighlightButton.addEventListener('click', () => void toggleWordHighlight());
  }
  if (saveButton) saveButton.addEventListener('click', () => void saveWord());
  removeNote.addEventListener('click', () => void removeNoteValue());
  done.addEventListener('click', () => void finish());
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    void finish();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) void finish();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (annotationsDirty) {
      annotationsDirty = false;
      rerenderReader();
    }
  });

  document.body.append(dialog);
  dialog.showModal();
  heading.focus();
}

function renderReader(options: { eagerImages?: boolean } = {}): void {
  if (!book || !chapter) return;
  revokeImageUrls();
  renderedBlocks = [];
  pairsById = new Map();
  paragraphRanges = new WeakMap();
  tapOrigin = null;

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

  const chaptersButton = document.createElement('button');
  chaptersButton.type = 'button';
  chaptersButton.className = 'secondary';
  chaptersButton.textContent = 'Chapters';
  chaptersButton.setAttribute('aria-label', 'Chapter list');
  chaptersButton.addEventListener('click', openChapters);

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

  controls.append(chaptersButton, settingsButton, library);
  const bar = document.createElement('div');
  bar.className = 'topbar-inner';
  bar.append(heading, controls);
  header.append(bar);

  const main = document.createElement('main');
  main.className = 'reader';
  main.lang = book.sourceLang;
  main.addEventListener('pointerdown', (event) => {
    if (event.isPrimary) {
      tapOrigin = { x: event.clientX, y: event.clientY, at: performance.now() };
    }
  });
  main.addEventListener('click', (event) => handleReaderTap(event, main));

  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.textContent = [
    `v${BUILD_INFO.version}`,
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

  for (const [blockIndex, block] of chapter.blocks.entries()) {
    if (block.type === 'pairs') {
      const firstPair = block.pairs[0];
      if (settings.displayMode === 'paragraph') {
        const paragraph = document.createElement('div');
        paragraph.className = 'paragraph';
        paragraph.dataset.pairId = firstPair.id;
        paragraph.dataset.bid = firstPair.bid;

        const derived = blockParagraph(block);
        const source = languageParagraph(book.sourceLang, 'src');
        appendRuns(source, derived.source, '');
        appendPinyin(source, paragraphPinyin(block));
        let target: HTMLElement | null = null;
        if (derived.target.length > 0) {
          target = languageParagraph(book.targetLang, 'tgt');
          appendRuns(target, derived.target, '');
        }
        appendLanguages(paragraph, source, target);

        for (const pair of block.pairs) pairsById.set(pair.id, pair);
        paragraphRanges.set(paragraph, derived.ranges);
        paintParagraphMarks(paragraph, derived.ranges);

        article.append(paragraph);
        renderedBlocks.push(paragraph);
      } else {
        for (const pair of block.pairs) {
          const pairElement = document.createElement('div');
          pairElement.className = 'pair';
          pairElement.dataset.pairId = pair.id;
          pairElement.dataset.bid = pair.bid;

          const source = languageParagraph(book.sourceLang, 'src');
          appendRuns(source, pair.sourceRuns, pair.source);
          appendPinyin(source, pair.pinyin);
          let target: HTMLElement | null = null;
          if (pair.target) {
            target = languageParagraph(book.targetLang, 'tgt');
            appendRuns(target, pair.targetRuns, pair.target);
          }
          appendLanguages(pairElement, source, target);
          pairsById.set(pair.id, pair);
          paintPairMarks(pairElement, pair);

          article.append(pairElement);
          renderedBlocks.push(pairElement);
        }
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
      appendRuns(paragraph, block.runs, block.text);
      const pair: Pair = {
        id: textPairId(chapter.path, blockIndex),
        bid: '',
        source: block.text,
        target: '',
        sourceRuns: block.runs,
      };
      paragraph.dataset.pairId = pair.id;
      pairsById.set(pair.id, pair);
      paintTextMarks(paragraph, pair);
      article.append(paragraph);
      // A pairless chapter (a plain book) has no other anchor; a jacket line
      // inside a bilingual chapter stays out of position tracking.
      if (chapter.pairCount === 0) renderedBlocks.push(paragraph);
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
    next.addEventListener('click', () => void openChapter(nextChapter));
    main.append(next);
  }

  app.replaceChildren(header, main);
}

/**
 * iOS can reject the first IndexedDB open while a service worker swaps bundles.
 * Defaulting at once would paint sentence mode over a stored `paragraph`, and the
 * next setting change would overwrite the record with defaults, so retry first.
 */
async function loadStoredSettings(attempts = 4): Promise<ReaderSettings> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await loadSettings();
    } catch (cause) {
      if (attempt >= attempts) throw cause;
      const delay = Promise.withResolvers<void>();
      setTimeout(delay.resolve, attempt * 150);
      await delay.promise;
    }
  }
}

async function boot(): Promise<void> {
  try {
    settings = await loadStoredSettings();
  } catch (cause) {
    console.warn('Could not read reader settings; using defaults.', cause);
    settings = { ...DEFAULT_SETTINGS };
  }
  applySettings();

  app.addEventListener('scroll', handleScroll, { passive: true });
  sheetGestureGuard();
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
