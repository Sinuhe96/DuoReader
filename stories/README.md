# stories/ — authored collections

One directory per collection. A directory is the source of one importable
BePub ZIP: the reader consumes only `reader-master.epub`, which the builder
generates from the story JSON and image files that live here.

```
stories/sima-guang/
  book.json            collection order, labels, paragraph grouping, images
  sima-guang.json       the adapted story, verbatim model output
  images/zagang.jpg     one illustration
```

Build (writes `out/books/<dir>.zip`, gitignored):

```bash
npm run book -- stories/sima-guang
```

## `book.json`

| Field | Meaning |
|---|---|
| `title` | Book title shown in the library and in the OPF `dc:title` |
| `author` | OPF `dc:creator` and the NCX `docAuthor` |
| `source_lang` | BCP-47 tag on `reader-src`; also decides spacing (below) |
| `target_lang` | BCP-47 tag on `reader-tgt` |
| `created_at` | Optional; pinned timestamp in `manifest.json`. Keep it fixed so rebuilds stay byte-identical |
| `stories[]` | One chapter per story, in reading order |
| `stories[].file` | Story JSON, relative to the collection |
| `stories[].label` | Chapter label in the chapter sheet; defaults to `title_zh`; prefixed `1 · ` when the collection has several |
| `stories[].pinyin` | Pinyin of the title pair (the model does not emit one) |
| `stories[].paragraphs` | Paragraph lengths in sentences, used when the story has no `p` |
| `stories[].image` | Illustration, relative to the collection |
| `stories[].alt` | `alt` text for that image |
| `stories[].image_after_paragraph` | `0` puts the picture before the first paragraph; `n` puts it after paragraph `n` |

## Story JSON (model output)

```json
{
  "title_zh": "…", "title_en": "…", "level": "HSK 2-3",
  "sentences": [{ "id": 1, "zh": "…", "pinyin": "…", "en": "…", "p": 1 }],
  "key_vocabulary": [{ "zh": "…", "pinyin": "…", "en": "…" }]
}
```

Require from the model, on top of the base prompt (`test_data/Sima Guang.json`
kept the first version):

1. **`sentences[].p`** — 1-based paragraph number. Without it every sentence of
   a story becomes one paragraph, and paragraph mode shows one long block.
2. **Sentence alignment 1-to-1** (already required) and **`pinyin` on every
   sentence** — the reader draws it above the source (`DESIGN.md` §18).

Illustration placement is editorial, never a model field: the model may
describe the picture in `alt`, but the file, its anchor, and the label are
`book.json`'s business.

`level` and `title_en` are carried for future use; the reader has no field for
the level yet.

## What the builder emits

- `reader-master.epub`: EPUB 2, one XHTML per story plus a glossary chapter,
  NCX with one labelled `navPoint` per document, illustration files under
  `OEBPS/images/`. Every paragraph is one container that owns its
  `reader-pair` spans (`DATA-FORMAT.md` §4).
- `manifest.json`: `title`, languages, byte length and sha256 of
  `reader-master.epub`.
- No `original.epub`, `bilingual-*.epub`, or `bilingual-pairs.csv`; the reader
  never parses them (`DATA-FORMAT.md` §5).

Mapping details worth knowing:

- The title pair is the first block, both sides wrapped in `<strong>`; the
  reader has no heading block, so this is the only bilingual title that
  renders as text.
- Offsets are cumulative inside the paragraph container with a **0-character
  gap for Chinese/Japanese** and a 1-character gap for spaced languages, which
  `blockParagraph` turns back into the exact source paragraph.
- `data-pinyin` rides on `reader-src`; the glossary chapter does the same for
  every vocabulary entry.
- The illustration is its own container (`<div class="illustration"><img …>`)
  between paragraph containers; an `<img>` inside a pair container would land
  after that container's pairs.
- Block ids (`bid`) are contiguous from 0 across the book; pair ids are
  `<bid>:<start>:<end>` and unique.

## Editions

The book identity is the sha256 of `reader-master.epub`, so the builder pins a
fixed ZIP mtime (`2026-01-01`) and a constant `created_at`: rebuilding unchanged
input produces the same id. Any text or image change produces a **new edition** —
the library imports it as a separate book and the old reading position does not
carry over (`DESIGN.md` §19 rule 4). Add the stories first, then publish.

## Ritual

```bash
npm run book -- stories/<collection>   # build
npm test                               # builder contract in tests/bepub-builder.test.ts
```

Import the ZIP on a device (or in Chromium through `npm run test:e2e`'s
server); check the chapter sheet lists every story plus the glossary, the
illustration is where `image_after_paragraph` says, and pinyin appears above
the Chinese with `Pinyin: Above source`.
