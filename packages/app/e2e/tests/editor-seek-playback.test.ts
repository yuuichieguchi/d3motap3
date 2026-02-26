/**
 * E2E test for seek-during-playback bug.
 *
 * Bug: When a video is playing and the user operates the seek bar,
 * the seek bar position updates but video.currentTime does NOT update.
 * Seeking works correctly when the video is paused.
 *
 * Root cause: In EditorView.tsx useEffect (line 31-51), the branches are:
 *   - clipChanged  → updates src + currentTime
 *   - !isPlaying   → updates currentTime (paused scrubbing)
 *   - (missing)    → same clip + playing + user seek → video.currentTime not updated
 *
 * This test MUST FAIL with the current code (Red phase).
 */

import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import type { Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a single mock clip for the editor store.
 * Duration is 3000ms so we have room to seek to 1500ms.
 */
function makeMockClip() {
  return [
    {
      id: 'seek-test-clip-0',
      sourcePath: '/tmp/seek-test-video.mp4',
      originalDuration: 3000,
      trimStart: 0,
      trimEnd: 0,
      order: 0,
    },
  ]
}

/**
 * Navigate to the Editor tab and populate the store with a single mock clip.
 */
async function setupEditorWithClip(page: Page): Promise<void> {
  await page.locator('.header-tab').filter({ hasText: 'Editor' }).click()
  await page.waitForTimeout(300)

  const clips = makeMockClip()
  await page.evaluate((clipData) => {
    const store = (window as any).__editorStore
    if (!store) throw new Error('__editorStore not exposed on window')
    store.setState({
      project: {
        ...store.getState().project,
        clips: clipData,
      },
      selectedClipIds: [],
      lastSelectedClipId: null,
      currentTimeMs: 0,
      isPlaying: false,
    })
  }, clips)

  // Wait for timeline clip and playback controls to render
  await expect(page.locator(S.timelineClip)).toHaveCount(1, { timeout: 5_000 })
  await expect(page.locator(S.playBtn)).toBeVisible({ timeout: 5_000 })
  await expect(page.locator(S.seekBar)).toBeVisible({ timeout: 5_000 })
}

/**
 * Reset the editor store and ensure playback is stopped.
 */
async function cleanupEditor(page: Page): Promise<void> {
  // Stop playback first (in case test left it playing)
  await page.evaluate(() => {
    const store = (window as any).__editorStore
    if (store) {
      store.getState().setPlaying(false)
    }
  })
  await page.waitForTimeout(100)

  await page.evaluate(() => {
    const store = (window as any).__editorStore
    if (store) store.getState().reset()
  })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Editor seek during playback', () => {
  test.beforeEach(async ({ page }) => {
    // Close any leftover dialogs from previous tests (shared Electron instance)
    const closeBtn = page.locator(S.dialogCloseBtn)
    if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await closeBtn.click()
      await page.locator(S.dialogOverlay).waitFor({ state: 'hidden' })
    }

    await setupEditorWithClip(page)
  })

  test.afterEach(async ({ page }) => {
    await cleanupEditor(page)
  })

  test('seek bar change during playback updates video.currentTime', async ({ page }) => {
    const video = page.locator(S.editorVideo)
    const seekBar = page.locator(S.seekBar)
    const playBtn = page.locator(S.playBtn)

    // Step 1: Verify initial state — video.currentTime should be 0
    const initialTime = await video.evaluate(
      (el: HTMLVideoElement) => el.currentTime
    )
    expect(initialTime).toBe(0)

    // Step 2: Start playback by clicking the play button
    await playBtn.click()

    // Verify store reflects playing state
    const isPlaying = await page.evaluate(() => {
      return (window as any).__editorStore.getState().isPlaying
    })
    expect(isPlaying).toBe(true)

    // Step 3: Wait briefly for the playback interval to tick a few times
    await page.waitForTimeout(200)

    // Step 4: Simulate a user seek to 1500ms while playing.
    //
    // We call store.setCurrentTime(1500) directly, which is exactly what
    // handleSeek does when the user operates the seek bar (<input type="range">
    // onChange -> store.setCurrentTime(Number(e.target.value))).
    //
    // Using store.setCurrentTime rather than native DOM events because React
    // controlled inputs ignore native dispatchEvent — React's onChange only fires
    // through React's internal input value tracker, not raw DOM events.
    // The code under test is the useEffect that reacts to currentTimeMs changes,
    // so calling the store method is the accurate simulation.
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().seekTo(1500)
    })

    // Step 5: Wait for the useEffect to process the currentTimeMs change.
    // The playback interval ticks every ~33ms and will advance currentTimeMs,
    // but it reads from the store each tick, so after our setCurrentTime(1500),
    // subsequent ticks will produce 1533, 1566, etc. We wait 150ms to let the
    // useEffect run but the value should still be near 1500.
    await page.waitForTimeout(150)

    // Step 6: Verify store state — currentTimeMs should be in the 1500+ range
    // (The playback interval advances by ~33ms per tick, so after ~150ms it may
    // have advanced by ~150ms from 1500 to ~1650)
    const storeTimeMs = await page.evaluate(() => {
      return (window as any).__editorStore.getState().currentTimeMs
    })
    expect(
      storeTimeMs,
      `Store currentTimeMs should be near 1500+ after seek, but got ${storeTimeMs}`
    ).toBeGreaterThanOrEqual(1400)
    expect(storeTimeMs).toBeLessThanOrEqual(1800)

    // Step 7: THE CRITICAL ASSERTION — video.currentTime must reflect the seek
    //
    // With the current buggy code, video.currentTime will NOT be updated because:
    //   - clipChanged is false (same clip)
    //   - isPlaying is true (so the `else if (!isPlaying)` branch is skipped)
    //   - No third branch exists to handle "playing + user seek"
    //
    // Expected: ~1.5 seconds (1500ms / 1000)
    // Actual (buggy): stays near 0 (or wherever it was before the seek)
    const videoCurrentTime = await video.evaluate(
      (el: HTMLVideoElement) => el.currentTime
    )
    expect(
      videoCurrentTime,
      `video.currentTime should be ~1.5s after seeking to 1500ms during playback, ` +
      `but got ${videoCurrentTime}s. This confirms the bug: seek during playback ` +
      `does not update video.currentTime.`
    ).toBeGreaterThanOrEqual(1.3)
    expect(videoCurrentTime).toBeLessThanOrEqual(1.7)
  })
})
