import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, test, type Locator } from '@playwright/test';

import { makeTitledZip } from './book-fixture';

interface CardLayout {
  viewport: number;
  scroll: number;
  card: { left: number; right: number; width: number };
  infoWidth: number;
  title: { client: number; scroll: number; overflow: string; whiteSpace: string };
  actions: { left: number; right: number; width: number };
  buttons: { left: number; right: number; width: number; text: string | null }[];
}

async function measure(card: Locator): Promise<CardLayout> {
  return card.evaluate((element) => {
    const root = element.ownerDocument.documentElement;
    const info = element.querySelector('.book-info') as HTMLElement;
    const title = element.querySelector('h2') as HTMLElement;
    const actions = element.querySelector('.book-actions') as HTMLElement;
    const buttons = Array.from(
      element.querySelectorAll<HTMLElement>('.book-actions button'),
    );
    const cardRect = element.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    return {
      viewport: root.clientWidth,
      scroll: root.scrollWidth,
      card: { left: cardRect.left, right: cardRect.right, width: cardRect.width },
      infoWidth: info.getBoundingClientRect().width,
      title: {
        client: title.clientWidth,
        scroll: title.scrollWidth,
        overflow: getComputedStyle(title).textOverflow,
        whiteSpace: getComputedStyle(title).whiteSpace,
      },
      actions: { left: actionsRect.left, right: actionsRect.right, width: actionsRect.width },
      buttons: buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, text: button.textContent };
      }),
    };
  });
}

test('a long title ellipsizes and the actions stay inside the card', async ({
  page,
}, testInfo) => {
  const fixturePath = testInfo.outputPath('long-title.epub');
  await mkdir(dirname(fixturePath), { recursive: true });
  await writeFile(
    fixturePath,
    makeTitledZip('The Dreadmoor Experiment (The Dreadmoor Chronicles, Volume One)'),
  );

  await page.goto('./');
  await page.locator('input[type="file"]').setInputFiles(fixturePath);
  await page.getByRole('button', { name: 'Back to library' }).click();

  const card = page.locator('.book-card').first();
  await expect(card).toBeVisible();

  // Phone (the default 390px): the card stacks and must stay inside the page.
  const phone = await measure(card);
  expect(phone.scroll).toBeLessThanOrEqual(phone.viewport);
  expect(phone.card.right).toBeLessThanOrEqual(phone.viewport);
  expect(phone.card.left).toBeGreaterThanOrEqual(0);

  // The title is clipped with an ellipsis instead of widening the card.
  expect(phone.title.overflow).toBe('ellipsis');
  expect(phone.title.whiteSpace).toBe('nowrap');
  expect(phone.title.scroll).toBeGreaterThan(phone.title.client);
  expect(phone.title.client).toBeLessThan(phone.card.width);

  // Both actions are fully inside the card and share its one row.
  expect(phone.buttons.map((button) => button.text)).toEqual(['Read', 'Delete']);
  for (const button of phone.buttons) {
    expect(button.left).toBeGreaterThanOrEqual(phone.card.left);
    expect(button.right).toBeLessThanOrEqual(phone.card.right);
    expect(button.width).toBeGreaterThanOrEqual(71.5);
    expect(button.width).toBeLessThanOrEqual(phone.card.width - 2);
  }
  expect(phone.buttons[0].left).toBeCloseTo(phone.actions.left, 0);
  expect(phone.buttons[1].right).toBeCloseTo(phone.actions.right, 0);

  // Wide screen: the actions sit beside the info and their width is bounded.
  await page.setViewportSize({ width: 900, height: 900 });
  const wide = await measure(card);
  expect(wide.scroll).toBeLessThanOrEqual(wide.viewport);
  expect(wide.actions.left).toBeGreaterThan(wide.card.left + wide.card.width / 2);
  for (const button of wide.buttons) {
    expect(button.left).toBeGreaterThanOrEqual(wide.card.left);
    expect(button.right).toBeLessThanOrEqual(wide.card.right);
    expect(button.width).toBeGreaterThanOrEqual(71.5);
    expect(button.width).toBeLessThanOrEqual(128.5);
  }
});
