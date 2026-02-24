import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import type { ElectronApplication } from '@playwright/test'

async function setupRecordingMocks(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    (global as any).__recordingMockState = {
      isRecording: false,
      elapsedMs: 0,
      outputPath: '/tmp/test-recording.mp4',
    }

    // FFmpeg available
    ipcMain.removeHandler('system:ffmpeg-available')
    ipcMain.handle('system:ffmpeg-available', () => true)

    ipcMain.removeHandler('system:ffmpeg-version')
    ipcMain.handle('system:ffmpeg-version', () => '6.0')

    // Sources list — return one active source so canRecord = true
    ipcMain.removeHandler('sources:list')
    ipcMain.handle('sources:list', () => [
      { id: 1, name: 'Screen 1', width: 1920, height: 1080, isActive: true },
    ])

    // V2 Start recording
    ipcMain.removeHandler('recording:start-v2')
    ipcMain.handle('recording:start-v2', (_event: any, _options: any) => {
      const state = (global as any).__recordingMockState
      state.isRecording = true
      state.elapsedMs = 0
      state._interval = setInterval(() => {
        state.elapsedMs += 200
      }, 200)
      return state.outputPath
    })

    // V2 Stop recording
    ipcMain.removeHandler('recording:stop-v2')
    ipcMain.handle('recording:stop-v2', () => {
      const state = (global as any).__recordingMockState
      state.isRecording = false
      if (state._interval) {
        clearInterval(state._interval)
        state._interval = null
      }
      return {
        outputPath: state.outputPath,
        frameCount: 30,
        durationMs: state.elapsedMs,
        format: 'mp4',
      }
    })

    // V2 Elapsed
    ipcMain.removeHandler('recording:elapsed-v2')
    ipcMain.handle('recording:elapsed-v2', () => {
      return (global as any).__recordingMockState.elapsedMs
    })

    // V2 Is recording
    ipcMain.removeHandler('recording:is-recording-v2')
    ipcMain.handle('recording:is-recording-v2', () => {
      return (global as any).__recordingMockState.isRecording
    })

    // Display list (still needed for initial load in useEffect)
    ipcMain.removeHandler('recording:list-displays')
    ipcMain.handle('recording:list-displays', () => [
      { id: 0, width: 1920, height: 1080 },
    ])
  })
}

test.describe('Recording', () => {
  test.describe.serial('Recording flow', () => {
    test('Setup mocks and verify idle state', async ({ page, electronApp }) => {
      await setupRecordingMocks(electronApp)

      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      const badge = page.locator(S.statusBadge)
      await expect(badge).toContainText('idle')

      const startBtn = page.locator('.recording-section .record-btn.start')
      await expect(startBtn).toBeVisible()
    })

    test('Start button shows correct text', async ({ page }) => {
      const startBtn = page.locator('.recording-section .record-btn.start')
      await expect(startBtn).toContainText('Start Recording')
    })

    test('Recording controls exist with Output Resolution presets', async ({ page }) => {
      const controlGroups = page.locator('.recording-section .control-group select')
      await expect(controlGroups).toHaveCount(4)

      // Output Resolution selector (first select)
      const resolutionSelect = controlGroups.first()
      await expect(resolutionSelect).toBeVisible()
      const resOptions = resolutionSelect.locator('option')
      await expect(resOptions).toHaveCount(3)
      await expect(resOptions.nth(0)).toContainText('1920x1080')
      await expect(resOptions.nth(1)).toContainText('1280x720')
      await expect(resOptions.nth(2)).toContainText('960x540')

      // Default value is 1920x1080
      await expect(resolutionSelect).toHaveValue('1920x1080')

      // FPS selector
      const fpsSelect = controlGroups.nth(1)
      const fpsOptions = fpsSelect.locator('option')
      await expect(fpsOptions).toHaveCount(4)

      // Format selector
      const formatSelect = controlGroups.nth(2)
      const formatOptions = formatSelect.locator('option')
      await expect(formatOptions).toHaveCount(3)

      // Quality selector
      const qualitySelect = controlGroups.nth(3)
      const qualityOptions = qualitySelect.locator('option')
      await expect(qualityOptions).toHaveCount(3)
    })

    test('Start button disabled without sources', async ({ page, electronApp }) => {
      // Override sources:list to return empty
      await electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('sources:list')
        ipcMain.handle('sources:list', () => [])
      })

      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      const startBtn = page.locator('.recording-section .record-btn.start')
      await expect(startBtn).toBeDisabled()

      // Restore sources for subsequent tests
      await electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('sources:list')
        ipcMain.handle('sources:list', () => [
          { id: 1, name: 'Screen 1', width: 1920, height: 1080, isActive: true },
        ])
      })

      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })
    })

    test('Start and stop recording flow', async ({ page }) => {
      const startBtn = page.locator('.recording-section .record-btn.start')
      await startBtn.click()

      const badge = page.locator(S.statusBadge)
      await expect(badge).toContainText('recording', { timeout: 5000 })

      const stopBtn = page.locator('.recording-section .record-btn.stop')
      await expect(stopBtn).toBeVisible()
      await expect(stopBtn).toContainText('Stop Recording')

      const elapsed = page.locator('.recording-section .elapsed-time')
      await expect(elapsed).toBeVisible({ timeout: 5000 })

      await page.waitForTimeout(1000)
      await expect(elapsed).toBeVisible()

      const elapsedText = await elapsed.textContent()
      expect(elapsedText).toMatch(/^\d{2}:\d{2}$/)

      await stopBtn.click()

      await expect(badge).toContainText('idle', { timeout: 10000 })
    })

    test('Result display after stop', async ({ page }) => {
      const resultBox = page.locator('.recording-section .result-box')
      await expect(resultBox).toBeVisible({ timeout: 5000 })
      await expect(resultBox).toContainText('Recording saved')

      await expect(resultBox).toContainText('/tmp/test-recording.mp4')
      await expect(resultBox).toContainText('30 frames')
      await expect(resultBox).toContainText('MP4')
    })

    test('Edit button in result box', async ({ page }) => {
      const editBtn = page.locator('.recording-section .result-box .edit-btn')
      await expect(editBtn).toBeVisible()
      await expect(editBtn).toContainText('Edit')
    })

    test('Elapsed time hidden after stop', async ({ page }) => {
      const elapsed = page.locator('.recording-section .elapsed-time')
      await expect(elapsed).not.toBeVisible()
    })

    test('Start button re-appears after stop', async ({ page }) => {
      const startBtn = page.locator('.recording-section .record-btn.start')
      await expect(startBtn).toBeVisible()
      await expect(startBtn).toContainText('Start Recording')
    })
  })
})
