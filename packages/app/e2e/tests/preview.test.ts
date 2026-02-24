import { test, expect } from '../fixtures/electron-app';
import { S } from '../helpers/selectors';

test.describe('Preview', () => {
  test('shows placeholder when no sources', async ({ page, electronApp }) => {
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('sources:list')
      ipcMain.handle('sources:list', () => [])
    })
    await page.reload()
    await page.locator('.app-header').waitFor({ state: 'visible', timeout: 30000 })

    const placeholder = page.locator(S.previewPlaceholder);
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toContainText('Add a source to see preview');
  });

  test.describe.serial('source interaction', () => {
    test('setup: mock sources', async ({ page, electronApp }) => {
      await electronApp.evaluate(({ ipcMain }) => {
        (global as any).__previewMockState = {
          sources: []
        }

        ipcMain.removeHandler('sources:list')
        ipcMain.handle('sources:list', () => {
          return (global as any).__previewMockState.sources
        })

        ipcMain.removeHandler('sources:add')
        ipcMain.handle('sources:add', () => {
          (global as any).__previewMockState.sources = [
            { id: 1, name: 'Terminal 1', width: 960, height: 540, isActive: true }
          ]
          return 1
        })

        ipcMain.removeHandler('sources:remove')
        ipcMain.handle('sources:remove', () => {
          (global as any).__previewMockState.sources = []
        })
      })
      await page.reload()
      await page.locator('.app-header').waitFor({ state: 'visible', timeout: 30000 })
    });

    test('shows source added after selection', async ({ page }) => {
      await page.locator(S.addSourceBtn).click();

      const select = page.locator(`${S.dialog} select`);
      await select.selectOption('Terminal');

      const defaultTerminalBtn = page.locator(S.sourceOptionBtn, {
        hasText: 'Default Terminal (zsh, 80x24)',
      });
      await defaultTerminalBtn.click();

      await expect(page.locator(S.sourceItem)).toBeVisible({ timeout: 10000 });
      await expect(page.locator(S.previewPlaceholder)).not.toBeVisible();
    });

    test('shows placeholder after removing all sources', async ({ page }) => {
      // Ensure a source exists from the previous test
      await expect(page.locator(S.sourceItem)).toBeVisible({ timeout: 10000 });

      await page.locator(S.sourceRemoveBtn).first().click();
      await expect(page.locator(S.previewPlaceholder)).toBeVisible();
    });
  });
});
