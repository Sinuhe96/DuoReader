import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { makeWordBookZip } from './book-fixture';

/** Click the middle of a visible word, so the app's caret resolves it. */
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

async function importBook(page: Page, path: string): Promise<void> {
  await page.goto('./');
  await page.locator('input[type="file"]').setInputFiles(path);
  await expect(page.locator('.pair[data-pair-id="p1"]')).toBeVisible();
}

async function saveWord(page: Page, selector: string, word: string): Promise<void> {
  await tapText(page, selector, word);
  const sheet = page.locator('.learning-dialog');
  await expect(sheet.getByRole('heading', { name: word })).toBeVisible();
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet.locator('.learning-status')).toHaveText('Saved ✓');
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(sheet).toBeHidden();
}

async function openWords(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Library' }).click();
  await page.getByRole('button', { name: 'Words' }).click();
  await expect(page.locator('.words-dialog').getByRole('heading', { name: 'Words' })).toBeVisible();
}

test('the Words sheet opens one pair, filters, and exports its CSV', async ({
  page,
}, testInfo) => {
  const fixture = testInfo.outputPath('words-de.epub');
  await mkdir(dirname(fixture), { recursive: true });
  await writeFile(
    fixture,
    makeWordBookZip('Hausbuch', 'de', [
      ['Das Haus ist alt.', 'The house is old.'],
      ['Der Hund bellt laut.', 'The dog barks loudly.'],
    ]),
  );
  await importBook(page, fixture);
  await saveWord(page, '.pair[data-pair-id="p1"] .src', 'Haus');
  await saveWord(page, '.pair[data-pair-id="p2"] .src', 'Hund');

  await openWords(page);
  const sheet = page.locator('.words-dialog');
  await expect(sheet.locator('.words-lead')).toHaveText('1 language pair · 2 words');
  const card = sheet.locator('.words-pair').filter({ hasText: 'German → English' });
  await expect(card).toContainText('de → en');
  await expect(card).toContainText('not exported');
  await expect(card.locator('.words-count b')).toHaveText('2');

  await card.click();
  await expect(sheet.getByRole('heading', { name: 'German → English' })).toBeVisible();
  await expect(sheet.locator('.words-row')).toHaveCount(2);

  const search = sheet.getByRole('searchbox', { name: 'Search saved words' });
  await search.fill('hund');
  await expect(sheet.locator('.words-row')).toHaveCount(1);
  await expect(sheet.locator('.words-row')).toContainText('Hund');
  const controls = await sheet.evaluate((dialog) => {
    const height = (selector: string): number =>
      dialog.querySelector(selector)?.getBoundingClientRect().height ?? 0;
    return {
      chip: height('.words-chip'),
      search: height('.words-search'),
      export: height('.words-export'),
      done: height('.words-done'),
    };
  });
  for (const [name, height] of Object.entries(controls)) {
    expect(height, `${name} is one tap target tall`).toBeGreaterThanOrEqual(43.5);
  }
  await search.fill('zzz');
  await expect(sheet.locator('.words-empty')).toHaveText('No saved words match this search.');
  await search.fill('');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    sheet.getByRole('button', { name: 'Export 2 words as CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^de-en-words-\d{4}-\d{2}-\d{2}\.csv$/);
  const path = await download.path();
  const csv = await readFile(path, 'utf8');
  expect(
    csv.startsWith(
      '\uFEFFWord,Surface,Context,Translation,Entry,Book,Chapter,Created,Note\r\n',
    ),
  ).toBe(true);
  expect(csv).toContain('Haus');
  expect(csv).toContain('The house is old.');

  await expect(sheet.locator('.words-status-line')).toHaveText('Exported 2 words ✓');
  await expect(sheet.getByRole('button', { name: 'Exported 2' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Exported 2' }).click();
  await expect(sheet.locator('.words-row')).toHaveCount(2);

  await sheet.getByRole('button', { name: '‹ Words' }).click();
  await expect(sheet.getByRole('heading', { name: 'Words' })).toBeVisible();
  await expect(sheet.locator('.words-pair')).toContainText('exported');

  await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  // Boot starts on the Library screen; the stored export state must survive it.
  await page.getByRole('button', { name: 'Words' }).click();
  await expect(page.locator('.words-pair')).toContainText('exported');
});

test('word lists stay separated by language pair', async ({ page }, testInfo) => {
  const german = testInfo.outputPath('words-de-2.epub');
  const vietnamese = testInfo.outputPath('words-vi.epub');
  await mkdir(dirname(german), { recursive: true });
  await writeFile(
    german,
    makeWordBookZip('Hausbuch', 'de', [['Das Haus ist alt.', 'The house is old.']]),
  );
  await writeFile(
    vietnamese,
    makeWordBookZip('Chú mèo', 'vi', [
      ['Con mèo ngồi trên mái nhà.', 'The cat sits on the roof.'],
    ]),
  );

  await importBook(page, german);
  await saveWord(page, '.pair[data-pair-id="p1"] .src', 'Haus');

  await page.getByRole('button', { name: 'Library' }).click();
  await page.locator('input[type="file"]').setInputFiles(vietnamese);
  await expect(page.locator('.pair[data-pair-id="p1"]')).toBeVisible();
  await saveWord(page, '.pair[data-pair-id="p1"] .src', 'mèo');

  await openWords(page);
  const sheet = page.locator('.words-dialog');
  await expect(sheet.locator('.words-lead')).toHaveText('2 language pairs · 2 words');
  await expect(sheet.locator('.words-pair')).toHaveCount(2);

  await sheet.locator('.words-pair').filter({ hasText: 'Vietnamese → English' }).click();
  await expect(sheet.getByRole('heading', { name: 'Vietnamese → English' })).toBeVisible();
  await expect(sheet.locator('.words-row')).toHaveCount(1);
  await expect(sheet.locator('.words-row')).toContainText('mèo');

  await sheet.getByRole('searchbox', { name: 'Search saved words' }).fill('Haus');
  await expect(sheet.locator('.words-empty')).toHaveText('No saved words match this search.');
  await expect(sheet.getByRole('button', { name: 'Export 0 words as CSV' })).toBeDisabled();
});

test('a saved word opens its sentence and its note, then jumps back to it', async ({
  page,
}, testInfo) => {
  const fixture = testInfo.outputPath('words-detail.epub');
  await mkdir(dirname(fixture), { recursive: true });
  await writeFile(
    fixture,
    makeWordBookZip('Hausbuch', 'de', [
      ['Das Haus ist alt.', 'The house is old.'],
      ['Der Hund bellt laut.', 'The dog barks loudly.'],
      // Enough sentences below the second pair to make the jump scrollable.
      ...Array.from(
        { length: 12 },
        (_, index) =>
          [`Füllsatz ${index + 1}.`, `Filler sentence ${index + 1}.`] as [string, string],
      ),
    ]),
  );
  await importBook(page, fixture);
  await saveWord(page, '.pair[data-pair-id="p1"] .src', 'Haus');
  await saveWord(page, '.pair[data-pair-id="p2"] .src', 'Hund');

  // The note belongs to the sentence, not to the word record.
  await tapText(page, '.pair[data-pair-id="p2"] .src', 'bellt');
  const learning = page.locator('.learning-dialog');
  await learning.waitFor({ state: 'visible' });
  const sentenceTab = learning.getByRole('tab', { name: /^(Sentence|Passage)$/ });
  if ((await sentenceTab.count()) > 0) await sentenceTab.click();
  await learning.getByRole('textbox', { name: 'Note' }).fill('A loud dog.');
  await learning.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(learning).toBeHidden();

  // Stored position stays on the first sentence, so a jump to the second shows.
  await page.evaluate(() => {
    const app = document.querySelector('#app');
    if (app) app.scrollTop = 0;
  });
  await page.waitForTimeout(600);

  await openWords(page);
  const sheet = page.locator('.words-dialog');
  await sheet.locator('.words-pair').filter({ hasText: 'German → English' }).click();
  const search = sheet.getByRole('searchbox', { name: 'Search saved words' });
  await search.fill('hund');
  await expect(sheet.locator('.words-row')).toHaveCount(1);
  const rowHeight = await sheet
    .locator('.words-open')
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(rowHeight).toBeGreaterThanOrEqual(43.5);
  await sheet.locator('.words-open').click();

  await expect(sheet.getByRole('heading', { name: 'Hund' })).toBeVisible();
  const context = sheet.locator('.words-context');
  await expect(context).toContainText('Der Hund bellt laut.');
  await expect(context).toContainText('The dog barks loudly.');
  await expect(context.locator('.words-detail-word')).toHaveText('Hund');
  await expect(sheet.locator('.words-detail-note')).toHaveText('A loud dog.');
  const jumpHeight = await sheet
    .getByRole('button', { name: 'Go to word' })
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(jumpHeight).toBeGreaterThanOrEqual(43.5);

  // Back keeps the search: a word is not hunted twice.
  await sheet.getByRole('button', { name: /German → English/ }).click();
  await expect(search).toHaveValue('hund');
  await expect(sheet.locator('.words-row')).toHaveCount(1);
  await sheet.locator('.words-open').click();

  await sheet.getByRole('button', { name: 'Go to word' }).click();
  await expect(sheet).toBeHidden();
  // The stored position was the first sentence, so scrolling proves the jump.
  await page.waitForFunction(() => {
    const app = document.querySelector('#app');
    const pair = document.querySelector('.pair[data-pair-id="p2"]');
    return !!pair && (app?.scrollTop ?? 0) > 0;
  });
  const geometry = await page.evaluate(() => {
    const app = document.querySelector('#app');
    const topbar = document.querySelector('.topbar');
    const pair = document.querySelector('.pair[data-pair-id="p2"]');
    return {
      scroll: app?.scrollTop ?? 0,
      anchor: (topbar?.getBoundingClientRect().height ?? 0) + 8,
      top: pair?.getBoundingClientRect().top ?? -1,
    };
  });
  expect(geometry.scroll).toBeGreaterThan(0);
  // The pair lands just under the sticky bar, which is the reader's own anchor.
  expect(Math.abs(geometry.top - geometry.anchor)).toBeLessThan(2);

  const jumped = page.locator('.pair[data-pair-id="p2"]');
  await expect(jumped.locator('.src')).toContainText('Der Hund bellt laut.');
  await expect(jumped.locator('mark.reader-note')).toHaveCount(2);
});
