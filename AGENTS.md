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
|`LEARNING.md`|Learning layer: capture, dictionary, TTS, Anki, AI, with option/pro-con dossiers and L0–L5|

Rule: each subsystem gets one topic document; `DESIGN.md` links to it and stays
compact. Add new documents to the table above.

## 2. Code map

| Path | Role |
|---|---|
| `index.html` | App shell; meta tags; inline first-paint theme shim |
| `src/main.ts` | All UI and interaction: library, import, reader, settings dialog, position tracking, service-worker registration, update toast |
| `src/build-info.ts` | `BUILD_INFO` injected at build time; `formatBuildTag` |
|`src/reader/parse.ts`|Outer ZIP → `reader-master.epub` → OPF/NCX/spine → chapters, pairs, images, stats, warnings; computes `book.id`; contract in `DATA-FORMAT.md`|
| `src/reader/archive.ts` | ZIP access and XML parsing helpers; `ImportError` for user-facing failures |
| `src/reader/types.ts` | `Book`, `Chapter`, `Block`, `Pair`, `InlineRun`, `ReaderSettings`, `DisplayMode`, `LanguagesMode`, `LanguageOrder`, `ReadingPosition`, `ReaderTheme`/`ReaderPalette` |
| `src/reader/paragraph.ts` | `blockParagraph(block)` — `InlineRun[]` for source (offset gaps) and target (single-space join); render-time only |
| `src/reader/position.ts` | `firstPairId`, `progressAt` — pair-based progress |
| `src/reader/settings.ts` | Defaults, normalization, themes, `DISPLAY_MODES`, `TRANSLATION_OPTIONS`, `LANGUAGE_ORDERS`, `resolveTheme`, `THEME_COLORS`, `THEME_HINT_KEY` |
| `src/reader/fonts.json` | Font catalog (`id`, `label`, `stack`, `default`) |
| `src/reader/fonts.ts` | Catalog accessors: `READER_FONTS`, `DEFAULT_FONT_ID`, `normalizeFontId`, `fontStack` |
| `src/storage/library.ts` | IndexedDB (idb) v2: books, content, images, positions, settings; `ensurePersistent` |
| `src/styles.css` | Theme variables, reader typography, library, sheet/dialog styles |
| `vite.config.ts` | Base `/DuoReader/`, git-derived build identity, `build-manifest.json` plugin, PWA/precache |
| `tests/*.test.ts` | Vitest: parse (offsets, inline runs), paragraph derivation, position, settings, storage, build info |
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
6. **iOS opens a `<select>` that receives focus inside a dialog gesture.** The
   settings dialog focuses its heading (`tabIndex = -1`); do not autofocus a
   control.
7. **`data-theme` only ever holds a resolved palette** (`light|sepia|dark`);
   `system` is resolved before it reaches the DOM.
8. **Version lives in `package.json` and `package-lock.json` together**; bump
   before a release commit — minor for behaviour, patch for fixes.
9. **`dist/` and `test_data/` are gitignored.** Never commit built output or
   book files.
10. **A push deploys.** Every push to `main` runs CI and publishes Pages; the
    build number increments with every commit, even a docs-only one.

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
- **Playwright is Chromium.** iOS/Safari behaviour is verified manually on the
  user's device; never claim a device check you did not run.
- **Persistence is best effort.** `navigator.storage.persist()` may return false;
  the Library shows a "keep your ZIPs" note. The e2e test forces denial.
- **Pair ids come from the publisher** (`data-pair-id`), not from us. Missing
  pairs become text-only blocks; chapters without pairs still render images.
- **Chapter labels** prefer NCX entries, then `Chapter N`, `Illustration`, or
  `Section N`. A file with a pair but no navPoint, sitting between two labelled
  files, is a continuation split: it takes the previous label instead of a
  number, because generators drop continuation halves from the NCX (the
  Vietnamese sample's `index_split_013.html` is the second half of
  `Chương 13:`). Several unlabelled files in a row are genuine unlabelled
  chapters and get numbers (the German sample's 17 novel chapters).
- **The reader opens at the cover chapter**; resume restores chapter + pair.
- **First paint:** `localStorage['duoreader.theme']` is read by the inline shim in
  `index.html`, which duplicates the three palette colours on purpose.
- **Font catalog:** `src/reader/fonts.json`; the default is `new-york`. Adding a
  font is a JSON edit; unknown stored ids normalize to the default.
- **Reading shape is three selects, one renderer.** `Display`, `Languages`,
  and `Order` live in the `Aa` sheet. `Display` is mirrored as
  `<html data-display>` and drives the column CSS; `Languages` is mirrored as
  `<html data-languages>`, which neutralizes the muted `.tgt` styling in
  translation-only mode; `Order` is a pure DOM decision. `appendLanguages`
  drops the hidden language and orders the rest, so hidden text never reaches
  the DOM. All three re-render in place and restore the scroll anchor. Select
  changes flush their settings write immediately; the sliders stay debounced.
  Two columns appear when `.reader` (a `container-type: inline-size`
  container) is at least 40rem wide; paragraph mode widens `.reader` and
  `.topbar-inner` to 64rem together, because widening one alone misaligns the
  header.
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

## 7. Current state (2026-11-19)

- Version 0.10.1; display modes, inline runs, the three language modes, and
  language order are in the app code, latest pushes may be ahead of the
  deployed build shown in the Library tag.
- Plain (untranslated) EPUBs import as-is since 0.10.0: a chapter container is
  split at HTML block elements, so paragraphs, headings, and list items stay
  separate, and their `i`/`b`/`br` runs and inline images survive. Before that
  a plain book rendered one fused block per container. Existing plain imports
  need a re-import.
- Two sample archives verified in `test_data/` (both gitignored): German
  (1,877 pairs) and Vietnamese (4,803 pairs, 588 images, 20 chapters, NFC
  text). Both reproduce their `bilingual-paragraph.epub` exactly. The
  Vietnamese jacket wrapper exposed a block-splitting bug fixed in 0.9.1.
  0.10.0 recovers its five untranslated paragraphs that carry an inline image
  (text-only blocks 3 → 8).
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
- Learning layer planned only: `LEARNING.md`, L0 (annotations core) next.
- Known gaps: archive entry-count and decompressed-size caps from `DESIGN.md` §9
  are not implemented; Playwright covers Chromium, not iOS; bare text inside a
  pair container is still dropped (whitespace only in the sample).
