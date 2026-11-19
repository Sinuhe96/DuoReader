import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The settings sheet owns its controls: every choice row is a group of
 * `aria-pressed` buttons, never a native `<select>`, so a tap cannot wait for
 * a platform picker. Tests pick an option the way a reader does — by tapping
 * the label they see — and the row must show that choice as pressed.
 */
export function option(page: Page, row: string, label: string): Locator {
  return page.locator(`#settings-${row}`).getByRole('button', { name: label, exact: true });
}

export async function choose(page: Page, row: string, label: string): Promise<void> {
  await option(page, row, label).click();
  await expect(option(page, row, label)).toHaveAttribute('aria-pressed', 'true');
}
