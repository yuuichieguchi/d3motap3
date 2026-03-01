/**
 * E2E tests for Editor Undo/Redo feature.
 *
 * Coverage:
 * - Cmd+Z undoes clip deletion (restores deleted clip)
 * - Cmd+Shift+Z redoes after undo (re-applies the deletion)
 * - Cmd+Z undoes clip split (merges split clips back into one)
 * - Cmd+Z on empty history does not crash
 * - Multiple consecutive undos restore original state
 *
 * The undo/redo system uses zundo temporal middleware on the zustand store.
 * - Keyboard: Cmd+Z = undo, Cmd+Shift+Z = redo
 * - Menu IPC: 'menu:edit-action' with 'undo' / 'redo' actions
 */

import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import { closeLeftoverDialogs, setupEditorWithClips, cleanupEditor } from '../helpers/test-utils'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Editor undo/redo', () => {
  test.beforeEach(async ({ page }) => {
    await closeLeftoverDialogs(page)
    await setupEditorWithClips(page, 2)
  })

  test.afterEach(async ({ page }) => {
    await cleanupEditor(page)
  })

  // ==================== Undo Clip Deletion ====================

  test('Cmd+Z undoes clip deletion', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Verify 2 clips exist initially
    await expect(clips).toHaveCount(2, { timeout: 5_000 })

    // Click first clip to select it
    await clips.nth(0).click()
    await expect(clips.nth(0)).toHaveClass(/selected/)

    // Press Backspace to delete the selected clip
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(300)

    // Verify 1 clip remains after deletion
    await expect(clips).toHaveCount(1, { timeout: 5_000 })

    // Press Cmd+Z to undo the deletion
    await page.keyboard.press('Meta+z')
    await page.waitForTimeout(300)

    // Verify 2 clips are restored
    await expect(clips).toHaveCount(2, { timeout: 5_000 })
  })

  // ==================== Redo After Undo ====================

  test('Cmd+Shift+Z redoes after undo', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Verify 2 clips exist initially
    await expect(clips).toHaveCount(2, { timeout: 5_000 })

    // Click first clip to select it, then delete
    await clips.nth(0).click()
    await expect(clips.nth(0)).toHaveClass(/selected/)
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(300)

    // Verify 1 clip remains
    await expect(clips).toHaveCount(1, { timeout: 5_000 })

    // Cmd+Z to undo — 2 clips restored
    await page.keyboard.press('Meta+z')
    await page.waitForTimeout(300)
    await expect(clips).toHaveCount(2, { timeout: 5_000 })

    // Cmd+Shift+Z to redo — 1 clip again
    await page.keyboard.press('Meta+Shift+z')
    await page.waitForTimeout(300)
    await expect(clips).toHaveCount(1, { timeout: 5_000 })
  })

  // ==================== Undo Clip Split ====================

  test('Cmd+Z undoes clip split', async ({ page }) => {
    // Clean up the 2-clip setup and re-setup with a single 6000ms clip
    await cleanupEditor(page)
    await setupEditorWithClips(page, [{ id: 'split-clip', duration: 6000 }])

    const clips = page.locator(S.timelineClip)

    // Verify 1 clip exists
    await expect(clips).toHaveCount(1, { timeout: 5_000 })

    // Click the clip to select it
    await clips.nth(0).click()
    await expect(clips.nth(0)).toHaveClass(/selected/)

    // Seek to 3000ms (middle of the 6000ms clip)
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().seekTo(3000)
    })
    await page.waitForTimeout(100)

    // Press Cmd+B to split at playhead
    await page.keyboard.press('Meta+b')
    await page.waitForTimeout(300)

    // Verify 2 clips after split
    await expect(clips).toHaveCount(2, { timeout: 5_000 })

    // Press Cmd+Z to undo the split
    await page.keyboard.press('Meta+z')
    await page.waitForTimeout(300)

    // Verify 1 clip is restored (split is undone)
    await expect(clips).toHaveCount(1, { timeout: 5_000 })
  })

  // ==================== Undo on Empty History ====================

  test('Cmd+Z on empty history does not crash', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Verify 2 clips exist initially
    await expect(clips).toHaveCount(2, { timeout: 5_000 })

    // Verify the temporal undo/redo API is available on the store
    const hasTemporal = await page.evaluate(() => {
      const store = (window as any).__editorStore
      return typeof store?.temporal?.getState === 'function'
    })
    expect(hasTemporal, 'Temporal middleware should be available on the store').toBe(true)

    // Press Cmd+Z without any prior operations — should be a no-op
    await page.keyboard.press('Meta+z')
    await page.waitForTimeout(300)

    // Verify 2 clips still exist — no crash, no change
    await expect(clips).toHaveCount(2, { timeout: 5_000 })
  })

  // ==================== Multiple Undo ====================

  test('Multiple undo restores original state', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Verify 2 clips exist initially
    await expect(clips).toHaveCount(2, { timeout: 5_000 })

    // Delete clip 0
    await clips.nth(0).click()
    await expect(clips.nth(0)).toHaveClass(/selected/)
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(300)
    await expect(clips).toHaveCount(1, { timeout: 5_000 })

    // Delete the remaining clip
    await clips.nth(0).click()
    await expect(clips.nth(0)).toHaveClass(/selected/)
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(300)
    await expect(clips).toHaveCount(0, { timeout: 5_000 })

    // First Cmd+Z — 1 clip restored
    await page.keyboard.press('Meta+z')
    await page.waitForTimeout(300)
    await expect(clips).toHaveCount(1, { timeout: 5_000 })

    // Second Cmd+Z — 2 clips restored (original state)
    await page.keyboard.press('Meta+z')
    await page.waitForTimeout(300)
    await expect(clips).toHaveCount(2, { timeout: 5_000 })
  })
})
