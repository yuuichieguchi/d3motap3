import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import type { ElectronApplication } from '@playwright/test'

async function setupRecordingControlsMocks(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    (global as any).__recordingMockState = {
      isRecording: false,
      elapsedMs: 0,
      outputPath: '/tmp/test-controls-recording.mp4',
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

test.describe('Recording Controls', () => {
  // ==================== Selector Interactions ====================

  test.describe('Selector interactions', () => {
    test('setup: mock ffmpeg, display, source and reload', async ({ page, electronApp }) => {
      await setupRecordingControlsMocks(electronApp)
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })
    })

    test('FPS selector has 4 options with default 30', async ({ page }) => {
      const fpsSelect = page.locator(`${S.recordingSection} ${S.controlGroup} select`).nth(1)
      const options = fpsSelect.locator('option')
      await expect(options).toHaveCount(4)

      const texts = await options.allTextContents()
      expect(texts).toEqual(['15', '24', '30', '60'])

      await expect(fpsSelect).toHaveValue('30')
    })

    test('FPS change to 60 is reflected', async ({ page }) => {
      const fpsSelect = page.locator(`${S.recordingSection} ${S.controlGroup} select`).nth(1)
      await fpsSelect.selectOption('60')
      await expect(fpsSelect).toHaveValue('60')

      // Reset for subsequent tests
      await fpsSelect.selectOption('30')
    })

    test('Format selector has 3 options with default mp4', async ({ page }) => {
      const formatSelect = page.locator(`${S.recordingSection} ${S.controlGroup} select`).nth(2)
      const options = formatSelect.locator('option')
      await expect(options).toHaveCount(3)

      const texts = await options.allTextContents()
      expect(texts).toEqual(['MP4', 'GIF', 'WebM'])

      await expect(formatSelect).toHaveValue('mp4')
    })

    test('Format change to gif is reflected', async ({ page }) => {
      const formatSelect = page.locator(`${S.recordingSection} ${S.controlGroup} select`).nth(2)
      await formatSelect.selectOption('gif')
      await expect(formatSelect).toHaveValue('gif')

      // Reset for subsequent tests
      await formatSelect.selectOption('mp4')
    })

    test('Quality selector has 3 options with default medium', async ({ page }) => {
      const qualitySelect = page.locator(`${S.recordingSection} ${S.controlGroup} select`).nth(3)
      const options = qualitySelect.locator('option')
      await expect(options).toHaveCount(3)

      const texts = await options.allTextContents()
      expect(texts).toEqual(['Low', 'Medium', 'High'])

      await expect(qualitySelect).toHaveValue('medium')
    })

    test('Quality change to high is reflected', async ({ page }) => {
      const qualitySelect = page.locator(`${S.recordingSection} ${S.controlGroup} select`).nth(3)
      await qualitySelect.selectOption('high')
      await expect(qualitySelect).toHaveValue('high')

      // Reset for subsequent tests
      await qualitySelect.selectOption('medium')
    })
  })

  // ==================== Selectors Disabled During Recording ====================

  test.describe.serial('Selectors disabled during recording', () => {
    test('setup: mock and reload', async ({ page, electronApp }) => {
      await setupRecordingControlsMocks(electronApp)
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })
    })

    test('all 4 selectors disabled after clicking start', async ({ page }) => {
      const startBtn = page.locator(`${S.recordingSection} ${S.recordBtnStart}`)
      await startBtn.click()

      const badge = page.locator(S.statusBadge)
      await expect(badge).toContainText('recording', { timeout: 5000 })

      const selects = page.locator(`${S.recordingSection} ${S.controlGroup} select`)
      await expect(selects).toHaveCount(4)

      for (let i = 0; i < 4; i++) {
        await expect(selects.nth(i)).toBeDisabled()
      }
    })

    test('selectors re-enabled after stopping', async ({ page }) => {
      const stopBtn = page.locator(`${S.recordingSection} ${S.recordBtnStop}`)
      await stopBtn.click()

      const badge = page.locator(S.statusBadge)
      await expect(badge).toContainText('idle', { timeout: 10000 })

      const selects = page.locator(`${S.recordingSection} ${S.controlGroup} select`)
      for (let i = 0; i < 4; i++) {
        await expect(selects.nth(i)).toBeEnabled()
      }
    })
  })

  // ==================== Selectors Disabled During Processing ====================

  test.describe.serial('Selectors disabled during processing', () => {
    test('setup: mock with delayed stop', async ({ page, electronApp }) => {
      await electronApp.evaluate(({ ipcMain }) => {
        (global as any).__recordingMockState = {
          isRecording: false,
          elapsedMs: 0,
          outputPath: '/tmp/test-processing-recording.mp4',
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

        // Delayed stop to simulate processing time
        ipcMain.removeHandler('recording:stop-v2')
        ipcMain.handle('recording:stop-v2', () => {
          const state = (global as any).__recordingMockState
          state.isRecording = false
          if (state._interval) {
            clearInterval(state._interval)
            state._interval = null
          }
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                outputPath: state.outputPath,
                frameCount: 60,
                durationMs: state.elapsedMs,
                format: 'mp4',
              })
            }, 2000)
          })
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

      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })
    })

    test('selectors disabled and Processing button shown during processing', async ({ page }) => {
      const startBtn = page.locator(`${S.recordingSection} ${S.recordBtnStart}`)
      await startBtn.click()

      const badge = page.locator(S.statusBadge)
      await expect(badge).toContainText('recording', { timeout: 5000 })

      const stopBtn = page.locator(`${S.recordingSection} ${S.recordBtnStop}`)
      await stopBtn.click()

      // Processing button should appear while stop-v2 is resolving
      const processingBtn = page.locator(`${S.recordingSection} ${S.recordBtnProcessing}`)
      await expect(processingBtn).toBeVisible({ timeout: 5000 })
      await expect(processingBtn).toBeDisabled()
      await expect(processingBtn).toContainText('Processing')

      // All selectors should be disabled during processing
      const selects = page.locator(`${S.recordingSection} ${S.controlGroup} select`)
      for (let i = 0; i < 4; i++) {
        await expect(selects.nth(i)).toBeDisabled()
      }

      // Wait for processing to complete
      await expect(badge).toContainText('idle', { timeout: 10000 })
    })
  })

  // ==================== Error Handling ====================

  test.describe('Error handling', () => {
    test('FFmpeg not found shows error box', async ({ page, electronApp }) => {
      await electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('system:ffmpeg-available')
        ipcMain.handle('system:ffmpeg-available', () => false)

        ipcMain.removeHandler('system:ffmpeg-version')
        ipcMain.handle('system:ffmpeg-version', () => '')

        ipcMain.removeHandler('recording:list-displays')
        ipcMain.handle('recording:list-displays', () => [
          { id: 0, width: 1920, height: 1080 },
        ])

        ipcMain.removeHandler('sources:list')
        ipcMain.handle('sources:list', () => [
          { id: 1, name: 'Screen 1', width: 1920, height: 1080, isActive: true },
        ])
      })

      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      const errorBox = page.locator(`${S.recordingSection} ${S.errorBox}`)
      await expect(errorBox).toBeVisible({ timeout: 5000 })
      await expect(errorBox).toContainText('FFmpeg not found')
    })

    test('Recording start failure shows error box', async ({ page, electronApp }) => {
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
        ipcMain.handle('sources:list', () => [
          { id: 1, name: 'Screen 1', width: 1920, height: 1080, isActive: true },
        ])

        ipcMain.removeHandler('recording:start-v2')
        ipcMain.handle('recording:start-v2', () => {
          throw new Error('Failed to start recording')
        })

        ipcMain.removeHandler('recording:elapsed-v2')
        ipcMain.handle('recording:elapsed-v2', () => 0)

        ipcMain.removeHandler('recording:is-recording-v2')
        ipcMain.handle('recording:is-recording-v2', () => false)
      })

      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      const startBtn = page.locator(`${S.recordingSection} ${S.recordBtnStart}`)
      await startBtn.click()

      const errorBox = page.locator(`${S.recordingSection} ${S.errorBox}`)
      await expect(errorBox).toBeVisible({ timeout: 5000 })
    })
  })

  // ==================== Footer Status ====================

  test.describe('Footer status', () => {
    test('FFmpeg ready shown in footer', async ({ page, electronApp }) => {
      await setupRecordingControlsMocks(electronApp)
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      const footer = page.locator(S.appFooter)
      await expect(footer).toContainText('FFmpeg ready')
    })

    test('FFmpeg not found shown in footer', async ({ page, electronApp }) => {
      await electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('system:ffmpeg-available')
        ipcMain.handle('system:ffmpeg-available', () => false)

        ipcMain.removeHandler('system:ffmpeg-version')
        ipcMain.handle('system:ffmpeg-version', () => '')

        ipcMain.removeHandler('recording:list-displays')
        ipcMain.handle('recording:list-displays', () => [
          { id: 0, width: 1920, height: 1080 },
        ])

        ipcMain.removeHandler('sources:list')
        ipcMain.handle('sources:list', () => [
          { id: 1, name: 'Screen 1', width: 1920, height: 1080, isActive: true },
        ])
      })

      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      const footer = page.locator(S.appFooter)
      await expect(footer).toContainText('FFmpeg not found')
    })
  })
})
