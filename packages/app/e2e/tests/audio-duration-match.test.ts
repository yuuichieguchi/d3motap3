import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import { spawn, type ChildProcess, execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unlinkSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs'

const FFMPEG_PATHS = [
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg',
  'ffmpeg',
]

function findFfmpeg(): string {
  for (const p of FFMPEG_PATHS) {
    try {
      execFileSync(p, ['-version'], { stdio: 'ignore' })
      return p
    } catch {}
  }
  throw new Error('ffmpeg not found')
}

test.describe('Audio Duration Match E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Close any leftover dialogs
    const closeBtn = page.locator(S.dialogCloseBtn)
    if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await closeBtn.click()
      await page.locator(S.dialogOverlay).waitFor({ state: 'hidden' })
    }
    // Ensure Recording tab is active
    await page.locator('.header-tab').filter({ hasText: 'Recording' }).click()
    // Turn OFF audio toggles if left on by previous test
    for (const label of ['Microphone', 'System Audio']) {
      const group = page.locator('.control-group.toggle').filter({ hasText: label })
      if (await group.locator('input[type="checkbox"]').isChecked().catch(() => false)) {
        await group.locator('.toggle-switch').click()
        await page.waitForTimeout(200)
      }
    }
    // Remove existing sources
    while (await page.locator(S.sourceRemoveBtn).count() > 0) {
      await page.locator(S.sourceRemoveBtn).first().click()
      await page.waitForTimeout(300)
    }
  })

  test('Audio track endMs matches video durationMs after recording', async ({ page }) => {
    test.setTimeout(120_000)

    const ffmpeg = findFfmpeg()
    const testTonePath = join(tmpdir(), 'd3motap3-duration-test-tone.wav')
    let afplay: ChildProcess | null = null

    try {
      // Step 1: Add a Display source via UI
      await page.locator(S.addSourceBtn).click()
      await page.locator(S.dialog).waitFor({ state: 'visible' })
      await page.locator(`${S.dialog} select`).first().selectOption('Display')
      await page.locator(S.sourceOptionBtn).first().click()
      await page.locator(S.dialog).waitFor({ state: 'hidden' })
      await expect(page.locator(S.sourceItem)).toHaveCount(1, { timeout: 10_000 })

      // Step 2: Turn ON System Audio toggle via UI
      const systemGroup = page.locator('.control-group.toggle').filter({ hasText: 'System Audio' })
      await systemGroup.locator('.toggle-switch').click()
      await expect(systemGroup.locator('input[type="checkbox"]')).toBeChecked()

      // Step 3: Turn ON Microphone toggle via UI
      const micGroup = page.locator('.control-group.toggle').filter({ hasText: 'Microphone' })
      await micGroup.locator('.toggle-switch').click()
      await expect(micGroup.locator('input[type="checkbox"]')).toBeChecked()

      // Step 4: Generate and play test tone so system audio captures real data
      execFileSync(ffmpeg, [
        '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10',
        '-ac', '2', '-ar', '48000', testTonePath,
      ], { stdio: 'ignore' })
      afplay = spawn('afplay', [testTonePath], { stdio: 'ignore' })
      await page.waitForTimeout(500) // let playback start

      // Step 5: Start recording
      const startBtn = page.getByRole('button', { name: 'Start Recording' })
      await startBtn.scrollIntoViewIfNeeded()
      await startBtn.click()
      const stopBtn = page.getByRole('button', { name: 'Stop Recording' })
      await expect(stopBtn).toBeVisible({ timeout: 10_000 })

      // Step 6: Record for 3 seconds then stop
      await page.waitForTimeout(3000)
      await stopBtn.click()
      afplay.kill()
      afplay = null

      // Step 7: Wait for Editor view (or error)
      await expect(
        page.locator(S.editorView)
          .or(page.locator(S.errorBox))
          .or(page.getByRole('button', { name: 'Start Recording' }))
      ).toBeVisible({ timeout: 60_000 })

      // Step 8: Assert no error
      const errorVisible = await page.locator(S.errorBox).isVisible().catch(() => false)
      if (errorVisible) {
        const errorText = await page.locator(S.errorBox).textContent()
        expect(errorVisible, `Recording failed: ${errorText}`).toBe(false)
      }
      await expect(page.locator(S.editorView)).toBeVisible({ timeout: 10_000 })

      // Step 9: Get bundle data via editorStore
      const result = await page.evaluate(async () => {
        const store = (window as unknown as Record<string, unknown>).__editorStore as
          { getState: () => { project: { clips: Array<{ bundlePath?: string }> } } } | undefined
        if (!store) throw new Error('__editorStore not found')
        const state = store.getState()
        const clip = state.project.clips[0]
        if (!clip || !clip.bundlePath) throw new Error('No bundle clip found')

        const projectJson = await (window as unknown as Record<string, { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }>)
          .api.invoke('editor:probe-bundle', clip.bundlePath) as string
        const project = JSON.parse(projectJson)

        return {
          videoDurationMs: project.video.durationMs as number,
          audioTracks: project.audioTracks.map((t: { id: string; label: string; clips: Array<{ endMs: number }> }) => ({
            id: t.id,
            label: t.label,
            endMs: t.clips[0]?.endMs ?? 0,
          })),
        }
      })

      // Step 10: Assertions
      expect(result.audioTracks.length).toBeGreaterThanOrEqual(2)

      const systemTrack = result.audioTracks.find((t: { id: string }) => t.id === 'system')
      const micTrack = result.audioTracks.find((t: { id: string }) => t.id === 'mic')

      expect(systemTrack, 'System audio track should exist').toBeTruthy()
      expect(micTrack, 'Mic audio track should exist').toBeTruthy()

      // Both endMs must equal video durationMs
      expect(systemTrack!.endMs).toBe(result.videoDurationMs)
      expect(micTrack!.endMs).toBe(result.videoDurationMs)

      // System and mic endMs must be equal to each other
      expect(systemTrack!.endMs).toBe(micTrack!.endMs)

      // Step 11: Save evidence (screenshot + JSON results)
      const evidenceDir = '/private/tmp/e2e-video-evidence'
      mkdirSync(evidenceDir, { recursive: true })
      await page.screenshot({ path: `${evidenceDir}/audio-duration-match.png`, fullPage: true })
      writeFileSync(`${evidenceDir}/audio-duration-match-results.json`, JSON.stringify(result, null, 2))

      // Also try to save Playwright video if available (Electron may not support it)
      const videoPath = await page.video()?.path()
      if (videoPath) {
        copyFileSync(videoPath, `${evidenceDir}/audio-duration-match.webm`)
      }
    } finally {
      if (afplay) afplay.kill()
      try { unlinkSync(testTonePath) } catch {}
    }
  })
})
