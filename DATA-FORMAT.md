# BePub ZIP — data format

Reverse-engineered from the audited sample
(`Anton taucht ab_AUTO-EN_Chưa xác định.zip`, 2026-11-14). No BePub
specification exists; this document is the contract the importer relies on
and the reference for producing compatible archives. Parser:
`src/reader/parse.ts`; product context: `DESIGN.md`; agent index:
`AGENTS.md`.

## 1. Outer archive

A plain ZIP, not an EPUB. No `mimetype`, no `META-INF/` at the root.

| Entry | Sample size | Role |
|---|---:|---|
| `manifest.json` | 1,077 B | Index, identity, languages, checksums |
| `original.epub` | 931,170 B | Untouched publisher EPUB in the source language |
| `reader-master.epub` | 1,008,664 B | Authoritative bilingual data; the only artifact the reader parses |
| `bilingual-sentence.epub` | 993,505 B | Presentation rendering, sentence granularity |
| `bilingual-paragraph.epub` | 976,941 B | Presentation rendering, paragraph granularity |
| `bilingual-pairs.csv` | 245,813 B | Flat alignment table |

Sample total: 4,157,170 B. `reader-master.epub` is the edition identity
(§2). The other four entries are derived artifacts: the reader may ignore
them entirely.

## 2. `manifest.json`

```json
{
  "schema_version": 1,
  "title": "Anton taucht ab",
  "source_lang": "de",
  "target_lang": "en",
  "pipeline_version": "bepub-engine-1",
  "created_at": "2026-11-14T05:39:01.412114+00:00",
  "reader_modes": ["original", "sentence", "paragraph", "columns"],
  "files": [
    {
      "path": "reader-master.epub",
      "bytes": 1008664,
      "sha256": "090cb6f840e14190c24b9e800ab07267e6a9f741ba4a85af17959c1e80d8129f",
      "media_type": "application/epub+zip"
    }
  ]
}
```

- `files[]` lists every outer entry with real byte length and SHA-256.
- `media_type` values seen: `application/epub+zip`, `text/csv`.
- `reader_modes` advertises modes; **no columns artifact exists** in the
  archive. Do not infer file structure from it.
- Identity: `book.id` is `book-<first 12 hex of the reader-master sha256>`.
  Missing manifest → fallback to a hash of `title|first chapter path`.
  Because the hash is the identity, regenerating a byte-different
  `reader-master.epub` creates a new book, not an update.
- The manifest is optional to the parser: it falls back to locating
  `reader-master.epub` by name, then to a lone `.epub`. Without it, languages
  degrade to `und` and identity falls back to the title hash.
- The importer also accepts a bare EPUB (any `.epub` with
  `META-INF/container.xml` and `mimetype`), skipping the outer stage.

## 3. `reader-master.epub`

Valid **EPUB 2.0**. `mimetype` is the first entry and stored uncompressed.

| Path | Content |
|---|---|
| `META-INF/container.xml` | Rootfile → `OEBPS/content.opf` |
| `OEBPS/content.opf` | Package: metadata, complete manifest, spine (25 `itemref`s, `toc="ncx"`), `guide` |
| `OEBPS/content.ncx` | EPUB2 NCX: one `navPoint` per spine document, classes `title`/`chapter`/`about`, `docAuthor` |
| `OEBPS/d_001.xhtml` … `d_025.xhtml` | One document per spine item; flat, machine-generated markup |
| `OEBPS/css/content.css` | Original print CSS (`dejavuserif`, `@page`); no pair-class rules |
| `OEBPS/images/*.jpg` | 25 JPEGs; 43 `<img>` blocks reference them |
| `OEBPS/fonts/{authors,license}.txt` | Plain text only; no font binaries |

Package metadata in the sample: `dc:identifier` ISBN, `dc:title`,
`dc:language` = source language, `<meta name="cover" content="e_59"/>`.
`dc:creator` holds the **publisher** (`Beltz & Gelberg`), not the author; the
parser prefers the NCX `docAuthor` and strips a trailing parenthetical
(`Milena Baisch (Baisch, Milena)` → `Milena Baisch`).

Precedence used by the importer:

| Field | Order |
|---|---|
| Title | OPF `dc:title` → `manifest.title` → `Untitled book` |
| Source language | OPF `dc:language` → `manifest.source_lang` → first `reader-src` `lang` → `und` |
| Target language | `manifest.target_lang` → first `reader-tgt` `lang` → `und` |
| Author | NCX `docAuthor` → OPF `dc:creator` → `Unknown author` |

## 4. Pair markup contract

