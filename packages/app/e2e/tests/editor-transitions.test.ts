/**
 * E2E tests for Editor transition indicators between timeline clips.
 *
 * Coverage:
 * - Transition indicators render between clips (not after the last clip)
 * - Click on indicator adds a fade transition
 * - Consecutive clicks cycle through transition types: fade → dissolve → wipe_left → wipe_right → fade
 * - No transition indicator on the last clip's wrapper
 *
 * Test setup:
 * The store is exposed on `window.__editorStore` (zustand store with getState/setState).
 * We populate mock clips via setState for preconditions, then interact via real UI clicks.
 */

import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import { closeLeftoverDialogs, setupEditorWithClips, cleanupEditor } from '../helpers/test-utils'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Editor transitions', () => {
  test.beforeEach(async ({ page }) => {
    await closeLeftoverDialogs(page)
    await setupEditorWithClips(page, 3)
  })

  test.afterEach(async ({ page }) => {
    await cleanupEditor(page)
  })

  // ==================== Indicator Rendering ====================

  test('transition indicators appear between clips but not after the last', async ({ page }) => {
    // 3 clips → 2 transition indicators (between clip 0-1 and clip 1-2)
    const indicators = page.locator(S.transitionIndicator)
    await expect(indicators).toHaveCount(2, { timeout: 5_000 })

    // Each indicator should show "+" (no transition set yet)
    await expect(indicators.nth(0)).toHaveText('+')
    await expect(indicators.nth(1)).toHaveText('+')
  })

  // ==================== First Click Adds Fade ====================

  test('clicking an indicator adds a fade transition', async ({ page }) => {
    const indicators = page.locator(S.transitionIndicator)
    const firstIndicator = indicators.nth(0)

    // Before click: no has-transition class, text is "+"
    await expect(firstIndicator).not.toHaveClass(/has-transition/)
    await expect(firstIndicator).toHaveText('+')

    // Click to add fade transition
    await firstIndicator.click()

    // After click: has-transition class, text is "F" (first char of "fade")
    await expect(firstIndicator).toHaveClass(/has-transition/)
    await expect(firstIndicator).toHaveText('F')
  })

  // ==================== Cycle Through Transition Types ====================

  test('consecutive clicks cycle through transition types', async ({ page }) => {
    const firstIndicator = page.locator(S.transitionIndicator).nth(0)

    // Click 1: fade → "F"
    await firstIndicator.click()
    await expect(firstIndicator).toHaveText('F')
    await expect(firstIndicator).toHaveClass(/has-transition/)

    // Click 2: dissolve → "D"
    await firstIndicator.click()
    await expect(firstIndicator).toHaveText('D')

    // Click 3: wipe_left → "W"
    await firstIndicator.click()
    await expect(firstIndicator).toHaveText('W')

    // Verify store has wipe_left (UI shows "W" for both wipe types)
    let transType = await page.evaluate(() => {
      const store = (window as any).__editorStore
      const clip = store.getState().project.clips.find((c: any) => c.id === 'test-clip-0')
      return clip?.transition?.type
    })
    expect(transType).toBe('wipe_left')

    // Click 4: wipe_right → "W" (still "W" since wipe_right also starts with "W")
    await firstIndicator.click()
    await expect(firstIndicator).toHaveText('W')

    // Verify store has wipe_right (UI also shows "W")
    transType = await page.evaluate(() => {
      const store = (window as any).__editorStore
      const clip = store.getState().project.clips.find((c: any) => c.id === 'test-clip-0')
      return clip?.transition?.type
    })
    expect(transType).toBe('wipe_right')

    // Click 5: cycles back to fade → "F"
    await firstIndicator.click()
    await expect(firstIndicator).toHaveText('F')
  })

  // ==================== No Indicator on Last Clip ====================

  test('last clip wrapper does not contain a transition indicator', async ({ page }) => {
    // 3 clips → 3 wrappers
    const wrappers = page.locator('.timeline-clip-wrapper')
    await expect(wrappers).toHaveCount(3, { timeout: 5_000 })

    // The last wrapper should NOT contain a .transition-indicator
    const lastWrapper = wrappers.nth(2)
    const indicatorInLastWrapper = lastWrapper.locator(S.transitionIndicator)
    await expect(indicatorInLastWrapper).toHaveCount(0)
  })
})
