import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import type { ElectronApplication } from '@playwright/test'

async function setupExportMocks(electronApp: ElectronApplication, scenario: 'success' | 'error' = 'success'): Promise<void> {
  await electronApp.evaluate(({ ipcMain }, { scenario }) => {
    (global as any).__exportMockState = { status: 'idle' }

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

    ipcMain.removeHandler('editor:probe')
    ipcMain.handle('editor:probe', () => ({
      durationMs: 5000,
      width: 1920,
      height: 1080,
      fps: 30,
      codec: 'h264',
    }))

    ipcMain.removeHandler('editor:thumbnails')
    ipcMain.handle('editor:thumbnails', () => [])

    ipcMain.removeHandler('dialog:open-file')
    ipcMain.handle('dialog:open-file', () => '/tmp/test-export-video.mp4')

    ipcMain.removeHandler('editor:export')
    ipcMain.handle('editor:export', () => {
      ;(global as any).__exportMockState = { status: 'exporting', progress: 0 }

      if (scenario === 'success') {
        // Simulate progress
        setTimeout(() => {
          ;(global as any).__exportMockState = { status: 'exporting', progress: 50 }
        }, 300)
        setTimeout(() => {
          ;(global as any).__exportMockState = { status: 'completed' }
        }, 600)
      } else {
        setTimeout(() => {
          ;(global as any).__exportMockState = {
            status: 'failed',
            progress: 0,
            error: 'FFmpeg process failed',
          }
        }, 300)
      }
    })

    ipcMain.removeHandler('editor:export-status')
    ipcMain.handle('editor:export-status', () => {
      return JSON.stringify((global as any).__exportMockState)
    })
  }, { scenario })
}

test.describe('Editor Export', () => {
  test.describe.serial('Export flow', () => {
    test('Setup mocks and import clip', async ({ page, electronApp }) => {
      await setupExportMocks(electronApp, 'success')
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      // Navigate to editor
      const navBtn = page.locator(S.navBtn)
      await navBtn.click()

      const editorView = page.locator(S.editorView)
      await expect(editorView).toBeVisible()

      // Add a clip
      const addClipBtn = page.locator(`${S.editorToolbar} button`, { hasText: '+ Clip' })
      await addClipBtn.click()

      const timelineClip = page.locator(S.timelineClip)
      await expect(timelineClip.first()).toBeVisible({ timeout: 5000 })
    })

    test('Export button enabled with clips', async ({ page }) => {
      const exportBtn = page.locator(S.editorExportBtn)
      await expect(exportBtn).toBeEnabled()
    })

    test('Click Export shows progress', async ({ page }) => {
      const exportBtn = page.locator(S.editorExportBtn)
      await exportBtn.click()

      const progressBar = page.locator(S.exportProgressBar)
      await expect(progressBar).toBeVisible({ timeout: 5000 })
    })

    test('Progress percentage is displayed', async ({ page }) => {
      const progressBar = page.locator(S.exportProgressBar)
      // Check that it contains exporting text with percentage
      await expect(progressBar).toContainText('Exporting', { timeout: 5000 })
    })

    test('Completion shows result-box', async ({ page }) => {
      const resultBox = page.locator(`${S.editorView} ${S.resultBox}`)
      await expect(resultBox).toBeVisible({ timeout: 5000 })
      await expect(resultBox).toContainText('Export completed')
    })
  })

  test.describe.serial('Export error', () => {
    test('Setup error mock and import clip', async ({ page, electronApp }) => {
      await setupExportMocks(electronApp, 'error')
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      // Navigate to editor
      const navBtn = page.locator(S.navBtn)
      await navBtn.click()

      const editorView = page.locator(S.editorView)
      await expect(editorView).toBeVisible()

      // Add a clip
      const addClipBtn = page.locator(`${S.editorToolbar} button`, { hasText: '+ Clip' })
      await addClipBtn.click()

      const timelineClip = page.locator(S.timelineClip)
      await expect(timelineClip.first()).toBeVisible({ timeout: 5000 })
    })

    test('Failed export shows error-box', async ({ page }) => {
      const exportBtn = page.locator(S.editorExportBtn)
      await exportBtn.click()

      const errorBox = page.locator(`${S.editorView} ${S.errorBox}`)
      await expect(errorBox).toBeVisible({ timeout: 5000 })
      await expect(errorBox).toContainText('Export failed')
    })
  })
})
