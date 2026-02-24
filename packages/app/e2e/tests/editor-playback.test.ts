import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import type { ElectronApplication } from '@playwright/test'

async function setupPlaybackMocks(electronApp: ElectronApplication): Promise<void> {
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
    ipcMain.handle('dialog:open-file', () => '/tmp/test-playback-video.mp4')
  })
}

test.describe('Editor Playback', () => {
  test.describe.serial('Controls', () => {
    test('Setup editor mocks and navigate to editor', async ({ page, electronApp }) => {
      await setupPlaybackMocks(electronApp)
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      // Navigate to editor
      const navBtn = page.locator(S.navBtn)
      await navBtn.click()

      const editorView = page.locator(S.editorView)
      await expect(editorView).toBeVisible()
    })

    test('Empty state: playback controls not visible', async ({ page }) => {
      const playback = page.locator(S.editorPlayback)
      await expect(playback).not.toBeVisible()
    })

    test('Empty state: "No clips added" visible', async ({ page }) => {
      const emptyState = page.locator(S.editorEmptyState)
      await expect(emptyState).toBeVisible()
      await expect(emptyState).toContainText('No clips')
    })

    test('+ Text button disabled when no clips', async ({ page }) => {
      const addTextBtn = page.locator(`${S.editorToolbar} button`, { hasText: '+ Text' })
      await expect(addTextBtn).toBeDisabled()
    })

    test('Split button disabled without selected clip', async ({ page }) => {
      const splitBtn = page.locator(`${S.editorToolbar} button`, { hasText: 'Split' })
      await expect(splitBtn).toBeDisabled()
    })

    test('Add clip via "+ Clip" button', async ({ page }) => {
      const addClipBtn = page.locator(`${S.editorToolbar} button`, { hasText: '+ Clip' })
      await addClipBtn.click()

      const timelineClip = page.locator(S.timelineClip)
      await expect(timelineClip.first()).toBeVisible({ timeout: 5000 })
    })

    test('Playback controls become visible after adding clip', async ({ page }) => {
      const playback = page.locator(S.editorPlayback)
      await expect(playback).toBeVisible()
    })

    test('Time display shows "00:00" and "00:05"', async ({ page }) => {
      const timeDisplays = page.locator(S.timeDisplay)
      await expect(timeDisplays.first()).toHaveText('00:00')
      await expect(timeDisplays.last()).toHaveText('00:05')
    })

    test('Play button shows ▶ initially', async ({ page }) => {
      const playBtn = page.locator(S.playBtn)
      await expect(playBtn).toHaveText('▶')
    })

    test('Click play changes button text to ⏸', async ({ page }) => {
      const playBtn = page.locator(S.playBtn)
      await playBtn.click()

      await expect(playBtn).toHaveText('⏸')
    })

    test('Click pause returns button text to ▶', async ({ page }) => {
      const playBtn = page.locator(S.playBtn)
      await playBtn.click()

      await expect(playBtn).toHaveText('▶')
    })

    test('Seek bar change updates time display', async ({ page }) => {
      const seekBar = page.locator(S.seekBar)
      await seekBar.fill('2500')

      const currentTime = page.locator(S.timeDisplay).first()
      await expect(currentTime).toHaveText('00:02')
    })
  })
})
