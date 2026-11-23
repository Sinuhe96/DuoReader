# DuoReader — design brief

**Status:** M3 verified on device: finished one whole book in airplane mode, after the persistence request, import error handling, source-only fallback, lazy images, and parser/position/storage tests. Reader font picker shipped in 0.4.0 from an editable catalog in `src/reader/fonts.json`. System theme shipped in 0.5.0 and is now the default; verified on device on 2026-11-14: flipping the system appearance repaints the app, and stored Light/Sepia/Dark choices ignore the flip. Version 0.12.0: pinyin as an optional source-side line (§18). 0.12.1 keeps a long library title inside its card and bounds the card buttons; 0.12.2–0.12.4: the sheet owns the gesture (§20) — the viewport never scrolls and `#app` is the only scroller. 0.12.5 removes every live backdrop filter under a sheet after an iOS select picker took about a second to finish appearing; 0.12.6 replaces the sheet's six native select pickers with `aria-pressed` choice rows, because the platform picker stayed slow and could open and close on the first tap. Page mode postponed: scroll mode reads well. Sentence and paragraph display modes shipped in 0.6.0 (§18): a `Display` row in the `Aa` sheet, paragraphs stacked on phones and side by side once the reading column reaches 40rem; inline runs (italics, bold, line breaks) followed in 0.7.0; hide-translation and language order followed in 0.8.0, and the `Languages` row gained `Translation only` in 0.9.0; 0.9.1 splits wrapped paragraph containers into separate blocks (found with the Vietnamese sample), verified on device on 2026-11-16: after re-importing the ZIP the front matter shows the title, author, genre, star, and site lines as separate paragraphs. 0.10.0 splits text-only content at HTML block elements, so a plain untranslated EPUB renders paragraph by paragraph instead of one fused block per container, and its `i`/`b`/`br` markup and inline images survive (verified against plain German and Vietnamese EPUBs). 0.10.1 merges a chapter half that the NCX omits into the chapter it continues, instead of numbering it out of place. 0.11.0 moves the chapter list from the top-bar select into a sheet, so the reading screen names no chapter and a chapter's own heading is never repeated next to it; §19 states the storage contract (settings global, positions resolved by pair id) and `tests/e2e/state-contract.spec.ts` pins it; 0.11.1 retries the settings read and drops a rejected database open, so a transient IndexedDB failure no longer paints defaults over a stored record. Next: the learning layer, planned in `LEARNING.md` (see §17). 0.15.0 starts it
with L0: a sentence sheet, highlights and notes stored as annotations in DB v3,
and pair-range marks that survive reloads; L1 word capture follows.
**Date:** 2026-11-16

Repo map, commands, invariants, and agent instructions: **`AGENTS.md`**. BePub archive format: **`DATA-FORMAT.md`**. Source-edition alignment: **`ALIGNMENT.md`**. Learning layer: **`LEARNING.md`**.

## 1. Summary

DuoReader is a personal, offline-first reader for BePub bilingual exports. It imports the BePub ZIP, reads `reader-master.epub`, and displays the book as source/translation sentence pairs: source leading, translation smaller and dimmed underneath. It runs as an installable PWA on iPad and iPhone, stores books and reading positions on-device, and works in airplane mode after the first load.

Success is concrete: **finish one whole book on the iPad, offline, without losing the reading position.**

## 2. Goals and success criteria

- Import a BePub ZIP from the iOS Files picker; keep several books on a shelf.
- Read sentence-aligned pairs with original paragraph grouping and illustrations.
- Navigate by chapter, show progress, resume within one sentence after force-quit.
- Fully offline after installation: no server, account, or network dependency while reading.
- Comfortable at iPad width and at 390 px iPhone width.
- Adjust font size, line height, and light/sepia/dark theme.
- In three months: one finished book, read on the iPad in airplane mode, position never lost.

## 3. Non-goals for v1

- Page-flip mode (milestone 4; it is a second layout engine).
- Original-only (source-only) and target-first reading toggles; §18 tracks
  them next to the shipped sentence and paragraph modes.
- Translation generation or editing; input is already translated.
- Repairing or rewriting imported book content inside DuoReader; import warnings expose issues, but fixes belong upstream in BePub.
- Automatic or in-reader cross-edition annotation migration; deferred to a separate, rare-use tool.
- Search, sync, accounts, and in-app spaced repetition.
- Dictionary lookup, TTS, highlights, notes, and vocabulary export: planned as a separate learning layer in `LEARNING.md`, not part of the reading loop.
- Arbitrary EPUB import, DRM, Kindle formats.
- Native iOS/Android app or App Store distribution.

## 4. Users and scenarios

Single user, personal tool, no auth.

Typical session: open the installed app on iPad, tap a book, continue at the saved sentence, read for 20 minutes with Wi-Fi off.

Other scenarios: import a new ZIP from Files; switch books; rotate the device.

