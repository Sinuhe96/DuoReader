import { strToU8, zipSync } from 'fflate';

function bookArchive(title: string, chapter: string): Uint8Array {
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
    <dc:language>de</dc:language>
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
