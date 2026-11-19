import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';
import { makeChaptersZip } from './book-fixture';

test('the chapter list opens as a sheet and leaves the reading screen unnamed', async ({
  page,
}, testInfo) => {
  await page.goto('./');
  const fixturePath = testInfo.outputPath('chapters.epub');
  await mkdir(dirname(fixturePath), { recursive: true });
  await writeFile(fixturePath, makeChaptersZip());
  await page.locator('input[type="file"]').setInputFiles(fixturePath);

  await expect(page.locator('[data-pair-id="p1"]')).toBeVisible();
  await expect(page.locator('.controls select')).toHaveCount(0);
  await expect(page.locator('.chapters-dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'Chapter list' }).click();
  const dialog = page.locator('.chapters-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.chapter-item')).toHaveText([
    'Chapter 1',
    'Chapter 2',
    'Chapter 3',
  ]);
  await expect(dialog.locator('.chapter-item.current')).toHaveText(['Chapter 1']);

  await dialog.getByRole('button', { name: /Chapter 2/ }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-pair-id="p2"]')).toBeVisible();

  await page.getByRole('button', { name: 'Chapter list' }).click();
  await expect(page.locator('.chapters-dialog .chapter-item.current')).toHaveText([
    'Chapter 2',
  ]);
});