Failure cases: malformed ZIP, untranslated paragraph, iOS storage eviction, app relaunched offline.

## 5. Functional requirements

| Priority | Requirement |
|---|---|
| Must | Import BePub ZIP; locate and validate `reader-master.epub` |
| Must | Normalize title, author, languages, spine, chapter labels, pair blocks, images |
| Must | Library shelf: list, open, delete, show progress |
| Must | Sentence-pair rendering: one primary language and one secondary (muted, 0.9em, left rule); `Translation first` swaps the roles |
| Must | Preserve paragraph grouping and inline images; lazy-load images |
| Must | Chapter TOC with jump; number chapters where NCX has no title |
| Must | Open at the first spine item; show Next Chapter at the end, hidden on the last chapter |
| Must | Per-book position, progress percent, resume on reopen |
| Must | Font size, line height, theme; persisted settings |
| Must | Offline app shell, installable to Home Screen, safe-area-aware layout |
| Should | Import report: chapter/pair/image counts, untranslated blocks, warnings |
| Should | Render text-only blocks source-only instead of dropping them |
| Could | Display mode from a `Display` row in the `Aa` sheet: sentence-by-sentence (default) and paragraph-by-paragraph with a side-by-side layout once the reader column reaches 40rem (shipped in 0.6.0); `Languages` row (`both`, source only, translation only) and `Order` row (shipped in 0.8.0/0.9.0, §18); library backup/export; search |

## 6. Data and domain

Audited sample: **25 spine documents, 666 blocks, 1,877 sentence pairs, 43 images**. `reader-master.epub` is ≈1.0 MB; the outer ZIP is ≈4.0 MB. Pair IDs (`bid:start:end`) are globally unique and are the stable position keys. The CSV is redundant for this reader.

The NCX labels only front matter and the acknowledgments. The 17 novel chapters are unlabeled and are numbered “Chapter 1” through “Chapter 17”. A real content gap exists in `d_022`: the paragraph “Die Luft um mich herum bewegte sich –” has no translation pair. It renders source-only and is counted in the import report.

Normalized model, stored on import:

```
Book     { id, title, author, sourceLang, targetLang, chapters[], images{} }
Chapter  { index, label, blocks[] }
Block    = Image{ imageId } | Pairs{ pairs[] } | TextOnly{ text }
Pair     { id, bid, source, target }
Position { bookId, chapterIndex, pairId, progress, updatedAt }
```

Display-mode additions to this model — pair offsets (shipped), block identity
via the first pair's `bid`, inline runs (planned), and derived paragraph text
— are specified in §18.

Import is normalized once; reading never re-parses XHTML. Images are referenced by ID and loaded from storage.

IndexedDB layout: `books` holds small shelf metadata, `content` holds chapters, `images` holds image bytes plus media type keyed by `[bookId, imageId]` with a `by-book` index, `positions` holds one resume record per book, and `settings` holds the global reader typography, theme, and display mode. Opening a book joins the book stores and rebuilds image Blobs from the bytes. This avoids Safari's unreliable Blob persistence.

**Edition identity:** an imported book is immutable and singular. `book.id` is the content hash of `reader-master.epub`; a different BePub edition is a different book. Annotations, notes, and vocabulary key on `bookId + pairId`, so there is no automatic cross-edition relinking or migration. Content quality fixes belong upstream in BePub, not in the reader.

Cross-edition migration is a separate, rare-use utility, not a reader feature. Annotation records retain `pairId`, `quote`, and surrounding context so a later export/relink tool can map old highlights and notes onto a new edition without the old book still being installed.

## 7. Typography and wrapping

Wrapping is a hard constraint, not a styling preference. Both languages are normal block text; no `nowrap`, and a pair boundary never forces one line.

- Default `line-height: 1.5` for source and translation; adjustable from 1.3 to 1.9.
- Source and target wrap independently. The second language in the chosen order
  keeps its smaller size (0.9em) and left rule, and may run to multiple lines;
  `Translation first` therefore indents the source instead.
- Preserve `lang="de"` / `lang="en"` on each span; use `hyphens: auto` where WebKit supports it.
- Backstop: `overflow-wrap: break-word`. The sample contains a 46-character unbroken token (`»Niiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiieeeeeeeeeee!`) and a 227-character, 39-word sentence. Hyphenation cannot save the token; mid-word breaking must.
- Acceptance test: at 390 px width and maximum font size, the longest sentence and that 46-character token produce **zero horizontal overflow** at `line-height: 1.5`. Images may scale down; text never scrolls sideways.
- Defaults: serif body, system sans UI, 18 px base on phone, 1.5 line height, second language 0.9em.
- In future page mode, a pair may span pages; a pair taller than the viewport scrolls rather than being clipped.

## 8. Quality requirements

