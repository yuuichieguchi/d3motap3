import { test, expect } from '../fixtures/electron-app';
import { S } from '../helpers/selectors';

test.describe.serial('Source Management', () => {
  test('dialog opens and closes', async ({ page }) => {
    await page.locator(S.addSourceBtn).click();
    await expect(page.locator(S.dialogOverlay)).toBeVisible();

    await page.locator(S.dialogCloseBtn).click();
    await expect(page.locator(S.dialogOverlay)).toBeHidden();
  });

  test('source type dropdown has all options', async ({ page }) => {
    await page.locator(S.addSourceBtn).click();

    const select = page.locator(`${S.dialog} select`);
    await expect(select).toBeVisible();

    const options = select.locator('option');
    const texts = await options.allTextContents();

    expect(texts).toContain('Display');
    expect(texts).toContain('Window');
    expect(texts).toContain('Webcam');
    expect(texts).toContain('Android');
    expect(texts).toContain('iOS');
    expect(texts).toContain('Terminal');

    await page.locator(S.dialogCloseBtn).click();
  });

  test('terminal presets displayed', async ({ page }) => {
    await page.locator(S.addSourceBtn).click();

    const select = page.locator(`${S.dialog} select`);
    await select.selectOption('Terminal');

    const presetBtns = page.locator(S.sourceOptionBtn);
    await expect(presetBtns).toHaveCount(2);
    await expect(presetBtns.nth(0)).toHaveText('Default Terminal (zsh, 80x24)');
    await expect(presetBtns.nth(1)).toHaveText('Large Terminal (bash, 120x40)');

    await page.locator(S.dialogCloseBtn).click();
  });

  // NOTE: This test depends on the native PTY addon being available.
  // If the native addon is not built or unavailable, PTY creation will fail
  // and the source may not appear.
  test('add terminal source', async ({ page }) => {
    await page.locator(S.addSourceBtn).click();

    const select = page.locator(`${S.dialog} select`);
    await select.selectOption('Terminal');

    const defaultTerminalBtn = page.locator(S.sourceOptionBtn, {
      hasText: 'Default Terminal (zsh, 80x24)',
    });
    await defaultTerminalBtn.click();

    await expect(page.locator(S.dialogOverlay)).toBeHidden();
    await expect(page.locator(S.sourceItem)).toBeVisible({ timeout: 10000 });
  });

  // NOTE: This test also depends on the native PTY addon.
  // It adds a source first, then removes it, so PTY creation must succeed.
  test('remove source', async ({ page }) => {
    // Ensure a source exists from the previous test
    const sourceItem = page.locator(S.sourceItem);
    await expect(sourceItem).toBeVisible({ timeout: 10000 });

    await page.locator(S.sourceRemoveBtn).first().click();
    await expect(page.locator(S.emptyMessage)).toBeVisible();
  });
});
