# AGENTS.md — DuoReader index

Start here. This file is the master index for AI agents and for anyone returning
to the repo: where things live, how to run them, what must not break, and which
quirks are deliberate.

## 1. Documents

| File | Role |
|---|---|
| `AGENTS.md` | This index: map, commands, invariants, quirks, workflow |
|`DESIGN.md`|Reader brief: product, data model, constraints, risks, milestones M0–M5; display modes in §18|
|`DATA-FORMAT.md`|BePub ZIP contract: outer archive, `manifest.json`, `reader-master` pair markup, offsets, derived artifacts, generation checklist|
|`ALIGNMENT.md`|Source-edition alignment: adapters, case manifest, sentence DP, review, failure catalogue, reuse checklist; first English→Vietnamese case built|
|`LEARNING.md`|Learning layer: capture, dictionary, TTS, Anki, AI, with option/pro-con dossiers and L0–L5|
|`stories/README.md`|Story-collection contract: `book.json`, adapted story JSON and the prompt fields the builder needs, build command, edition rules|

Rule: each subsystem gets one topic document; `DESIGN.md` links to it and stays
compact. Add new documents to the table above.

## 2. Code map

| Path | Role |
|---|---|
| `index.html` | App shell; meta tags; inline first-paint theme shim |
| `src/main.ts` | All UI and interaction: library, import, reader, learning sheet, settings dialog, position tracking, service-worker registration, update toast; the app's scroll helpers (`scrollTop()`, `scrollTo()`) own all scrolling |
| `src/build-info.ts` | `BUILD_INFO` injected at build time; `formatBuildTag` |
|`src/reader/parse.ts`|Outer ZIP → `reader-master.epub` → OPF/NCX/spine → chapters, pairs, images, optional edition glossary, stats, warnings; computes `book.id`; contract in `DATA-FORMAT.md`|
| `src/reader/archive.ts` | ZIP access and XML parsing helpers; `ImportError` for user-facing failures |
| `src/reader/types.ts` | `Book`, `Chapter`, `Block`, `Pair`, `InlineRun`, `Annotation`, `BookGloss`, `VocabularyEntry`, `ReaderSettings`, `DisplayMode`, `LanguagesMode`, `LanguageOrder`, `PinyinMode`, `ReadingPosition`, `ReaderTheme`/`ReaderPalette` |
| `src/reader/paragraph.ts` | `blockParagraph(block)` — `InlineRun[]` for source (offset gaps) and target (single-space join), plus `ranges` mapping each pair to DOM text offsets; `paragraphPinyin(block)` for a block's one-line pinyin; render-time only |
| `src/reader/marks.ts` | `markTextRange(line, start, end, className)` — splits text nodes and wraps a range in `<mark>`; skips `.pinyin`; returns the marks so a word can carry its annotation id; never `innerHTML` |
| `src/reader/words.ts` | `wordAt(text, offset, lang)` (`Intl.Segmenter`), `pairTextMap` (pair string ↔ DOM runs, breaks included), `glossAt` (overlap then exact term); pure, unit-tested |
| `src/reader/position.ts` | `textPairId`, `firstPairId` (pairs first, then a plain chapter's first text block), `progressAt` — pair-based progress |
| `src/reader/settings.ts` | Defaults, normalization, themes, `DISPLAY_MODES`, `LANGUAGE_MODES`, `LANGUAGE_ORDERS`, `PINYIN_MODES`, `resolveTheme`, `THEME_COLORS`, `THEME_HINT_KEY` |
| `src/reader/fonts.json` | Font catalog (`id`, `label`, `stack`, `default`) |
| `src/reader/fonts.ts` | Catalog accessors: `READER_FONTS`, `DEFAULT_FONT_ID`, `normalizeFontId`, `fontStack` |
| `src/storage/library.ts` | IndexedDB (idb) v5: books, content, images, positions, settings, annotations (by book, pair, chapter), vocabulary (by book, pair, term, status), glossaries (by book); `ensurePersistent` |
| `src/styles.css` | Theme variables, reader typography, library, sheet/dialog styles |
| `vite.config.ts` | Base `/DuoReader/`, git-derived build identity, `build-manifest.json` plugin, PWA/precache |
| `tools/bepub/build.ts` | Story collection front-end: `book.json` + story JSON → neutral emitter; deterministic BePub ZIP |
| `tools/bepub/emit.ts` | Neutral BePub emitter: chapters/blocks → OPF, NCX, XHTML, `reader-master.epub`, `manifest.json`; shared by stories and the aligner |
| `tools/align/` | Two-edition aligner: EPUB and PDF-OCR adapters, sentence DP, review HTML, aligned-book emitter; `npm run align -- out/align/<case>/case.json` |
| `stories/<collection>/` | Authored collections: `book.json`, verbatim model story JSON, images; built into `out/books/*.zip` (gitignored) |
| `tests/*.test.ts` | Vitest: parse (offsets, inline runs, pinyin), paragraph derivation, position, settings, storage, build info, BePub builder |
| `tests/e2e/*.spec.ts` | Playwright against `dist/`; `book-fixture.ts` builds a tiny EPUB |
| `.github/workflows/` | CI: install, test, build, Playwright, deploy to Pages |

## 3. Commands

```bash
npm ci                 # install
npm run dev            # dev server, network-visible
npm run build          # tsc --noEmit + vite build → dist/
npm test               # vitest
npm run test:e2e       # build, then Playwright (Chromium, 390×844)
npm run preview        # serve dist/ locally
npm run book -- stories/<collection>   # story collection → out/books/<collection>.zip
npm run align -- out/align/<case>/case.json   # two editions → out/books/<id>.zip
```

There is no linter or formatter configuration; `tsc` strict plus the tests are
the gate. CI checks out full history because the build number is the commit count.

## 4. Invariants

1. **Book text is rendered with `textContent`.** Never `innerHTML` for imported
   content; images come only from local blobs.
2. **Reading makes zero network requests.** Any network feature is an explicit
   user action with visible UI (see `LEARNING.md` D12).
3. **Editions are immutable.** `book.id` is `book-<sha256 prefix>` of
   `reader-master.epub`; the same ZIP always yields the same id, and a changed
   export is a new book. Never mutate a stored book in place.
4. **Settings enter the app only through `normalizeSettings`.** Unknown or
   legacy values fall back to defaults; do not trust stored data.
5. **Safari does not keep Blobs in IndexedDB reliably.** Store image bytes and
   rebuild the Blob on read (`StoredImage.bytes`); `blob` is legacy.
6. **A sheet opens on its heading, not on a control.** `showModal()` focuses
   the first control; the settings sheet puts `tabIndex = -1` on its heading so
   the thumb never lands on a choice it did not make. (Before 0.12.6 that also
   stopped iOS from opening a `<select>` picker on open.)
7. **`data-theme` only ever holds a resolved palette** (`light|sepia|dark`);
   `system` is resolved before it reaches the DOM.
8. **Version lives in `package.json` and `package-lock.json` together**; bump
   before a release commit — minor for behaviour, patch for fixes.
9. **`dist/`, `test_data/`, and `out/` are gitignored.** Never commit built
   output, generated ZIPs, or book files; `stories/` holds text and images and
   is committed.
10. **A push deploys.** Every push to `main` runs CI and publishes Pages; the
    build number increments with every commit, even a docs-only one.
11. **State ownership is fixed** (`DESIGN.md` §19): settings are one global
    record and import never writes them; content is per book and replaced on
    re-import; a position is per book and resolves by pair id before chapter
    index; annotations and the edition glossary are per book, and vocabulary is
    global user state that survives both a re-import and a book deletion.
    `tests/e2e/state-contract.spec.ts` pins all the rules; classify any new
    persistent state there, and extend that test, before adding it.
12. **A modal sheet owns the gesture.** The viewport never scrolls (`html` and
    `body` are `overflow: hidden`) and `#app` is the app's only scroller, so a
    top-layer `<dialog>`'s scroll chain stops at a viewport that cannot move
    and never passes through the pane that holds the story. `sheetGestureGuard()`
    only keeps the sheet sane: it never cancels a `touchmove` that starts on a
    control, so a range slider follows the finger from anywhere on its track.
    Nothing may use `window.scrollY` or `window.scrollTo`; use the app's
    `scrollTop()`/`scrollTo()` helpers. `tests/e2e/sheet-scroll.spec.ts` pins
    the structure and the behaviour, and the suite runs in Chromium **and**
    WebKit — the bug only ever reproduced in the engine behind iOS Safari.

## 5. Quirks worth knowing

- **Windows shell:** no `python`/`python3`. Bash coreutils, `rg`, `jq`, `sd`,
  `node` are available. Git prints LF→CRLF warnings; ignore them.
- **Version bumps:** `npm version` refuses with "Version not changed" once
  `package.json` is already edited; set the version in both manifests directly.
- **Stale service worker while developing:** an old SW can serve an older bundle
  on the same origin, so a new build looks unchanged. Use a fresh port, or
  unregister the SW, delete caches, delete the `duoreader` database, then reload.
- **e2e runs against `dist/`** and its own preview server on port 4173 with base
  path `/DuoReader/`; `npm run test:e2e` builds first.
- **Authored books are produced, not hand-written.** `npm run book --
  stories/<collection>` (`tools/bepub/build.ts`) emits `reader-master.epub` and
  `manifest.json`; the story JSON stays verbatim model output and
  `book.json` owns order, labels, paragraphs, and image placement. Three rules
  it exists to enforce: one container per paragraph that directly owns its
  `reader-pair` spans; a `navPoint` for **every** spine document (an unlabelled
  one between labelled ones is merged into the previous chapter); the
  illustration as its own `<div>` container, never inside a pair container.
  ZIP mtimes are pinned to 2026-01-01 and `created_at` is a constant, so
  unchanged input rebuilds to the same bytes and the same `book.id`.
- **Library cards stay inside the column.** `.book-list` is
  `grid-template-columns: minmax(0, 1fr)`, not the default `auto`: an `auto`
  track takes its width from a nowrap title, which widened the whole page on
  iPhone and pushed `Delete` off-screen. Below 30rem a card is one column —
  info full width, `Read`/`Delete` splitting the row — and above it the actions
  sit beside the info with each button bounded to 4.5–8rem. Titles, authors,
  and meta lines clip with an ellipsis; `tests/e2e/library-card.spec.ts` pins
  the phone and wide shapes.
- **A sheet's drag used to pan the page behind it.** Two event-based patches
  failed before the cause was found, and the reason is worth keeping: the
  first (`overflow: hidden` on `<html>`) cannot work on iOS, which ignores root
  `overflow` when deciding whether a touch may pan the viewport; the second
  (cancelling `touchmove`) had a hole — whenever the sheet itself overflowed,
  the sheet's `overflow-y: auto` ancestor "owned" the gesture and it was
  allowed through. The fix is structural: the viewport never scrolls and the
  story lives in `#app`, a pane that is not an ancestor of the dialog, so the
  sheet's scroll chain stops at a viewport that cannot move. Chromium never
  reproduced the original bug, which is why two patches could ship uncaught —
  the suite now runs in WebKit as well.
- **The sheet owns its controls, and nothing under it filters.** Two backdrop
  filters were live beneath the top layer: the frosted bar (`blur(12px)`) and
  the sheet's `::backdrop` (`blur(2px)`). On iOS 26, opening a native
  `<select>` picker there made the compositor re-snapshot them, and the
  picker's shadow arrived about a second late. 0.12.5 dropped the backdrop
  blur (a 40% tint separates the sheet) and switched the bar's blur off while
  any `dialog[open]` exists — that helped, but the first tap on a control
  still sometimes opened the picker and closed it again. Both are the platform
  picker's own (a WebKit/iOS 26 defect, not the page's), so 0.12.6 removed
  every `<select>` from the sheet: choice rows are `aria-pressed` buttons.
  Keep both rules — no filter under a sheet, no native picker in one; a
  regression is only ever noticed on a device, never in CI.
