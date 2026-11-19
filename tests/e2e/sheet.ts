import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The settings sheet owns its controls: every choice row is a group of
 * `aria-pressed` buttons, never a native `<select>`, so a tap cannot wait for
 * a platform picker. Tests pick an option the way a reader does — by tapping
 * the label they see — and the row must show that choice as pressed.
 *
 * The font row is a disclosure that swaps the sheet body for a list, so it is
 * addressed by its list id when the list is open.
 */
export function option(page: Page, row: string, label: string): Locator {
  return page
    .locator(`#settings-${row}-list, #settings-${row}`)
    .getByRole('button', { name: label, exact: true });
}

/** Open the pushed font list the way a reader does: the `Font … ›` row. */
export async function openFontList(page: Page): Promise<void> {
  await page.locator('#settings-font').click();
  await expect(page.locator('#settings-font-list')).toBeVisible();
}

export async function choose(page: Page, row: string, label: string): Promise<void> {
  await option(page, row, label).click();
  await expect(option(page, row, label)).toHaveAttribute('aria-pressed', 'true');
}

/**
 * Pick a font. The list pops back to the main panel on selection, so the
 * pressed state is not observable afterwards; the row's value is.
 */
export async function chooseFont(page: Page, label: string): Promise<void> {
  await openFontList(page);
  await option(page, 'font', label).click();
  await expect(page.locator('#settings-font-value')).toHaveText(label);
  await expect(page.locator('#settings-font-list')).toBeHidden();
}
