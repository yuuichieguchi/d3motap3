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

  test('setup: mock sources for remove test', async ({ page, electronApp }) => {
    await electronApp.evaluate(({ ipcMain }) => {
      (global as any).__sourceMockState = {
        sources: [{ id: 1, name: 'Terminal 1', width: 960, height: 540, isActive: true }],
      }

      ipcMain.removeHandler('sources:list')
      ipcMain.handle('sources:list', () => {
        return (global as any).__sourceMockState.sources
      })

      ipcMain.removeHandler('sources:remove')
      ipcMain.handle('sources:remove', () => {
        (global as any).__sourceMockState.sources = []
      })
    })
    await page.reload()
    await page.locator('.app-header').waitFor({ state: 'visible', timeout: 30000 })
  });

  test('source item is visible after mock setup', async ({ page }) => {
    await expect(page.locator(S.sourceItem)).toBeVisible({ timeout: 10000 });
  });

  test('remove source', async ({ page }) => {
    await page.locator(S.sourceRemoveBtn).first().click();
    await expect(page.locator(S.emptyMessage)).toBeVisible();
  });
});
