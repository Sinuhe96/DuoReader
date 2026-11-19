import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';

import { makePinyinZip } from './book-fixture';
import { choose } from './sheet';

test('pinyin sits above the source only when asked', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('./');

  const fixturePath = testInfo.outputPath('pinyin.epub');
  await mkdir(dirname(fixturePath), { recursive: true });
  await writeFile(fixturePath, makePinyinZip());
  await page.locator('input[type="file"]').setInputFiles(fixturePath);

  // Off by default: a book that carries pinyin renders exactly as before.
  await expect(page.locator('.pair')).toHaveCount(3);
  await expect(page.locator('.pinyin')).toHaveCount(0);

  await page.getByRole('button', { name: 'Reading settings' }).click();
  await choose(page, 'pinyin', 'Above source');

  const firstPair = page.locator('.pair').first();
  await expect(page.locator('.pinyin')).toHaveCount(2);
  await expect(firstPair.locator('.pinyin')).toHaveText('Hěn jiǔ yǐqián');
  expect(await firstPair.locator('.pinyin').getAttribute('lang')).toBe('zh-Latn');

  // The line is smaller than the source and sits above its text.
  const geometry = await firstPair.locator('.src').evaluate((element) => {
    const pinyin = element.querySelector('.pinyin') as HTMLElement;
    const textNode = Array.from(element.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE,
    );
    const range = document.createRange();
    if (textNode) range.selectNodeContents(textNode);
    return {
      pinyinBottom: pinyin.getBoundingClientRect().bottom,
      textTop: range.getBoundingClientRect().top,
      pinyinSize: Number.parseFloat(getComputedStyle(pinyin).fontSize),
      sourceSize: Number.parseFloat(getComputedStyle(element).fontSize),
    };
  });
  expect(geometry.pinyinBottom).toBeLessThanOrEqual(geometry.textTop + 1);
  expect(geometry.pinyinSize).toBeLessThan(geometry.sourceSize);

  // The third sentence has no pinyin and gets no line.
  const lastPair = page.locator('.pair').last();
  await expect(lastPair.locator('.pinyin')).toHaveCount(0);

  // Paragraph mode joins the annotated sentences into one line per paragraph.
  const paragraphs = page.locator('.paragraph');
  await choose(page, 'display', 'Paragraph');
  await expect(paragraphs).toHaveCount(2);
  await expect(paragraphs.first().locator('.pinyin')).toHaveText(
    'Hěn jiǔ yǐqián yǒu yí gè háizi',
  );
  await expect(paragraphs.nth(1).locator('.pinyin')).toHaveCount(0);

  // Translation only hides the source, and the pinyin with it.
  await choose(page, 'languages', 'Translation only');
  await expect(page.locator('.src')).toHaveCount(0);
  await expect(page.locator('.pinyin')).toHaveCount(0);
  await choose(page, 'languages', 'Both languages');
  await expect(paragraphs.first().locator('.pinyin')).toHaveCount(1);

  await page.getByRole('button', { name: 'Done' }).click();

  // The choice survives a reload.
  await page.reload();
  await page.getByRole('button', { name: 'Read' }).click();
  await expect(page.locator('.paragraph').first().locator('.pinyin')).toHaveText(
    'Hěn jiǔ yǐqián yǒu yí gè háizi',
  );

  expect(pageErrors).toEqual([]);
});
