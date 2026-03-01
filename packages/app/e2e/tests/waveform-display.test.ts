/**
 * E2E test for waveform display in the timeline.
 *
 * Verifies that:
 * - After adding an audio clip, the Editor timeline renders a waveform canvas
 * - The waveform canvas has non-zero dimensions
 */

import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import {
  closeLeftoverDialogs,
  removeAllSources,
} from '../helpers/test-utils'
import * as fs from 'fs'
import * as path from 'path'

const EVIDENCE_DIR = '/private/tmp/e2e-video-evidence'

/** Generate a tiny WAV file (1 second, 44100Hz mono, 16-bit sine wave) */
function generateTestWav(filePath: string): void {
  const sampleRate = 44100
  const duration = 1
  const numSamples = sampleRate * duration
  const buffer = Buffer.alloc(44 + numSamples * 2)

  // WAV header
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + numSamples * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)  // PCM
  buffer.writeUInt16LE(1, 22)  // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(numSamples * 2, 40)

  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0.5
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * 2)
  }

  fs.writeFileSync(filePath, buffer)
}

test.describe('Waveform display', () => {
  test.beforeEach(async ({ page }) => {
    await closeLeftoverDialogs(page)
    await page.locator('.header-tab').filter({ hasText: 'Recording' }).click()
    await page.waitForTimeout(300)

    for (const label of ['Microphone', 'System Audio']) {
      const group = page.locator('.control-group.toggle').filter({ hasText: label })
      if (await group.locator('input[type="checkbox"]').isChecked().catch(() => false)) {
        await group.locator('.toggle-switch').click()
        await page.waitForTimeout(200)
      }
    }

    await removeAllSources(page)
  })

  test('shows waveform canvas in independent audio track', async ({ page }) => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })

    // Step 1: Add a Display source and record briefly to get a video clip
    await page.locator(S.addSourceBtn).click()
    await page.locator(S.dialog).waitFor({ state: 'visible' })
    await page.locator(`${S.dialog} select`).first().selectOption('Display')
    await page.locator(S.sourceOptionBtn).first().click()
    await page.locator(S.dialog).waitFor({ state: 'hidden', timeout: 10_000 })
    await expect(page.locator(S.sourceItem)).toHaveCount(1, { timeout: 10_000 })

    // Start recording
    const startBtn = page.getByRole('button', { name: 'Start Recording' })
    await startBtn.scrollIntoViewIfNeeded()
    await startBtn.click()

    const stopBtn = page.getByRole('button', { name: 'Stop Recording' })
    await expect(stopBtn).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(2000)
    await stopBtn.click()

    // Wait for editor to load
    await expect(
      page.locator(S.editorView)
        .or(page.locator(S.errorBox))
        .or(page.getByRole('button', { name: 'Start Recording' }))
    ).toBeVisible({ timeout: 60_000 })

    const errorBox = page.locator(S.errorBox)
    if (await errorBox.isVisible().catch(() => false)) {
      const errorText = await errorBox.textContent()
      expect(false, `Recording failed: ${errorText}`).toBe(true)
    }

    await expect(page.locator(S.editorView)).toBeVisible({ timeout: 10_000 })
    await page.locator('.header-tab').filter({ hasText: 'Editor' }).click()
    await page.waitForTimeout(500)
    await expect(page.locator(S.timeline)).toBeVisible({ timeout: 10_000 })

    // Step 2: Generate a test WAV file and import it as independent audio
    const wavPath = path.join('/tmp', 'waveform-test-440hz.wav')
    generateTestWav(wavPath)

    // Add independent audio track via store (exposed as window.__editorStore)
    await page.evaluate(async (filePath: string) => {
      const store = (window as any).__editorStore
      store.getState().addAudioTrack('Test Audio')
      const tracks = store.getState().project.independentAudioTracks
      const trackId = tracks[tracks.length - 1].id
      await store.getState().addAudioClip(trackId, filePath)
    }, wavPath)

    await page.screenshot({ path: `${EVIDENCE_DIR}/waveform-01-audio-added.png` })

    // Step 3: Wait for waveform data to decode
    await page.waitForTimeout(5000)

    // Step 4: Verify independent audio clip exists
    const audioClip = page.locator('.independent-audio-clip')
    await expect(audioClip.first()).toBeVisible({ timeout: 10_000 })

    // Step 5: Verify waveform canvas exists inside the audio clip
    const waveformCanvas = page.locator('.independent-audio-clip .waveform-canvas')
    await expect(waveformCanvas.first()).toBeVisible({ timeout: 10_000 })

    // Step 6: Verify canvas has non-zero dimensions
    const box = await waveformCanvas.first().boundingBox()
    expect(box, 'Waveform canvas should have a bounding box').not.toBeNull()
    expect(box!.width).toBeGreaterThan(0)
    expect(box!.height).toBeGreaterThan(0)

    // Step 7: Take final screenshot as evidence
    await page.screenshot({ path: `${EVIDENCE_DIR}/waveform-02-waveform-visible.png` })

    // Also check bundle audio waveform if present
    const bundleWaveform = page.locator('.audio-track-bar .waveform-canvas')
    const bundleCount = await bundleWaveform.count()
    if (bundleCount > 0) {
      const bBox = await bundleWaveform.first().boundingBox()
      expect(bBox).not.toBeNull()
      expect(bBox!.width).toBeGreaterThan(0)
      expect(bBox!.height).toBeGreaterThan(0)
    }

    await page.screenshot({ path: `${EVIDENCE_DIR}/waveform-03-final.png` })
  })
})
