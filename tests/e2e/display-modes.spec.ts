import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';

import { makeParagraphZip } from './book-fixture';
import { choose } from './sheet';

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
  await choose(page, 'display', 'Paragraph');

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

  // Source only removes the target paragraph; the source spans the row.
  await page.getByRole('button', { name: 'Reading settings' }).click();
  await choose(page, 'languages', 'Source only');
  await expect(page.locator('.tgt')).toHaveCount(0);
  await expect(first.locator('.src')).toHaveText('Jetzt erzähle ich die Geschichte.');
  expect(
    await first.locator('.src').evaluate((element) => getComputedStyle(element).gridColumn),
  ).toBe('1 / -1');

  // Translation only drops the source and promotes the target to reading size.
  await choose(page, 'languages', 'Translation only');
  await expect(page.locator('.src')).toHaveCount(0);
  await expect(first.locator('.tgt')).toHaveText('Now I tell the story.');
  const promoted = await first.locator('.tgt').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      border: style.borderLeftWidth,
      size: style.fontSize,
      paragraphSize: getComputedStyle(element.parentElement as HTMLElement).fontSize,
    };
  });
  expect(promoted.border).toBe('0px');
  expect(promoted.size).toBe(promoted.paragraphSize);

  // Translation first: the DOM order and the two columns swap.
  await choose(page, 'languages', 'Both languages');
  await choose(page, 'order', 'Translation first');
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
  const roles = await first.evaluate((element) => {
    const read = (node: Element | null) => {
      const style = getComputedStyle(node as HTMLElement);
      return { color: style.color, size: style.fontSize };
    };
    return {
      chapter: read(element.closest('.chapter')),
      source: read(element.querySelector('.src')),
      target: read(element.querySelector('.tgt')),
    };
  });
  // Translation first promotes the translation and demotes the source, in the
  // columns as well as the stacked flow.
  expect(roles.target.color).toBe(roles.chapter.color);
  expect(roles.target.size).toBe(roles.chapter.size);
  expect(roles.source.color).not.toBe(roles.chapter.color);
  expect(parseFloat(roles.source.size)).toBeCloseTo(
    parseFloat(roles.chapter.size) * 0.9,
    1,
  );
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
  await choose(page, 'display', 'Sentence');
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

  const stacked = await sentencePair.evaluate((element) => {
    const read = (selector: string) => {
      const style = getComputedStyle(element.querySelector(selector) as HTMLElement);
      return { border: style.borderLeftWidth, indent: style.paddingLeft, size: style.fontSize };
    };
    return { source: read('.src'), target: read('.tgt') };
  });
  // Stacked, the rule and the indent mark the second language, not the target.
  expect(stacked.target.border).toBe('0px');
  expect(stacked.target.indent).toBe('0px');
  expect(stacked.source.border).toBe('2px');
  expect(stacked.source.size).not.toBe(stacked.target.size);

  // One visible language is always primary, even under Translation first.
  await choose(page, 'languages', 'Source only');
  await expect(page.locator('.tgt')).toHaveCount(0);
  await expect(sentencePair.locator('.src')).toHaveText('Jetzt erzähle ich');
  expect(await sentencePair.evaluate((element) => element.children.length)).toBe(1);
  const lone = await sentencePair.locator('.src').evaluate((element) => {
    const style = getComputedStyle(element);
    return { border: style.borderLeftWidth, size: style.fontSize };
  });
  expect(lone.border).toBe('0px');
  expect(lone.size).toBe(
    await sentencePair.evaluate((element) => getComputedStyle(element).fontSize),
  );

  // Translation only leaves just the target, at reading size.
  await choose(page, 'languages', 'Translation only');
  await expect(page.locator('.src')).toHaveCount(0);
  await expect(sentencePair.locator('.tgt')).toHaveText('Now I tell');
  expect(
    await sentencePair
      .locator('.tgt')
      .evaluate((element) => getComputedStyle(element).borderLeftWidth),
  ).toBe('0px');

  // Changing the order back resets the roles; no element keeps a stale class.
  await choose(page, 'languages', 'Both languages');
  await choose(page, 'order', 'Source first');
  await expect
    .poll(() =>
      sentencePair.evaluate((element) =>
        Array.from(element.children).map((child) => child.className),
      ),
    )
    .toEqual(['src', 'tgt']);
  const reset = await sentencePair.evaluate((element) => {
    const read = (selector: string) => {
      const style = getComputedStyle(element.querySelector(selector) as HTMLElement);
      return { border: style.borderLeftWidth, size: style.fontSize };
    };
    return { source: read('.src'), target: read('.tgt') };
  });
  expect(reset.source.border).toBe('0px');
  expect(reset.target.border).toBe('2px');
  expect(reset.target.size).not.toBe(reset.source.size);

  expect(pageErrors).toEqual([]);
});
