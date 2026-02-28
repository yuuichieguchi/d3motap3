/**
 * E2E tests for Editor clip split feature via timeline context menu.
 *
 * Coverage:
 * - "Split at Playhead" is disabled when playhead is at clip boundary
 * - Split creates two clips from one at the playhead position
 * - Split produces proportional clip widths matching the split point
 *
 * The split operation (store.splitAtPlayhead) divides a clip at currentTimeMs:
 *   - clip1: trimEnd adjusted to cut at the split point
 *   - clip2: trimStart adjusted to start from the split point
 *
 * The context menu is opened by right-clicking a `.timeline-clip` element.
 * The "Split at Playhead" menu item is enabled only when `canSplit()` is true
 * (i.e., a clip is selected AND the playhead is strictly within the clip).
 *
 * Test setup uses `window.__editorStore` (zustand) for state population,
 * then interacts via real UI clicks for the actual split operation.
 */

import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import { closeLeftoverDialogs, setupEditorWithClips, cleanupEditor } from '../helpers/test-utils'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPLIT_MENU_ITEM = '.timeline-context-menu-item'

/** Locate the "Split at Playhead" item inside the context menu. */
function splitMenuItem(page: import('@playwright/test').Page) {
  return page.locator(SPLIT_MENU_ITEM).filter({ hasText: 'Split at Playhead' })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Editor clip split', () => {
  test.beforeEach(async ({ page }) => {
    await closeLeftoverDialogs(page)

    await setupEditorWithClips(page, [{ id: 'test-clip-0', duration: 6000 }])
  })

  test.afterEach(async ({ page }) => {
    await cleanupEditor(page)
  })

  // ==================== Split Disabled at Boundary ====================

  test('Split at Playhead is disabled when playhead is at clip boundary', async ({
    page,
  }) => {
    const clips = page.locator(S.timelineClip)

    // After setup, playhead is at 0 (clip start boundary).
    // Right-click the clip to open the context menu — this also selects the clip.
    await clips.nth(0).click({ button: 'right' })

    // Wait for context menu to appear
    const menuItem = splitMenuItem(page)
    await expect(menuItem).toBeVisible({ timeout: 3_000 })

    // canSplit() returns false because currentTimeMs (0) is not strictly within the clip
    await expect(menuItem).toBeDisabled()

    // Close the context menu
    await page.keyboard.press('Escape')
    await expect(menuItem).not.toBeVisible()
  })

  // ==================== Split Creates Two Clips ====================

  test('Split at midpoint creates two clips from one', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Click the clip to select it
    await clips.nth(0).click()
    await expect(clips.nth(0)).toHaveClass(/selected/)

    // Seek to middle of the 6000ms clip (3000ms)
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().seekTo(3000)
    })
    await page.waitForTimeout(100)

    // Right-click at the clip's left edge to avoid playhead overlay at the seek position.
    // After seekTo(3000), the playhead sits at 50% of the clip width and intercepts
    // pointer events, so we click at x=10 (left edge) which is always clear.
    const box2 = await clips.nth(0).boundingBox()
    await clips.nth(0).click({ button: 'right', position: { x: 10, y: box2!.height / 2 } })

    // "Split at Playhead" should be enabled
    const menuItem = splitMenuItem(page)
    await expect(menuItem).toBeVisible({ timeout: 3_000 })
    await expect(menuItem).toBeEnabled()

    // Click "Split at Playhead"
    await menuItem.click()

    // Two clips should exist after the split
    await expect(page.locator(S.timelineClip)).toHaveCount(2, {
      timeout: 5_000,
    })
  })

  // ==================== Split Proportional Widths ====================

  test('Split at 1/3 produces proportional clip widths', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Click the clip to select it
    await clips.nth(0).click()
    await expect(clips.nth(0)).toHaveClass(/selected/)

    // Seek to 2000ms (1/3 of 6000ms)
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().seekTo(2000)
    })
    await page.waitForTimeout(100)

    // Right-click at the clip's left edge to avoid playhead overlay at the seek position
    const box3 = await clips.nth(0).boundingBox()
    await clips.nth(0).click({ button: 'right', position: { x: 10, y: box3!.height / 2 } })
    const menuItem = splitMenuItem(page)
    await expect(menuItem).toBeVisible({ timeout: 3_000 })
    await menuItem.click()

    // Wait for two clips to render
    await expect(page.locator(S.timelineClip)).toHaveCount(2, {
      timeout: 5_000,
    })

    // Get bounding boxes for both clips
    const clip1Box = await page.locator(S.timelineClip).nth(0).boundingBox()
    const clip2Box = await page.locator(S.timelineClip).nth(1).boundingBox()
    expect(clip1Box).not.toBeNull()
    expect(clip2Box).not.toBeNull()

    // Total track width = sum of both clips
    const totalWidth = clip1Box!.width + clip2Box!.width

    // First clip should be ~33% of total width (2000/6000)
    const clip1Ratio = clip1Box!.width / totalWidth
    expect(
      clip1Ratio,
      `First clip width ratio should be ~0.33 (±0.10), got ${clip1Ratio.toFixed(3)}`
    ).toBeGreaterThanOrEqual(0.23)
    expect(clip1Ratio).toBeLessThanOrEqual(0.43)

    // Second clip should be ~67% of total width (4000/6000)
    const clip2Ratio = clip2Box!.width / totalWidth
    expect(
      clip2Ratio,
      `Second clip width ratio should be ~0.67 (±0.10), got ${clip2Ratio.toFixed(3)}`
    ).toBeGreaterThanOrEqual(0.57)
    expect(clip2Ratio).toBeLessThanOrEqual(0.77)
  })
})
