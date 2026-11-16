import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';

import type { BuildInfo } from '../../src/build-info';
import { makeBookZip } from './book-fixture';

test('cold start restores the reading position and settings', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  // Refuse persistence so the best-effort storage note is exercised.
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'persist', { value: async () => false });
    Object.defineProperty(navigator.storage, 'persisted', { value: async () => false });
  });

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
  await expect(page.locator('.settings-dialog')).toBeVisible();
  // A focused <select> pops the native picker open on iOS.
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.id))
    .toBe('settings-title');
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

  const fontSelect = page.locator('#settings-font');
  await fontSelect.selectOption('georgia');
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--reader-font').trim(),
      ),
    )
    .toContain('Georgia');

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
  await expect(
    page.getByText('This browser may clear stored books when space runs low.'),
  ).toBeVisible();

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
  const readerFont = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--reader-font').trim(),
  );
  expect(readerFont).toContain('Georgia');
  expect(pageErrors).toEqual([]);
});
