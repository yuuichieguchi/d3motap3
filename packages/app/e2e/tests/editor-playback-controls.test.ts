/**
 * E2E tests for editor playback controls visibility, interaction, and state.
 *
 * Coverage:
 * - Playback controls hidden when no clips exist
 * - Playback controls visible when clips are loaded
 * - Play/Pause toggle button behavior
 * - Time advances during playback
 * - Seek via store updates current time display
 * - Playback auto-stops at end of timeline
 * - Export button state and empty state display
 *
 * The playback controls (<div className="editor-playback">) are conditionally
 * rendered only when `totalDuration > 0` (i.e., at least one clip exists).
 * The play button toggles between "▶" (paused) and "⏸" (playing).
 * Playback interval advances by 33ms per tick (~30fps) and auto-stops at the end.
 */

import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import { closeLeftoverDialogs, setupEditorWithClips, resetEditorStore, cleanupEditor } from '../helpers/test-utils'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Editor playback controls', () => {
  test.beforeEach(async ({ page }) => {
    await closeLeftoverDialogs(page)

    // Navigate to Editor tab
    await page.locator('.header-tab').filter({ hasText: 'Editor' }).click()
    await page.waitForTimeout(300)

    // Reset store
    await resetEditorStore(page)
    await page.waitForTimeout(200)
  })

  test.afterEach(async ({ page }) => {
    await cleanupEditor(page)
  })

  // ==================== Visibility ====================

  test('playback controls are hidden when no clips exist', async ({
    page,
  }) => {
    // After reset, the store has no clips, so totalDuration === 0
    // and the .editor-playback div should NOT be rendered
    await expect(page.locator(S.editorPlayback)).toHaveCount(0)
  })

  test('playback controls are visible when clips are loaded', async ({
    page,
  }) => {
    await setupEditorWithClips(page, [{ id: 'clip-vis-1', duration: 3000 }])

    // Playback controls container should be visible
    await expect(page.locator(S.editorPlayback)).toBeVisible({ timeout: 5_000 })

    // Play button should be visible
    await expect(page.locator(S.playBtn)).toBeVisible()

    // Seek bar should be visible
    await expect(page.locator(S.seekBar)).toBeVisible()

    // Time display should be visible — first one shows current time "00:00"
    const timeDisplays = page.locator(S.timeDisplay)
    await expect(timeDisplays.first()).toBeVisible()
    await expect(timeDisplays.first()).toHaveText('00:00')
  })

  // ==================== Play/Pause Toggle ====================

  test('play/pause button toggles between play and pause states', async ({
    page,
  }) => {
    await setupEditorWithClips(page, [{ id: 'clip-toggle-1', duration: 5000 }])

    const playBtn = page.locator(S.playBtn)

    // Initial state: should show play icon "▶"
    await expect(playBtn).toHaveText('▶')

    // Click to start playback → should show pause icon "⏸"
    await playBtn.click()
    await expect(playBtn).toHaveText('⏸')

    // Click again to pause → should show play icon "▶"
    await playBtn.click()
    await expect(playBtn).toHaveText('▶')
  })

  // ==================== Time Advancement ====================

  test('time advances after pressing play', async ({ page }) => {
    await setupEditorWithClips(page, [{ id: 'clip-time-1', duration: 3000 }])

    const playBtn = page.locator(S.playBtn)
    const currentTimeDisplay = page.locator(S.timeDisplay).first()

    // Verify initial time is "00:00"
    await expect(currentTimeDisplay).toHaveText('00:00')

    // Start playback
    await playBtn.click()

    // Wait >1 second for the playback interval to advance time past 1000ms.
    // The formatTime function uses Math.floor(ms / 1000), so the display only
    // changes from "00:00" to "00:01" once currentTimeMs reaches 1000.
    // At 33ms per tick, 1200ms of wall-clock time yields ~1188ms of playback.
    await page.waitForTimeout(1200)

    // Current time display should no longer be "00:00"
    const timeText = await currentTimeDisplay.textContent()
    expect(
      timeText,
      'Time display should advance from 00:00 after playing for ~1.2s'
    ).not.toBe('00:00')

    // Stop playback to clean up
    await playBtn.click()
  })

  // ==================== Seek ====================

  test('seeking via store updates the time display', async ({ page }) => {
    await setupEditorWithClips(page, [{ id: 'clip-seek-1', duration: 5000 }])

    const currentTimeDisplay = page.locator(S.timeDisplay).first()

    // Verify initial time is "00:00"
    await expect(currentTimeDisplay).toHaveText('00:00')

    // Seek to 1500ms via store (same mechanism as handleSeek)
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().seekTo(1500)
    })

    // Wait for React re-render
    await page.waitForTimeout(200)

    // Time display should now show non-zero time
    const timeText = await currentTimeDisplay.textContent()
    expect(
      timeText,
      'Time display should reflect the seek position (1500ms = 00:01)'
    ).not.toBe('00:00')
  })

  // ==================== Auto-Stop ====================

  test('playback auto-stops at the end of the timeline', async ({ page }) => {
    // Use a short clip (500ms) so playback ends quickly
    await setupEditorWithClips(page, [
      { id: 'clip-autostop-1', duration: 500 },
    ])

    const playBtn = page.locator(S.playBtn)

    // Start playback
    await playBtn.click()
    await expect(playBtn).toHaveText('⏸')

    // Use condition-based wait instead of fixed timeout to avoid CI flakiness
    await expect(playBtn).toHaveText('▶', { timeout: 3_000 })

    // Verify store reflects stopped state
    const isPlaying = await page.evaluate(() => {
      return (window as any).__editorStore.getState().isPlaying
    })
    expect(isPlaying, 'Store isPlaying should be false after auto-stop').toBe(
      false
    )
  })

  // ==================== Export & Empty State ====================

  test('export button and empty state reflect clip presence', async ({
    page,
  }) => {
    // --- With clips loaded ---
    await setupEditorWithClips(page, [
      { id: 'clip-export-1', duration: 3000 },
    ])

    const exportBtn = page.locator(S.editorExportBtn)

    // Export button should be visible and enabled
    await expect(exportBtn).toBeVisible()
    await expect(exportBtn).toBeEnabled()

    // Empty state should NOT be visible
    await expect(page.locator(S.editorEmptyState)).not.toBeVisible()

    // --- After reset (no clips) ---
    await resetEditorStore(page)
    await page.waitForTimeout(300)

    // Empty state should be visible
    await expect(page.locator(S.editorEmptyState)).toBeVisible({ timeout: 5_000 })

    // Export button should be disabled
    await expect(exportBtn).toBeDisabled()
  })
})