- Import of the 4 MB sample: ≤3 s on the target iPhone.
- Chapter open: ≤300 ms; the largest sample chapter is 166 pairs.
- Scrolling: no visible jank; render one chapter at a time.
- Cold start from Home Screen: ≤1 s.
- Reading makes zero automatic network requests; the app shell is fully precached. The only egress is an explicit, user-initiated action: the external Define lookup when online, and later opt-in AI features (`LEARNING.md` D12).
- No horizontal scrolling at 390 px; long German compounds must wrap.
- Resume accuracy: within one sentence.
- Storage: under 5 MB per book; request persistent storage. Home Screen web apps can request persistence, and WebKit grants it heuristically — not a guarantee ([WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/)). Keep a re-import path if eviction happens.

## 9. Constraints and environment

- Static PWA hosted once over HTTPS; first load needs network, after that offline. No backend.
- Default stack: Vite + TypeScript, vanilla DOM, `fflate` for nested ZIP/EPUB, `idb` for IndexedDB, `vite-plugin-pwa` for precache. Vitest for parser tests.
- iOS 17+ assumed; both iPhone and iPad. Mac/Xcode available later, not now.
- Imported EPUBs are untrusted input: render text via `textContent`, never `innerHTML`; allow only local image blobs; no external resources; cap decompressed size and entry count.
- UI language: English by default; book languages come from metadata.

## 10. Approaches considered

| Approach | Trade-off | Verdict |
|---|---|---|
| **A. Normalize on import, custom renderer** | Parser work up front; full control of typography, progress, sanitization, and future page mode | **Chosen** |
| B. Render `reader-master` XHTML chapters in an iframe with injected CSS | Less parsing; EPUB CSS leaks, sentence-level progress and page mode are fragile | Rejected |
| C. Render `bilingual-sentence.epub` in an iframe | Least code; fixed styling, no per-pair state, still needs nested unzip | Rejected |
| D. Do nothing — keep using the BePub website | Zero build; no offline, no device persistence, no control | Rejected: offline is the stated requirement |

Delivery was settled as a static PWA over a self-contained HTML file (fragile on iOS, no persistent library) and a native shell (Xcode/signing cost too early). The PWA keeps the native path open: the same web code can later be wrapped with Capacitor.

## 11. Design sketch

```mermaid
flowchart LR
  Z[BePub ZIP from Files] --> U[Unzip outer archive]
  U --> R[reader-master.epub]
  R --> P[Parse OPF, NCX, XHTML]
  P --> N[Normalized book]
  N --> D[(IndexedDB: books + blobs)]
  D --> V[Reader: chapters, sentence pairs, position]
  S[Service worker: app shell] --> V
```

Import pipeline: outer ZIP → `reader-master.epub` → OPF spine/manifest → per-document blocks → pairs and images.

Reader pipeline: load normalized chapter → render blocks → observe top visible pair → debounced position write.

## 12. Risks and unknowns

| Risk | Mitigation |
|---|---|
| iOS evicts PWA storage | Call `navigator.storage.persist()`; instruct Home Screen install; keep normalized data small; make re-import easy; test relaunch |
| Import parser misses malformed markup | Audit against the sample; source-only fallback for text without pairs; import report; cap ZIP size |
| EPUB CSS/scripts compromise rendering or security | Never apply book CSS; `textContent` only; local image blobs only; no network |
| Page mode is harder than expected | Deferred; keep block-level model so pagination can reuse it |
| iPhone layout cramped | Design at 390 px first; test long words, images, font-size changes |
| Learning features crowd out reading | Ordered, separately documented in `LEARNING.md`; core capture/export stays offline; no in-app SRS in v1 |
| PWA update breaks offline | Versioned precache; test installed relaunch after deploy |

Pre-mortem: the likely failure is motivation, not technology — the parser and layout feel fiddly, the reading loop never becomes pleasant, and the project stalls. The parser spike plus one real chapter on the phone is the cheapest way to falsify that early.

## 13. Phased plan

| Milestone | Work | Done signal |
|---|---|---|
| **M0 — Parser spike** | Parse the sample ZIP in the browser; emit normalized stats; render one chapter in a throwaway page | `d_022` displays pairs, images, and the source-only paragraph at phone width |
| **M1 — PWA skeleton** | Vite app, manifest, service worker, ZIP picker, library, normalized storage, open chapter | Installed app imports the ZIP and reads `d_006` in airplane mode after relaunch |
| **M2 — Reading loop** | All chapters, TOC, progress, resume, typography/themes, iPhone/iPad layout | Read a full chapter, force-quit, reopen at the same sentence; no horizontal scroll |
| **M3 — Hardening** | Persistence request, import errors, untranslated fallback, lazy images, parser/position tests | Finish one whole book offline |
| **M4 — Page mode (postponed)** | Page index mapping, font/rotation reflow, pair-height handling | Scroll mode reads well enough; revisit only if page turning is missed |
| **M5 — Native shell** | Capacitor wrapper only if PWA limits bite | App runs standalone without browser chrome |

