# ALIGNMENT.md — source-edition alignment

**Status:** first case built. `npm run align -- out/align/seagull/case.json`
turns the English PDF and Vietnamese EPUB into an importable BePub ZIP.
Overrides and independent QA gates are still planned. Format contract for the
output: `DATA-FORMAT.md`. Authored story collections: `stories/README.md`.

This document is the durable contract for turning **two existing editions** of
the same work into one BePub ZIP. It is not a per-book plan: each book gets a
small `case.json`, and the only durable prose is what belongs here.

## 1. Scope

**In.** Two files that contain the same work in different languages, in a
supported format; chapter order preserved; no machine translation. Output is a
BePub ZIP the reader already imports.

**Out.** Translation generation, DRM removal, page-image preservation, repairing
a different/abridged edition, rendering inside DuoReader. A book that is not the
same text cannot be aligned; detect and stop.

Reuse is the point: adapters differ per format, the aligner, review, and
emitter do not.

## 2. Pipeline

```
case.json
  → extract        (format adapter → Doc, cached OCR)
  → normalize      (NFC, quotes, spaces, line-end hyphenation)
  → segment        (chapters → paragraphs → sentences)
  → align          (chapter pairing → sentence DP → paragraph grouping)
  → review         (review.html / review.md / review.json + prompt)
  → decide         (optional decisions.json; external LLM or human)
  → emit           (neutral input → tools/bepub/emit.ts)
```

Every stage writes an artifact under `out/align/<slug>/`. Extraction is
resumable: OCR is cached in `pages/ocr.json`, alignment is deterministic, and
the review is regenerable. Book text stays in `out/` (gitignored); only the tool
and this document are committed.

## 3. Code layout

```
tools/align/
  cli.ts             # case.json → alignment.json + review + ZIP
  model.ts           # Doc / Chapter / Paragraph / Alignment
  adapters/
    epub.ts          # OPF + NCX + <br><br> paragraphs
    pdf.ts           # PDF.js render + Windows OCR + line/paragraph rules
    ocr.ps1          # Windows.Media.Ocr bridge
  segment.ts         # sentence boundaries, quote/attribution folding
  align.ts           # chapter sentence stream DP, paragraph grouping
  review.ts          # review.html + review.md
  decisions.ts       # review.json / prompt + validated decisions.json
  emit.ts            # alignment.json → tools/bepub/emit.ts
tools/bepub/
  emit.ts            # neutral BePub emitter (story + aligned front-ends)
  build.ts           # story collection front-end
```

One CLI, two implemented adapters, one emitter. A new format is a new adapter
file, not a new pipeline.

## 4. Common model

The aligner does not see EPUB, PDF, or HTML. Adapters produce:

```ts
interface Doc {
  lang: string;
  title: string;
  chapters: Chapter[];
  meta: { format: string; pages?: number; warnings: string[] };
}

interface Chapter {
  index: number;
  label: string;
  paragraphs: Paragraph[];
}

interface Paragraph {
  text: string;
  page?: number; // PDF provenance for review
}
```

`src/reader/types.ts` is the reader model; do not reuse it as the tool model.
`emit.ts` converts aligned pairs into `reader-pair` markup.

## 5. Adapters

| `kind` | Input | What it does | Status |
|---|---|---|---|
| `epub` | EPUB | OPF spine + NCX labels; splits each `<p>` at `<br><br>`; first chapter can skip dedication | Implemented |
| `pdf-ocr` | Scanned PDF | PDF.js renders pages at 2×; Windows OCR returns line boxes; body margin/indent/text boxes become paragraphs | Implemented |
| `pdf-text` | Digital PDF with text layer | Line grouping by baseline, no OCR | Planned; the sample's text layer is only partly clean |
| `pairs-json` | Already aligned JSON/CSV | Direct map to neutral model | Planned |

Rules that must not be hardcoded per book:

- Body left margin = leftmost body line, not the mode: OCR pages with a paragraph
  indent can make the indent the mode.
- Paragraph start = first-line indent (`x > body + 8`) or a new text box
  (`x > body + 80`); a page break is not a paragraph break.
- Running heads sit in the top margin (`y <= 100`) and are about 14 px tall;
  body lines can start near `y ≈ 93`. Drop the short top-margin lines, not every
  line above 100.
