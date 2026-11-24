import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

import { makeBookZip } from './book-fixture';

/** 2.75rem at the 16px root — Apple's 44 pt minimum tap target. */
const TAP_TARGET = 44;

/** Click the middle of a word, so the app's caret resolves it. */
async function tapWord(page: Page, selector: string, needle: string): Promise<void> {
  const point = await page.evaluate(
    ({ query, text }) => {
      const line = document.querySelector(query);
      if (!line) throw new Error(`Missing ${query}`);
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const index = (node as Text).data.indexOf(text);
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + text.length);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
      throw new Error(`Text not found: ${text}`);
    },
    { query: selector, text: needle },
  );
  await page.mouse.click(point.x, point.y);
}

async function expectTapTarget(controls: Locator, label: string): Promise<void> {
  await expect(controls.first(), label).toBeVisible();
  const heights = await controls.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().height),
  );
  expect(heights.length, label).toBeGreaterThan(0);
  for (const height of heights) {
    expect(Math.abs(height - TAP_TARGET), `${label}: ${height}px`).toBeLessThanOrEqual(0.5);
  }
}

/**
 * The sheets and the bars are chrome built from one control height. Before
 * 0.17.1 the reading bar and the Aa choices sat at 40 px while a sheet's
 * actions sat at 44, and the learning segments at 36; a thumb feels the
 * difference between two sheets that do the same kind of work.
 */
test('every bar and sheet control is one tap target tall', async ({ page }, testInfo) => {
  const fixture = testInfo.outputPath('control-heights.epub');
  await mkdir(dirname(fixture), { recursive: true });
  await writeFile(fixture, makeBookZip());
  await page.goto('./');
  await page.locator('input[type="file"]').setInputFiles(fixture);
  await expect(page.locator('[data-pair-id="p1"]')).toBeVisible();

  await expectTapTarget(page.locator('.controls button'), 'reading bar');

  await tapWord(page, '.pair[data-pair-id="p1"] .src', 'bleibt');
  const sheet = page.locator('.learning-dialog');
  await expect(sheet).toBeVisible();
  await expectTapTarget(sheet.locator('.learning-tab'), 'learning segments');
  await expectTapTarget(
    sheet.locator('.learning-panel:not([hidden]) .learning-action'),
    'word actions',
  );
  await expectTapTarget(sheet.locator('.learning-done'), 'learning Done');
  await sheet.getByRole('tab', { name: 'Sentence' }).click();
  await expectTapTarget(
    sheet.locator('.learning-panel:not([hidden]) .learning-action'),
    'sentence actions',
  );
  await sheet.getByRole('button', { name: 'Done', exact: true }).click();

  await page.getByRole('button', { name: 'Reading settings' }).click();
  const settings = page.locator('.settings-dialog');
  await expect(settings).toBeVisible();
  await expectTapTarget(settings.locator('.segment'), 'settings choices');
  await expectTapTarget(settings.locator('.setting-disclosure'), 'font row');
  await expectTapTarget(settings.locator('.settings-close'), 'settings Done');
  await settings.getByRole('button', { name: 'Done', exact: true }).click();

  await page.getByRole('button', { name: 'Chapter list' }).click();
  const chapters = page.locator('.chapters-dialog');
  await expect(chapters).toBeVisible();
  await expectTapTarget(chapters.locator('.chapter-item'), 'chapter rows');
  await chapters.getByRole('button', { name: 'Chapter 1' }).click();

  await page.getByRole('button', { name: 'Library' }).click();
  await expectTapTarget(page.locator('.book-actions button'), 'library cards');
});