M0–M3 are complete. M3 was verified on device on 2026-11-14 by finishing one whole book in airplane mode. M4 is postponed; the learning layer and its L0–L5 milestones live in `LEARNING.md`.

## 14. Open questions

- Hosting: GitHub Pages or Cloudflare Pages? Default GitHub Pages if this becomes a repo.
- UI language: English, Vietnamese, or German? Default English.
- Minimum iOS version: assume 17+.
- Untranslated blocks: source-only silently, or visibly marked? Default source-only, counted in the import report.
- Library shelf: simple list, or cover thumbnails? Default list.
- Import diagnostics: on-screen warnings only, or a downloadable report for BePub authors? Default on-screen.

## 15. Post-M2 backlog

Checked on 2026-11-14: resume, font size, line height, theme, and airplane mode pass on the installed app; one whole book read offline end to end.

- **Reader font picker** — done in 0.4.0, focus fix in 0.4.1. The picker offers Athelas, Avenir Next, Charter, Georgia, Iowan, New York, Palatino, San Francisco, Seravek, and Times New Roman; no bold toggle. Choices live in `src/reader/fonts.json` as `{ id, label, stack }` records with a `default` id, so the list can change without touching reader code. Stacks are iOS-first with desktop fallbacks, and an unknown or missing stored id normalizes to the default. Default remains New York (serif) to preserve the previous look; sans is available through the same picker rather than as a separate mode. The dialog opens with the heading focused, because `showModal()` would otherwise land on the first control — in 0.4.1 that was the font `<select>`, and iOS opened its native picker on focus. Since 0.12.6 the fonts are typeface chips (each chip previews its own stack) in the sheet's choice-row pattern, so no picker is involved.
- **System theme** — done in 0.5.0. `ReaderTheme` gained `system`, resolved to the light or dark palette from a `matchMedia('(prefers-color-scheme: dark)')` query; a `change` listener reapplies only while `system` is stored. `System` is the default, so a fresh install matches the device; stored Light/Sepia/Dark choices are untouched. Because `data-theme` only ever holds a resolved palette, the existing CSS theme blocks are unchanged. The resolved palette is mirrored to `localStorage['duoreader.theme']` and an inline shim in `index.html` reads it before the bundle runs, so cold start paints the right palette before the async IndexedDB read; the shim duplicates the three `THEME_COLORS` values with a comment pointing at `src/reader/settings.ts`. Device check passed on 2026-11-14: the open installed app follows a system appearance flip, and explicit Light/Sepia/Dark choices are unaffected.

## 16. Versioning and build identity

`package.json` `version` is the single human-facing app version. Bump it before a release commit: minor for user-visible behavior, patch for fixes. Do not hand-edit version strings elsewhere.

The build identity is derived from git at build time:

```
version  0.2.0          package.json
build    12             git rev-list --count HEAD
commit   a1b2c3d        short HEAD
dirty    false          working tree changed at build time (shown as +)
```

`vite.config.ts` injects this object into the bundle and emits `dist/build-manifest.json`. The Library screen displays `v0.2.0 · build 12 · a1b2c3d`; the `+` suffix warns that the loaded build came from an uncommitted tree. The displayed tag is the identity to quote in an issue report.

## 17. Learning layer

Separate document: **`LEARNING.md`**. It owns the learning loop — annotations, vocabulary, dictionary lookup, TTS, Anki export, and the later AI features — including the option/pro-con dossiers behind each open decision.

The only commitments here: reading stays the primary mode, the core capture/review loop works offline, and any network feature is an explicit user action. L0 (annotations core) shipped in 0.15.0: tapping a sentence opens a modal sheet, `Highlight` writes a sentence annotation, `Note` writes a note annotation, both survive a reload, and the chapter repaints the marks when the sheet closes. Sentence mode marks both lines; paragraph mode marks the pair's range inside the joined paragraph. `Done` saves the note; `Remove note` deletes a stored one. A plain EPUB block has no pair, so it becomes a synthetic `text:<path>@<n>` passage: the same sheet is titled `Passage` and the whole block is highlighted or noted. Annotations load by chapter (DB v4 `by-book-chapter`), so opening a book does not pay for notes in chapters it does not render. L1 (word capture) starts next in `LEARNING.md` §6.

## 18. Display modes

Sentence and paragraph modes are implemented (0.6.0) because they differ only
in granularity and derive from the same data. Hide-translation and language
order ship in 0.8.0, and the three-state language mode in 0.9.0; all are
independent settings on the same renderer. The archive already carries
everything; `DATA-FORMAT.md` §4–§6 define the markup and derivation rules.

