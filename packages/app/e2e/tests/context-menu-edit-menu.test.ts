/**
 * E2E tests for Context menu Copy/Cut/Paste/Split/Delete and Edit menu.
 *
 * Coverage:
 * - Context menu shows all expected items (Copy, Cut, Paste, Split at Playhead, Delete)
 * - Shortcut labels displayed on each menu item
 * - Copy + Paste inserts a duplicate clip
 * - Cut removes a clip, Paste re-inserts it
 * - Paste is disabled when clipboard is empty
 * - Split at Playhead splits the selected clip at playhead position
 * - Split at Playhead is disabled when playhead is not on selected clip
 * - Delete removes selected clip (preserving existing behaviour)
 * - Separators between menu groups
 *
 * These tests are expected to FAIL (TDD Red phase) because:
 * - The current context menu only has "Delete"
 * - Copy/Cut/Paste/Split actions do not exist in the store
 * - Shortcut labels and separators are not rendered
 */

import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import { closeLeftoverDialogs, setupEditorWithClips, cleanupEditor } from '../helpers/test-utils'

test.describe('Context menu - Copy/Cut/Paste/Split/Delete', () => {
  test.beforeEach(async ({ page }) => {
    await closeLeftoverDialogs(page)
    await setupEditorWithClips(page, 4)
  })

  test.afterEach(async ({ page }) => {
    await cleanupEditor(page)
  })

  // ==================== Menu Items Visibility ====================

  test('clip right-click menu shows Copy, Cut, Paste, Split at Playhead, Delete items', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Click clip 0 to select it
    await clips.nth(0).click()
    await expect(clips.nth(0)).toHaveClass(/selected/)

    // Right-click to open context menu
    await clips.nth(0).click({ button: 'right' })
    await expect(page.locator('.timeline-context-menu')).toBeVisible()

    const menuItems = page.locator('.timeline-context-menu-item')

    // Verify all 5 menu items exist
    await expect(menuItems).toHaveCount(5)

    // Verify each item by text
    await expect(menuItems.filter({ hasText: 'Copy' })).toBeVisible()
    await expect(menuItems.filter({ hasText: 'Cut' })).toBeVisible()
    await expect(menuItems.filter({ hasText: 'Paste' })).toBeVisible()
    await expect(menuItems.filter({ hasText: 'Split at Playhead' })).toBeVisible()
    await expect(menuItems.filter({ hasText: 'Delete' })).toBeVisible()

    // Verify shortcut labels are shown
    const shortcuts = page.locator('.context-menu-shortcut')
    await expect(shortcuts).toHaveCount(5)
    await expect(shortcuts.nth(0)).toHaveText('⌘C')
    await expect(shortcuts.nth(1)).toHaveText('⌘X')
    await expect(shortcuts.nth(2)).toHaveText('⌘V')
    await expect(shortcuts.nth(3)).toHaveText('⌘B')
    await expect(shortcuts.nth(4)).toHaveText('⌫')
  })

  // ==================== Copy + Paste ====================

  test('Copy then Paste inserts duplicate clip after selected clip', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Select clip 1, right-click → Copy
    await clips.nth(1).click()
    await expect(clips.nth(1)).toHaveClass(/selected/)
    await clips.nth(1).click({ button: 'right' })
    await expect(page.locator('.timeline-context-menu')).toBeVisible()

    const copyItem = page.locator('.timeline-context-menu-item').filter({ hasText: 'Copy' })
    await copyItem.click()

    // Context menu should close after clicking
    await expect(page.locator('.timeline-context-menu')).not.toBeVisible()

    // Select clip 2, right-click → Paste
    await clips.nth(2).click()
    await expect(clips.nth(2)).toHaveClass(/selected/)
    await clips.nth(2).click({ button: 'right' })
    await expect(page.locator('.timeline-context-menu')).toBeVisible()

    const pasteItem = page.locator('.timeline-context-menu-item').filter({ hasText: 'Paste' })
    await pasteItem.click()

    // Should have 5 clips total (4 original + 1 pasted)
    await expect(page.locator(S.timelineClip)).toHaveCount(5, { timeout: 5_000 })
  })

  // ==================== Cut + Paste ====================

  test('Cut removes clip and Paste inserts it', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Select clip 1, right-click → Cut
    await clips.nth(1).click()
    await expect(clips.nth(1)).toHaveClass(/selected/)
    await clips.nth(1).click({ button: 'right' })
    await expect(page.locator('.timeline-context-menu')).toBeVisible()

    const cutItem = page.locator('.timeline-context-menu-item').filter({ hasText: 'Cut' })
    await cutItem.click()

    // Should have 3 clips (clip 1 removed)
    await expect(page.locator(S.timelineClip)).toHaveCount(3, { timeout: 5_000 })

    // Select clip 0, right-click → Paste
    const remainingClips = page.locator(S.timelineClip)
    await remainingClips.nth(0).click()
    await expect(remainingClips.nth(0)).toHaveClass(/selected/)
    await remainingClips.nth(0).click({ button: 'right' })
    await expect(page.locator('.timeline-context-menu')).toBeVisible()

    const pasteItem = page.locator('.timeline-context-menu-item').filter({ hasText: 'Paste' })
    await pasteItem.click()

    // Should have 4 clips again (pasted after clip 0)
    await expect(page.locator(S.timelineClip)).toHaveCount(4, { timeout: 5_000 })
  })

  // ==================== Paste Disabled ====================

  test('Paste is disabled when clipboard is empty', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Right-click on clip 0 (nothing has been copied/cut yet)
    await clips.nth(0).click()
    await clips.nth(0).click({ button: 'right' })
    await expect(page.locator('.timeline-context-menu')).toBeVisible()

    // Paste menu item should be disabled
    const pasteItem = page.locator('.timeline-context-menu-item').filter({ hasText: 'Paste' })
    await expect(pasteItem).toBeVisible()
    await expect(pasteItem).toBeDisabled()
  })

  // ==================== Split at Playhead ====================

  test('Split at Playhead splits the selected clip at playhead position', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Select clip 0
    await clips.nth(0).click()
    await expect(clips.nth(0)).toHaveClass(/selected/)

    // Seek to 1500ms (middle of 3000ms clip)
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().seekTo(1500)
    })
    await page.waitForTimeout(100)

    // Right-click → Split at Playhead
    await clips.nth(0).click({ button: 'right' })
    await expect(page.locator('.timeline-context-menu')).toBeVisible()

    const splitItem = page.locator('.timeline-context-menu-item').filter({ hasText: 'Split at Playhead' })
    await expect(splitItem).toBeEnabled()
    await splitItem.click()

    // Should have 5 clips (4 original, clip 0 split into 2)
    await expect(page.locator(S.timelineClip)).toHaveCount(5, { timeout: 5_000 })
  })

  // ==================== Split Disabled ====================

  test('Split at Playhead is disabled when playhead is not on selected clip', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Select clip 0
    await clips.nth(0).click()
    await expect(clips.nth(0)).toHaveClass(/selected/)

    // Seek to a position on clip 2 (e.g., 7000ms — clip 0 is 0-3000ms, clip 1 is 3000-6000ms, clip 2 is 6000-9000ms)
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().seekTo(7000)
    })
    await page.waitForTimeout(100)

    // Right-click on clip 0
    await clips.nth(0).click({ button: 'right' })
    await expect(page.locator('.timeline-context-menu')).toBeVisible()

    // Split at Playhead should be disabled
    const splitItem = page.locator('.timeline-context-menu-item').filter({ hasText: 'Split at Playhead' })
    await expect(splitItem).toBeVisible()
    await expect(splitItem).toBeDisabled()
  })

  // ==================== Delete ====================

  test('Delete removes the selected clip', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Select clip 1, right-click → Delete
    await clips.nth(1).click()
    await expect(clips.nth(1)).toHaveClass(/selected/)
    await clips.nth(1).click({ button: 'right' })
    await expect(page.locator('.timeline-context-menu')).toBeVisible()

    const deleteItem = page.locator('.timeline-context-menu-item').filter({ hasText: 'Delete' })
    await expect(deleteItem).toBeVisible()

    // Delete item should have the danger class
    await expect(deleteItem).toHaveClass(/danger/)

    await deleteItem.click()

    // Should have 3 clips remaining
    await expect(page.locator(S.timelineClip)).toHaveCount(3, { timeout: 5_000 })

    // Context menu should be closed
    await expect(page.locator('.timeline-context-menu')).not.toBeVisible()
  })

  // ==================== Separators ====================

  test('context menu has separators between groups', async ({ page }) => {
    const clips = page.locator(S.timelineClip)

    // Right-click on clip 0
    await clips.nth(0).click()
    await clips.nth(0).click({ button: 'right' })
    await expect(page.locator('.timeline-context-menu')).toBeVisible()

    // Verify separators exist between groups:
    // Group 1: Copy, Cut, Paste
    // --- separator ---
    // Group 2: Split at Playhead
    // --- separator ---
    // Group 3: Delete
    const separators = page.locator('.context-menu-separator')
    await expect(separators).toHaveCount(2)
  })
})
