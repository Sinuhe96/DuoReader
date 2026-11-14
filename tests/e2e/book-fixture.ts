import { strToU8, zipSync } from 'fflate';

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
    <dc:title>Cold Start Smoke</dc:title>
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
