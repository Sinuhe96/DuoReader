import { strToU8, zipSync } from 'fflate';

function bookArchive(title: string, chapter: string, lang = 'de'): Uint8Array {
  return zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:duoreader:smoke</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:language>${lang}</dc:language>
  </metadata>
  <manifest>
    <item id="chapter-1" href="c1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter-1"/>
  </spine>
</package>`),
    'OEBPS/c1.xhtml': strToU8(chapter),
  });
}

/** One tiny chapter; the title is the only variable, for layout checks. */
export function makeTitledZip(title: string): Uint8Array {
  const chapter = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="de">
  <head><title>Chapter</title></head>
  <body><div class="chapter">
    <div class="reader-pair" data-pair-id="p1" data-bid="b1">
      <span class="reader-src" lang="de">Satz. Der Leser liest weiter.</span>
      <span class="reader-tgt" lang="en">Sentence. The reader keeps reading.</span>
    </div>
  </div></body>
</html>`;

  return bookArchive(title, chapter);
}

export function makeBookZip(): Uint8Array {
  const pairs = Array.from({ length: 12 }, (_, index) => {
    const number = index + 1;
    return `
      <div class="reader-pair" data-pair-id="p${number}" data-bid="b${number}">
        <span class="reader-src" lang="de">Satz ${number}. Der Leser bleibt an dieser Stelle stehen und prueft die Wiederherstellung.</span>
        <span class="reader-tgt" lang="en">Sentence ${number}. The reader stays here and verifies that the position is restored.</span>
      </div>`;
  }).join('');

  const chapter = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="de">
  <head><title>Chapter 1</title></head>
  <body><div class="chapter">${pairs}</div></body>
</html>`;

  return bookArchive('Cold Start Smoke', chapter);
}

export function makePlainZip(): Uint8Array {
  const chapter = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
  <head><title>Plain</title></head>
  <body><div class="chapter">
    <h2>A Plain Chapter</h2>
    <p>The river rose through the night. By morning it had reached the bridge.</p>
    <p>A second paragraph stands alone.</p>
  </div></body>
</html>`;

  return bookArchive('Plain Book', chapter, 'en');
}

/** One long chapter, so the document actually scrolls. */
export function makeLongZip(count = 60): Uint8Array {
  const pairs = Array.from({ length: count }, (_, index) => {
    const number = index + 1;
    return `
      <div class="reader-pair" data-pair-id="p${number}" data-bid="b${number}">
        <span class="reader-src" lang="de">Satz ${number}. Der Leser bleibt an dieser Stelle stehen und prueft die Wiederherstellung der Position.</span>
        <span class="reader-tgt" lang="en">Sentence ${number}. The reader stays here and verifies that the position is restored.</span>
      </div>`;
  }).join('');

  const chapter = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="de">
  <head><title>Long</title></head>
  <body><div class="chapter">${pairs}</div></body>
</html>`;

  return bookArchive('Long Book', chapter);
}

/** Two paragraph blocks: one with a one-space gap, one split after punctuation. */
export function makeParagraphZip(): Uint8Array {
  const chapter = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="de">
  <head><title>Paragraphs</title></head>
  <body>
    <div class="standard_oe">
      <span class="reader-pair" data-pair-id="10:0:18" data-bid="10" data-start="0" data-end="18">
        <span class="reader-src" lang="de">Jetzt <i>erzähle</i> ich</span>
        <span class="reader-tgt" lang="en">Now I <i>tell</i></span>
      </span><span class="normal"> </span><span class="reader-pair" data-pair-id="10:19:33" data-bid="10" data-start="19" data-end="33">
        <span class="reader-src" lang="de">die Geschichte.</span>
        <span class="reader-tgt" lang="en">the story.</span>
      </span>
    </div>
    <div class="standard_oe">
      <span class="reader-pair" data-pair-id="11:0:25" data-bid="11" data-start="0" data-end="25">
        <span class="reader-src" lang="de">»Kannst du schwimmen?«</span>
        <span class="reader-tgt" lang="en">Can you swim?</span>
      </span><span class="reader-pair" data-pair-id="11:25:37" data-bid="11" data-start="25" data-end="37">
        <span class="reader-src" lang="de">, fragte Oma.</span>
        <span class="reader-tgt" lang="en">asked Grandma.</span>
      </span>
    </div>
  </body>
</html>`;

  return bookArchive('Paragraph Probe', chapter);
}

/** Three chapters with no NCX: labels fall back to Chapter 1..3. */
export function makeChaptersZip(): Uint8Array {
  const chapterFile = (index: number): string => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="de">
  <head><title>Chapter ${index}</title></head>
  <body><div class="chapter">
    <div class="reader-pair" data-pair-id="p${index}" data-bid="b${index}">
      <span class="reader-src" lang="de">Satz ${index}. Der Leser blaettert weiter.</span>
      <span class="reader-tgt" lang="en">Sentence ${index}. The reader turns the page.</span>
    </div>
  </div></body>
</html>`;

  return zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:duoreader:chapters</dc:identifier>
    <dc:title>Chapter List Probe</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:language>de</dc:language>
  </metadata>
  <manifest>
    <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="c3.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
    <itemref idref="c3"/>
  </spine>
</package>`),
    'OEBPS/c1.xhtml': strToU8(chapterFile(1)),
    'OEBPS/c2.xhtml': strToU8(chapterFile(2)),
    'OEBPS/c3.xhtml': strToU8(chapterFile(3)),
  });
}

/** Two paragraphs; two sentences carry pinyin, the third has none. */
export function makePinyinZip(): Uint8Array {
  const chapter = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-Hans">
  <head><title>Pinyin</title></head>
  <body>
    <div class="standard_oe">
      <span class="reader-pair" data-pair-id="20:0:4" data-bid="20" data-start="0" data-end="4">
        <span class="reader-src" lang="zh-Hans" data-pinyin="Hěn jiǔ yǐqián">很久以前</span>
        <span class="reader-tgt" lang="en">Long ago</span>
      </span>
      <span class="reader-pair" data-pair-id="20:4:9" data-bid="20" data-start="4" data-end="9">
        <span class="reader-src" lang="zh-Hans" data-pinyin="yǒu yí gè háizi">有一个孩子</span>
        <span class="reader-tgt" lang="en">there was a child</span>
      </span>
    </div>
    <div class="standard_oe">
      <span class="reader-pair" data-pair-id="21:0:6" data-bid="21" data-start="0" data-end="6">
        <span class="reader-src" lang="zh-Hans">他有一个水缸</span>
        <span class="reader-tgt" lang="en">He had a water jar</span>
      </span>
    </div>
  </body>
</html>`;

  return bookArchive('Pinyin Probe', chapter, 'zh-Hans');
}