- Page numbers are short numeric-like lines at the bottom (including OCR `TO`
  for `10`).
- Chapter starts can be explicit (`page_starts`); otherwise detect a centered
  heading above the first body line. Heading lines are selected by vertical
  position, not OCR order.
- Chapter titles are never trusted from OCR: `case.json` overrides them.
- Windows OCR can split one visual line into several boxes. Merge boxes on the
  same baseline in x order before paragraph detection; otherwise a line such as
  `"You're ... you're ... talking,"` becomes two fragments.
- A source paragraph that starts lowercase is a continuation. Merge it into the
  previous paragraph even across a page break; do not do this for dialogue that
  starts with an opening quote.

## 6. Case manifest

`case.json` is the only hand-authored file per book. Keep it beside the cached
artifacts so the inputs stay read-only:

```json
{
  "id": "seagull-en-vi",
  "title": "The Story of a Seagull and the Cat Who Taught Her to Fly",
  "author": "Luis Sepúlveda",
  "source_lang": "en",
  "target_lang": "vi",
  "source": {
    "kind": "pdf-ocr",
    "path": "test_data/…unito.pdf",
    "lang": "en",
    "scale": 2,
    "page_starts": [5, 9, 17, 23, 28, 34, 40, 47, 51, 55],
    "titles": ["The North Sea", "…"],
    "replacements": { "Pefias": "Peñas" },
    "max_chapters": 9
  },
  "target": {
    "kind": "epub",
    "path": "test_data/chuyenconmeodayhaiaubay.epub",
    "lang": "vi",
    "skip_until": "Có đàn cá trích",
    "titles": ["1. Biển Bắc", "…"],
    "replacements": { "wrong target sentence": "corrected target sentence" },
    "max_chapters": 9
  }
}
```

`page_starts` includes an end marker (one past the last retained page).
`skip_until` drops front matter from the first retained EPUB chapter.
`start_chapter` skips N content chapters before collecting; use it to split a
two-part edition without rebuilding the EPUB. `replacements` applies exact
substitutions to source OCR lines or target EPUB paragraphs; use it for OCR and
translation fixes, not editorial rewriting.

Do not commit book text, OCR output, or aligned text to the repository unless
the text is authored here (the `stories/` case).

## 7. Segmentation

**Normalize first, but keep display text.** NFC; remove soft hyphens; collapse
spaces; repair OCR punctuation spacing. Footnote markers (`[7]`) stay in display
text and are ignored by anchors.

**Sentences.** `Intl.Segmenter` is the baseline, with two folding rules:

- a fragment that starts lowercase continues the previous sentence
  (`"St Michael's!" she shrieked.` stays one unit, and so does an unquoted
  thought attribution such as `He's the best! he corrected himself.`). If the
  folded source contains that second, lowercase sentence and the target has two
  sentences, the pair is reported `2:2` rather than a misleading `1:2`. Case is
  tested with Unicode `Ll`, not a Latin range: `à-ỹ` also contains uppercase
  `Đ` (U+0110) and the uppercase Vietnamese vowels;
- a fragment that consists only of closing quotes or brackets attaches to the
  previous sentence.

Quoted sentences are otherwise split at their own terminal punctuation, so a
long quotation becomes several pairs instead of one giant unit.

**Paragraphs.** Preserve the edition's paragraphing. Cross-page continuation is
a paragraph only if the next page starts at the body margin; an indented first
line starts a paragraph. A narrow, far-right block is a text box and stays one
paragraph. A source paragraph that ends inside an open quote is merged with the
next source paragraph when that paragraph starts lowercase; PDF paragraph
detection can break a quotation at a page or line edge. The target's separate
quote and attribution paragraphs may still meet inside the merged source
paragraph during grouping. Dehyphenate `bear-` + `ings`; keep real compounds.

## 8. Alignment

Monotone dynamic programming; every transformation preserves order.

**Chapters** pair by index after trim. The first case maps 9 English chapters to
9 Vietnamese chapters; a missing chapter becomes source-only or target-only.

**Sentences** are flattened across the whole chapter with their paragraph index.
DP moves are `1:1`, `1:2`, `2:1`, `1:0`, `0:1`. Cost:

