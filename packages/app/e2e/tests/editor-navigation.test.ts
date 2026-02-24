import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import type { ElectronApplication } from '@playwright/test'

async function setupNavigationMocks(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    (global as any).__recordingMockState = {
      isRecording: false,
      elapsedMs: 0,
      outputPath: '/tmp/test-nav-recording.mp4',
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
    ipcMain.handle('recording:start-v2', () => {
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
        durationMs: 2000,
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

    // Editor probe mock (used when addClip is called)
    ipcMain.removeHandler('editor:probe')
    ipcMain.handle('editor:probe', () => ({
      durationMs: 2000,
      width: 1920,
      height: 1080,
      fps: 30,
      codec: 'h264',
    }))

    ipcMain.removeHandler('editor:thumbnails')
    ipcMain.handle('editor:thumbnails', () => [])
  })
}

test.describe('Editor Navigation', () => {
  test('nav-btn shows "Editor" text', async ({ page, electronApp }) => {
    await setupNavigationMocks(electronApp)
    await page.reload()
    await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

    const navBtn = page.locator(S.navBtn)
    await expect(navBtn).toBeVisible()
    await expect(navBtn).toContainText('Editor')
  })

  test('Click Editor nav-btn shows editor-view', async ({ page }) => {
    const navBtn = page.locator(S.navBtn)
    await navBtn.click()

    const editorView = page.locator(S.editorView)
    await expect(editorView).toBeVisible()

    // Sidebar should not be visible
    const sidebar = page.locator('.sidebar')
    await expect(sidebar).not.toBeVisible()
  })

  test('nav-btn changes to "Recording"', async ({ page }) => {
    const navBtn = page.locator(S.navBtn)
    await expect(navBtn).toContainText('Recording')
  })

  test('Click Recording nav-btn returns to recording UI', async ({ page }) => {
    const navBtn = page.locator(S.navBtn)
    await navBtn.click()

    const sidebar = page.locator('.sidebar')
    await expect(sidebar).toBeVisible()

    const editorView = page.locator(S.editorView)
    await expect(editorView).not.toBeVisible()
  })

  test('editor-back-btn returns to recording UI', async ({ page }) => {
    // Go to editor first
    const navBtn = page.locator(S.navBtn)
    await navBtn.click()

    const editorView = page.locator(S.editorView)
    await expect(editorView).toBeVisible()

    // Click back button
    const backBtn = page.locator(S.editorBackBtn)
    await backBtn.click()

    // Should be back to recording
    const sidebar = page.locator('.sidebar')
    await expect(sidebar).toBeVisible()
    await expect(editorView).not.toBeVisible()
  })

  test.describe.serial('recording → edit flow', () => {
    test('Record and stop to get result-box with edit-btn', async ({ page, electronApp }) => {
      await setupNavigationMocks(electronApp)
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      // Start recording
      const startBtn = page.locator('.recording-section .record-btn.start')
      await startBtn.click()

      const badge = page.locator(S.statusBadge)
      await expect(badge).toContainText('recording', { timeout: 5000 })

      // Stop recording
      await page.waitForTimeout(500)
      const stopBtn = page.locator('.recording-section .record-btn.stop')
      await stopBtn.click()

      await expect(badge).toContainText('idle', { timeout: 10000 })

      // Result box should show with edit-btn
      const resultBox = page.locator('.recording-section .result-box')
      await expect(resultBox).toBeVisible({ timeout: 5000 })

      const editBtn = page.locator(S.editBtn)
      await expect(editBtn).toBeVisible()
    })

    test('edit-btn navigates to editor with timeline clip', async ({ page }) => {
      const editBtn = page.locator(S.editBtn)
      await editBtn.click()

      // Should be in editor view
      const editorView = page.locator(S.editorView)
      await expect(editorView).toBeVisible({ timeout: 5000 })

      // Timeline should have at least one clip
      const timelineClip = page.locator(S.timelineClip)
      await expect(timelineClip.first()).toBeVisible({ timeout: 5000 })
    })
  })
})