Every chapter is a sequence of `<body>` descendants. **A paragraph block is
the element that directly owns `reader-pair` spans** — usually a top-level
`<body>` child, but a container that wraps paragraph elements (a jacket
`<div>` holding `<p>`s, as in the Vietnamese sample's front matter) is
descended into, so each wrapped paragraph stays its own block and its
text-only lines are kept in document order. Inside a paragraph, each sentence
is one `span.reader-pair`:

```html
<div class="standard_oe">
  <span class="reader-pair" data-bid="85" data-pair-id="85:0:39"
        data-start="0" data-end="39">
    <span class="reader-src" lang="de">»Kannst du vielleicht nicht schwimmen?«</span>
    <span class="reader-tgt" lang="en">"Can't you swim, perhaps?" asked Grandma.</span>
  </span><span class="reader-pair" data-bid="85" data-pair-id="85:39:52"
        data-start="39" data-end="52">
    <span class="reader-src" lang="de">, fragte Oma.</span>
    <span class="reader-tgt" lang="en">, asked Grandma.</span>
  </span>
</div>
```

Between pairs the generator emits a separator element carrying the gap
whitespace, e.g. `<span class="normal"> </span>`. It is ignored; the
offsets are the canonical separation.

**Text-only content.** An element with no `reader-pair` descendant is content
without a translation: a jacket line, or a whole plain EPUB imported directly
(an EPUB that is itself the outer archive is read as its own `reader-master`).
It is split at HTML block elements — `p`, `div`, `li`, headings, `ul`/`ol`,
`table`, `blockquote`, `section`, and the rest of `BLOCK_LEVEL` in
`src/reader/parse.ts` — because `textContent` carries no boundary between
them and fusing paragraphs is the failure this rule exists to prevent. A leaf
block becomes one text block; inside it `i`/`em`, `b`/`strong`, and `br`
become the same runs a pair gets, and an `<img>` splits the text so the picture
keeps its place instead of swallowing the prose around it.

| Attribute / class | Meaning |
|---|---|
| `reader-pair` | One sentence pair. The only class the parser requires |
| `reader-src`, `reader-tgt` | Source / translation children, in that order; text is flattened into `source`/`target`, whitelisted markup is kept as runs (`i|em → em`, `b|strong → strong`, `br → break`), and every other element contributes only text |
| `data-pair-id` | `<bid>:<start>:<end>`; **required** — a pair without it is dropped; globally unique position key |
| `data-bid` | Block id; uniform inside one block; globally contiguous from 0 in reading order (sample: `0…665`) |
| `data-start`, `data-end` | Character offsets of the pair inside the block's source text |
| `lang` on src/tgt | Language tags; fallback when OPF/manifest lack languages |
| inline markup | `<i>`, `<b>`, `<em>`, `<strong>`, `<br>` may appear inside `reader-src`/`reader-tgt`. In the sample all 16 `<i>` sit inside `reader-src` (15 pairs; one pair has two) and no `reader-tgt` carries markup, so the translation is unformatted by the producer. The single `<br>` is in the source-only `d_022` block |

Constraints observed and relied on:

- Pairs live directly inside the paragraph container; containers are flat
  (no nested `<div>` inside a paragraph container).
- Inter-pair separators are whitespace only. In the sample, gaps are
  `0` (6 occurrences, punctuation splits such as `«` + `,`) or `1` (1,205
  occurrences, a single space). Nothing else appears.
- Block order in the spine is reading order; bids are contiguous and unique.
- Classes on the container (`standard_oe`, `standard_mlz`, `normal`, `bild`,
  `titel`, `kap`) are publisher styling, not data. The parser keeps only
  images and pairs; it does not interpret the class.
- Images: `<img src="images/…">` with a relative path inside the paragraph
  container. The parser reads images from chapter markup, **not** from the
  OPF manifest; external URLs and unknown extensions are ignored. 43 image
  blocks / 25 unique files in the sample.
- Inline markup is kept as runs since 0.7.0 (whitelist above); text outside
  pairs inside a pair container is still dropped, but in the sample that is
  separator whitespace only. Pair offsets are kept since 0.6.0;
  `src/reader/paragraph.ts` implements the derivation in §6.

Sample counts: 666 pair blocks (bids `0…665`), 1,877 pairs, 43 image blocks,
25 unique images, 16 `<i>` (all inside `reader-src`; none inside
`reader-tgt`), 1 `<br>` (in the `d_022` text-only block). Two non-pair text
blocks exist: `d_022` "Die Luft um mich herum bewegte sich –" (untranslated in
every artifact) and `d_025` (whitespace only; skipped).

A second archive (Vietnamese → English, `test_data/`) shows the rules
generalize: 20 chapters, 4,803 pairs, 588 image blocks, 8 text-only
paragraphs (three front-matter lines plus five untranslated paragraphs whose
text the image branch dropped before 0.10.0 while keeping the picture), gaps
of 0 or 1 only, 30 `em` runs in source spans and none in `reader-tgt`,
and 2,745 derived source paragraphs / 2,742 targets that match
`bilingual-paragraph.epub` character for character. Its front matter is the
wrapper case above. The Vietnamese text is NFC throughout and passes through
unchanged; the parser never normalizes, so decomposed input would also be
stored as written.

## 5. Derived artifacts

### `bilingual-sentence.epub`

Same EPUB skeleton and spine. Each sentence is
`span.bilingual-pair` with `span.bilingual-src` / `span.bilingual-tgt`,
styled by inline `style=` attributes. **No `data-*` attributes, no ids.**
Useful only for third-party readers; a data source cannot rely on it.

### `bilingual-paragraph.epub`

One source paragraph directly in the original container, followed by a
sibling target paragraph:

```html
<div class="standard_oe">Jetzt erzähle ich die Geschichte. Eine Abenteuer…</div>
<p class="bilingual-paragraph-tgt" lang="en" xml:lang="en">Now I will tell the story. An adventure…</p>
```

No ids, no `reader-*` classes, inline styles. It preserves the 16 `<i>` runs.

Verified against `reader-master`: 666 paragraph pairs, source and target
identical to the derivations in §6 (source modulo the 6 punctuation-space
artifacts, target exactly after whitespace normalization). So the paragraph
variant adds no information the reader cannot derive; treat it as rendered
output, not as a data contract.

### `bilingual-pairs.csv`

UTF-8 **with BOM**. Header and 1,877 data rows:

```
block_id,span_start,span_end,source_text,target_text,method
0,0,16,Über die Autorin,About the Author,fast_atomic_direct
1,0,62,"Milena Baisch, geboren 1976 …","Milena Baisch, born in Bochum …",joint_split_translate
```

`block_id` = `data-bid`, `span_start`/`span_end` = `data-start`/`data-end`.
`method` values observed: `fast_atomic_direct`, `joint_split_translate`.
Sentence-level only — no paragraph rows. Redundant for the reader.

### `original.epub`

The publisher EPUB, untouched. Source of truth for original paragraph text
and punctuation, but not aligned to blocks; the reader does not use it.

## 6. Derivation rules

These rules are verified on the sample and implemented by `blockParagraph` in
`src/reader/paragraph.ts` (`DESIGN.md` §18): all 667 paragraph blocks of the
sample reproduce `bilingual-paragraph.epub` character for character.

**Source paragraph.** Concatenate the block's `reader-src` texts in order and
insert `start − previousEnd` spaces between consecutive pairs. Gap widths are
only 0 or 1, so this reproduces the original paragraph exactly — 666/666
blocks match `bilingual-paragraph.epub`. A plain `join(' ')` is wrong: it
inserts spaces that the source does not have (`»…?« ,`).

**Target paragraph.** Concatenate `reader-tgt` texts with a single space.
There are no target offsets; this matched all 666 paragraph targets in the
sample.

Both derivations keep inline runs (0.7.0): the separator is a plain run,
adjacent plain runs merge, and a `br` inside a pair survives the merge. Pair
texts themselves are whitespace-normalized and trimmed, so run text always
equals `source`/`target`.

## 7. Producing a compatible archive

1. Take the source EPUB as `original.epub`; keep its spine order, metadata,
   CSS, and images.
2. Align sentences to translations and assign block ids: one bid per
   paragraph block, contiguous from 0 across the whole book in reading order.
3. Emit `reader-master.epub`: one element per paragraph — a top-level `<body>`
   child, or a `<p>` inside a wrapper that carries no pair spans — with
   `reader-pair` spans with `data-pair-id`/`data-bid`/`data-start`/`data-end`
   and `lang`-tagged children, `mimetype` first and stored, complete OPF
   manifest, NCX labels, relative image paths.
4. Emit `bilingual-sentence.epub`, `bilingual-paragraph.epub`, and
   `bilingual-pairs.csv` from the same aligned data.
5. Write `manifest.json` last, with actual byte lengths and SHA-256 for each
   finished file. Use a fixed `created_at` and pinned ZIP mtimes if
   reproducible editions matter — the hash is the book identity.
6. Validate by unzipping and running `parseBePubZip`: unique pair ids,
   contiguous bids, every `img src` resolved, expected block/pair/image
   counts.

## 8. Known gaps and upstream asks

- The block id exists only on each pair span; a `data-bid` on the paragraph
  container would make paragraph identity explicit.
- `data-start`/`data-end` describe gap *width*, not content. A future engine
  emitting non-whitespace outside pairs would break paragraph reconstruction.
- Inline formatting is a de-facto whitelist (`i`/`em`, `b`/`strong`, `br`);
  documenting it would make the planned run model safe.
- If paragraph-level MT ever diverges from the sentence join, expose it as a
  field in `reader-master` (with ids), not only in the rendered variant.
- A container that *directly* owns pair spans is not descended into: pairs
  nested inside separate paragraphs within such a container would still merge
  into one block. Emit one container per paragraph, or wrap paragraphs in an
  element that carries no pair spans itself.
