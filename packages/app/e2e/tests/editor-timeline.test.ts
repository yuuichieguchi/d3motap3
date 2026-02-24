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

    // Editor probe
    ipcMain.removeHandler('editor:probe')
    ipcMain.handle('editor:probe', () => ({
      durationMs: 5000,
      width: 1920,
      height: 1080,
      fps: 30,
      codec: 'h264',
    }))

    // Editor thumbnails
    ipcMain.removeHandler('editor:thumbnails')
    ipcMain.handle('editor:thumbnails', () => [])

    // File dialog — returns a different path each time
    ipcMain.removeHandler('dialog:open-file')
    ipcMain.handle('dialog:open-file', () => {
      dialogCallCount++
      return `/tmp/test-video-${dialogCallCount}.mp4`
    })
  })
}

test.describe('Editor Timeline', () => {
  test.describe.serial('Clip management', () => {
    test('Setup editor mocks', async ({ page, electronApp }) => {
      await setupEditorMocks(electronApp)
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })
    })

    test('Navigate to editor', async ({ page }) => {
      const navBtn = page.locator(S.navBtn)
      await navBtn.click()

      const editorView = page.locator(S.editorView)
      await expect(editorView).toBeVisible()
    })

    test('Empty state shows "No clips"', async ({ page }) => {
      const emptyState = page.locator(S.timelineEmpty)
      await expect(emptyState).toBeVisible()
      await expect(emptyState).toContainText('No clips')
    })

    test('Add clip via toolbar', async ({ page }) => {
      // Click "+ Clip" toolbar button
      const addClipBtn = page.locator(`${S.editorToolbar} button`, { hasText: '+ Clip' })
      await addClipBtn.click()

      // Wait for clip to appear in timeline
      const timelineClip = page.locator(S.timelineClip)
      await expect(timelineClip.first()).toBeVisible({ timeout: 5000 })

      // Empty state should be gone
      const emptyState = page.locator(S.timelineEmpty)
      await expect(emptyState).not.toBeVisible()
    })

    test('Playback controls appear', async ({ page }) => {
      const playBtn = page.locator(S.playBtn)
      await expect(playBtn).toBeVisible()

      const seekBar = page.locator(S.seekBar)
      await expect(seekBar).toBeVisible()

      const timeDisplay = page.locator(S.timeDisplay)
      await expect(timeDisplay.first()).toBeVisible()
    })

    test('Click clip selects it', async ({ page }) => {
      const timelineClip = page.locator(S.timelineClip).first()
      await timelineClip.click()

      const selectedClip = page.locator(S.timelineClipSelected)
      await expect(selectedClip).toBeVisible()
    })

    test('Add second clip', async ({ page }) => {
      const addClipBtn = page.locator(`${S.editorToolbar} button`, { hasText: '+ Clip' })
      await addClipBtn.click()

      const clips = page.locator(S.timelineClip)
      await expect(clips).toHaveCount(2, { timeout: 5000 })
    })

    test('Transition indicator appears between clips', async ({ page }) => {
      const indicator = page.locator(S.transitionIndicator)
      await expect(indicator.first()).toBeVisible()
    })

    test('Click transition adds has-transition', async ({ page }) => {
      const indicator = page.locator(S.transitionIndicator).first()
      await indicator.click()

      const active = page.locator(S.transitionActive)
      await expect(active).toBeVisible()
    })

    test('Playhead exists', async ({ page }) => {
      const playhead = page.locator(S.timelinePlayhead)
      await expect(playhead).toBeVisible()
    })
  })

  test.describe.serial('Text overlay', () => {
    test('Setup and navigate to editor with clip', async ({ page, electronApp }) => {
      await setupEditorMocks(electronApp)
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      // Navigate to editor
      const navBtn = page.locator(S.navBtn)
      await navBtn.click()

      const editorView = page.locator(S.editorView)
      await expect(editorView).toBeVisible()

      // Add a clip first
      const addClipBtn = page.locator(`${S.editorToolbar} button`, { hasText: '+ Clip' })
      await addClipBtn.click()

      const timelineClip = page.locator(S.timelineClip)
      await expect(timelineClip.first()).toBeVisible({ timeout: 5000 })
    })

    test('Add text overlay', async ({ page }) => {
      const addTextBtn = page.locator(`${S.editorToolbar} button`, { hasText: '+ Text' })
      await addTextBtn.click()

      const overlay = page.locator(S.timelineOverlay)
      await expect(overlay.first()).toBeVisible()
    })

    test('overlay-text-label shows "Text"', async ({ page }) => {
      const label = page.locator(S.overlayTextLabel)
      await expect(label.first()).toContainText('Text')
    })

    test('Click overlay selects it', async ({ page }) => {
      const overlay = page.locator(S.timelineOverlay).first()
      await overlay.click()

      const selected = page.locator(S.timelineOverlaySelected)
      await expect(selected).toBeVisible()
    })
  })
})
