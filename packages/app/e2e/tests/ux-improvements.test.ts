import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import type { ElectronApplication } from '@playwright/test'

/**
 * UX Improvements E2E Tests (TDD Red Phase)
 *
 * Test 1: Source limit - add-source-btn should be disabled when 2 sources exist
 * Test 2: Slider step - split ratio slider step should be 0.01 (currently 0.1)
 * Test 3: Output directory setting - UI for changing output directory
 *
 * All tests MUST FAIL against the current codebase.
 */

// ---------------------------------------------------------------------------
// Shared mock helpers
// ---------------------------------------------------------------------------

async function setupSourceMocks(
  electronApp: ElectronApplication,
  sourceCount: number,
): Promise<void> {
  await electronApp.evaluate(({ ipcMain }, count) => {
    ipcMain.removeHandler('system:ffmpeg-available')
    ipcMain.handle('system:ffmpeg-available', () => true)

    ipcMain.removeHandler('system:ffmpeg-version')
    ipcMain.handle('system:ffmpeg-version', () => '6.0')

    ipcMain.removeHandler('recording:list-displays')
    ipcMain.handle('recording:list-displays', () => [
      { id: 0, width: 1920, height: 1080 },
    ])

    ipcMain.removeHandler('layout:set')
    ipcMain.handle('layout:set', () => {})

    const sources = Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      name: `Terminal ${i + 1}`,
      width: 800,
      height: 600,
      isActive: true,
    }))

    ipcMain.removeHandler('sources:list')
    ipcMain.handle('sources:list', () => sources)

    ipcMain.removeHandler('sources:add')
    ipcMain.handle('sources:add', () => sources.length + 1)

    ipcMain.removeHandler('sources:remove')
    ipcMain.handle('sources:remove', () => {})
  }, sourceCount)
}

async function setupRecordingMocks(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    (global as any).__uxTestState = {
      isRecording: false,
      elapsedMs: 0,
      outputPath: '/tmp/test-ux-recording.mp4',
      lastStartOptions: null,
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

    ipcMain.removeHandler('layout:set')
    ipcMain.handle('layout:set', () => {})

    ipcMain.removeHandler('recording:select-output-dir')
    ipcMain.handle('recording:select-output-dir', () => {
      return '/Users/test/Videos'
    })

    ipcMain.removeHandler('recording:start-v2')
    ipcMain.handle('recording:start-v2', (_event: any, options: any) => {
      const state = (global as any).__uxTestState
      state.isRecording = true
      state.elapsedMs = 0
      state.lastStartOptions = options
      return state.outputPath
    })

    ipcMain.removeHandler('recording:stop-v2')
    ipcMain.handle('recording:stop-v2', () => {
      const state = (global as any).__uxTestState
      state.isRecording = false
      return {
        outputPath: state.outputPath,
        frameCount: 60,
        durationMs: state.elapsedMs,
        format: 'mp4',
      }
    })

    ipcMain.removeHandler('recording:elapsed-v2')
    ipcMain.handle('recording:elapsed-v2', () => {
      return (global as any).__uxTestState.elapsedMs
    })

    ipcMain.removeHandler('recording:is-recording-v2')
    ipcMain.handle('recording:is-recording-v2', () => {
      return (global as any).__uxTestState.isRecording
    })
  })
}

// ===========================================================================
// Test 1: Source limit (max 2 sources)
// ===========================================================================

