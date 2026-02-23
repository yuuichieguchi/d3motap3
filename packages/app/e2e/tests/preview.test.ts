import { test, expect } from '../fixtures/electron-app';
import { S } from '../helpers/selectors';

test.describe('Preview', () => {
  test('shows placeholder when no sources', async ({ page }) => {
    const placeholder = page.locator(S.previewPlaceholder);
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toContainText('Add a source to see preview');
  });

  test.describe.serial('source interaction', () => {
    test('shows canvas after source added', async ({ page }) => {
      await page.locator(S.addSourceBtn).click();

      const select = page.locator(`${S.dialog} select`);
      await select.selectOption('Terminal');

      const defaultTerminalBtn = page.locator(S.sourceOptionBtn, {
        hasText: 'Default Terminal (zsh, 80x24)',
      });
      await defaultTerminalBtn.click();

      await expect(page.locator(S.sourceItem)).toBeVisible({ timeout: 10000 });
      await expect(page.locator(S.previewCanvas)).toBeVisible({ timeout: 10000 });
    });

    test('shows placeholder after removing all sources', async ({ page }) => {
      // Ensure a source exists from the previous test
      await expect(page.locator(S.sourceItem)).toBeVisible({ timeout: 10000 });

      await page.locator(S.sourceRemoveBtn).first().click();
      await expect(page.locator(S.previewPlaceholder)).toBeVisible();
    });
  });
});
