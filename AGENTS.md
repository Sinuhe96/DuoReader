# AGENTS.md — DuoReader index

Start here. This file is the master index for AI agents and for anyone returning
to the repo: where things live, how to run them, what must not break, and which
quirks are deliberate.

## 1. Documents

| File | Role |
|---|---|
| `AGENTS.md` | This index: map, commands, invariants, quirks, workflow |
|`DESIGN.md`|Reader brief: product, data model, constraints, risks, milestones M0–M5; planned display modes in §18|
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
| `src/reader/types.ts` | `Book`, `Chapter`, `Block`, `Pair`, `ReaderSettings`, `ReadingPosition`, `ReaderTheme`/`ReaderPalette` |
| `src/reader/position.ts` | `firstPairId`, `progressAt` — pair-based progress |
| `src/reader/settings.ts` | Defaults, normalization, themes, `resolveTheme`, `THEME_COLORS`, `THEME_HINT_KEY` |
| `src/reader/fonts.json` | Font catalog (`id`, `label`, `stack`, `default`) |
| `src/reader/fonts.ts` | Catalog accessors: `READER_FONTS`, `DEFAULT_FONT_ID`, `normalizeFontId`, `fontStack` |
| `src/storage/library.ts` | IndexedDB (idb) v2: books, content, images, positions, settings; `ensurePersistent` |
| `src/styles.css` | Theme variables, reader typography, library, sheet/dialog styles |
| `vite.config.ts` | Base `/DuoReader/`, git-derived build identity, `build-manifest.json` plugin, PWA/precache |
| `tests/*.test.ts` | Vitest: parse, position, settings, storage, build info |
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
  `Section N`.
- **The reader opens at the cover chapter**; resume restores chapter + pair.
- **First paint:** `localStorage['duoreader.theme']` is read by the inline shim in
  `index.html`, which duplicates the three palette colours on purpose.
- **Font catalog:** `src/reader/fonts.json`; the default is `new-york`. Adding a
  font is a JSON edit; unknown stored ids normalize to the default.
- **Killing a `vite preview` service** may surface "Supervised process failed
  with exit code 1"; that is the kill, not a bug.
- **Deployed app:** <https://sinuhe96.github.io/DuoReader/>; identity is shown on
  the Library screen as `v0.5.0 · build N · <commit>`, with `+` for a dirty tree.

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

## 7. Current state (2026-11-14)

- Version 0.5.0; the app code is at `d43f591`, later pushes are documentation only.
- M0–M3 complete and device-verified: import, offline library, reading loop,
  resume, typography, themes, fonts, system theme, persistent-storage request.
- M4 page mode postponed; scroll mode is the accepted reading mode.
- Learning layer planned only: `LEARNING.md`, L0 (annotations core) next.
- Display modes planned: paragraph (stacked or two-column), hide-translation,
  language order; data contract in `DATA-FORMAT.md`, design in `DESIGN.md` §18.
- Known gaps: archive entry-count and decompressed-size caps from `DESIGN.md` §9
  are not implemented; Playwright covers Chromium, not iOS.