$$c(u,v)=\left(\log\frac{|t|}{|s|}-\log r\right)^2+0.45\,[u\ne v]-0.12\,A(u,v)$$

`|·|` is space-stripped characters; `r` is the chapter ratio (median paragraph
ratio blended with the total ratio); `A` rewards shared proper nouns and digits
(capped at 3). `[u≠v]` discourages gratuitous merges. A move that crosses a
target or source paragraph boundary pays another `0.35`. A target-only sentence
that begins with an opening quote pays `2`, and a quote/non-quote mismatch pays
`0.25`, so a new quotation stays with the next source quote instead of being
attached as a `0:1` to the previous pair.

**Paragraph grouping.** After the DP, pairs are grouped by their source
paragraph. A target sentence that arrives alone is deferred: it is attached to
the neighbouring source pair whose length matches better, so a translation-only
sentence at a paragraph start does not get glued to the previous paragraph.
When it is attached to an existing pair, the flags are counted from both final
sides (`1:2`, `2:2`, …), never a bare `0:1`. A PDF paragraph split inside an
open quote is merged on the source side before DP.

**Post-pass.** A `1:2` immediately followed by a `2:1`, or its mirror `2:1`
followed by `1:2`, is the signature of a crossed boundary: one sentence on each
side belongs with the neighbor. The two groups are split into three `1:1` pairs
when that is cheaper. A `1:2` followed by a `1:1` or a `1:0` can instead be a
target boundary that slipped one sentence (`...great speed.` / `...kinh khiếp.
Báo động!` before `Alert, he leapt...` / `Nó nhảy...`, or `...front paws.` /
`...ôm đầu. Nó xem chừng...` before `He seemed truly devastated.` / empty); the
left target's second sentence moves to the next pair when that is cheaper, so a
source-only gap disappears. A true `2:2` block is split into two `1:1` pairs.
This removes visible “But how?” / “Nhưng…” drift.

**Gaps.** `1:0` emits a source-only pair with empty target; the reader shows it
in the source language and the review marks it `gap`. A source-less target
sentence is merged into a neighbour; if the neighbour has a source, the pair is
counted as `1:2`/`2:2`, not `0:1`. A true `0:1` only appears when no source
pair exists. Never duplicate text.

## 9. Non-1:1 cases

| Case | Emit as | Notes |
|---|---|---|
| `1:1` | One pair | Default |
| `1:2`, `2:1` | One pair with multiple sentences on one side | Legitimate; flag for review |
| `2:2` | One pair with two sentences on each side | An unquoted lowercase attribution is folded and reported `2:2`; a true `2:2` block is split into two `1:1` pairs |
| `1:0` | Pair with empty target | Reader shows source only; flag |
| `0:1` | Attach to neighbour | An empty source line is not useful |
| Reordered text | Separate blocks | Cannot be expressed as crossing pairs |

The reader renders a pair as one unit; it cannot show that a merge happened.
That is why merges and gaps are review flags, not reader-visible states.

## 10. Review and LLM adjudication

`review.html` is self-contained and offline; `review.md` lists flagged units for
phone/terminal reading. Each row carries a key
`ch01/p003/s002`, chapter label, source, target, and flags.

For hard boundaries, the deterministic DP is not always the best judge. The
tool exports the same flagged paragraphs, at paragraph granularity, in
`review.json` plus a ready-to-send `review-prompt.md`. An external LLM or human
chooses a grouping of the existing sentences and writes `decisions.json`; the
build applies it before emission. There is no built-in provider or API key, and
reading never calls a model.

LLM-bound review runs in a subagent pinned to
`commandcode/claude-haiku-5-5:medium` with `thinkingLevel: medium`. Do not use
`:auto`: auto-thinking routes an auxiliary judge through OpenRouter. Do not use
OpenRouter or omp API keys for review. The app remains provider-free; only the
external reviewer's transport is pinned, and `decisions.json` remains the only
way a review changes output.

Keep review lanes closed by case: Part One is finished and its reviewed
artifacts stay in `out/align/seagull/`; Part Two is a separate case and review
in `out/align/seagull-part2/`. A Part Two decision cannot silently invalidate
Part One's reviewed output.

