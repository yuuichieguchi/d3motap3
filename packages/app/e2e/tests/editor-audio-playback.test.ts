/**
 * E2E tests for audio playback correctness and Split audio track behavior.
 *
 * Coverage:
 * - Bundle clip audio plays at correct local offset (not global timeline time)
 * - Split does not duplicate audio track rows
 * - Split audio bar widths sum to pre-split width
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

test.describe('Editor audio playback', () => {
  test.beforeAll(async () => {
    // Create test bundle with real PCM data
    await createTestBundle(BUNDLE_PATH)
  })

  test.afterAll(() => {
    // Clean up test bundle
    fs.rmSync(BUNDLE_PATH, { recursive: true, force: true })
  })

  test.beforeEach(async ({ page }) => {
    await closeLeftoverDialogs(page)
    // Navigate to Editor tab and set up clips
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

  // ==================== Test 1: Audio playback offset ====================

  test('Bundle clip audio plays at correct local offset', async ({ page }) => {
    // Seek to 3500ms (500ms into the bundle clip which starts at 3000ms)
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().seekTo(3500)
    })

    // Poll for audio buffers to finish loading via audio:// protocol (fetch + decodeAudioData)
    await page.waitForFunction(
      () => (window as any).__audioLoadState?.loaded === true
        || (window as any).__audioLoadError != null,
      { timeout: 10_000, polling: 200 },
    )

    // Click play button via UI
    await page.locator(S.playBtn).click()

    // Poll for playback debug with AudioContext actually running.
    // startAudioPlayback is now async and awaits ctx.resume() before source.start(),
    // so contextState MUST be 'running' when debug info is recorded.
    await page.waitForFunction(
      () => (window as any).__audioPlaybackDebug?.contextState === 'running',
      { timeout: 5_000, polling: 200 },
    )

    // Read pipeline state
    const debug = await page.evaluate(() => (window as any).__audioPlaybackDebug)
    const loadError = await page.evaluate(() => (window as any).__audioLoadError)

    // Verify pipeline conditions
    expect(debug, `Audio debug must exist. loadError=${JSON.stringify(loadError)}`).toBeTruthy()
    expect(debug.isLoaded, 'Audio buffers must be loaded').toBe(true)
    expect(debug.contextState, 'AudioContext MUST be running').toBe('running')
    expect(debug.activeSourceCount, 'Source nodes must be active').toBeGreaterThan(0)
    expect(debug.lastOffsetSeconds, 'Offset must be within buffer').toBeLessThan(debug.bufferDuration)
    // Local time should be ~0.5s (3500ms - 3000ms = 500ms)
    expect(debug.lastOffsetSeconds).toBeGreaterThanOrEqual(0.3)
    expect(debug.lastOffsetSeconds).toBeLessThanOrEqual(0.7)

    // DEFINITIVE PROOF: poll AnalyserNode for non-zero audio signal.
    // The test PCM is a 440Hz sine wave at 50% amplitude.
    // If audio is truly playing, the analyser MUST detect signal > 0.
    // Poll because the analyser needs time to accumulate samples after source.start().
    await page.waitForFunction(
      () => {
        const fn = (window as any).__getAudioSignalLevel
        return fn && fn() > 0
      },
      { timeout: 3_000, polling: 50 },
    )
    const signalLevel = await page.evaluate(() => (window as any).__getAudioSignalLevel())
    expect(signalLevel, 'AnalyserNode must detect non-zero audio signal (PROOF of actual audio output)').toBeGreaterThan(0)

    // Stop playback
    await page.locator(S.playBtn).click()
  })

  // ==================== Test 2: Split audio track row count ====================

  test('Split does not duplicate audio track rows', async ({ page }) => {
    // Count initial audio track rows (should be 2: system + mic)
    const audioRows = page.locator('.audio-track-row')
    await expect(audioRows).toHaveCount(2, { timeout: 5_000 })

    // Select the bundle clip via store (avoids playhead z-index interception)
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().selectClip('bundle-1', 'single')
    })
    await page.waitForTimeout(100)

    // Seek to midpoint of bundle clip (3000-6000ms)
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().seekTo(4500)
    })
    await page.waitForTimeout(100)

    // Execute split via store action.
    // We invoke splitAtPlayhead() directly because:
    // - Cmd+B menu accelerator is handled at the native Electron level, not DOM
    // - The playhead z-index overlay intercepts right-click on timeline clips
    // The test's intent is to verify audio track behavior AFTER split, not the split UI trigger.
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().splitAtPlayhead()
    })
    await page.waitForTimeout(300)

    // After split: should still have exactly 2 audio track rows
    await expect(audioRows).toHaveCount(2, { timeout: 5_000 })

    // But timeline clips should have increased (normal + 2 split halves = 3)
    await expect(page.locator(S.timelineClip)).toHaveCount(3, { timeout: 5_000 })
  })

  // ==================== Test 3: Split audio bar width sum ====================

  test('Split audio bar widths sum to pre-split width', async ({ page }) => {
    // Get pre-split audio bar width
    const audioBar = page.locator('.audio-track-bar').first()
    await expect(audioBar).toBeVisible({ timeout: 5_000 })
    const preSplitBox = await audioBar.boundingBox()
    expect(preSplitBox).not.toBeNull()
    const preSplitWidth = preSplitBox!.width

    // Select the bundle clip via store (avoids playhead z-index interception)
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().selectClip('bundle-1', 'single')
    })
    await page.waitForTimeout(100)

    // Seek to midpoint of bundle clip (3000-6000ms)
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().seekTo(4500)
    })
    await page.waitForTimeout(100)

    // Execute split via store action.
    // We invoke splitAtPlayhead() directly because:
    // - Cmd+B menu accelerator is handled at the native Electron level, not DOM
    // - The playhead z-index overlay intercepts right-click on timeline clips
    // The test's intent is to verify audio track bar widths AFTER split, not the split UI trigger.
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().splitAtPlayhead()
    })
    await page.waitForTimeout(300)

    // Verify split actually happened before checking widths
    await expect(page.locator(S.timelineClip)).toHaveCount(3, { timeout: 5_000 })

    // Get post-split audio bars in the first audio track row
    const firstRow = page.locator('.audio-track-row').first()
    const bars = firstRow.locator('.audio-track-bar')

    // In the grouped layout, the row should contain bars for each clip that has this track
    // The total visual width should equal the pre-split width
    const barCount = await bars.count()
    let totalWidth = 0
    for (let i = 0; i < barCount; i++) {
      const box = await bars.nth(i).boundingBox()
      if (box) totalWidth += box.width
    }

    // Allow ±2px tolerance for rounding
    expect(totalWidth).toBeGreaterThanOrEqual(preSplitWidth - 2)
    expect(totalWidth).toBeLessThanOrEqual(preSplitWidth + 2)
  })
})
