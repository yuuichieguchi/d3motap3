/**
 * E2E tests for Timeline clip multi-select feature.
 *
 * Coverage:
 * - Normal click: single-select (deselect others)
 * - Cmd+Click: toggle selection (add/remove individual clips)
 * - Shift+Click: range select from anchor to target
 * - Right-click on non-selected clip: single-select + context menu
 * - Right-click on selected clip: preserve selection + context menu with count
 * - Context menu delete: batch-delete all selected clips
 *
 * Test setup:
 * The store is exposed on `window.__editorStore` (zustand store with getState/setState).
 * We populate mock clips via setState for preconditions, then interact via real UI clicks.
 */

import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import type { Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create mock clip data for populating the store.
 * Each clip has a 3-second duration and sequential ordering.
 */
function makeMockClips(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `test-clip-${i}`,
    sourcePath: `/tmp/test-video-${i}.mp4`,
    originalDuration: 3000,
    trimStart: 0,
    trimEnd: 0,
    order: i,
  }))
}

/**
 * Navigate to the Editor tab and populate the store with mock clips.
 * Uses `window.__editorStore` (zustand store) to set state directly.
 * This is acceptable for test SETUP — actual tests interact via the UI.
 */
async function setupEditorWithClips(page: Page, count: number = 4): Promise<void> {
  // Navigate to Editor tab
  await page.locator('.header-tab').filter({ hasText: 'Editor' }).click()
  await page.waitForTimeout(300)

  // Populate store with mock clips via exposed zustand store
  const clips = makeMockClips(count)
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
    })
  }, clips)

  // Wait for timeline clips to render
  await expect(page.locator(S.timelineClip)).toHaveCount(count, { timeout: 5_000 })
}

/**
 * Clean up: reset the editor store and navigate back to Recording tab.
 */
async function cleanupEditor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as any).__editorStore
    if (store) store.getState().reset()
  })
  // Close any open context menus by pressing Escape
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
}

/**
 * Get the IDs of all currently selected clips from the DOM.
 */
