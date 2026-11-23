import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import {
  makeBookZip,
  makeChaptersZip,
  makeGlossZip,
  makeParagraphZip,
  makePlainZip,
} from './book-fixture';
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

function readVocabulary(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('duoreader');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const words = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const request = db.transaction('vocabulary', 'readonly').objectStore('vocabulary').getAll();
      request.onsuccess = () => resolve(request.result as Record<string, unknown>[]);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return words;
  });
}

async function importBook(page: Page, path: string): Promise<void> {
  await page.goto('./');
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect(page.locator('[data-pair-id="p1"]')).toBeVisible();
}

/** Resume restores the position after a couple of paints; tap only once it stops. */
async function settleScroll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const app = document.querySelector('#app');
    if (!app) return;
    let last = app.scrollTop;
    let stable = 0;
    for (let frame = 0; frame < 60 && stable < 3; frame += 1) {
      await new Promise(requestAnimationFrame);
      if (app.scrollTop === last) stable += 1;
      else {
        stable = 0;
        last = app.scrollTop;
      }
    }
  });
}

test('a word tap captures the surface, the base form, and the sentence', async ({
  page,
}, testInfo) => {
  const fixture = testInfo.outputPath('word-capture.epub');
  await mkdir(dirname(fixture), { recursive: true });
  await writeFile(fixture, makeBookZip());
  await importBook(page, fixture);

  const pair = page.locator('.pair[data-pair-id="p1"]');
  await tapText(page, '.pair[data-pair-id="p1"] .src', 'bleibt');
  const sheet = page.locator('.learning-dialog');
  await expect(sheet.getByRole('heading', { name: 'Word' })).toBeVisible();
  await expect(sheet.locator('.learning-word')).toHaveText('bleibt');
  await expect(sheet.locator('.learning-quote').first()).toHaveText(
    'Satz 1. Der Leser bleibt an dieser Stelle stehen und prueft die Wiederherstellung.',
  );
  await expect(sheet.locator('.learning-translation')).toHaveText(
    'Sentence 1. The reader stays here and verifies that the position is restored.',
  );
  const base = sheet.getByRole('textbox', { name: 'Base form' });
  await expect(base).toHaveValue('');
  await base.fill('bleiben');

  const highlight = sheet.getByRole('button', { name: 'Highlight word', exact: true });
  await highlight.click();
  await expect(highlight).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet.locator('.learning-status')).toHaveText('Saved ✓');
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();

  await expect(pair.locator('.src mark.reader-word')).toHaveText('bleibt');
  await expect(pair.locator('.tgt mark.reader-word')).toHaveCount(0);

  const words = await readVocabulary(page);
  expect(words).toHaveLength(1);
  expect(words[0]).toMatchObject({
    pairId: 'p1',
    side: 'source',
    start: 18,
    end: 24,
    surface: 'bleibt',
    term: 'bleiben',
    lemma: 'bleiben',
    lemmaSource: 'user',
    bookTitle: 'Cold Start Smoke',
    chapterLabel: 'Chapter 1',
    context:
      'Satz 1. Der Leser bleibt an dieser Stelle stehen und prueft die Wiederherstellung.',
    translation:
      'Sentence 1. The reader stays here and verifies that the position is restored.',
    status: 'new',
  });

  await page.reload();
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(pair.locator('.src mark.reader-word')).toHaveText('bleibt');
  await settleScroll(page);

  await tapText(page, '.pair[data-pair-id="p1"] .src', 'bleibt');
  const reopened = page.locator('.learning-dialog');
  await expect(reopened.getByRole('heading', { name: 'Word' })).toBeVisible();
  await expect(reopened.getByRole('textbox', { name: 'Base form' })).toHaveValue('bleiben');
  await expect(reopened.locator('.learning-status')).toHaveText('Saved ✓');
  await expect(
    reopened.getByRole('button', { name: 'Highlight word', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await reopened.getByRole('button', { name: 'Done', exact: true }).click();

  // Vocabulary is user state: importing the same edition again keeps it.
  await page.getByRole('button', { name: 'Library' }).click();
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(pair.locator('.src mark.reader-word')).toHaveText('bleibt');
  await settleScroll(page);
  await tapText(page, '.pair[data-pair-id="p1"] .src', 'bleibt');
  await expect(
    page.locator('.learning-dialog').getByRole('textbox', { name: 'Base form' }),
  ).toHaveValue('bleiben');
  expect(await readVocabulary(page)).toHaveLength(1);
});

test('a target word marks only the translation', async ({ page }, testInfo) => {
  const fixture = testInfo.outputPath('target-word.epub');
  await mkdir(dirname(fixture), { recursive: true });
  await writeFile(fixture, makeBookZip());
  await importBook(page, fixture);

  const pair = page.locator('.pair[data-pair-id="p1"]');
  await tapText(page, '.pair[data-pair-id="p1"] .tgt', 'stays');
  const sheet = page.locator('.learning-dialog');
  await expect(sheet.getByRole('heading', { name: 'Word' })).toBeVisible();
  await expect(sheet.locator('.learning-word')).toHaveText('stays');
  await sheet.getByRole('button', { name: 'Highlight word', exact: true }).click();
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet.locator('.learning-status')).toHaveText('Saved ✓');
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();

  await expect(pair.locator('.tgt mark.reader-word')).toHaveText('stays');
  await expect(pair.locator('.src mark.reader-word')).toHaveCount(0);
  const words = await readVocabulary(page);
  expect(words).toHaveLength(1);
  expect(words[0]).toMatchObject({
    pairId: 'p1',
    side: 'target',
    start: 23,
    end: 28,
    surface: 'stays',
    term: 'stays',
    context:
      'Satz 1. Der Leser bleibt an dieser Stelle stehen und prueft die Wiederherstellung.',
    translation:
      'Sentence 1. The reader stays here and verifies that the position is restored.',
  });
});

test('a matching book gloss is shown and promoted on save', async ({ page }, testInfo) => {
  const fixture = testInfo.outputPath('word-gloss.epub');
  await mkdir(dirname(fixture), { recursive: true });
  await writeFile(fixture, makeGlossZip());
  await importBook(page, fixture);

  await tapText(page, '.pair[data-pair-id="p1"] .src', 'bleibt');
  const sheet = page.locator('.learning-dialog');
  await expect(sheet.getByRole('heading', { name: 'Word' })).toBeVisible();
  const gloss = sheet.locator('.learning-gloss');
  await expect(gloss).toContainText('Book gloss');
  await expect(gloss).toContainText('bleiben');
  await expect(gloss).toContainText('stays');

  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet.locator('.learning-status')).toHaveText('Saved ✓');
  const words = await readVocabulary(page);
  expect(words).toHaveLength(1);
  expect(words[0]).toMatchObject({
    pairId: 'p1',
    side: 'source',
    start: 10,
    end: 16,
    surface: 'bleibt',
    term: 'bleibt',
    entry: 'stays',
    glossSource: 'book',
    glossId: 'g1',
    context: 'Der Leser bleibt hier.',
    translation: 'The reader stays here.',
  });
});

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
  const highlight = sheet.getByRole('button', { name: 'Highlight sentence', exact: true });
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
  await settleScroll(page);

  await tapText(page, '.pair[data-pair-id="p1"] .src', 'bleibt');
  const reopened = page.locator('.learning-dialog');
  await expect(reopened.getByRole('button', { name: 'Highlight sentence', exact: true })).toHaveAttribute(
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
  await expect(sheet.getByRole('heading', { name: 'Word' })).toBeVisible();
  await expect(sheet.locator('.learning-word')).toHaveText('river');
  await expect(sheet.locator('.learning-quote')).toHaveCount(1);
  await expect(sheet.locator('.learning-quote').first()).toHaveText(
    'The river rose through the night. By morning it had reached the bridge.',
  );
  await sheet.getByRole('button', { name: 'Highlight passage', exact: true }).click();
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

test('a note loads with its chapter, not with the book', async ({ page }, testInfo) => {
  const fixture = testInfo.outputPath('chapter-annotations.epub');
  await mkdir(dirname(fixture), { recursive: true });
  await writeFile(fixture, makeChaptersZip());
  await page.goto('./');
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.locator('[data-pair-id="p1"]')).toBeVisible();

  await tapText(page, '[data-pair-id="p1"] .src', 'Satz');
  const sheet = page.locator('.learning-dialog');
  await sheet.getByRole('button', { name: 'Highlight sentence', exact: true }).click();
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('[data-pair-id="p1"] mark.reader-highlight')).toHaveCount(2);

  await page.getByRole('button', { name: 'Chapter list' }).click();
  await page.locator('.chapters-dialog').getByRole('button', { name: /Chapter 2/ }).click();
  await expect(page.locator('[data-pair-id="p2"]')).toBeVisible();
  await expect(page.locator('[data-pair-id="p2"] mark')).toHaveCount(0);

  await page.getByRole('button', { name: 'Chapter list' }).click();
  await page.locator('.chapters-dialog').getByRole('button', { name: /Chapter 1/ }).click();
  await expect(page.locator('[data-pair-id="p1"] mark.reader-highlight')).toHaveCount(2);
  expect(await readAnnotations(page)).toHaveLength(1);
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
  await sheet.getByRole('button', { name: 'Highlight sentence', exact: true }).click();
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();

  const first = page.locator('.paragraph').first();
  await expect(first.locator('.src mark.reader-highlight')).toHaveText('die Geschichte.');
  await expect(first.locator('.tgt mark.reader-highlight')).toHaveText('the story.');
  // The other sentence in the same paragraph stays clean.
  await expect(first.locator('.src')).toHaveText('Jetzt erzähle ich die Geschichte.');
  await expect(first.locator('mark.reader-highlight')).toHaveCount(2);
});
