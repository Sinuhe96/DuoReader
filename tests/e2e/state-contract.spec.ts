import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { makeChaptersZip } from './book-fixture';
import { choose } from './sheet';

/** Reads the two persistent stores the contract covers: global settings and per-book positions. */
function readState(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('duoreader');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const all = <T>(store: string) =>
      new Promise<T[]>((resolve, reject) => {
        const request = db.transaction(store, 'readonly').objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result as T[]);
        request.onerror = () => reject(request.error);
      });
    const [settings, positions] = await Promise.all([
      all<Record<string, unknown>>('settings'),
      all<{ bookId: string; chapterIndex: number; pairId: string | null }>('positions'),
    ]);
    db.close();
    return { settings: settings[0], positions };
  });
}

test('reader settings and the reading position survive a re-import', async ({ page }, testInfo) => {
  await page.goto('./');
  const path = testInfo.outputPath('chapters.epub');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, makeChaptersZip());

  await page.locator('input[type="file"]').setInputFiles(path);
  await expect(page.locator('[data-pair-id="p1"]')).toBeVisible();

  await page.getByRole('button', { name: 'Chapter list' }).click();
  await page.locator('.chapters-dialog').getByRole('button', { name: 'Chapter 2' }).click();
  await expect(page.locator('[data-pair-id="p2"]')).toBeVisible();

  await page.getByRole('button', { name: 'Reading settings' }).click();
  const sheet = page.locator('.settings-dialog');
  await choose(page, 'display', 'Paragraph');
  await choose(page, 'languages', 'Translation only');
  await choose(page, 'order', 'Translation first');
  await choose(page, 'theme', 'Dark');
  await sheet.locator('input[type="range"]').first().evaluate((element: HTMLInputElement) => {
    element.value = '24';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.paragraph')).toHaveCount(1);

  const before = await readState(page);
  if (!before.settings) throw new Error('expected stored settings');
  expect(before.settings).toMatchObject({
    fontSize: 24,
    theme: 'dark',
    displayMode: 'paragraph',
    languages: 'target',
    languageOrder: 'target-first',
  });

  await page.getByRole('button', { name: 'Library' }).click();
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect(page.locator('[data-pair-id="p2"]')).toBeVisible();

  // The contract: import writes books, content, and images only.
  expect((await readState(page)).settings).toEqual(before.settings);

  const attrs = await page.evaluate(() => ({
    display: document.documentElement.dataset.display,
    languages: document.documentElement.dataset.languages,
    theme: document.documentElement.dataset.theme,
    size: document.documentElement.style.getPropertyValue('--reader-size'),
  }));
  expect(attrs).toEqual({
    display: 'paragraph',
    languages: 'target',
    theme: 'dark',
    size: '24px',
  });
  await expect(page.locator('.chapter')).toHaveAttribute('aria-label', 'Chapter 2');
  expect((await readState(page)).positions.at(-1)).toMatchObject({
    chapterIndex: 1,
    pairId: 'p2',
  });
});

test('the stored pair id wins over a stale chapter index', async ({ page }, testInfo) => {
  await page.goto('./');
  const path = testInfo.outputPath('chapters.epub');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, makeChaptersZip());

  await page.locator('input[type="file"]').setInputFiles(path);
  await expect(page.locator('[data-pair-id="p1"]')).toBeVisible();

  // Leaving the reader flushes the live position; write the stale row after that.
  await page.getByRole('button', { name: 'Library' }).click();

  // A parser change can renumber chapters; the index then points elsewhere while
  // the pair id still identifies the exact line the reader left off on.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('duoreader');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const position = await new Promise<{ bookId: string; progress: number }>((resolve, reject) => {
      const request = db.transaction('positions', 'readonly').objectStore('positions').getAll();
      request.onsuccess = () => resolve(request.result[0]);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const request = db
        .transaction('positions', 'readwrite')
        .objectStore('positions')
        .put({ ...position, chapterIndex: 0, pairId: 'p2', progress: 0 });
      request.onsuccess = () => resolve(undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();
  });

  await page.getByRole('button', { name: 'Read', exact: true }).first().click();

  await expect(page.locator('[data-pair-id="p2"]')).toBeVisible();
  await expect(page.locator('.chapter')).toHaveAttribute('aria-label', 'Chapter 2');
});