| Mode | Behaviour | Learner benefit |
|---|---|---|
| Sentence | source sentence, then target sentence, per pair | fine-grained comparison |
| Paragraph, narrow | whole source paragraph, then the same paragraph in the target language, stacked in the current vertical flow | cohesion, natural reading, less fragmentation |
| Paragraph, wide | the two paragraphs side by side, aligned at the top of one row | comparison without fragmentation |
| Source only | target omitted | advanced readers stop leaning on the crutch |
| Translation only | source omitted; the target is promoted to reading size — no rule, normal colour, full size | read the translation as a book |
| Language order | target first — per pair in sentence mode, per paragraph in paragraph mode; the translation takes primary styling and the source the muted rule | L2-first immersion |

No BePub change is required, and there is no read-time copy of the text:
paragraphs are derived on render. Verified against the sample — all 667
paragraph blocks (666 pairs blocks plus the untranslated `d_022` block) match
`bilingual-paragraph.epub` character for character. The rendered variants
remain unused as data sources. Device check on 2026-11-16: iPad and iPhone show
two columns in landscape and the stacked flow after rotating to portrait. The
same devices verified the 0.9.0 combinations: `Both languages`, `Source only`,
and `Translation only` each render in both display modes; in the side-by-side
layout hiding one language lets the remaining text span the row at reading
size; and `Translation first` works with every language mode.

### Control

The `Aa` sheet opens with four related rows, built as choice rows of
`aria-pressed` buttons (`choiceRow()` in `main.ts`) — the sheet owns its
controls, so nothing waits on a native picker (0.12.6, §20):

| Row | Id | Options |
|---|---|---|
| Display | `#settings-display` | `Sentence`, `Paragraph` |
| Languages | `#settings-languages` | `Both languages`, `Source only`, `Translation only` |
| Order | `#settings-order` | `Source first`, `Translation first` |
| Pinyin | `#settings-pinyin` | `Off`, `Above source` |
| Font | `#settings-font` | A disclosure row (`Font  Iowan ›`) that swaps the sheet body for `#settings-font-list`, one row per face |

They are the only home for these choices — no second toggle in the reader
header. Each selection persists through `updateSettings` and re-renders the
open chapter in place, restoring scroll to the pair that was at the top
(resolved to its block through `bid` when the granularity changed). A choice
row flushes its write immediately; the font-size and line-height sliders stay
debounced because they fire per drag step.

The font row follows Apple Books: `showModal()` keeps its heading focused,
tapping the row reveals a pushed list inside the same dialog (a second
`<section>`; `Done` stays outside both panels, so it is always reachable), and
picking a face applies it and pops back. Nothing is presented outside the page,
so one tap is one DOM swap.

The sliders are drawn rather than themed. `accent-color` cannot enlarge the
thumb, so `appearance: none` plus `::-webkit-slider-thumb`/`::-moz-range-thumb`
give a 28 px white knob on a 4 px track inside a 44 px lane; `rangeFill()`
writes `--fill`, which paints the accent up to the knob. Touch tolerance comes
from the lane, not the knob.

The sheet is chrome, not content: `.settings-dialog` sets `--ui-font`
explicitly — its `h2` included — and every row label, group labels (`Display`)
and row labels (`Font`, `Text size`) alike, is 0.9rem in `--fg` while values
stay muted. The serif display face belongs to the Library and chapter
headings, never to a sheet (0.13.1).

On a 390×844 phone the sheet's content is 800 px in an 810 px box, so `Done`
sits on screen; the font list no longer contributes nine inline chips (199 px).
On an iPhone 13 the browser viewport is 664 px, so the sheet still scrolls by
about 170 px there and `Done` starts below the fold — ordinary for an iOS
sheet. The device check of 2026-11-20 accepted that for now; the planned
optimization is to give the four choice rows the same disclosure treatment as
`Font` (or tighten the rows), which is the only remaining content to trim. The
contract is unchanged: it scrolls itself (`overflow-y: auto`,
`overscroll-behavior: contain`) and owns the gesture (§20).

Model (`src/reader/types.ts`, `src/reader/parse.ts`):

```
Pair      { id, bid, start?, end?, source, target, pinyin?, sourceRuns?, targetRuns? }
InlineRun { text, style?: 'em' | 'strong', break?: true }
Block     = Pairs{ pairs[] } | Image | TextOnly
```

- `start`/`end` are parsed from `data-start`/`data-end` and stay optional:
  books imported before 0.6.0 keep working, joining sentences with one space
  instead of the publisher's gap. The block id is its first pair's `bid`;
  there is no separate field.
- **Inline formatting ships in 0.7.0.** `i`/`em` become `em`, `b`/`strong`
  become `strong`, `br` becomes a break; every other element contributes only
  its text, inheriting the surrounding style. Runs are whitespace-normalized
  and trimmed so their text always equals `source`/`target`. The renderer
  creates text nodes and whitelisted elements only — never `innerHTML`, no
  attributes, no links.