- **Playwright is Chromium and WebKit.** iOS/Safari behaviour is verified
  manually on the user's device; never claim a device check you did not run.
  WebKit has no CDP, so a real touch drag cannot be dispatched there: the
  sheet spec builds touch events from `document.createTouch`, which is the one
  API Safari still has, and keeps the real gesture for Chromium.
- **Persistence is best effort.** `navigator.storage.persist()` may return false;
  the Library shows a "keep your ZIPs" note. The e2e test forces denial.
- **Pair ids come from the publisher** (`data-pair-id`), not from us. Missing
  pairs become text-only blocks; chapters without pairs still render images.
- **Chapter labels** prefer NCX entries, then `Chapter N`, `Illustration`, or
  `Section N`. A file with a pair but no navPoint, sitting between two labelled
  files, is a continuation split: it is merged into the previous chapter,
  because generators drop continuation halves from the NCX (the Vietnamese
  sample's `index_split_013.html` is the second half of `Chương 13:`). Several
  unlabelled files in a row are genuine chapters and get numbers (the German
  sample's 17 novel chapters).
- **Chapters are picked from a sheet.** The top bar has no chapter select and
  shows no chapter label; `Chapters` opens `.chapters-dialog` with one
  `chapter-item` button per chapter, the current one marked. As in Apple
  Books, a chapter's own heading is the only title on the reading screen; the
  bar never repeats it.
- **The reader meta line starts with the app version** (`v0.12.4 · vi → en ·
  4,803 pairs · …`) so a reported screenshot identifies the parser that
  produced it. Temporary diagnostics; remove it in the production build.
- **iOS can throw the first `indexedDB.open`** while a service worker swaps
  bundles. `boot` retries the settings read four times with backoff and
  `database()` forgets a rejected open, so the app never paints defaults over a
  stored record; before 0.11.1 it did, and the next setting change made that
  loss permanent. If settings ever look reset, read the `settings` record
  before trusting the screen (`settings-recovery.spec.ts` simulates the throw).
- **The reader opens at the cover chapter**; resume restores chapter + pair.
- **First paint:** `localStorage['duoreader.theme']` is read by the inline shim in
  `index.html`, which duplicates the three palette colours on purpose.
- **Font catalog:** `src/reader/fonts.json`; the default is `new-york`. Adding a
  font is a JSON edit; unknown stored ids normalize to the default.
- **One control height.** `--tap-target` (2.75rem / 44 px, Apple's minimum)
  sets every button, segment, row, and sheet action: the reading bar, library
  cards, chapter and font rows, the `Aa` choices, the learning segments and
  actions, `Done`, `Next chapter`, the base-form field, and the slider lane.
  Before 0.17.1 the bars and `Aa` choices were 40 px, the sheet actions 44, and
  the new learning segments 36 — three heights for one kind of control.
  `tests/e2e/control-heights.spec.ts` measures them all.
- **Reading shape is four choice rows, one disclosure.** `Display`,
  `Languages`, `Order`, and `Pinyin` live in the `Aa` sheet as rows of
  `aria-pressed`
  buttons (`choiceRow()` in `main.ts`), never `<select>`: the sheet owns its
  controls, so no native picker can be presented, wait, or open-then-close
  (0.12.6, `DESIGN.md` §20). `Display` is mirrored as
  `<html data-display>` and drives the column CSS; `Languages` is mirrored as
  `<html data-languages>`, which gates the second-language rule so a lone
  visible language stays primary; `Order` is mirrored as `<html data-order>`
  and decides whether `.tgt` (`source-first`) or `.src` (`target-first`) is the
  muted, 0.9em, rule-indented line — changing the order swaps the roles and
  re-renders, so no element carries stale formatting. `Pinyin` prepends a line
  inside `.src`, so it hides and reorders with the source and needs no
  visibility rule of its own.
  `appendLanguages`
  drops the hidden language and orders the rest, so hidden text never reaches
  the DOM. All four re-render in place and restore the scroll anchor. A choice
  change flushes its settings write immediately; the sliders stay debounced.
  `Font` is the one disclosure instead of a row of chips: a
  `Font  New York ›` button swaps the sheet body for a pushed list of faces in
  the same dialog (`#settings-font-list`), and picking one pops back (0.13.0).
  The two sliders are drawn (`appearance: none`, a 28 px knob on a 4 px track
  in a 44 px lane) because `accent-color` cannot size a thumb; `rangeFill()`
  paints the accent up to the knob. The sheet is chrome: `.settings-dialog`
  pins `--ui-font` (its `h2` too), and every row label is 0.9rem `--fg`;
  serif display faces belong to Library and chapter headings (0.13.1).
  Two columns appear when `.reader` (a `container-type: inline-size`
  container) is at least 40rem wide; paragraph mode widens `.reader` and
  `.topbar-inner` to 64rem together, because widening one alone misaligns the
  header.
- **A plain block borrows the pair contract.** A text-only block has no
  publisher pair, so the renderer registers it as a synthetic `Pair` with id
  `text:<chapter path>@<block index>`, `source` = the block text, and an empty
  `target`. It gets `data-pair-id` on the `.text-only` paragraph, the sheet is
  titled `Passage`, and the whole block is the annotated unit; the id is stable
  across reloads and re-imports of the same edition. In a chapter without
  pairs, text blocks also sit in `renderedBlocks`, so `topPairId`/`scrollToPair`
  resume a plain book by block; a jacket line in a paired chapter stays out of
  position tracking.
- **A tap is a word; the sheet has a segment for each.** A single tap resolves
  the caret to a pair, a side, and a word (`Intl.Segmenter`), and opens the
  sheet titled with the word on its `Word` segment (`Highlight word`, an
  editable `Base form` prefilled with the surface — or the saved lemma when the
  range was captured before; an untouched prefill stores no lemma — `Save`, the
  `Book gloss` when the edition carries one, and the word's own line as
  context); `Sentence` (or `Passage`) is the second segment, with `Highlight
  sentence`/`Highlight passage` and the note. Both panels stay in the DOM, so
  switching drops neither a typed note nor a base form, and `Remove note` only
  appears on the sentence segment. A tap that resolves no word has no segments
  and opens straight at the sentence/passage. Word marks are
  `<mark class="reader-word" data-annotation-id>`, so tapping one reopens its
  exact range and stored base form; sentence highlights and notes stay
  `reader-highlight`/`reader-note` and mark both lines. `pairTextMap` converts
  between a pair string and its DOM runs, a `<br>` contributes no DOM character,
  and a break may consume the producer's space. `Save` writes `vocabulary`
  (surface, optional user lemma, both sentences, gloss provenance) and
  `Saved ✓` is shown on reopen; a re-import keeps vocabulary, deleting the book
  keeps it too, while annotations and the edition glossary are deleted with it.
  The word lookup reads `[bookId, pairId]`, so a tap does not load the whole
  vocabulary. Book glosses are edition data (`glossary.json` in the package,
  DB `glossaries`), read-only until an explicit Save promotes one.
- **Learning marks repaint on close.** The sheet writes a highlight on tap and
  the note when it closes (`Done`, Escape, backdrop), but the chapter re-renders
  only after the dialog closes, so the story under a modal is never rebuilt
  while a thumb is on it. `Remove note` deletes a stored note at once. Marks
  are `<mark class="reader-highlight|reader-note|reader-word">` built by
  splitting text nodes; tapping any text resolves the pair by `data-pair-id`
  (sentence mode) or by `blockParagraph().ranges` (paragraph mode), and a tap
  after a non-collapsed selection is ignored. The sheet has no `<select>`; it
  inherits `DESIGN.md` §20. Annotations load per chapter through
  `by-book-chapter`: opening a book reads only the rendered chapter, and a
  chapter switch reads that chapter, so notes elsewhere never delay the open.
- **Inline runs are a whitelist, not HTML.** `i`/`em` → `em`, `b`/`strong` →
  `strong`, `br` → break; everything else contributes only text. Runs are
  stored on `Pair` only when a span carries markup, so old imports fall back to
  plain `source`/`target`; the target parses identically but BePub emits no
  markup there.
- **Paragraph ownership decides blocks.** The block is the element that
  directly owns `reader-pair` spans. A wrapper that holds paragraph elements
  (the Vietnamese sample's jacket `<div>` of `<p>`s) is descended into, so its
  paragraphs stay separate and its text-only lines are kept in order. Pairs
  nested inside a container that *itself* owns pairs still merge into one
  block; the producer should keep one container per paragraph. Content with no
  pair at all is split by `BLOCK_LEVEL` in `parse.ts` instead, one text block
  per `p`/`div`/`li`/heading, with `i`/`b`/`br` as runs and images in place —
  so a plain EPUB imported as-is reads paragraph by paragraph. Do not flatten
  such a container with `textOf`: `textContent` has no boundary between
  siblings and fuses them without even a space.
- **Killing a `vite preview` service** may surface "Supervised process failed
  with exit code 1"; that is the kill, not a bug.
- **Deployed app:** <https://sinuhe96.github.io/DuoReader/>; identity is shown on
  the Library screen as `v0.9.1 · build N · <commit>`, with `+` for a dirty tree.

## 6. Working agreement for agents

1. Read this file, then the relevant section of `DESIGN.md` or `LEARNING.md`
   before proposing a design.
2. Prefer the existing pattern over a new abstraction; one convention per concern.
3. Edit with the editor tool, not shell substitutions. Keep diffs small.
4. Verify with the narrowest check: `npx tsc --noEmit`, `npm test`, then
   `npm run test:e2e` only when the UI changed. Report exactly what ran.
5. Update the owning document when behaviour or a decision changes; keep
   `DESIGN.md` compact and push detail into topic documents.
6. Bump the version for user-visible changes (minor) or fixes (patch) and keep
   the lockfile in sync.
7. Commit messages are imperative and milestone-prefixed where a milestone
   applies (`M3: …`, `Add …`, `Mark … verified`). The user expects verified work
   to be pushed; pushing redeploys.
8. Never add tests that only assert wiring, echoes, or source text. Test
   contracts: normalization, migration, position, parsing, export.

## 7. Current state (2026-11-24)

- Version 0.17.2; display modes, inline runs, the three language modes,
  language order, pinyin, and the L0–L1 learning layer are in the app code;
  latest pushes may be ahead of the deployed build shown in the Library tag.
- 0.17.2 prefills the word sheet's `Base form` with the tapped word (or the
  stored lemma on a captured range), so editing a stem is trimming, not
  retyping. Saving that prefill untouched stores no lemma — the field is an
  edit affordance, not a claim about the headword. The target-word e2e pins
  both halves.
- 0.17.1 gives every control one height: `--tap-target` (2.75rem / 44 px,
  Apple's minimum) replaces the literals, so the reading bar, library cards,
  chapter/font rows, `Aa` choices, learning segments and actions, `Done`, and
  the slider lane all measure 44 px. Before, bars and `Aa` choices were 40 px
  and the new learning segments 36, while the sheet actions were 44.
  `control-heights.spec.ts` measures each group in Chromium and WebKit.
- 0.17.0 splits the learning sheet into two segments, an Apple-style segmented
  control: a word tap opens on `Word` (the word is the sheet title, plus its
  line as context, the editable base form, the book gloss, `Highlight word`,
  `Save`) and `Sentence` carries both lines, `Highlight sentence`/`Highlight
  passage`, and the note — so neither job scrolls past the other. The row is a
  `role="tablist"` of `role="tab"` buttons (no `<select>`, `DESIGN.md` §20),
  arrow/Home/End move between them, both panels stay in the DOM so a typed note
  or base form survives a switch, and `Done` saves the note from either
  segment. `Remove note` appears only on the sentence segment. A tap that
  resolves no word has no segments and opens straight at the sentence/passage.
  E2E covers both segments in Chromium and WebKit.
- 0.15.0 starts the learning layer with L0: a single tap on a sentence opens the
  learning sheet; `Highlight` and `Note` write `annotations` (DB v3) and the
  chapter repaints when the sheet closes. Sentence mode marks both lines;
  paragraph mode marks the pair's range inside the joined paragraph. Verified
  in Chromium and WebKit e2e (`annotations.spec.ts`, `state-contract.spec.ts`,
  `sheet-scroll.spec.ts`); device check pending.
- 0.15.1 removes the redundant `Save note` button: `Done` saves the note, and a
  `Remove note` button (shown only when one is stored) deletes it. Chromium and
  WebKit e2e cover both paths.
- 0.15.2 makes a plain EPUB annotatable. Each text-only block becomes a
  synthetic pair (`text:<chapter path>@<block index>`, the block text as its
  source), so tapping it opens the sheet titled `Passage`; highlight and note
  cover the whole block and persist. Text blocks also anchor the reading
  position in a chapter without pairs. E2E covers the sheet and a reload in
  both engines; a note on one paragraph leaves its neighbours clean.
- 0.15.3 makes note loading scale with the chapter, not the book: DB v4 adds
  the `by-book-chapter` index, `openBook` reads only the resolved chapter, and
  a chapter switch reads that chapter's notes. A book with thousands of notes
  elsewhere no longer pays for them on open. v3→v4 keeps existing annotations;
  the e2e switches chapters and finds each chapter's mark.
- 0.16.0 ships L1 word capture. A tap maps the caret to a pair, side, and word
  with `Intl.Segmenter`; the word sheet offers an editable base form, `Book
  gloss` when the edition carries one, `Highlight word`, and `Save` to
  vocabulary, while the sentence/passage highlight and note stay in the same
  sheet. Word marks are ranged `<mark data-annotation-id>` elements; tapping
  one reopens the exact captured word. DB v5 adds `vocabulary` and
  `glossaries`; the parser reads optional `glossary.json`; a re-import keeps
  vocabulary, while deleting a book keeps vocabulary and drops its annotations
  and glossary. Verified by 14 annotation and 3 state-contract e2e tests in
  Chromium and WebKit plus unit tests for segmentation, mapping, gloss
  matching, parsing, and storage.
- 0.13.0 reshaped the `Aa` sheet after Apple Books' theme sheet: `Font` is a
  `Font  New York ›` disclosure that swaps the sheet body for a pushed list of
  faces (`#settings-font-list`, back link `#settings-font-panel`'s
  `‹ Reading settings`, `Done` outside both panels), and both sliders are drawn
  with a 28 px knob in a 44 px lane, so the thumb is easy to catch. The sheet's
  content dropped from 908 px to 800 px; it fits a 390×844 box, while an
  iPhone 13 browser viewport (664 px) still scrolls it by ~170 px. Device check
  on 2026-11-20: the font row opens instantly and the pushed list is a clear
  improvement over ten chips; the larger slider thumb is easier to catch.
- 0.13.1 made the sheet one type system: `.settings-dialog` pins `--ui-font`
  (headline included) and every row label — `Display` through `Text size` — is
  0.9rem `--fg`; values stay muted. The serif display face now belongs only to
  Library and chapter headings. Cosmetic; no behaviour changed. Device check on
  2026-11-20: the sheet's type reads consistently; it still scrolls slightly,
  accepted for now (see the known gap).
- Pinyin shipped in 0.12.0 as the `Pinyin` row in the `Aa` sheet: `Off` by
  default, `Above source` draws one muted line per annotated sentence from an
  optional `data-pinyin` attribute on the `reader-src` span (`DATA-FORMAT.md`
  §4). Paragraph mode joins a block's sentence pinyin with one space; the line
  lives inside `.src`, so it hides with the source and follows `Order`.
  Archives without the attribute are unaffected, so no re-import is needed for
  them; an archive gains pinyin only when its producer emits the attribute.
  Per-character ruby is not implemented.
- 0.12.1 keeps a long library title inside its card (one-line ellipsis) and
  bounds the card buttons to 4.5–8rem, so the `Delete` button can no longer sit
  off-screen on an iPhone. Verified in Chromium at 390 and 900 px; re-check on
  the device after the push.
- 0.12.2/0.12.3 patched the sheet gesture with events and did not fix it:
  `overflow: hidden` on `<html>` cannot stop an iOS pan, and the `touchmove`
  guard let the gesture through whenever the sheet overflowed. 0.12.4 fixes it
  structurally: the viewport never scrolls, `#app` is the app's only scroller,
  and the sheet's scroll chain stops at a viewport that cannot reach the
  story. The reader no longer scrolls under the `Aa` sheet, and a drag that
  starts anywhere on the slider's track moves it. Pinned by
  `tests/e2e/sheet-scroll.spec.ts`, which now runs in Chromium and WebKit;
  contract in `DESIGN.md` §20. Device check still pending.
- 0.12.5 removed the sheet's backdrop blur and switches the bar's blur off
  while a sheet is open. 0.12.6 then removed every native `<select>` from the
  sheet: the six pickers became choice rows of `aria-pressed` buttons
  (`choiceRow()`, segments and typeface chips), because on iOS 26 the picker
  took about a second to finish presenting — its shadow arrived late even
  after the filters were gone — and the first tap sometimes opened it and
  closed it again. The reader-facing result is one tap, no picker; the rows'
  ids (`#settings-display`, `-languages`, `-order`, `-pinyin`, `-font`,
  `-theme`) are unchanged, and `tests/e2e/sheet.ts` picks options by their
  visible label. Verified in Chromium and WebKit (full suite); device check on
  2026-11-19 confirmed the controls are instant, at the cost of a sheet that
  now scrolls on a phone (see the known gap below).
- The story toolchain is in place: `stories/sima-guang/` (the adapted
  `司马光砸缸` story, 30 aligned zh/en sentences with pinyin, 13 glossary
  entries, one illustration) builds with `npm run book -- stories/sima-guang`
  into a two-chapter ZIP (story + `词汇 · Vocabulary`, 45 pairs, 1 image).
  Verified by importing that ZIP in Chromium: title pair, illustration, pinyin
  above every sentence, the chapter sheet, and the two-column glossary all
  render. Not device-verified. The prompt fields the builder relies on
  (`p`, sentence pinyin) are documented in `stories/README.md`.
- The top bar offers `Chapters`, `Aa`, `Library`; the chapter list is a sheet
  (`chapters.spec.ts`), so the reading screen names no chapter and an in-text
  heading never appears twice. Shipped in 0.11.0.
- Storage ownership is now written down and pinned (`DESIGN.md` §19,
  `state-contract.spec.ts`): a re-import keeps all eight reader settings and the
  reading position, and a position resolves by pair id before chapter index.
  Deleting a book removes its content, images, and position but never the global
  settings, so a delete followed by an import starts at the cover by design.
- Plain (untranslated) EPUBs import as-is since 0.10.0: a chapter container is
  split at HTML block elements, so paragraphs, headings, and list items stay
  separate, and their `i`/`b`/`br` runs and inline images survive. Before that
  a plain book rendered one fused block per container. Existing plain imports
  need a re-import.
- Two sample archives verified in `test_data/` (both gitignored): German
  (1,877 pairs) and Vietnamese (4,803 pairs, 588 images, 19 chapters after the
  0.10.1 continuation merge, NFC text). Both reproduce their
  `bilingual-paragraph.epub` exactly. The Vietnamese jacket wrapper exposed a
  block-splitting bug fixed in 0.9.1. 0.10.0 recovers its five untranslated
  paragraphs that carry an inline image (text-only blocks 3 → 8).
- M0–M3 complete and device-verified: import, offline library, reading loop,
  resume, typography, themes, fonts, system theme, persistent-storage request.
- M4 page mode postponed; scroll mode is the accepted reading mode.
- Display modes: sentence-by-sentence (default) and paragraph-by-paragraph
  shipped in 0.6.0 via a `Display` row in the `Aa` sheet — stacked in the
  current vertical flow on phones, two columns once the reader column reaches
  40rem. Device-verified on iPad and iPhone on 2026-11-16: side by side in
  landscape, stacked after rotating to portrait (`DESIGN.md` §18, data
  contract in `DATA-FORMAT.md`).
- Language modes and order shipped in 0.8.0 as the `Languages` and `Order`
  rows; `Languages` gained `Translation only` in 0.9.0, where the target is
  promoted to body size. All apply to sentence and paragraph mode, and the
  choices survive a reload. Device-verified on iPad and iPhone on 2026-11-16:
  in side-by-side layout a single remaining language promotes to reading size,
  and `Translation first` combines correctly with `Source only` and
  `Translation only`.
- Inline runs shipped in 0.7.0: italics, bold, and line breaks render in both
  modes; books imported earlier need a re-import to gain them.
- Learning layer: L0 shipped in 0.15.0 (sentence highlights and notes) and L1
  in 0.16.0 (word capture, vocabulary, edition glosses); L2, the review loop
  and Words screen, is next in `LEARNING.md` §6.
- Source alignment has a first working case: `ALIGNMENT.md` fixes the contract
  and `npm run align -- out/align/seagull/case.json` builds *The Story of a
  Seagull…* (English OCR PDF → Vietnamese EPUB). Part One, chapters 1–9:
  502 content pairs, 41 flagged, 2 source-only, 0 parser warnings. The English
  file is a 54-page scan; OCR is Windows-only. `review.json` plus
  `review-prompt.md` export hard paragraphs for an external LLM/human; a
  validated `decisions.json` applies the chosen grouping deterministically.
  There is no built-in provider or API key.
  The generated book was imported in Chromium at 390×844; chapter sheet,
  source/target styling, and a source-only gap render. Vietnamese diacritics
  look decomposed in the Windows Chromium profile with the existing Vietnamese
  sample too, so that is a font/environment artifact, not a data defect.
- Known gaps: archive entry-count and decompressed-size caps from `DESIGN.md` §9
  are not implemented; Playwright covers Chromium, not iOS; bare text inside a
  pair container is still dropped (whitespace only in the sample); the `Aa`
  sheet still scrolls on an iPhone browser viewport (664 px) — its content is
  800 px, so about 170 px is below the fold, though it fits a 390×844 box. The
  font row's pushed list removed the 199 px of chips (`DESIGN.md` §18
  Control); the rest is deferred — the next step is the same treatment for the
  four choice rows; the device check of 0.12.6 confirmed the controls are
  instant.
