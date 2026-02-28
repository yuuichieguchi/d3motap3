/**
 * E2E test: verify audio signal flows through the full Web Audio pipeline.
 *
 * Plays a 440Hz sine wave test bundle and samples the AnalyserNode at 100ms
 * intervals for 1 second. Verifies sustained non-zero signal output, proving
 * the pipeline (audio:// → fetch → decodeAudioData → source → gain →
 * analyser → destination) works end-to-end.
 *
 * The test PCM is 1 second long. Starting at offset 0.5s leaves ~0.5s of
 * audio, so we expect signal in approximately 4–5 of the first 10 samples.
 */

import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import {
  closeLeftoverDialogs,
  cleanupEditor,
  makeBundleMockClips,
  createTestBundle,
} from '../helpers/test-utils'
import * as fs from 'fs'

const BUNDLE_PATH = '/tmp/test-bundle.d3m'

test.describe('Audio signal verification', () => {
  test.beforeAll(async () => {
    await createTestBundle(BUNDLE_PATH)
  })

  test.afterAll(() => {
    fs.rmSync(BUNDLE_PATH, { recursive: true, force: true })
  })

  test.beforeEach(async ({ page }) => {
    await closeLeftoverDialogs(page)
    await page.locator('.header-tab').filter({ hasText: 'Editor' }).click()
    await page.waitForTimeout(300)

    const clipData = makeBundleMockClips()
    await page.evaluate((data) => {
      const store = (window as any).__editorStore
      if (!store) throw new Error('__editorStore not exposed on window')
      store.setState({
        project: { ...store.getState().project, clips: data, textOverlays: [], independentAudioTracks: [] },
        selectedClipIds: [],
        lastSelectedClipId: null,
        selectedOverlayId: null,
        selectedAudioClipIds: [],
        lastSelectedAudioClipId: null,
        clipboardAudioClips: null,
        currentTimeMs: 0,
        isPlaying: false,
      })
    }, clipData)
  })

  test.afterEach(async ({ page }) => {
    await cleanupEditor(page)
  })

  test('AnalyserNode detects sustained audio signal during playback', async ({ page }) => {
    // Seek to 3500ms (500ms into the bundle clip starting at 3000ms)
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().seekTo(3500)
    })

    // Wait for audio buffers to load via audio:// protocol
    await page.waitForFunction(
      () =>
        (window as any).__audioLoadState?.loaded === true ||
        (window as any).__audioLoadError != null,
      { timeout: 10_000, polling: 200 },
    )

    const loadState = await page.evaluate(() => (window as any).__audioLoadState)
    expect(loadState?.loaded, 'Audio buffers must be loaded').toBe(true)
    expect(loadState?.trackCount, 'At least the system audio track must be loaded').toBeGreaterThanOrEqual(1)

    // Click play via UI
    await page.locator(S.playBtn).click()

    // Wait for AudioContext to be running
    await page.waitForFunction(
      () => (window as any).__audioPlaybackDebug?.contextState === 'running',
      { timeout: 5_000, polling: 100 },
    )

    // Sample signal level every 100ms for 1 second
    const samples: number[] = []
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(100)
      const level = await page.evaluate(() => {
        const fn = (window as any).__getAudioSignalLevel
        return fn ? fn() : -1
      })
      samples.push(level)
    }

    // Stop playback
    await page.locator(S.playBtn).click()

    // Analyze results
    const nonZeroCount = samples.filter((s) => s > 0).length
    const maxSignal = Math.max(...samples)

    // Assertions:
    // - Test PCM = 1s of 440Hz sine at 50% amplitude
    // - Offset 0.5s → 0.5s of audio remains → ~4-5 non-zero samples at 100ms intervals
    // - Peak should be ~0.5 (half-amplitude sine wave)
    expect(nonZeroCount, `Expected ≥3 non-zero samples, got ${nonZeroCount}/10: [${samples.map(s => s.toFixed(3)).join(', ')}]`).toBeGreaterThanOrEqual(3)
    expect(maxSignal, `Peak signal must be ≥0.3 (expected ~0.5 for 50% sine), got ${maxSignal.toFixed(4)}`).toBeGreaterThan(0.3)
  })
})