- Runs are omitted when a span is plain, so stored books stay lean; books
  imported before 0.7.0 render as plain text and gain formatting only after
  re-import.
- Target runs are parsed the same way and need no extra work if BePub starts
  emitting markup inside `reader-tgt`; the sample has none.
- Text outside pairs inside a paragraph container is dropped; in the sample
  it is separator whitespace only, so nothing is lost.

Paragraph derivation: a pure `blockParagraph(block)` in
`src/reader/paragraph.ts`, called at render time (no second copy stored).
A block is the element that directly owns pair spans (`DATA-FORMAT.md` §4),
so a wrapper holding several `<p>`s yields one block per paragraph and the
derivation never joins across paragraphs. Source keeps `start − previousEnd`
separator spaces (never a plain `join(' ')`), clamped to 4, falling back to
one space when either offset is absent; target joins non-empty pair targets
with one space. Both sides are
`InlineRun[]`: separators are plain runs, adjacent plain runs merge, stored
runs are copied rather than mutated, and a `br` inside a pair survives the
merge.

Settings (`normalizeSettings`): the reader-shape fields clamp or fall back
independently — `displayMode` (`sentence` | `paragraph`), `languages`
(`both` | `source` | `target`, default `both`), `languageOrder`
(`source-first` | `target-first`, default `source-first`), and `pinyin`
(`off` | `sentence`, default `off`) — alongside the
typography fields. Unknown values fall back to the default. There is no
storage migration step: settings are normalized on load, and older stored
settings gain the defaults. The 0.8.0 boolean `translation` is read once and
mapped (`false` → `source`, anything else → `both`), so a device that stored
it keeps its choice.

Renderer (`src/main.ts`): paragraph mode emits one `.paragraph` element per
pairs block holding `.src` and `.tgt`; the block carries its first pair's id
as `data-pair-id` (so `scrollToPair`, `topPairId`, and `progressAt` keep
working) and the `bid` as `data-bid`. Resume and mode switches resolve a saved
pair id to its block through `bid` when no element carries that id.
`appendRuns` builds both modes: text nodes for plain runs, `<em>`/`<strong>`
for styled runs, `<br>` for breaks, and a plain `textContent` fallback for
books imported before runs existed. Both branches end in the shared
`appendLanguages`: it drops whichever language the mode hides, appends the
rest in `languageOrder`, and still shows a source-only block's source when
`languages` is `target` because that is the only text the block has. Hidden
languages never reach the DOM.

Pinyin (0.12.0) is a source-side reading aid read from `data-pinyin`
(`DATA-FORMAT.md` §4). `Pair.pinyin` is folded to one line at parse time;
`appendPinyin` prepends a `<span class="pinyin" lang="zh-Latn">` inside `.src`
in both modes, so the language mode hides it with the source, `languageOrder`
moves it with the source, and the paragraph grid keeps it in the source
column — no second visibility rule exists. Paragraph mode joins the
sentences' pinyin with one space through `paragraphPinyin(block)`, skipping
sentences that have none. Archives without the attribute render exactly as
before; the setting is therefore safe to leave on. Sentence-level only: the
pinyin is word-spaced, and aligning syllables to characters for ruby is a
separate problem.

Side-by-side is CSS, not a setting. `applySettings` mirrors the mode onto
`<html data-display>`, which widens the reading column and the sticky top
bar's inner column together from 42rem to 64rem so the header stays aligned;
on phones that cap is above the viewport, so nothing moves. `.reader` is a
`container-type: inline-size` container, and each paragraph block becomes
`display: grid; grid-template-columns: 1fr 1fr; gap: 2rem` with `min-width: 0`
children once `@container (min-width: 40rem)` holds. Below 40rem — every
phone width — it keeps the current vertical flow: the first language of
`languageOrder`, then the second one muted at 0.9em behind its hairline left
rule. In two columns the hairline and indent are dropped for whichever
language is second (`.paragraph .src, .paragraph .tgt`), since the gutter
separates them, while the muted colour and smaller size stay; both columns
start at the top edge of the row. Columns follow DOM order, which
`appendLanguages` already set from `languageOrder`, so source and translation
swap sides with no extra CSS. Stacked, the second language carries the gap
(`margin-top: 0.3rem`). `applySettings` mirrors the language mode onto
`<html data-languages>` and the order onto `<html data-order>`; the secondary
rule is gated on `both`, so a sole visible language keeps primary styling — no
hairline, normal colour, `1em` — whatever the order says. With `Translation
first` the rule therefore moves to `.src` instead of `.tgt`, and pinyin, which
lives inside `.src`, sits above the now-secondary source. Hiding either
language leaves one child,
which spans the row (`grid-column: 1 / -1`), so paragraph mode reflows to one
full-width column instead of leaving half the row empty.

