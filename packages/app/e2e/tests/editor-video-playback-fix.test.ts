import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import { execSync } from 'child_process'
import { existsSync, unlinkSync } from 'fs'
import type { ElectronApplication } from '@playwright/test'

const TEST_VIDEO = '/tmp/test-editor-video.mp4'

function generateTestVideo(): void {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' })
  } catch {
    throw new Error('ffmpeg is required but not found in PATH')
  }
  if (existsSync(TEST_VIDEO)) unlinkSync(TEST_VIDEO)
  execSync(
    `ffmpeg -y -f lavfi -i "color=c=blue:s=320x240:d=3" -c:v libx264 -t 3 -pix_fmt yuv420p ${TEST_VIDEO}`,
    { timeout: 10000 }
  )
}

async function setupMocks(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('system:ffmpeg-available')
    ipcMain.handle('system:ffmpeg-available', () => true)

    ipcMain.removeHandler('recording:list-displays')
    ipcMain.handle('recording:list-displays', () => [
      { id: 0, width: 1920, height: 1080 },
    ])

    ipcMain.removeHandler('sources:list')
    ipcMain.handle('sources:list', () => [])

    ipcMain.removeHandler('dialog:open-file')
    ipcMain.handle('dialog:open-file', () => '/tmp/test-editor-video.mp4')
  })
}

test.describe('Editor Video Playback Fix', () => {
  test.beforeAll(() => {
    generateTestVideo()
  })

  test.afterAll(() => {
    if (existsSync(TEST_VIDEO)) unlinkSync(TEST_VIDEO)
  })

  test.describe.serial('Playback actually works', () => {
    test('Import video and navigate to editor', async ({ page, electronApp }) => {
      await setupMocks(electronApp)
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      const editorTab = page.locator('.header-tab', { hasText: 'Editor' })
      await editorTab.click()
      await page.locator(S.editorView).waitFor({ state: 'visible', timeout: 10000 })

      const addClipBtn = page.locator(`${S.editorToolbar} button`, { hasText: '+ Clip' })
      await addClipBtn.click()
      await expect(page.locator(S.timelineClip).first()).toBeVisible({ timeout: 10000 })
    })

    test('Click play → video.currentTime advances', async ({ page }) => {
      const t1 = await page.locator(S.editorVideo).evaluate((el: HTMLVideoElement) => el.currentTime)

      const playBtn = page.locator(S.playBtn)
      await playBtn.click()

      // Wait 1.5s for playback to advance noticeably
      await page.waitForTimeout(1500)

      const t2 = await page.locator(S.editorVideo).evaluate((el: HTMLVideoElement) => el.currentTime)

      // Pause
      await playBtn.click()

      console.log(`video.currentTime: ${t1} → ${t2}`)
      expect(t2).toBeGreaterThan(t1)
    })

    test('During playback, video.src stays the same', async ({ page }) => {
      // Reset to beginning
      const seekBar = page.locator(S.seekBar)
      await seekBar.fill('0')

      const srcBefore = await page.locator(S.editorVideo).evaluate((el: HTMLVideoElement) => el.src)

      const playBtn = page.locator(S.playBtn)
      await playBtn.click()
      await page.waitForTimeout(500)

      const srcDuring = await page.locator(S.editorVideo).evaluate((el: HTMLVideoElement) => el.src)

      await playBtn.click()

      console.log(`src before: ${srcBefore}`)
      console.log(`src during: ${srcDuring}`)
      expect(srcBefore).toBe(srcDuring)
    })

    test('Time display updates after 2s of playback', async ({ page }) => {
      // Reset to beginning
      const seekBar = page.locator(S.seekBar)
      await seekBar.fill('0')
      await page.waitForTimeout(100)

      const playBtn = page.locator(S.playBtn)
      await playBtn.click()

      // Wait 2s so display should show at least 00:01
      await page.waitForTimeout(2000)

      const timeText = await page.locator(S.timeDisplay).first().textContent()
      await playBtn.click()

      console.log(`Time display after 2s: ${timeText}`)
      expect(timeText).not.toBe('00:00')
    })
  })
})
