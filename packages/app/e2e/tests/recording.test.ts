import { test, expect } from '../fixtures/electron-app';
import { S } from '../helpers/selectors';
import type { ElectronApplication } from '@playwright/test';

async function setupRecordingMocks(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    (global as any).__recordingMockState = {
      isRecording: false,
      elapsedMs: 0,
      outputPath: '/tmp/test-recording.mp4',
    };

    // FFmpeg available
    ipcMain.removeHandler('system:ffmpeg-available');
    ipcMain.handle('system:ffmpeg-available', () => true);

    ipcMain.removeHandler('system:ffmpeg-version');
    ipcMain.handle('system:ffmpeg-version', () => '6.0');

    // Display list
    ipcMain.removeHandler('recording:list-displays');
    ipcMain.handle('recording:list-displays', () => [
      { id: 0, width: 1920, height: 1080 },
    ]);

    // Start recording
    ipcMain.removeHandler('recording:start');
    ipcMain.handle('recording:start', () => {
      const state = (global as any).__recordingMockState;
      state.isRecording = true;
      state.elapsedMs = 0;
      // Simulate elapsed time ticking
      state._interval = setInterval(() => {
        state.elapsedMs += 200;
      }, 200);
      return state.outputPath;
    });

    // Stop recording
    ipcMain.removeHandler('recording:stop');
    ipcMain.handle('recording:stop', () => {
      const state = (global as any).__recordingMockState;
      state.isRecording = false;
      if (state._interval) {
        clearInterval(state._interval);
        state._interval = null;
      }
      return {
        outputPath: state.outputPath,
        frameCount: 30,
        durationMs: state.elapsedMs,
        format: 'mp4',
      };
    });

    // Elapsed
    ipcMain.removeHandler('recording:elapsed');
    ipcMain.handle('recording:elapsed', () => {
      return (global as any).__recordingMockState.elapsedMs;
    });

    // Is recording
    ipcMain.removeHandler('recording:is-recording');
    ipcMain.handle('recording:is-recording', () => {
      return (global as any).__recordingMockState.isRecording;
    });
  });
}

test.describe('Recording', () => {
  test.describe.serial('Recording flow', () => {
    test('Setup mocks and verify idle state', async ({ page, electronApp }) => {
      await setupRecordingMocks(electronApp);

      // Reload so the App's useEffect re-runs against the mocked IPC handlers
      await page.reload();
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 });

      const badge = page.locator(S.statusBadge);
      await expect(badge).toContainText('idle');

      const startBtn = page.locator('.recording-section .record-btn.start');
      await expect(startBtn).toBeVisible();
    });

    test('Start button shows correct text', async ({ page }) => {
      const startBtn = page.locator('.recording-section .record-btn.start');
      await expect(startBtn).toContainText('Start Recording');
    });

    test('Recording controls exist with correct options', async ({ page }) => {
      const controlGroups = page.locator('.recording-section .control-group select');
      await expect(controlGroups).toHaveCount(4);

      // Display selector - should have the mocked display
      const displaySelect = page.locator('.recording-section .control-group select').first();
      await expect(displaySelect).toBeVisible();
      const displayOption = displaySelect.locator('option');
      await expect(displayOption.first()).toContainText('1920x1080');

      // FPS selector
      const fpsSelect = controlGroups.nth(1);
      const fpsOptions = fpsSelect.locator('option');
      await expect(fpsOptions).toHaveCount(4);

      // Format selector
      const formatSelect = controlGroups.nth(2);
      const formatOptions = formatSelect.locator('option');
      await expect(formatOptions).toHaveCount(3);

      // Quality selector
      const qualitySelect = controlGroups.nth(3);
      const qualityOptions = qualitySelect.locator('option');
      await expect(qualityOptions).toHaveCount(3);
    });

    test('Start and stop recording flow', async ({ page }) => {
      // Click Start Recording
      const startBtn = page.locator('.recording-section .record-btn.start');
      await startBtn.click();

      // Status badge should show "recording"
      const badge = page.locator(S.statusBadge);
      await expect(badge).toContainText('recording', { timeout: 5000 });

      // Stop button should be visible
      const stopBtn = page.locator('.recording-section .record-btn.stop');
      await expect(stopBtn).toBeVisible();
      await expect(stopBtn).toContainText('Stop Recording');

      // Elapsed time should appear
      const elapsed = page.locator('.recording-section .elapsed-time');
      await expect(elapsed).toBeVisible({ timeout: 5000 });

      // Wait for elapsed time to tick so it shows a non-zero value
      await page.waitForTimeout(1000);
      await expect(elapsed).toBeVisible();

      // Elapsed time should match MM:SS format
      const elapsedText = await elapsed.textContent();
      expect(elapsedText).toMatch(/^\d{2}:\d{2}$/);

      // Click Stop Recording
      await stopBtn.click();

      // Status badge should return to "idle"
      await expect(badge).toContainText('idle', { timeout: 10000 });
    });

    test('Result display after stop', async ({ page }) => {
      const resultBox = page.locator('.recording-section .result-box');
      await expect(resultBox).toBeVisible({ timeout: 5000 });
      await expect(resultBox).toContainText('Recording saved');

      // Verify result details are displayed
      await expect(resultBox).toContainText('/tmp/test-recording.mp4');
      await expect(resultBox).toContainText('30 frames');
      await expect(resultBox).toContainText('MP4');
    });

    test('Elapsed time hidden after stop', async ({ page }) => {
      const elapsed = page.locator('.recording-section .elapsed-time');
      await expect(elapsed).not.toBeVisible();
    });

    test('Start button re-appears after stop', async ({ page }) => {
      const startBtn = page.locator('.recording-section .record-btn.start');
      await expect(startBtn).toBeVisible();
      await expect(startBtn).toContainText('Start Recording');
    });
  });
});
