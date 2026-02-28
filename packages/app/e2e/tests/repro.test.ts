import { test } from '../fixtures/electron-app'
import * as fs from 'fs'

test('repro: record with mic + system audio, 10s', async ({ page }) => {
  const dir = '/private/tmp/e2e-video-evidence'
  fs.mkdirSync(dir, { recursive: true })

  // Add display source
  await page.locator('.add-source-btn').click()
  await page.locator('.dialog').waitFor({ state: 'visible' })
  await page.locator('.source-option-btn').first().click()
  await page.locator('.dialog').waitFor({ state: 'hidden', timeout: 10000 })

  // Enable System Audio toggle
  const toggles = page.locator('.toggle-switch')
  await toggles.nth(0).click()
  await page.waitForTimeout(300)

  // Enable Microphone toggle
  await toggles.nth(1).click()
  await page.waitForTimeout(300)

  await page.screenshot({ path: `${dir}/repro-01-both-audio-on.png` })

  // Start recording
  await page.getByRole('button', { name: 'Start Recording' }).click()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${dir}/repro-02-recording.png` })

  // Record 10 seconds
  await page.waitForTimeout(10000)

  // Stop
  const stopBtn = page.locator('.record-btn.stop')
  if (await stopBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await stopBtn.click()
  }

  // Wait for processing + editor
  await page.waitForTimeout(8000)
  await page.screenshot({ path: `${dir}/repro-03-after-stop.png` })

  // Go to editor
  await page.locator('.header-tab').filter({ hasText: 'Editor' }).click()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `${dir}/repro-04-editor.png` })

  // Play
  const playBtn = page.locator('.play-btn')
  if (await playBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await playBtn.click()
    await page.waitForTimeout(5000)
    await page.screenshot({ path: `${dir}/repro-05-playing.png` })
    await playBtn.click()
  }

  // Dump state
  const state = await page.evaluate(() => {
    const store = (window as any).__editorStore
    if (!store) return null
    const s = store.getState()
    return {
      clipCount: s.project.clips.length,
      clips: s.project.clips.map((c: any) => ({
        id: c.id, sourcePath: c.sourcePath, duration: c.originalDuration,
        bundlePath: c.bundlePath,
        audioTracks: c.audioTracks?.map((t: any) => ({
          id: t.id, label: t.label, type: t.type,
          clipCount: t.clips?.length,
          format: t.format,
        })),
        mixerSettings: c.mixerSettings,
      })),
      audioTrackCount: s.project.independentAudioTracks.length,
      independentAudioTracks: s.project.independentAudioTracks,
    }
  })
  console.log('STORE STATE:', JSON.stringify(state, null, 2))
  fs.writeFileSync(`${dir}/repro-store-state.json`, JSON.stringify(state, null, 2))
})
