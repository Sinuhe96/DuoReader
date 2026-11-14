import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';

import type { BuildInfo } from '../../src/build-info';

function makeBookZip(): Uint8Array {
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

test('cold start restores the reading position and settings', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'DuoReader' })).toBeVisible();
  await expect(page.getByText('No books yet. Add a BePub ZIP to start reading.')).toBeVisible();

  const manifest = JSON.parse(
    readFileSync('dist/build-manifest.json', 'utf8'),
  ) as BuildInfo;
  const expectedBuildTag = `v${manifest.version} · build ${manifest.build}${
    manifest.dirty ? '+' : ''
  } · ${manifest.commit}`;
  const buildTag = page.locator('.build-tag');
  await expect(buildTag).toBeVisible();
  await expect(buildTag).toHaveText(expectedBuildTag);
  await expect(buildTag).toHaveAttribute('data-version', manifest.version);
  await expect(buildTag).toHaveAttribute('data-build', String(manifest.build));
  await expect(buildTag).toHaveAttribute('data-commit', manifest.commit);

  const expectedEntry = /assets\/index-[^"]+\.js/.exec(
    readFileSync('dist/index.html', 'utf8'),
  )?.[0];
  expect(expectedEntry, 'dist/index.html should contain a built entry asset').toBeTruthy();
  const loadedEntry = await page.locator('script[type="module"]').getAttribute('src');
  expect(loadedEntry).toContain(expectedEntry?.split('/').at(-1));

  const fixturePath = testInfo.outputPath('cold-start.epub');
  await mkdir(dirname(fixturePath), { recursive: true });
  await writeFile(fixturePath, makeBookZip());

  await page.locator('input[type="file"]').setInputFiles(fixturePath);
  await expect(page.locator('[data-pair-id="p1"] .src')).toHaveText(
    'Satz 1. Der Leser bleibt an dieser Stelle stehen und prueft die Wiederherstellung.',
  );

  await page.getByRole('button', { name: 'Reading settings' }).click();
  await page.locator('.settings-dialog input[type="range"]').first().evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = '22';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--reader-size').trim(),
      ),
    )
    .toBe('22px');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.settings-dialog')).toHaveCount(0);

  await page.locator('[data-pair-id="p8"]').evaluate((element) => {
    const topbar = document.querySelector<HTMLElement>('.topbar');
    const top = element.getBoundingClientRect().top;
    window.scrollTo(0, window.scrollY + top - (topbar?.getBoundingClientRect().height ?? 0) - 2);
  });
  await page.waitForTimeout(700);

  await page.getByRole('button', { name: 'Library' }).click();
  await expect(page.getByText('67% read')).toBeVisible();

  await page.reload();
  await expect(page.getByText('67% read')).toBeVisible();
  await page.getByRole('button', { name: 'Read' }).click();

  const restored = page.locator('[data-pair-id="p8"]');
  await expect(restored).toBeInViewport();
  const restoredTop = await restored.evaluate((element) => element.getBoundingClientRect().top);
  expect(restoredTop).toBeGreaterThan(0);
  expect(restoredTop).toBeLessThan(240);

  const readerSize = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--reader-size').trim(),
  );
  expect(readerSize).toBe('22px');
  expect(pageErrors).toEqual([]);
});
