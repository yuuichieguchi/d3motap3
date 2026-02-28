/**
 * E2E test: verify independent audio track signal flows through Web Audio pipeline.
 *
 * Similar to audio-signal-verification.test.ts but for independent audio tracks
 * (useIndependentAudioPlayback). Plays a 440Hz sine wave test WAV and samples
 * the AnalyserNode at 100ms intervals. Verifies sustained non-zero signal output.
 *
 * The independent audio pipeline is:
 *   media:// → fetch → decodeAudioData → source → gain → analyser → destination
 */

import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import {
  closeLeftoverDialogs,
  cleanupEditor,
  createTestWav,
} from '../helpers/test-utils'
import * as fs from 'fs'

const TEST_WAV_PATH = '/tmp/test-indie-tone.wav'

test.describe('Independent audio signal verification', () => {
  test.beforeAll(async () => {
    createTestWav(TEST_WAV_PATH, 2) // 2 seconds of 440Hz tone
  })

  test.afterAll(() => {
    fs.rmSync(TEST_WAV_PATH, { force: true })
  })

  test.beforeEach(async ({ page }) => {
    await closeLeftoverDialogs(page)
    await page.locator('.header-tab').filter({ hasText: 'Editor' }).click()
    await page.waitForTimeout(300)

    // Inject a video clip + independent audio track with the test WAV
    await page.evaluate((wavPath) => {
      const store = (window as any).__editorStore
      if (!store) throw new Error('__editorStore not exposed on window')
      store.setState({
        project: {
          ...store.getState().project,
          clips: [
            {
              id: 'video-1',
              sourcePath: '/tmp/v1.mp4',
              originalDuration: 5000,
              trimStart: 0,
              trimEnd: 0,
              order: 0,
            },
          ],
          textOverlays: [],
          independentAudioTracks: [
            {
              id: 'test-signal-track',
              label: 'Test Tone',
              clips: [
                {
                  id: 'test-signal-clip',
                  sourcePath: wavPath,
                  originalDuration: 2000,
                  trimStart: 0,
                  trimEnd: 0,
                  timelineStartMs: 0,
                },
              ],
              volume: 1,
              muted: false,
            },
          ],
        },
        selectedClipIds: [],
        lastSelectedClipId: null,
        selectedOverlayId: null,
        selectedAudioClipIds: [],
        lastSelectedAudioClipId: null,
        currentTimeMs: 0,
        isPlaying: false,
      })
    }, TEST_WAV_PATH)
  })

  test.afterEach(async ({ page }) => {
    await cleanupEditor(page)
  })

  test('AnalyserNode detects sustained audio signal from independent track', async ({ page }) => {
    // Wait for independent audio buffers to load
    await page.waitForFunction(
      () =>
        (window as any).__independentAudioLoadState?.loaded === true ||
        (window as any).__independentAudioLoadError != null,
      { timeout: 10_000, polling: 200 },
    )

    const loadState = await page.evaluate(() => (window as any).__independentAudioLoadState)
    expect(loadState?.loaded, 'Independent audio buffers must be loaded').toBe(true)
    expect(loadState?.trackCount, 'At least one track must be loaded').toBeGreaterThanOrEqual(1)

    // Click play via UI
    await page.locator(S.playBtn).click()

    // Wait a moment for AudioContext to start and buffers to play
    await page.waitForTimeout(300)

    // Sample signal level every 100ms for 1 second
    const samples: number[] = []
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(100)
      const level = await page.evaluate(() => {
        const fn = (window as any).__getIndependentAudioSignalLevel
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
    // - Test WAV = 2s of 440Hz sine at 10% amplitude
    // - Starting at offset 0 → full 2s of audio → expect many non-zero samples
    // - Peak should be ~0.1 (10% amplitude sine wave)
    expect(
      nonZeroCount,
      `Expected ≥3 non-zero samples, got ${nonZeroCount}/10: [${samples.map((s) => s.toFixed(3)).join(', ')}]`,
    ).toBeGreaterThanOrEqual(3)
    expect(
      maxSignal,
      `Peak signal must be ≥0.05 (expected ~0.1 for 10% sine), got ${maxSignal.toFixed(4)}`,
    ).toBeGreaterThan(0.05)

    // Verify signal drops to zero after stopping
    await page.waitForTimeout(300)
    const postStopLevel = await page.evaluate(() => {
      const fn = (window as any).__getIndependentAudioSignalLevel
      return fn ? fn() : -1
    })
    expect(
      postStopLevel,
      `Signal should be near zero after stop, got ${postStopLevel.toFixed(4)}`,
    ).toBeLessThan(0.01)
  })
})
