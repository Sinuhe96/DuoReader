import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { makeBookZip, makeParagraphZip, makePlainZip } from './book-fixture';
import { choose } from './sheet';

/** Click the middle of a visible slice, so the app's caret maps to that word. */
async function tapText(page: Page, selector: string, needle: string): Promise<void> {
  const point = await page.evaluate(
    ({ selector: query, needle: text }) => {
      const line = document.querySelector(query);
      if (!line) throw new Error(`Missing ${query}`);
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const textNode = node as Text;
        const index = textNode.data.indexOf(text);
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(textNode, index);
        range.setEnd(textNode, index + text.length);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
      throw new Error(`Text not found: ${text}`);
    },
    { selector, needle },
  );
  await page.mouse.click(point.x, point.y);
}

function readAnnotations(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('duoreader');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const annotations = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const request = db.transaction('annotations', 'readonly').objectStore('annotations').getAll();
      request.onsuccess = () => resolve(request.result as Record<string, unknown>[]);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return annotations;
  });
}

async function importBook(page: Page, path: string): Promise<void> {
  await page.goto('./');
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect(page.locator('[data-pair-id="p1"]')).toBeVisible();
}

test('a highlight and a note survive a reload', async ({ page }, testInfo) => {
  const fixture = testInfo.outputPath('annotations.epub');
  await mkdir(dirname(fixture), { recursive: true });
  await writeFile(fixture, makeBookZip());
  await importBook(page, fixture);

  const pair = page.locator('.pair[data-pair-id="p1"]');
  await tapText(page, '.pair[data-pair-id="p1"] .src', 'bleibt');

  const sheet = page.locator('.learning-dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.learning-remove')).toBeHidden();
  const highlight = sheet.getByRole('button', { name: 'Highlight', exact: true });
  await highlight.click();
  await expect(highlight).toHaveAttribute('aria-pressed', 'true');

  await sheet.getByRole('textbox', { name: 'Note' }).fill('Dative after “an”.');
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();

  await expect(pair.locator('.src mark.reader-highlight')).toHaveText(
    'Satz 1. Der Leser bleibt an dieser Stelle stehen und prueft die Wiederherstellung.',
  );
  await expect(pair.locator('mark.reader-note')).toHaveCount(2);

  const stored = await readAnnotations(page);
  expect(stored).toHaveLength(2);
  expect(stored.map((entry) => entry.kind).sort()).toEqual(['note', 'sentence']);
  const noteRecord = stored.find((entry) => entry.kind === 'note');
  expect(noteRecord).toMatchObject({
    pairId: 'p1',
    note: 'Dative after “an”.',
    side: 'source',
    start: 0,
    text: 'Satz 1. Der Leser bleibt an dieser Stelle stehen und prueft die Wiederherstellung.',
  });

  await page.reload();
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(pair.locator('mark.reader-highlight')).toHaveCount(2);
  await expect(pair.locator('mark.reader-note')).toHaveCount(2);

  await tapText(page, '.pair[data-pair-id="p1"] .src', 'bleibt');
  const reopened = page.locator('.learning-dialog');
  await expect(reopened.getByRole('button', { name: 'Highlight', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(reopened.getByRole('textbox', { name: 'Note' })).toHaveValue('Dative after “an”.');

  // Remove note deletes the record and clears the field; the highlight stays.
  const removeNote = reopened.locator('.learning-remove');
  await expect(removeNote).toBeVisible();
  await removeNote.click();
  await expect(reopened.getByRole('textbox', { name: 'Note' })).toHaveValue('');
  await expect(removeNote).toBeHidden();
  await reopened.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(pair.locator('mark.reader-note')).toHaveCount(0);
  await expect(pair.locator('mark.reader-highlight')).toHaveCount(2);
  expect((await readAnnotations(page)).map((entry) => entry.kind)).toEqual(['sentence']);
});

test('a plain book paragraph opens the passage sheet and keeps its marks', async ({
  page,
}, testInfo) => {
  const fixture = testInfo.outputPath('plain-annotations.epub');
  await mkdir(dirname(fixture), { recursive: true });
  await writeFile(fixture, makePlainZip());
  await page.goto('./');
  await page.locator('input[type="file"]').setInputFiles(fixture);

  const paragraph = page.locator('.text-only[data-pair-id$="@1"]');
  await expect(paragraph).toBeVisible();
  await expect(paragraph).toHaveText(
    'The river rose through the night. By morning it had reached the bridge.',
  );

  await tapText(page, '.text-only[data-pair-id$="@1"]', 'river');
  const sheet = page.locator('.learning-dialog');
  await expect(sheet.getByRole('heading', { name: 'Passage' })).toBeVisible();
  await expect(sheet.locator('.learning-quote')).toHaveCount(1);
  await expect(sheet.locator('.learning-quote').first()).toHaveText(
    'The river rose through the night. By morning it had reached the bridge.',
  );
  await sheet.getByRole('button', { name: 'Highlight', exact: true }).click();
  await sheet.getByRole('textbox', { name: 'Note' }).fill('Night crossing.');
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();

  await expect(paragraph.locator('mark.reader-highlight')).toHaveCount(1);
  await expect(paragraph.locator('mark.reader-note')).toHaveCount(1);
  await expect(page.locator('.text-only[data-pair-id$="@0"] mark')).toHaveCount(0);

  const stored = await readAnnotations(page);
  expect(stored).toHaveLength(2);
  expect(stored.map((entry) => entry.kind).sort()).toEqual(['note', 'passage']);
  const noteRecord = stored.find((entry) => entry.kind === 'note');
  expect(noteRecord).toMatchObject({ note: 'Night crossing.', side: 'source' });
  expect(noteRecord?.pairId).toMatch(/c1\.xhtml@1$/);

  await page.reload();
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(paragraph.locator('mark.reader-highlight')).toHaveCount(1);
  await expect(paragraph.locator('mark.reader-note')).toHaveCount(1);
});

test('paragraph mode marks only the sentence that was tapped', async ({ page }, testInfo) => {
  const fixture = testInfo.outputPath('paragraph-annotations.epub');
  await mkdir(dirname(fixture), { recursive: true });
  await writeFile(fixture, makeParagraphZip());
  await page.goto('./');
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.locator('[data-pair-id="10:0:18"]')).toBeVisible();

  await page.getByRole('button', { name: 'Reading settings' }).click();
  await choose(page, 'display', 'Paragraph');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.paragraph')).toHaveCount(2);

  await tapText(page, '.paragraph .src', 'die Geschichte');
  const sheet = page.locator('.learning-dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.learning-quote').first()).toHaveText('die Geschichte.');
  await sheet.getByRole('button', { name: 'Highlight', exact: true }).click();
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();

  const first = page.locator('.paragraph').first();
  await expect(first.locator('.src mark.reader-highlight')).toHaveText('die Geschichte.');
  await expect(first.locator('.tgt mark.reader-highlight')).toHaveText('the story.');
  // The other sentence in the same paragraph stays clean.
  await expect(first.locator('.src')).toHaveText('Jetzt erzähle ich die Geschichte.');
  await expect(first.locator('mark.reader-highlight')).toHaveCount(2);
});
