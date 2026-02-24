import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import type { ElectronApplication } from '@playwright/test'

async function setupEditorMocks(electronApp: ElectronApplication): Promise<void> {
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
    ipcMain.handle('dialog:open-file', () => '/tmp/test-overlay-edit-video.mp4')
  })
}

test.describe('Editor Overlay Editing', () => {
  test.describe.serial('Field updates', () => {
    test('Setup mocks and navigate to editor', async ({ page, electronApp }) => {
      await setupEditorMocks(electronApp)
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      const navBtn = page.locator(S.navBtn)
      await navBtn.click()

      const editorView = page.locator(S.editorView)
      await expect(editorView).toBeVisible()
    })

    test('Add clip via "+ Clip"', async ({ page }) => {
      const addClipBtn = page.locator(`${S.editorToolbar} button`, { hasText: '+ Clip' })
      await addClipBtn.click()

      const timelineClip = page.locator(S.timelineClip)
      await expect(timelineClip.first()).toBeVisible({ timeout: 5000 })
    })

    test('Add text overlay via "+ Text"', async ({ page }) => {
      const addTextBtn = page.locator(`${S.editorToolbar} button`, { hasText: '+ Text' })
      await addTextBtn.click()

      const overlay = page.locator(S.timelineOverlay)
      await expect(overlay.first()).toBeVisible({ timeout: 5000 })
    })

    test('Click overlay in timeline to select it', async ({ page }) => {
      const overlay = page.locator(S.timelineOverlay).first()
      await overlay.click()

      const selected = page.locator(S.timelineOverlaySelected)
      await expect(selected).toBeVisible()
    })

    test('text-overlay-editor becomes visible', async ({ page }) => {
      const editor = page.locator(S.textOverlayEditor)
      await expect(editor).toBeVisible()

      const heading = editor.locator('h3')
      await expect(heading).toContainText('Text Overlay')
    })

    test('Textarea has default value "Text"', async ({ page }) => {
      const textarea = page.locator(`${S.textOverlayEditor} textarea`)
      await expect(textarea).toBeVisible()
      await expect(textarea).toHaveValue('Text')
    })

    test('Change text to "Hello World" updates overlay-text-label', async ({ page }) => {
      const textarea = page.locator(`${S.textOverlayEditor} textarea`)
      await textarea.fill('Hello World')

      const label = page.locator(S.overlayTextLabel).first()
      await expect(label).toContainText('Hello World')
    })

    test('Font size slider has default value 48 and display shows "48px"', async ({ page }) => {
      const fontSizeGroup = page.locator(`${S.textOverlayEditor} ${S.controlGroup}`).filter({ hasText: 'Font Size' })
      const rangeInput = fontSizeGroup.locator('input[type="range"]')
      await expect(rangeInput).toHaveValue('48')

      const display = fontSizeGroup.locator('span')
      await expect(display).toHaveText('48px')
    })

    test('Change font size to 72 updates display to "72px"', async ({ page }) => {
      const fontSizeGroup = page.locator(`${S.textOverlayEditor} ${S.controlGroup}`).filter({ hasText: 'Font Size' })
      const rangeInput = fontSizeGroup.locator('input[type="range"]')
      await rangeInput.fill('72')

      const display = fontSizeGroup.locator('span')
      await expect(display).toHaveText('72px')
    })

    test('Color input exists with default #ffffff', async ({ page }) => {
      const colorInput = page.locator(`${S.textOverlayEditor} input[type="color"]`)
      await expect(colorInput).toBeVisible()
      await expect(colorInput).toHaveValue('#ffffff')
    })

    test('Position X slider has default 50 and display shows "50%"', async ({ page }) => {
      const posXGroup = page.locator(`${S.textOverlayEditor} ${S.controlGroup}`).filter({ hasText: 'Position X' })
      const rangeInput = posXGroup.locator('input[type="range"]')
      await expect(rangeInput).toHaveValue('50')

      const display = posXGroup.locator('span')
      await expect(display).toHaveText('50%')
    })

    test('Change Position X to 30 updates display to "30%"', async ({ page }) => {
      const posXGroup = page.locator(`${S.textOverlayEditor} ${S.controlGroup}`).filter({ hasText: 'Position X' })
      const rangeInput = posXGroup.locator('input[type="range"]')
      await rangeInput.fill('30')

      const display = posXGroup.locator('span')
      await expect(display).toHaveText('30%')
    })

    test('Position Y slider has default 90 and display shows "90%"', async ({ page }) => {
      const posYGroup = page.locator(`${S.textOverlayEditor} ${S.controlGroup}`).filter({ hasText: 'Position Y' })
      const rangeInput = posYGroup.locator('input[type="range"]')
      await expect(rangeInput).toHaveValue('90')

      const display = posYGroup.locator('span')
      await expect(display).toHaveText('90%')
    })

    test('Change Position Y to 50 updates display to "50%"', async ({ page }) => {
      const posYGroup = page.locator(`${S.textOverlayEditor} ${S.controlGroup}`).filter({ hasText: 'Position Y' })
      const rangeInput = posYGroup.locator('input[type="range"]')
      await rangeInput.fill('50')

      const display = posYGroup.locator('span')
      await expect(display).toHaveText('50%')
    })

    test('Start time input has default 0', async ({ page }) => {
      const startGroup = page.locator(`${S.textOverlayEditor} ${S.controlGroup}`).filter({ hasText: 'Start (ms)' })
      const numberInput = startGroup.locator('input[type="number"]')
      await expect(numberInput).toHaveValue('0')
    })

    test('End time input has default 3000', async ({ page }) => {
      const endGroup = page.locator(`${S.textOverlayEditor} ${S.controlGroup}`).filter({ hasText: 'End (ms)' })
      const numberInput = endGroup.locator('input[type="number"]')
      await expect(numberInput).toHaveValue('3000')
    })

    test('Change start time to 500', async ({ page }) => {
      const startGroup = page.locator(`${S.textOverlayEditor} ${S.controlGroup}`).filter({ hasText: 'Start (ms)' })
      const numberInput = startGroup.locator('input[type="number"]')
      await numberInput.fill('500')

      await expect(numberInput).toHaveValue('500')
    })

    test('Change end time to 4000', async ({ page }) => {
      const endGroup = page.locator(`${S.textOverlayEditor} ${S.controlGroup}`).filter({ hasText: 'End (ms)' })
      const numberInput = endGroup.locator('input[type="number"]')
      await numberInput.fill('4000')

      await expect(numberInput).toHaveValue('4000')
    })
  })

  test.describe.serial('Multiple overlays', () => {
    test('Setup mocks and navigate to editor', async ({ page, electronApp }) => {
      await setupEditorMocks(electronApp)
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      const navBtn = page.locator(S.navBtn)
      await navBtn.click()

      const editorView = page.locator(S.editorView)
      await expect(editorView).toBeVisible()
    })

    test('Add clip', async ({ page }) => {
      const addClipBtn = page.locator(`${S.editorToolbar} button`, { hasText: '+ Clip' })
      await addClipBtn.click()

      await expect(page.locator(S.timelineClip).first()).toBeVisible({ timeout: 5000 })
    })

    test('Add 2 text overlays', async ({ page }) => {
      const addTextBtn = page.locator(`${S.editorToolbar} button`, { hasText: '+ Text' })

      await addTextBtn.click()
      await expect(page.locator(S.timelineOverlay)).toHaveCount(1, { timeout: 5000 })

      await addTextBtn.click()
      await expect(page.locator(S.timelineOverlay)).toHaveCount(2, { timeout: 5000 })
    })

    test('2 overlay elements in timeline', async ({ page }) => {
      const overlays = page.locator(S.timelineOverlay)
      await expect(overlays).toHaveCount(2)
    })

    test('Click first overlay selects it', async ({ page }) => {
      const firstOverlay = page.locator(S.timelineOverlay).first()
      // force: true because overlays overlap at same position
      await firstOverlay.click({ force: true })

      const selected = page.locator(S.timelineOverlaySelected)
      await expect(selected).toBeVisible()
    })

    test('Click second overlay switches selection', async ({ page }) => {
      const secondOverlay = page.locator(S.timelineOverlay).nth(1)
      await secondOverlay.click({ force: true })

      // The second overlay should now have the selected class
      const selected = page.locator(S.timelineOverlaySelected)
      await expect(selected).toHaveCount(1)

      // Verify the second overlay is the selected one
      await expect(secondOverlay).toHaveClass(/selected/)
    })

    test('Selected overlay text shown in editor textarea', async ({ page }) => {
      const textarea = page.locator(`${S.textOverlayEditor} textarea`)
      await expect(textarea).toBeVisible()
      // Both overlays have default text "Text" since neither was edited
      await expect(textarea).toHaveValue('Text')
    })
  })
})