test.describe('UX Improvements', () => {
  test.describe.serial('Source Limit - add button disabled at max sources', () => {
    test('setup: mock 2 sources (at limit)', async ({ page, electronApp }) => {
      await setupSourceMocks(electronApp, 2)
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })
      await expect(page.locator(S.sourceItem)).toHaveCount(2, { timeout: 10000 })
    })

    test('add-source-btn should be disabled when 2 sources exist', async ({ page }) => {
      // EXPECTED TO FAIL: current code never disables the add button
      const addBtn = page.locator(S.addSourceBtn)
      await expect(addBtn).toBeDisabled()
    })

    test('setup: mock 1 source (below limit)', async ({ page, electronApp }) => {
      await setupSourceMocks(electronApp, 1)
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })
      await expect(page.locator(S.sourceItem)).toHaveCount(1, { timeout: 10000 })
    })

    test('add-source-btn should be enabled when below limit', async ({ page }) => {
      const addBtn = page.locator(S.addSourceBtn)
      await expect(addBtn).toBeEnabled()
    })
  })

  // ===========================================================================
  // Test 2: Slider step = 0.01
  // ===========================================================================

  test.describe.serial('Slider Step - split ratio step should be 0.01', () => {
    test('setup: mock 2 sources and select SideBySide', async ({ page, electronApp }) => {
      await setupSourceMocks(electronApp, 2)
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })
      await expect(page.locator(S.sourceItem)).toHaveCount(2, { timeout: 10000 })

      // Click SideBySide layout button
      const sideBySideBtn = page.locator(S.layoutOption).nth(1)
      await sideBySideBtn.click()
      await expect(page.locator(S.layoutOptionSelected)).toContainText('Side by Side')
    })

    test('split ratio slider should have step of 0.01', async ({ page }) => {
      // EXPECTED TO FAIL: current step is "0.1"
      const slider = page.locator(`${S.layoutSelector} input[type="range"]`)
      await expect(slider).toBeVisible()
      await expect(slider).toHaveAttribute('step', '0.01')
    })
  })

  // ===========================================================================
  // Test 3: Output directory setting
  // ===========================================================================

  test.describe.serial('Output Directory Setting', () => {
    test('setup: mock recording handlers', async ({ page, electronApp }) => {
      await setupRecordingMocks(electronApp)
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })
    })

    test('"Change..." button should exist in recording section', async ({ page }) => {
      // EXPECTED TO FAIL: the output-dir-section UI does not exist yet
      const changeBtn = page.locator(`${S.recordingSection} ${S.outputDirChangeBtn}`)
      await expect(changeBtn).toBeVisible({ timeout: 5000 })
      await expect(changeBtn).toHaveText('Change...')
    })

    test('output directory path should be displayed', async ({ page }) => {
      // EXPECTED TO FAIL: the output-dir-path element does not exist yet
      const dirPath = page.locator(`${S.recordingSection} ${S.outputDirPath}`)
      await expect(dirPath).toBeVisible({ timeout: 5000 })
    })

    test('clicking Change... should invoke select-output-dir and update display', async ({ page }) => {
      // EXPECTED TO FAIL: the output-dir-change-btn does not exist yet
      const changeBtn = page.locator(`${S.recordingSection} ${S.outputDirChangeBtn}`)
      await changeBtn.click()

      const dirPath = page.locator(`${S.recordingSection} ${S.outputDirPath}`)
      await expect(dirPath).toContainText('/Users/test/Videos', { timeout: 5000 })
    })

    test('recording:start-v2 should receive outputDir parameter', async ({ page, electronApp }) => {
      // EXPECTED TO FAIL: current start-v2 call does not include outputDir
      // First, set the output dir via UI
      const changeBtn = page.locator(`${S.recordingSection} ${S.outputDirChangeBtn}`)
      await changeBtn.click()

      // Start recording
      const startBtn = page.locator('.recording-section .record-btn.start')
      await startBtn.click()

      // Wait for recording to start
      const badge = page.locator(S.statusBadge)
      await expect(badge).toContainText('recording', { timeout: 5000 })

      // Verify the outputDir was passed to start-v2
      const lastOptions = await electronApp.evaluate(() => {
        return (global as any).__uxTestState.lastStartOptions
      })
      expect(lastOptions).toHaveProperty('outputDir', '/Users/test/Videos')

      // Stop recording to clean up
      const stopBtn = page.locator('.recording-section .record-btn.stop')
      await stopBtn.click()
      await expect(badge).toContainText('idle', { timeout: 10000 })
    })
  })
})
