import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { makeLongZip } from './book-fixture';

/**
 * The sheet's own coordinates: the padding above the first row, far from any
 * control, so a drag there can only mean "pan the sheet".
 */
const sheetBlank = { x: 195, y: 700 };

async function topPairId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const header = document.querySelector('.topbar');
    const threshold = (header?.getBoundingClientRect().height ?? 0) + 4;
    let last: string | null = null;
    for (const pair of Array.from(document.querySelectorAll('.reader-pair'))) {
      last = pair.getAttribute('data-pair-id');
      if (pair.getBoundingClientRect().bottom > threshold) return last;
    }
    return last;
  });
}

async function touchDrag(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const steps = 8;
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [start],
  });
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        {
          x: start.x + ((end.x - start.x) * step) / steps,
          y: start.y + ((end.y - start.y) * step) / steps,
        },
      ],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
  await cdp.detach();
}

test('a settings sheet owns the gesture and leaves the reader in place', async ({
  page,
}, testInfo) => {
  const fixturePath = testInfo.outputPath('long.epub');
  await mkdir(dirname(fixturePath), { recursive: true });
  await writeFile(fixturePath, makeLongZip());

  await page.goto('./');
  await page.locator('input[type="file"]').setInputFiles(fixturePath);
  await page.waitForSelector('[data-pair-id="p1"]');

  // The book has to scroll for the bug to be visible at all: before the lock,
  // a drag that started on the sheet panned the reader underneath it.
  const scrollable = await page.evaluate(
    () => document.documentElement.scrollHeight > window.innerHeight,
  );
  expect(scrollable).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 600));
  const startScroll = await page.evaluate(() => window.scrollY);
  const pairBefore = await topPairId(page);

  await page.getByRole('button', { name: 'Reading settings' }).click();
  const dialog = page.locator('.settings-dialog');
  await expect(dialog).toBeVisible();

  // The sheet locks the document scroller while it is open.
  const html = page.locator('html');
  await expect(html).toHaveClass(/sheet-open/);
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).overflow),
  ).toBe('hidden');

  // A wheel or a touch drag on the sheet must not move the reader.
  await page.mouse.move(sheetBlank.x, 130);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.scrollY)).toBe(startScroll);

  await touchDrag(page, sheetBlank, { x: sheetBlank.x, y: sheetBlank.y - 400 });
  expect(await page.evaluate(() => window.scrollY)).toBe(startScroll);

  // Dragging along the slider's track, away from the thumb, now takes the drag.
  const slider = page.locator('input[type="range"]').first();
  const box = await slider.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const sizeBefore = Number(await slider.inputValue());
  const trackY = box.y + box.height / 2;
  await touchDrag(
    page,
    { x: box.x + box.width * 0.2, y: trackY },
    { x: box.x + box.width * 0.85, y: trackY },
  );
  expect(Number(await slider.inputValue())).toBeGreaterThan(sizeBefore);

  // Closing releases the lock and keeps the reader anchored on the same pair.
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(html).not.toHaveClass(/sheet-open/);
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).overflow),
  ).toBe('visible');
  await expect.poll(() => topPairId(page)).toBe(pairBefore);
});
