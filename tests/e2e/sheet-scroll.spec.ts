import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

import { makeLongZip } from './book-fixture';

/** The app is a scroll pane; the viewport never scrolls. */
async function appScroll(page: Page): Promise<number> {
  return page.evaluate(() => document.getElementById('app')!.scrollTop);
}

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

/**
 * A touch drag built from real touch events, so it runs in every engine and
 * reports what the app did with each move. Untrusted events do not drive
 * native controls, so this proves the app's decision (cancelled or not), not
 * the engine's own gesture handling.
 */
async function syntheticDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<boolean[]> {
  return page.evaluate(
    ({ from: start, to: end }) => {
      const target = document.elementFromPoint(start.x, start.y) ?? document.body;
      const prevented: boolean[] = [];
      const legacy = document as Document & {
        createTouch?: (
          view: Window,
          target: EventTarget,
          identifier: number,
          x: number,
          y: number,
          pageX: number,
          pageY: number,
        ) => Touch;
      };
      const fire = (type: string, x: number, y: number): void => {
        const point = legacy.createTouch?.call(document, window, target, 1, x, y, x, y);
        const list = point ? [point] : [];
        let event: Event;
        try {
          event = new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: type === 'touchend' ? [] : list,
            targetTouches: type === 'touchend' ? [] : list,
            changedTouches: list,
          });
        } catch {
          event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, {
            touches: { value: type === 'touchend' ? [] : list },
            targetTouches: { value: type === 'touchend' ? [] : list },
            changedTouches: { value: list },
            clientX: { value: x },
            clientY: { value: y },
          });
        }
        target.dispatchEvent(event);
        if (type === 'touchmove') prevented.push(event.defaultPrevented);
      };
      fire('touchstart', start.x, start.y);
      for (let step = 1; step <= 8; step += 1) {
        fire(
          'touchmove',
          start.x + ((end.x - start.x) * step) / 8,
          start.y + ((end.y - start.y) * step) / 8,
        );
      }
      fire('touchend', end.x, end.y);
      return prevented;
    },
    { from, to },
  );
}

/** A real touch drag, where the engine can dispatch one (Chromium only). */
async function nativeDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const steps = 8;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        {
          x: from.x + ((to.x - from.x) * step) / steps,
          y: from.y + ((to.y - from.y) * step) / steps,
        },
      ],
    });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);
  await cdp.detach();
}

test('the viewport never scrolls and the sheet cannot reach the story', async ({
  page,
}, testInfo) => {
  const fixturePath = testInfo.outputPath('long.epub');
  await mkdir(dirname(fixturePath), { recursive: true });
  await writeFile(fixturePath, makeLongZip());

  await page.goto('./');
  await page.locator('input[type="file"]').setInputFiles(fixturePath);
  await page.waitForSelector('[data-pair-id="p1"]');

  // The structural guarantee, and the reason this cannot drift: the viewport
  // has no scrollable overflow, so there is nothing for a gesture to pan. The
  // story lives in `#app`, a scroll pane that is not an ancestor of the
  // dialog, so the sheet's scroll chain ends at a viewport that cannot move.
  const model = await page.evaluate(() => {
    const app = document.getElementById('app')!;
    return {
      htmlOverflow: getComputedStyle(document.documentElement).overflow,
      bodyOverflow: getComputedStyle(document.body).overflow,
      appOverflow: getComputedStyle(app).overflowY,
      documentScrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      appScrollHeight: app.scrollHeight,
      appClientHeight: app.clientHeight,
    };
  });
  expect(model.htmlOverflow).toBe('hidden');
  expect(model.bodyOverflow).toBe('hidden');
  expect(model.appOverflow).toBe('auto');
  expect(model.documentScrollHeight).toBe(model.innerHeight);
  expect(model.appScrollHeight).toBeGreaterThan(model.appClientHeight);

  // The story scrolls in the pane, and the window never moves.
  await page.evaluate(() => {
    document.getElementById('app')!.scrollTop = 600;
  });
  const startScroll = await appScroll(page);
  expect(startScroll).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const pairBefore = await topPairId(page);

  await page.getByRole('button', { name: 'Reading settings' }).click();
  const dialog = page.locator('.settings-dialog');
  await expect(dialog).toBeVisible();

  // The heading is the one place in the sheet that owns no control, so a drag
  // there can only mean "the sheet".
  const heading = await page.locator('#settings-title').boundingBox();
  expect(heading).not.toBeNull();
  if (!heading) return;
  const blank = { x: heading.x + heading.width / 2, y: heading.y + heading.height / 2 };

  // A drag on the sheet's surface belongs to the sheet. When the sheet has
  // nothing to scroll, the app cancels the gesture, so it is neither a page
  // pan nor a text selection. When the sheet overflows — a short viewport, or
  // a WebKit sheet that is taller than its box — the gesture scrolls the sheet
  // instead. Either way the story does not move.
  const sheetOverflows = await page.evaluate(() => {
    const dialog = document.querySelector('.settings-dialog') as HTMLElement;
    return dialog.scrollHeight - dialog.clientHeight > 1;
  });
  const sheetMoves = await syntheticDrag(page, blank, { x: blank.x, y: blank.y - 240 });
  expect(sheetMoves.length).toBeGreaterThan(0);
  if (sheetOverflows) {
    expect(sheetMoves.some((prevented) => !prevented)).toBe(true);
  } else {
    expect(sheetMoves.every(Boolean)).toBe(true);
  }

  // A drag on a control is never cancelled, so the slider keeps the gesture.
  // The sheet scrolls, so bring the slider into the sheet's view first: a drag
  // that starts outside the viewport would hit nothing.
  const slider = page.locator('input[type="range"]').first();
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const trackY = box.y + box.height / 2;
  const sliderMoves = await syntheticDrag(
    page,
    { x: box.x + box.width * 0.2, y: trackY },
    { x: box.x + box.width * 0.85, y: trackY },
  );
  expect(sliderMoves.length).toBeGreaterThan(0);
  expect(sliderMoves.some((prevented) => !prevented)).toBe(true);

  // Where the engine can dispatch a real gesture, the story must not move and
  // the slider must follow the finger from anywhere on its track.
  const native = test.info().project.use.browserName === 'chromium';
  if (native) {
    const sizeBefore = Number(await slider.inputValue());
    await nativeDrag(
      page,
      { x: box.x + box.width * 0.2, y: trackY },
      { x: box.x + box.width * 0.85, y: trackY },
    );
    expect(Number(await slider.inputValue())).toBeGreaterThan(sizeBefore);

    // The size change re-rendered the reader, so take the baseline now: the
    // drag on the sheet must not move the pane at all.
    const beforeDrag = await appScroll(page);
    await nativeDrag(page, blank, { x: blank.x, y: blank.y - 240 });
    expect(await appScroll(page)).toBe(beforeDrag);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  }

  // A size change re-renders the reader, so the offset may shift — what must
  // hold is that the reader stays on the same pair and the viewport is still.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(() => topPairId(page)).toBe(pairBefore);

  // Closing keeps the reader anchored on the same pair.
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => topPairId(page)).toBe(pairBefore);
});