Tests: `tests/parse.test.ts` covers offsets, malformed attributes, the run
whitelist (nesting, flattening, omission of plain runs), and `data-pinyin`
(folding, whitespace-only, absent); `tests/paragraph.test.ts`
covers gap 0 vs 1, missing offsets, source-only blocks, target joining, run
merging, breaks, pinyin joining, and that stored runs are not mutated; `tests/settings.test.ts`
covers normalization for `displayMode`, `languages` (including the 0.8.0
boolean migration), `languageOrder`, and `pinyin`, and `tests/storage.test.ts` the
persisted field plus the v1 upgrade gain. `tests/e2e/display-modes.spec.ts`
switches modes through the `Display` row, checks italics in both modes, the
stacked phone layout against two aligned columns at tablet width, walks
source-only (target gone, source spanning the row), translation-only (source
gone, target borderless at body size), and translation-first (DOM order,
column position, the promoted translation's colour and size, stacked order, a
lone visible language staying primary, and the roles resetting when the order
returns to source-first) in both modes, and re-checks the choices after
a reload. `tests/e2e/pinyin.spec.ts` pins the pinyin row: off by default, one
muted line above each annotated source and none for a sentence without it,
joined per paragraph, hidden with the source, and remembered after a reload.

Upstream asks (optional): block `data-bid` on the container; a guarantee
that inter-pair gaps are whitespace; a paragraph translation field only if
paragraph MT ever differs from the sentence join.

Risks: non-whitespace gaps break reconstruction; target joins assume MT
spans never need to abut after a space; books imported before 0.6.0 have no
offsets (one-space fallback) and books imported before runs exist render
without italics, so translation-only mode shows plain text until BePub emits
markup in `reader-tgt`. At the 40rem breakpoint each column is only about 19rem wide,
so raise the threshold if tablet portrait reads cramped.
Do not implement the manifest's advertised `columns` mode — no columns
artifact exists.

## 19. State ownership contract

Four kinds of state, kept apart. Import and re-import are the only operations
that can silently damage a reader's setup, so the rules below are pinned by
`tests/e2e/state-contract.spec.ts` rather than left to review.

|State|Store|Key|Scope|On import / re-import|
|---|---|---|---|---|
|Reader settings|`settings`|`reader`|Global, one record|Never read or written|
|Book content|`books`, `content`, `images`|`book-<sha256>`|Per book, immutable|Replaced wholesale for the same id; `importedAt` kept|
|Reading position|`positions`|`book-<sha256>`|Per book|Resolved by pair id first, chapter index second|
|Annotations|`annotations`|`id`; `by-book`, `by-book-pair`|Per book|Kept for the same id; deleted with the book|

Rules:

1. **Import writes content only.** `saveBook` opens `books`, `content`, and
   `images`; settings, positions, and annotations are outside that transaction.
   A re-import therefore keeps every reader setting, the position, and the
   marks.
2. **Settings are global by design**, not per book: typography, display mode,
   language mode, and order describe the reader, not the edition, and must not
   jump when the reader switches books. Per-book state is content, position,
   and annotations.
3. **The position's pair id outranks its chapter index.** A parser change can
   merge or renumber chapters (0.10.1 merged a continuation split), so
   `openBook` finds the chapter that contains the stored pair and only falls
   back to the index when the pair is gone. A stale index with a valid pair is
   the expected shape after an upgrade, not an error.
4. **A regenerated archive is a new edition.** `book.id` hashes
   `reader-master.epub`, so a changed export imports as a separate book:
   settings carry over (they are global), the old book's position and marks do
   not. That is deliberate, see invariant 3 in `AGENTS.md`.
5. **Field changes go through `normalizeSettings`.** Adding a field means
   defaulting it there; renaming or removing one means a migration in the same
   function plus a test of the old record shape. Nothing else may write the
   settings record.
6. **New persistent state is classified here first.** Before it is added, say
   which row of the table it belongs to and extend the contract test with how
   import and re-import treat it.
7. **Deleting a book forgets its position and marks.** `deleteBook` removes the
   book, its content, its images, its position row, and its annotations
   together; settings are untouched. Re-importing after a delete therefore
   starts at the cover with a clean page, and that is the expected shape — not
   a lost resume. Delete means forget.
8. **Annotations belong to an edition.** A mark stores the pair id, the side,
   character offsets, and the exact slice; rendering skips a mark whose slice no
   longer matches the sentence instead of painting the wrong words. A new
   edition therefore starts with no marks, and the old book keeps its own.

Consequence worth stating plainly: a re-import cannot reset reader settings —
no import path writes that record. Two cases look like it did:

- **The record is gone.** Storage eviction, cleared site data, or a fresh
  install; the app cannot tell that apart from a first run, and the fix is the
  persistence request plus keeping the ZIPs.
