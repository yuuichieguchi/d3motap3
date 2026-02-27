/**
 * E2E tests for Editor clip split feature.
 *
 * Coverage:
 * - Split button disabled when no clip is selected
 * - Split creates two clips from one at the playhead position
 * - Split produces proportional clip widths matching the split point
 *
 * The split operation (store.splitClip) divides a clip at a given time:
 *   - clip1: trimEnd adjusted to cut at the split point
 *   - clip2: trimStart adjusted to start from the split point
 *
 * Test setup uses `window.__editorStore` (zustand) for state population,
 * then interacts via real UI clicks for the actual split operation.
 */

import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import { closeLeftoverDialogs, setupEditorWithClips, cleanupEditor } from '../helpers/test-utils'

// ---------------------------------------------------------------------------
// Helpers — shared via ../helpers/test-utils
// ---------------------------------------------------------------------------

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

  // ==================== Split Button State ====================

  test('Split button is disabled when no clip is selected', async ({
    page,
  }) => {
    const splitBtn = page
      .locator(S.editorToolbar)
      .locator('button')
      .filter({ hasText: 'Split' })

    // No clip is selected after setup — Split should be disabled
    await expect(splitBtn).toBeDisabled()
  })

  // ==================== Split Creates Two Clips ====================

  test('Split at midpoint creates two clips from one', async ({ page }) => {
    const clips = page.locator(S.timelineClip)
    const splitBtn = page
      .locator(S.editorToolbar)
      .locator('button')
      .filter({ hasText: 'Split' })

    // Click the clip to select it
    await clips.nth(0).click()
    await expect(clips.nth(0)).toHaveClass(/selected/)

    // Seek to middle of the 6000ms clip (3000ms)
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().seekTo(3000)
    })
    await page.waitForTimeout(100)

    // Split button should now be enabled
    await expect(splitBtn).toBeEnabled()

    // Click Split
    await splitBtn.click()

    // Two clips should exist after the split
    await expect(page.locator(S.timelineClip)).toHaveCount(2, {
      timeout: 5_000,
    })
  })

  // ==================== Split Proportional Widths ====================

  test('Split at 1/3 produces proportional clip widths', async ({ page }) => {
    const clips = page.locator(S.timelineClip)
    const splitBtn = page
      .locator(S.editorToolbar)
      .locator('button')
      .filter({ hasText: 'Split' })

    // Click the clip to select it
    await clips.nth(0).click()
    await expect(clips.nth(0)).toHaveClass(/selected/)

    // Seek to 2000ms (1/3 of 6000ms)
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().seekTo(2000)
    })
    await page.waitForTimeout(100)

    // Click Split
    await splitBtn.click()

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