async function getSelectedClipIndices(page: Page): Promise<number[]> {
  const allClips = page.locator(S.timelineClip)
  const count = await allClips.count()
  const selectedIndices: number[] = []
  for (let i = 0; i < count; i++) {
    const classList = await allClips.nth(i).getAttribute('class')
    if (classList && classList.includes('selected')) {
      selectedIndices.push(i)
    }
  }
  return selectedIndices
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Timeline multi-select', () => {
  test.beforeEach(async ({ page }) => {
    // Close any leftover dialogs from previous tests
    const closeBtn = page.locator(S.dialogCloseBtn)
    if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await closeBtn.click()
      await page.locator(S.dialogOverlay).waitFor({ state: 'hidden' })
    }

    await setupEditorWithClips(page, 4)
  })

  test.afterEach(async ({ page }) => {
    await cleanupEditor(page)
  })

  // ==================== Normal Click ====================

  test('normal click selects single clip and deselects others', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Click clip 0
    await clips.nth(0).click()
    await expect(clips.nth(0)).toHaveClass(/selected/)
    let selected = await getSelectedClipIndices(page)
    expect(selected).toEqual([0])

    // Click clip 2 — clip 0 should be deselected
    await clips.nth(2).click()
    await expect(clips.nth(2)).toHaveClass(/selected/)
    await expect(clips.nth(0)).not.toHaveClass(/selected/)
    selected = await getSelectedClipIndices(page)
    expect(selected).toEqual([2])

    // Click clip 3 — only clip 3 should be selected
    await clips.nth(3).click()
    selected = await getSelectedClipIndices(page)
    expect(selected).toEqual([3])
  })

  // ==================== Cmd+Click (Toggle) ====================

  test('Cmd+Click toggles clip selection without affecting others', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Click clip 0 to start
    await clips.nth(0).click()
    await expect(clips.nth(0)).toHaveClass(/selected/)

    // Cmd+Click clip 2 — both 0 and 2 should be selected
    await clips.nth(2).click({ modifiers: ['Meta'] })
    await expect(clips.nth(0)).toHaveClass(/selected/)
    await expect(clips.nth(2)).toHaveClass(/selected/)
    let selected = await getSelectedClipIndices(page)
    expect(selected).toEqual([0, 2])

    // Cmd+Click clip 1 — 0, 1, 2 should be selected
    await clips.nth(1).click({ modifiers: ['Meta'] })
    selected = await getSelectedClipIndices(page)
    expect(selected).toEqual([0, 1, 2])

    // Cmd+Click clip 0 again — should deselect clip 0, leaving 1 and 2
    await clips.nth(0).click({ modifiers: ['Meta'] })
    await expect(clips.nth(0)).not.toHaveClass(/selected/)
    selected = await getSelectedClipIndices(page)
    expect(selected).toEqual([1, 2])
  })

  test('Cmd+Click deselecting the last selected clip clears all selection', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Click clip 1 to select it
    await clips.nth(1).click()
    await expect(clips.nth(1)).toHaveClass(/selected/)

    // Cmd+Click clip 1 to deselect it — no clips selected
    await clips.nth(1).click({ modifiers: ['Meta'] })
    await expect(clips.nth(1)).not.toHaveClass(/selected/)
    const selected = await getSelectedClipIndices(page)
    expect(selected).toEqual([])
  })

  // ==================== Shift+Click (Range) ====================

  test('Shift+Click selects range between anchor and target', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Click clip 0 to set anchor
    await clips.nth(0).click()
    await expect(clips.nth(0)).toHaveClass(/selected/)

    // Shift+Click clip 3 — should select range [0, 1, 2, 3]
    await clips.nth(3).click({ modifiers: ['Shift'] })
    const selected = await getSelectedClipIndices(page)
    expect(selected).toEqual([0, 1, 2, 3])
  })

  test('consecutive Shift+Click updates range with fixed anchor', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Click clip 1 to set anchor
    await clips.nth(1).click()

    // Shift+Click clip 3 — should select range [1, 2, 3]
    await clips.nth(3).click({ modifiers: ['Shift'] })
    let selected = await getSelectedClipIndices(page)
    expect(selected).toEqual([1, 2, 3])

    // Shift+Click clip 0 — anchor stays at 1, range updates to [0, 1]
    await clips.nth(0).click({ modifiers: ['Shift'] })
    selected = await getSelectedClipIndices(page)
    expect(selected).toEqual([0, 1])
  })

  test('Shift+Click backward selects range from higher to lower index', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Click clip 3 to set anchor
    await clips.nth(3).click()

    // Shift+Click clip 1 — should select [1, 2, 3]
    await clips.nth(1).click({ modifiers: ['Shift'] })
    const selected = await getSelectedClipIndices(page)
    expect(selected).toEqual([1, 2, 3])
  })

  // ==================== Right-Click (Context Menu) ====================

  test('right-click on non-selected clip single-selects it and shows context menu', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // First select clip 0
    await clips.nth(0).click()
    await expect(clips.nth(0)).toHaveClass(/selected/)

    // Right-click on clip 2 (not selected)
    await clips.nth(2).click({ button: 'right' })

    // Clip 2 should now be the only selected clip
    await expect(clips.nth(2)).toHaveClass(/selected/)
    await expect(clips.nth(0)).not.toHaveClass(/selected/)
    const selected = await getSelectedClipIndices(page)
    expect(selected).toEqual([2])

    // Context menu should be visible
    await expect(page.locator('.timeline-context-menu')).toBeVisible()
  })

  test('right-click on already-selected clip preserves multi-selection', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Multi-select clips 0 and 2
    await clips.nth(0).click()
    await clips.nth(2).click({ modifiers: ['Meta'] })
    let selected = await getSelectedClipIndices(page)
    expect(selected).toEqual([0, 2])

    // Right-click on clip 0 (already selected) — should keep both selected
    await clips.nth(0).click({ button: 'right' })
    selected = await getSelectedClipIndices(page)
    expect(selected).toEqual([0, 2])

    // Context menu should be visible
    await expect(page.locator('.timeline-context-menu')).toBeVisible()
  })

  test('context menu shows selected count for multiple selected clips', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Select clips 0, 1, 2 via Cmd+Click
    await clips.nth(0).click()
    await clips.nth(1).click({ modifiers: ['Meta'] })
    await clips.nth(2).click({ modifiers: ['Meta'] })

    // Right-click on clip 1 (already selected)
    await clips.nth(1).click({ button: 'right' })
    await expect(page.locator('.timeline-context-menu')).toBeVisible()

    // Context menu delete button should show count "(3 selected)"
    const deleteBtn = page.locator('.timeline-context-menu-item').filter({ hasText: 'Delete' })
    await expect(deleteBtn).toBeVisible()
    await expect(deleteBtn).toContainText('3')
  })

  // ==================== Context Menu Delete (Batch) ====================

  test('context menu delete removes all selected clips', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Select clips 0, 1, 2 via Cmd+Click
    await clips.nth(0).click()
    await clips.nth(1).click({ modifiers: ['Meta'] })
    await clips.nth(2).click({ modifiers: ['Meta'] })
    let selected = await getSelectedClipIndices(page)
    expect(selected).toEqual([0, 1, 2])

    // Right-click on clip 1 (already selected) to open context menu
    await clips.nth(1).click({ button: 'right' })
    await expect(page.locator('.timeline-context-menu')).toBeVisible()

    // Click the Delete menu item
    const deleteBtn = page.locator('.timeline-context-menu-item').filter({ hasText: 'Delete' })
    await deleteBtn.click()

    // Only clip 3 should remain
    await expect(page.locator(S.timelineClip)).toHaveCount(1, { timeout: 5_000 })

    // Context menu should be closed
    await expect(page.locator('.timeline-context-menu')).not.toBeVisible()
  })

  test('context menu delete on single-selected clip removes only that clip', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Click clip 1 to select only it
    await clips.nth(1).click()

    // Right-click to open context menu
    await clips.nth(1).click({ button: 'right' })
    await expect(page.locator('.timeline-context-menu')).toBeVisible()

    // Click Delete
    const deleteBtn = page.locator('.timeline-context-menu-item').filter({ hasText: 'Delete' })
    await deleteBtn.click()

    // 3 clips should remain (clip 1 was removed)
    await expect(page.locator(S.timelineClip)).toHaveCount(3, { timeout: 5_000 })
  })
})