- **The record is intact but the page rendered defaults.** That was the 0.11.0
  shape on iOS: the first `indexedDB.open` throws around a service-worker swap,
  `boot` swallowed it and painted defaults, and the next settings change wrote
  those defaults over the good record — out of sync until fiddled with, then
  permanently lost. Fixed in 0.11.1: `loadStoredSettings` retries four times
  with backoff, `database()` drops a failed open instead of memoizing the
  rejection, and `tests/e2e/settings-recovery.spec.ts` simulates the throw.

## 20. Sheet interaction contract

A sheet — the `Aa` settings dialog and the `Chapters` list — is modal in the
user's model: it is on top, so it owns the gesture. `<dialog>` alone does not
deliver that, and neither did two attempts to patch it around it.

What was measured, in order:

| Attempt | Mechanism | Result |
|---|---|---|
| 0.12.2 | `overflow: hidden` on `<html>` while a sheet is open | Stopped the Chromium wheel leak. The iPhone still scrolled: WebKit ignores root `overflow` when it decides whether a touch may pan the viewport. |
| 0.12.3 | A non-passive `touchmove` listener that cancels the gesture | Cancelled the gesture in Chromium, but the phone still scrolled, and it had a hole: whenever the sheet itself overflowed, the listener allowed the gesture (the sheet's `overflow-y: auto` ancestor "owned" it), so the drag scrolled the sheet and the story moved with it. |

Both were event-based patches on a structural problem. The rule is now
structural, and it does not depend on any engine's gesture semantics:

1. **The viewport never scrolls.** `html` and `body` are `height: 100%` with
   `overflow: hidden`. There is nothing for a touch to pan, so the question
   "does the gesture reach the page?" has no answer.
2. **`#app` is the app's only scroller.** The story lives in a scroll pane
   inside `#app`, and `#app` is a **sibling** of the dialog, never an
   ancestor. A top-layer `<dialog>`'s scroll ancestor is the viewport, so the
   chain from the sheet runs dialog → body → html and stops at a viewport that
   cannot move. It never passes through `#app`. That is why the gesture
   cannot reach the story, whatever the engine does with the touch.
3. **The app scrolls through `scrollTop()`/`scrollTo()`.** These read and
   write `#app.scrollTop`. Nothing may use `window.scrollY` or
   `window.scrollTo` — the document no longer scrolls, so those would be
   silently wrong. The anchor keeps working: it is `scrollTop() + rect.top`,
   which is the same arithmetic as before, against the pane instead of the
   window.
4. **The sheet scrolls itself, and its own scrolling is not a gesture
   problem.** `max-height: calc(100dvh - 2rem)` with `overflow-y: auto` and
   `overscroll-behavior: contain`. `sheetGestureGuard()` then only keeps the
   sheet's behaviour sane: it never cancels a `touchmove` that starts on a
   control (so a range slider follows the finger from anywhere on its track)
   or on a box inside the sheet that can scroll (the chapter list, or the sheet
   when it overflows), and it cancels the rest so a drag on the sheet is
   neither a page pan nor a text selection.
5. **The sheet owns its controls, and nothing under it filters.** Two
   backdrop filters were live beneath the top layer: the bar's `blur(12px)`
   and the sheet's `::backdrop` `blur(2px)`. On iOS 26 the native `<select>`
   picker re-snapshotted them, so its shadow arrived about a second late; the
   backdrop is now a plain 40% black tint and `html:has(dialog[open]) .topbar`
   drops the bar's blur while a sheet exists. That helped, but the first tap
   could still open the platform picker and close it again — a WebKit/iOS 26
   defect the page cannot reach — so 0.12.6 removed every `<select>` from the
   sheet: each choice is a row of `aria-pressed` buttons. 0.13.0 moved the
   longest list (ten typefaces) behind a `Font … ›` disclosure that swaps the
   sheet body for a pushed list in the same dialog. Both rules stand: no filter
   under a top-layer sheet, and no native picker in one. The costs are only
   visible on a device, never in CI.
6. **Add a sheet, extend the test.** A new `<dialog>` inherits the guarantee
   from the structure, not from the sheet code, but the test should still gain
   a drag on the new surface.

Verified in two engines, because the bug only ever appeared in one of them.
`tests/e2e/sheet-scroll.spec.ts` pins the structure (viewport overflow hidden,
document not scrollable, `#app` scrollable), that a drag on the sheet leaves
the pane where it was, that a drag on the slider's track moves the slider, and
that the reader stays anchored on the same pair. The suite runs in Chromium and
WebKit; the CI workflow installs both.

Why it drifted without anyone touching modality: the bug needs a document tall
enough to scroll and a gesture that starts on the sheet. The M2 dialog was
shipped and device-verified against a short story, where the reader cannot
scroll at all, and the pre-0.12 sheet was short enough that drags landed beside
it on the backdrop. The Pinyin row made the sheet ~90% of the viewport, so the
symptom appeared two releases after its cause — and Chromium, the only engine
in CI, did not reproduce it, which is why two event-based patches could ship
without either of them being caught.
