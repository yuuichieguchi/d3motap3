import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import type { ElectronApplication } from '@playwright/test'

async function setupEditorMocks(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    let dialogCallCount = 0

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
    ipcMain.handle('dialog:open-file', () => {
      dialogCallCount++
      return `/tmp/test-clip-ops-video-${dialogCallCount}.mp4`
    })
  })
}

test.describe('Editor Clip Operations', () => {
  test.describe.serial('Clip removal', () => {
    test('Setup mocks and navigate to editor', async ({ page, electronApp }) => {
      await setupEditorMocks(electronApp)
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      const navBtn = page.locator(S.navBtn)
      await navBtn.click()

      const editorView = page.locator(S.editorView)
      await expect(editorView).toBeVisible()
    })

    test('Add 2 clips', async ({ page }) => {
      const addClipBtn = page.locator(`${S.editorToolbar} button`, { hasText: '+ Clip' })

      await addClipBtn.click()
      await expect(page.locator(S.timelineClip)).toHaveCount(1, { timeout: 5000 })

      await addClipBtn.click()
      await expect(page.locator(S.timelineClip)).toHaveCount(2, { timeout: 5000 })
    })

    test('Transition indicator exists between clips', async ({ page }) => {
      const indicators = page.locator(S.transitionIndicator)
      await expect(indicators).toHaveCount(1)
    })

    test('Right-click first clip removes it', async ({ page }) => {
      const firstClip = page.locator(S.timelineClip).first()
      await firstClip.click({ button: 'right' })

      await expect(page.locator(S.timelineClip)).toHaveCount(1, { timeout: 5000 })
    })

    test('Transition indicator disappears for single clip', async ({ page }) => {
      const indicators = page.locator(S.transitionIndicator)
      await expect(indicators).toHaveCount(0)
    })
  })

  test.describe.serial('Transition cycling', () => {
    test('Setup mocks and navigate to editor', async ({ page, electronApp }) => {
      await setupEditorMocks(electronApp)
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      const navBtn = page.locator(S.navBtn)
      await navBtn.click()

      const editorView = page.locator(S.editorView)
      await expect(editorView).toBeVisible()
    })

    test('Add 2 clips', async ({ page }) => {
      const addClipBtn = page.locator(`${S.editorToolbar} button`, { hasText: '+ Clip' })

      await addClipBtn.click()
      await expect(page.locator(S.timelineClip)).toHaveCount(1, { timeout: 5000 })

      await addClipBtn.click()
      await expect(page.locator(S.timelineClip)).toHaveCount(2, { timeout: 5000 })
    })

    test('Transition indicator shows "+" with no transition', async ({ page }) => {
      const indicator = page.locator(S.transitionIndicator).first()
      await expect(indicator).toBeVisible()
      await expect(indicator).toContainText('+')
    })

    test('First click sets fade transition', async ({ page }) => {
      const indicator = page.locator(S.transitionIndicator).first()
      await indicator.click()

      const active = page.locator(S.transitionActive)
      await expect(active).toBeVisible()
      await expect(indicator).toHaveAttribute('title', /fade/)
      await expect(indicator).toContainText('F')
    })

    test('Second click sets dissolve transition', async ({ page }) => {
      const indicator = page.locator(S.transitionIndicator).first()
      await indicator.click()

      await expect(indicator).toHaveAttribute('title', /dissolve/)
      await expect(indicator).toContainText('D')
    })

    test('Third click sets wipe_left transition', async ({ page }) => {
      const indicator = page.locator(S.transitionIndicator).first()
      await indicator.click()

      await expect(indicator).toHaveAttribute('title', /wipe_left/)
      await expect(indicator).toContainText('W')
    })

    test('Fourth click sets wipe_right transition', async ({ page }) => {
      const indicator = page.locator(S.transitionIndicator).first()
      await indicator.click()

      await expect(indicator).toHaveAttribute('title', /wipe_right/)
      await expect(indicator).toContainText('W')
    })
  })

  test.describe.serial('Overlay removal', () => {
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

    test('Add text overlay', async ({ page }) => {
      const addTextBtn = page.locator(`${S.editorToolbar} button`, { hasText: '+ Text' })
      await addTextBtn.click()

      const overlay = page.locator(S.timelineOverlay)
      await expect(overlay.first()).toBeVisible({ timeout: 5000 })
    })

    test('Overlay visible in timeline', async ({ page }) => {
      const overlay = page.locator(S.timelineOverlay)
      await expect(overlay).toHaveCount(1)
    })

    test('Right-click overlay removes it', async ({ page }) => {
      const overlay = page.locator(S.timelineOverlay).first()
      await overlay.click({ button: 'right' })

      await expect(page.locator(S.timelineOverlay)).toHaveCount(0, { timeout: 5000 })
    })

    test('Overlay track disappears', async ({ page }) => {
      const overlayTrack = page.locator(S.overlayTrack)
      await expect(overlayTrack).not.toBeVisible()
    })
  })

  test.describe.serial('Multiple clips order', () => {
    test('Setup mocks and navigate to editor', async ({ page, electronApp }) => {
      await setupEditorMocks(electronApp)
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      const navBtn = page.locator(S.navBtn)
      await navBtn.click()

      const editorView = page.locator(S.editorView)
      await expect(editorView).toBeVisible()
    })

    test('Add 3 clips', async ({ page }) => {
      const addClipBtn = page.locator(`${S.editorToolbar} button`, { hasText: '+ Clip' })

      await addClipBtn.click()
      await expect(page.locator(S.timelineClip)).toHaveCount(1, { timeout: 5000 })

      await addClipBtn.click()
      await expect(page.locator(S.timelineClip)).toHaveCount(2, { timeout: 5000 })

      await addClipBtn.click()
      await expect(page.locator(S.timelineClip)).toHaveCount(3, { timeout: 5000 })
    })

    test('Timeline has 3 clips', async ({ page }) => {
      const clips = page.locator(S.timelineClip)
      await expect(clips).toHaveCount(3)
    })

    test('Transition indicators count is 2 (between clips, not after last)', async ({ page }) => {
      const indicators = page.locator(S.transitionIndicator)
      await expect(indicators).toHaveCount(2)
    })
  })
})