```json
{
  "schema_version": 1,
  "decisions": [
    {
      "key": "ch04/p002",
      "source_hash": "…",
      "target_hash": "…",
      "groups": [
        { "source": [0], "target": [0] },
        { "source": [1], "target": [1, 2] }
      ]
    }
  ]
}
```

`groups` are index arrays into `review.json`'s `source` and `target` sentence
arrays. Every index must appear exactly once, in order; empty source or target
side is allowed for a gap. Hashes are optional but reject stale decisions after
an editorial change. Put `decisions.json` beside `case.json` for automatic
reuse, or pass `npm run align -- case.json --decisions path.json`. The LLM must
not rewrite text; it only chooses the grouping.

Flags implemented today: `1:2`, `2:1`, `2:2`, `1:0`, `0:1`, `gap`, `merge`,
`ratio`.
The base `alignment.json` stays reproducible. A rebuild changes `book.id`, so
review the draft before reading far; the final import is a new book and starts
at the cover.

DuoReader has no annotations (L0 is planned), no visible pair ids, and no way to
report a bad pair. Do not use it as the review surface; use it only for a final
typography/flow spot-check.

## 11. QA gates

Implemented now: source coverage (every source sentence appears once), pair
monotonicity (by construction), ratio flags, gap flags, unique pair ids, and a
`parseBePubZip` smoke test. Planned: spellcheck, anchor-only-one-side, first/last
boundary checks, and a determinism assertion in CI.

Tests: `tests/alignment.test.ts` covers quote/attribution segmentation, the
Unicode lowercase boundary that fixes uppercase Vietnamese `Đ`, multi-sentence
quotation splitting, source-paragraph continuation merging, target-quote
boundary alignment, a gap, a `1:2` merge, a `2:2` attribution merge, a target
sentence shifted to the next pair, and a target sentence moved into a
source-only gap; `tests/decisions.test.ts` covers review export, grouping
application, index validation, and stale hashes.
The story-builder suite covers the neutral emitter.

## 12. Emission

`tools/bepub/emit.ts` is the single emitter; `build.ts` and the aligner both use
it. The story-collection output is byte-identical to the pre-refactor builder
(same `book.id`). Aligned output adds one title pair per chapter and one
paragraph block per source paragraph. Text-only blocks are supported; scanned
page images are never emitted. `source_lang`/`target_lang` come from
`case.json`; fixed mtimes and `created_at` keep rebuilds stable.

## 13. Failure catalogue

| Failure | Detection | Mitigation |
|---|---|---|
| No text layer | Font count / OCR needed | Digital edition first; OCR fallback |
| Scanned text | Image-only pages | `pdf-ocr`, 2× render, cached |
| Running heads | Repeated edge lines | `y > 100` filter |
| Page number read as `TO` | Short bottom line | bottom + numeric-like filter |
| Line-end hyphenation | `-` + lowercase continuation | Join, keep known compounds |
| Paragraph split at page | Counts + page-boundary line | Carry paragraph state across pages |
| Paragraph split inside a quote | Unclosed quote + lowercase next | Merge source paragraphs before DP |
| Target paragraph starts a quote late | Previous pair ends with a `0:1` target quote | Penalize target-only quotes; count the joined pair |
| Indented-mode confusion | Body margin too large | use leftmost body line |
| Text box read as paragraphs | Far-right narrow lines | boxed-column grouping |
| Chapter headings unreadable | OCR small caps | page geometry + `titles` |
| Chapter split across files | Two headings in one file | Paragraph-level segmentation |
| Numbering resets | Duplicate “1.” | Sequence alignment |
| Translation merges/splits | `1:2`, `2:1` | One pair per unit; flag |
| Omitted/added text | `1:0`, `0:1` | Source-only pair; flag |
| Different edition | Chapter/length mismatch | Abort |
| Diacritic damage | Broken combining marks | NFC + repair pass |
| OCR platform | Windows-only engine | Cache; adapter behind an interface |

## 14. Worked case

*The Story of a Seagull…*, English → Vietnamese.

- English: 54-page OCR PDF, story pp. 5–54, **Part One, chapters 1–9**.
- Vietnamese: 20-chapter EPUB; Part One chapters 1–9; `<br><br>` paragraphs;
  front matter and site footer trimmed.
