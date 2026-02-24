import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import type { ElectronApplication } from '@playwright/test'

async function setupEditorWithClip(electronApp: ElectronApplication): Promise<void> {
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
    ipcMain.handle('dialog:open-file', () => '/tmp/test-overlay-video.mp4')
  })
}

test.describe('Text Overlay Editor', () => {
  test.describe.serial('Editor panel', () => {
    test('Setup and navigate to editor with clip', async ({ page, electronApp }) => {
      await setupEditorWithClip(electronApp)
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

    test('text-overlay-editor hidden when no overlay selected', async ({ page }) => {
      const editor = page.locator(S.textOverlayEditor)
      await expect(editor).not.toBeVisible()
    })

    test('Add overlay and select it', async ({ page }) => {
      // Add text overlay
      const addTextBtn = page.locator(`${S.editorToolbar} button`, { hasText: '+ Text' })
      await addTextBtn.click()

      // Click the overlay to select it
      const overlay = page.locator(S.timelineOverlay).first()
      await expect(overlay).toBeVisible({ timeout: 5000 })
      await overlay.click()
    })

    test('text-overlay-editor becomes visible', async ({ page }) => {
      const editor = page.locator(S.textOverlayEditor)
      await expect(editor).toBeVisible()

      const heading = editor.locator('h3')
      await expect(heading).toContainText('Text Overlay')
    })

    test('textarea exists with default "Text"', async ({ page }) => {
      const textarea = page.locator(`${S.textOverlayEditor} textarea`)
      await expect(textarea).toBeVisible()
      await expect(textarea).toHaveValue('Text')
    })

    test('font size range input exists', async ({ page }) => {
      const rangeInputs = page.locator(`${S.textOverlayEditor} input[type="range"]`)
      // Font Size, Position X, Position Y = 3 range inputs
      await expect(rangeInputs).toHaveCount(3)
    })

    test('color input exists', async ({ page }) => {
      const colorInput = page.locator(`${S.textOverlayEditor} input[type="color"]`)
      await expect(colorInput).toBeVisible()
    })

    test('start/end number inputs exist', async ({ page }) => {
      const numberInputs = page.locator(`${S.textOverlayEditor} input[type="number"]`)
      await expect(numberInputs).toHaveCount(2)
    })

    test('Changing text updates overlay-text-label', async ({ page }) => {
      const textarea = page.locator(`${S.textOverlayEditor} textarea`)
      await textarea.fill('Hello World')

      const label = page.locator(S.overlayTextLabel).first()
      await expect(label).toContainText('Hello World')
    })

    test('Remove overlay hides editor and removes overlay', async ({ page }) => {
      const removeBtn = page.locator(`${S.textOverlayEditor} .record-btn.stop`)
      await removeBtn.click()

      // Editor should be hidden
      const editor = page.locator(S.textOverlayEditor)
      await expect(editor).not.toBeVisible()

      // Overlay should be gone
      const overlays = page.locator(S.timelineOverlay)
      await expect(overlays).toHaveCount(0)
    })
  })
})
