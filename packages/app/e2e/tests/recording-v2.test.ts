import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import type { ElectronApplication } from '@playwright/test'

async function setupV2RecordingMocks(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    (global as any).__recordingMockState = {
      isRecording: false,
      elapsedMs: 0,
      outputPath: '/tmp/test-v2-recording.mp4',
    }

    ipcMain.removeHandler('system:ffmpeg-available')
    ipcMain.handle('system:ffmpeg-available', () => true)

    ipcMain.removeHandler('system:ffmpeg-version')
    ipcMain.handle('system:ffmpeg-version', () => '6.0')

    ipcMain.removeHandler('recording:list-displays')
    ipcMain.handle('recording:list-displays', () => [
      { id: 0, width: 1920, height: 1080 },
    ])

    ipcMain.removeHandler('sources:list')
    ipcMain.handle('sources:list', () => [
      { id: 1, name: 'Screen 1', width: 1920, height: 1080, isActive: true },
    ])

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
        frameCount: 60,
        durationMs: state.elapsedMs,
        format: 'mp4',
      }
    })

    ipcMain.removeHandler('recording:elapsed-v2')
    ipcMain.handle('recording:elapsed-v2', () => {
      return (global as any).__recordingMockState.elapsedMs
    })

    ipcMain.removeHandler('recording:is-recording-v2')
    ipcMain.handle('recording:is-recording-v2', () => {
      return (global as any).__recordingMockState.isRecording
    })
  })
}

test.describe('V2 Recording UI', () => {
  test.describe('Output Resolution', () => {
    test('Output Resolution selector has 3 presets', async ({ page, electronApp }) => {
      await setupV2RecordingMocks(electronApp)
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      const resolutionSelect = page.locator('.recording-section .control-group select').first()
      const options = resolutionSelect.locator('option')
      await expect(options).toHaveCount(3)
      await expect(options.nth(0)).toContainText('1920x1080')
      await expect(options.nth(1)).toContainText('1280x720')
      await expect(options.nth(2)).toContainText('960x540')
    })

    test('Default resolution is 1920x1080', async ({ page }) => {
      const resolutionSelect = page.locator('.recording-section .control-group select').first()
      await expect(resolutionSelect).toHaveValue('1920x1080')
    })

    test('Resolution change is reflected', async ({ page }) => {
      const resolutionSelect = page.locator('.recording-section .control-group select').first()
      await resolutionSelect.selectOption('1280x720')
      await expect(resolutionSelect).toHaveValue('1280x720')

      // Reset for next tests
      await resolutionSelect.selectOption('1920x1080')
    })
  })

  test.describe.serial('V2 IPC', () => {
    test('Setup mocks and add source', async ({ page, electronApp }) => {
      await setupV2RecordingMocks(electronApp)
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      const startBtn = page.locator('.recording-section .record-btn.start')
      await expect(startBtn).toBeEnabled()
    })

    test('Start calls recording:start-v2', async ({ page }) => {
      const startBtn = page.locator('.recording-section .record-btn.start')
      await startBtn.click()

      const badge = page.locator(S.statusBadge)
      await expect(badge).toContainText('recording', { timeout: 5000 })
    })

    test('Elapsed polling via recording:elapsed-v2', async ({ page }) => {
      const elapsed = page.locator('.recording-section .elapsed-time')
      await expect(elapsed).toBeVisible({ timeout: 5000 })

      await page.waitForTimeout(600)
      const text = await elapsed.textContent()
      expect(text).toMatch(/^\d{2}:\d{2}$/)
    })

    test('Stop calls recording:stop-v2 and shows result', async ({ page }) => {
      const stopBtn = page.locator('.recording-section .record-btn.stop')
      await stopBtn.click()

      const badge = page.locator(S.statusBadge)
      await expect(badge).toContainText('idle', { timeout: 10000 })

      const resultBox = page.locator('.recording-section .result-box')
      await expect(resultBox).toBeVisible({ timeout: 5000 })
      await expect(resultBox).toContainText('Recording saved')
      await expect(resultBox).toContainText('/tmp/test-v2-recording.mp4')
    })
  })

  test.describe.serial('canRecord logic', () => {
    test('Start disabled without sources', async ({ page, electronApp }) => {
      await electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('system:ffmpeg-available')
        ipcMain.handle('system:ffmpeg-available', () => true)

        ipcMain.removeHandler('system:ffmpeg-version')
        ipcMain.handle('system:ffmpeg-version', () => '6.0')

        ipcMain.removeHandler('recording:list-displays')
        ipcMain.handle('recording:list-displays', () => [
          { id: 0, width: 1920, height: 1080 },
        ])

        ipcMain.removeHandler('sources:list')
        ipcMain.handle('sources:list', () => [])
      })

      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      const startBtn = page.locator('.recording-section .record-btn.start')
      await expect(startBtn).toBeDisabled()
    })

    test('Start enabled after adding source', async ({ page, electronApp }) => {
      await electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('sources:list')
        ipcMain.handle('sources:list', () => [
          { id: 1, name: 'Screen 1', width: 1920, height: 1080, isActive: true },
        ])
      })

      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      const startBtn = page.locator('.recording-section .record-btn.start')
      await expect(startBtn).toBeEnabled()
    })
  })
})