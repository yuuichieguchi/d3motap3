import { test, expect } from '../fixtures/electron-app';
import { S } from '../helpers/selectors';
import { stubDialog } from 'electron-playwright-helpers';
import { resolve } from 'path';

test.describe.serial('Script Panel', () => {
  test('Select YAML button exists', async ({ page }) => {
    const selectYamlBtn = page.locator(S.scriptSection).getByRole('button', { name: 'Select YAML' });
    await expect(selectYamlBtn).toBeVisible();
  });

  test('Run disabled without YAML', async ({ page }) => {
    const runBtn = page.locator(`${S.scriptSection} ${S.recordBtnStart}`).getByText('Run Script');
    await expect(runBtn).toBeDisabled();
  });

  test('File selection via dialog stub', async ({ page, electronApp }) => {
    const yamlPath = resolve(__dirname, '../fixtures/test-script.yaml');
    await stubDialog(electronApp, 'showOpenDialog', { canceled: false, filePaths: [yamlPath] });

    const selectYamlBtn = page.locator(S.scriptSection).getByRole('button', { name: 'Select YAML' });
    await selectYamlBtn.click();

    const filePath = page.locator(`${S.scriptSection} ${S.filePath}`);
    await expect(filePath).toContainText('test-script.yaml');
  });

  test('Run enabled after file selection', async ({ page }) => {
    const runBtn = page.locator(`${S.scriptSection} ${S.recordBtnStart}`).getByText('Run Script');
    await expect(runBtn).not.toBeDisabled();
  });

  test('Running state shows Cancel and progress', async ({ page, electronApp }) => {
    await electronApp.evaluate(({ ipcMain }) => {
      (global as any).__scriptMockState = { status: 'idle' };

      ipcMain.removeHandler('script:run');
      ipcMain.handle('script:run', () => {
        (global as any).__scriptMockState = { status: 'parsing' };
        setTimeout(() => {
          (global as any).__scriptMockState = {
            status: 'running',
            current_step: 0,
            total_steps: 2,
            step_description: 'wait 500ms',
          };
        }, 300);
        setTimeout(() => {
          (global as any).__scriptMockState = {
            status: 'running',
            current_step: 1,
            total_steps: 2,
            step_description: 'caption',
          };
        }, 600);
        setTimeout(() => {
          (global as any).__scriptMockState = {
            status: 'completed',
            output_path: '/tmp/test-output.mp4',
            duration_ms: 1000,
          };
        }, 900);
      });

      ipcMain.removeHandler('script:status');
      ipcMain.handle('script:status', () => {
        return JSON.stringify((global as any).__scriptMockState);
      });

      ipcMain.removeHandler('script:cancel');
      ipcMain.handle('script:cancel', () => {
        (global as any).__scriptMockState = { status: 'idle' };
      });
    });

    const runBtn = page.locator(`${S.scriptSection} ${S.recordBtnStart}`).getByText('Run Script');
    await runBtn.click();

    const cancelBtn = page.locator(`${S.scriptSection} ${S.recordBtnStop}`).getByText('Cancel');
    await expect(cancelBtn).toBeVisible({ timeout: 5000 });
  });

  test('Completion display', async ({ page }) => {
    const resultBox = page.locator(`${S.scriptSection} ${S.resultBox}`);
    await expect(resultBox).toBeVisible({ timeout: 10000 });
    await expect(resultBox).toContainText('Script completed');
  });

  test('Error display', async ({ page, electronApp }) => {
    await electronApp.evaluate(({ ipcMain }) => {
      (global as any).__scriptMockState = { status: 'idle' };

      ipcMain.removeHandler('script:run');
      ipcMain.handle('script:run', () => {
        (global as any).__scriptMockState = { status: 'parsing' };
        setTimeout(() => {
          (global as any).__scriptMockState = { status: 'failed', error: 'Parse error in YAML', step: null };
        }, 300);
      });
    });

    const runBtn = page.locator(`${S.scriptSection} ${S.recordBtnStart}`).getByText('Run Script');
    await runBtn.click();

    const errorBox = page.locator(`${S.scriptSection} ${S.errorBox}`);
    await expect(errorBox).toBeVisible({ timeout: 10000 });
    await expect(errorBox).toContainText('Script failed');
  });
});
