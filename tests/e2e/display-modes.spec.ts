import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';

import { makeParagraphZip } from './book-fixture';

test('paragraph mode stacks on a phone and splits into columns on a tablet', async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('./');

  const fixturePath = testInfo.outputPath('paragraphs.epub');
  await mkdir(dirname(fixturePath), { recursive: true });
  await writeFile(fixturePath, makeParagraphZip());
  await page.locator('input[type="file"]').setInputFiles(fixturePath);

  // Sentence-by-sentence is the default view.
  await expect(page.locator('.pair')).toHaveCount(4);
  await expect(page.locator('.paragraph')).toHaveCount(0);
  const firstPair = page.locator('.pair').first();
  await expect(firstPair.locator('.src em')).toHaveText('erzähle');
  await expect(firstPair.locator('.tgt em')).toHaveText('tell');

  await page.getByRole('button', { name: 'Reading settings' }).click();
  await page.locator('#settings-display').selectOption('paragraph');

  await expect(page.locator('.pair')).toHaveCount(0);
  await expect(page.locator('.paragraph')).toHaveCount(2);
  const first = page.locator('.paragraph').first();
  await expect(first.locator('.src')).toHaveText('Jetzt erzähle ich die Geschichte.');
  await expect(first.locator('.tgt')).toHaveText('Now I tell the story.');
  await expect(first.locator('.src em')).toHaveText('erzähle');
  await expect(first.locator('.tgt em')).toHaveText('tell');
  await expect(page.locator('.paragraph').nth(1).locator('.src')).toHaveText(
    '»Kannst du schwimmen?«, fragte Oma.',
  );

  await page.getByRole('button', { name: 'Done' }).click();

  // 390px: the current vertical flow.
  expect(await first.evaluate((element) => getComputedStyle(element).display)).toBe('block');

  // Tablet width: two columns on one row.
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect
    .poll(() => first.evaluate((element) => getComputedStyle(element).display))
    .toBe('grid');
  const geometry = await first.evaluate((element) => {
    const source = element.querySelector('.src');
    const target = element.querySelector('.tgt');
    return {
      columns: getComputedStyle(element).gridTemplateColumns.split(' ').length,
      sourceTop: source?.getBoundingClientRect().top ?? -1,
      targetTop: target?.getBoundingClientRect().top ?? -1,
      sourceLeft: source?.getBoundingClientRect().left ?? -1,
      targetLeft: target?.getBoundingClientRect().left ?? -1,
    };
  });
  expect(geometry.columns).toBe(2);
  expect(Math.abs(geometry.sourceTop - geometry.targetTop)).toBeLessThan(2);
  expect(geometry.targetLeft).toBeGreaterThan(geometry.sourceLeft);

  // Hiding the translation removes the target paragraph; the source spans the row.
  await page.getByRole('button', { name: 'Reading settings' }).click();
  await page.locator('#settings-translation').selectOption('source');
  await expect(page.locator('.tgt')).toHaveCount(0);
  await expect(first.locator('.src')).toHaveText('Jetzt erzähle ich die Geschichte.');
  expect(
    await first.locator('.src').evaluate((element) => getComputedStyle(element).gridColumn),
  ).toBe('1 / -1');

  // Translation first: the DOM order and the two columns swap.
  await page.locator('#settings-translation').selectOption('both');
  await page.locator('#settings-order').selectOption('target-first');
  await expect(first.locator('.tgt')).toHaveText('Now I tell the story.');
  await expect
    .poll(() =>
      first.evaluate((element) =>
        Array.from(element.children).map((child) => child.className),
      ),
    )
    .toEqual(['tgt', 'src']);
  const swapped = await first.evaluate((element) => {
    const source = element.querySelector('.src');
    const target = element.querySelector('.tgt');
    return {
      sourceLeft: source?.getBoundingClientRect().left ?? -1,
      targetLeft: target?.getBoundingClientRect().left ?? -1,
    };
  });
  expect(swapped.targetLeft).toBeLessThan(swapped.sourceLeft);
  await page.getByRole('button', { name: 'Done' }).click();

  // The choices persist across a reload.
  await page.reload();
  await page.getByRole('button', { name: 'Read' }).click();
  await expect(page.locator('.paragraph')).toHaveCount(2);
  await expect
    .poll(() =>
      page.locator('.paragraph').first().evaluate((element) =>
        Array.from(element.children).map((child) => child.className),
      ),
    )
    .toEqual(['tgt', 'src']);

  // Back to sentences: the pair view returns with the same order.
  await page.getByRole('button', { name: 'Reading settings' }).click();
  await page.locator('#settings-display').selectOption('sentence');
  await expect(page.locator('.pair')).toHaveCount(4);
  await expect(page.locator('.paragraph')).toHaveCount(0);
  const sentencePair = page.locator('.pair').first();
  await expect
    .poll(() =>
      sentencePair.evaluate((element) =>
        Array.from(element.children).map((child) => child.className),
      ),
    )
    .toEqual(['tgt', 'src']);

  // Hiding the translation also works pair by pair.
  await page.locator('#settings-translation').selectOption('source');
  await expect(page.locator('.tgt')).toHaveCount(0);
  await expect(sentencePair.locator('.src')).toHaveText('Jetzt erzähle ich');
  expect(await sentencePair.evaluate((element) => element.children.length)).toBe(1);

  expect(pageErrors).toEqual([]);
});
