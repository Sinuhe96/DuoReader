import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';
import { makeChaptersZip } from './book-fixture';
import { choose, option } from './sheet';

test('a transient IndexedDB failure does not reset stored settings', async ({ page }, testInfo) => {
  await page.goto('./');
  const path = testInfo.outputPath('chapters.epub');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, makeChaptersZip());

  await page.locator('input[type="file"]').setInputFiles(path);
  await expect(page.locator('[data-pair-id="p1"]')).toBeVisible();
  await page.getByRole('button', { name: 'Reading settings' }).click();
  await choose(page, 'display', 'Paragraph');
  await page.locator('.settings-dialog').getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.paragraph')).toHaveCount(1);

  // The next page load fails its first database open, as iOS does around an update.
  await page.evaluate(() => sessionStorage.setItem('duoreader.fail-open-once', '1'));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('duoreader.fail-open-once') !== '1') return;
    sessionStorage.removeItem('duoreader.fail-open-once');
    const open = indexedDB.open.bind(indexedDB);
    let failed = false;
    indexedDB.open = ((...args: Parameters<IDBFactory['open']>) => {
      if (!failed) {
        failed = true;
        throw new Error('simulated transient database failure');
      }
      return open(...args);
    }) as IDBFactory['open'];
  });
  await page.reload();

  // The library itself recovered, so the failure was not persisted in the session.
  await page.getByRole('button', { name: 'Read', exact: true }).first().click();
  await expect(page.locator('.paragraph')).toHaveCount(1);
  await page.getByRole('button', { name: 'Reading settings' }).click();
  await expect(option(page, 'display', 'Paragraph')).toHaveAttribute('aria-pressed', 'true');
});