- Paragraph counts (source/target): 15/15, 34/34, 22/22, 22/24, 25/27, 16/17,
  38/38, 16/16, 7/7.
- Result: 502 content pairs (511 with chapter titles), 194 aligned paragraphs,
  41 flagged, 38 merges, 2 source-only pairs, 0 warnings from `parseBePubZip`.
- Chapter 1's “It would be a beautiful time…” is two `1:1` pairs; before the
  Unicode `Ll` fix, uppercase Vietnamese `Đ` matched `[a-zà-ỹ]` and folded the
  second target sentence into the first, producing a false `2:1`.
- Chapter 2's “He is a good kid…” is `1:1` for the first sentence, `1:1` for
  “What do I mean…?”, then `2:2` for “He's the best! he corrected himself…”:
  the lowercase attribution stays with the exclamation, and both sides contain
  two sentences. The `2:2` label records the zoomed-out grouping; it is not
  split into a standalone lowercase fragment.
- Chapter 4's “At the precise moment…” is `1:1`, then `1:2` for “Alert, he
  leapt up…” with `Báo động! Nó nhảy…`: the target-shift post-pass moves
  `Báo động!` from the previous pair to the sentence it translates. The
  translation text itself is untouched.
- Chapter 7's “Dreadful story!” source paragraph was split at a page/line edge
  after “oil..”; the open-quote continuation merge rejoins “sick gull... that's
  it!”, and the long quotation becomes five `1:1` pairs ending with the
  attribution. No gap.
- Chapter 7's “You see?” paragraph now keeps `"Anh thấy chưa?` with its own
  source sentence instead of attaching it to the previous Einstein paragraph as
  a `0:1`; the target paragraph is aligned `1:1` then `1:1`, no flag.
- Chapter 7's “He was nervously pacing…” is two `1:1` pairs: the target-shift
  post-pass moves `Nó xem chừng đang thật sự tan nát cõi lòng.` out of the
  previous pair and into the source-only gap at “He seemed truly devastated.”
- Gaps are real translation omissions (e.g. the Colonel's “That is exactly…”
  line in chapter 5, or “Curious indeed.” in chapter 2, which quote splitting
  made visible) or attribution echoes; they render as source-only lines.
- First import verified in Chromium at 390×844: title pair, nine chapters,
  source/target styling, chapter sheet, and a source-only gap render. Vietnamese
  diacritics show decomposed marks in this Windows Chromium profile with the
  existing Vietnamese sample too, so it is a font/environment artifact, not a
  data defect; the strings are NFC.
- Part Two is a separate case, `out/align/seagull-part2/`, so its review cannot
  invalidate Part One. English pages 59–128 of the 132-page scan; 11 chapters;
  the Vietnamese EPUB uses `start_chapter: 9`. Initial deterministic result
  after baseline grouping and lowercase continuation merging: 779 pairs, 364
  aligned paragraphs, 98 flagged, 2 gaps, 96 merges. The two gaps are `"No.`
  (the Vietnamese target omits it) and `"Bully for you,"` (the target sentence
  is shifted into the next pair and is a review-decision candidate).

## 15. Reuse checklist

1. Copy `case.json`; set languages, chapter start pages, trim, and titles.
2. Pick adapters from §5; do not write a new one until a format recurs.
3. Run extract; inspect chapter and paragraph counts, not the whole text.
4. Align one chapter; tune thresholds; confirm 1:1 rate, merges, and gaps.
5. Run the full alignment; read `review.md`.
6. Build and import once; spot-check typography, chapter sheet, and gaps.
7. Keep the case recipe; add new failure modes to §13.

## 16. Limits / next

- Windows OCR only; other platforms need a Tesseract adapter behind the same
  interface.
- No built-in LLM provider: `review-prompt.md` is for an external model or
  human; `decisions.json` is validated and applied deterministically. Adding an
  API adapter later must keep that contract.
- No overrides for arbitrary text: decisions choose a grouping of existing
  sentences, so they cannot silently rewrite an edition.
- No chapter DP yet; chapter maps are positional. A differing chapter count
  needs a `titles` map and a manual check.
- The digital text layer in the sample is unusable on even pages, so OCR is the
  current path. A cleaner digital edition should use `pdf-text` when added.
