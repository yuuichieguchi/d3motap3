/**
 * E2E tests for Editor text overlay feature.
 *
 * Coverage:
 * - "+ Text" button disabled state when no clips exist
 * - Adding a text overlay directly via + Text button
 * - Selecting an overlay to show the text overlay editor panel
 * - Editing overlay text via the textarea and verifying label update
 * - Removing an overlay via the "Remove Overlay" button
 * - Deleting an overlay via right-click context menu
 * - Adjusting font size via the number input
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

test.describe('Editor text overlays', () => {
  test.beforeEach(async ({ page }) => {
    await closeLeftoverDialogs(page)
    await setupEditorWithClips(page, 2)
  })

  test.afterEach(async ({ page }) => {
    await cleanupEditor(page)
  })

  /** Helper: add a text overlay by clicking the + Text button (direct add, no dialog) */
  async function addTextOverlay(page: import('@playwright/test').Page) {
    const textBtn = page.locator(S.editorToolbar).locator('button').filter({ hasText: '+ Text' })
    await textBtn.click()
    await expect(page.locator(S.timelineOverlay)).toHaveCount(1, { timeout: 5000 })
  }

  // ==================== Disabled State ====================

  test('+ Text button is disabled when no clips exist', async ({ page }) => {
    // Clear all clips to simulate empty project
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.setState({
        project: { ...store.getState().project, clips: [], textOverlays: [] },
      })
    })
    await page.waitForTimeout(300)

    const textBtn = page.locator(S.editorToolbar).locator('button').filter({ hasText: '+ Text' })
    await expect(textBtn).toBeDisabled()
  })

  // ==================== Add Overlay ====================

  test('+ Text button adds a text overlay to the timeline', async ({ page }) => {
    // Click "+ Text" and add via preset dialog
    await addTextOverlay(page)

    // Verify overlay appears in the timeline
    await expect(page.locator(S.timelineOverlay)).toHaveCount(1, { timeout: 5_000 })
    await expect(page.locator(S.overlayTrack)).toBeVisible()
    await expect(page.locator(S.overlayTextLabel)).toHaveText('Text')
  })

  // ==================== Select Overlay ====================

  test('clicking an overlay selects it and shows the text overlay editor', async ({ page }) => {
    // Add an overlay first
    await addTextOverlay(page)
    await expect(page.locator(S.timelineOverlay)).toHaveCount(1, { timeout: 5_000 })

    // Click on the overlay to select it
    await page.locator(S.timelineOverlay).click()

    // Verify selection state
    await expect(page.locator(S.timelineOverlaySelected)).toHaveCount(1)

    // Verify the text overlay editor panel is visible
    await expect(page.locator(S.textOverlayEditor)).toBeVisible()
  })

  // ==================== Edit Text ====================

  test('editing text in the overlay editor updates the timeline label', async ({ page }) => {
    // Add an overlay and select it
    await addTextOverlay(page)
    await expect(page.locator(S.timelineOverlay)).toHaveCount(1, { timeout: 5_000 })
    await page.locator(S.timelineOverlay).click()
    await expect(page.locator(S.textOverlayEditor)).toBeVisible()

    // Find the textarea and update its content
    const textarea = page.locator(`${S.textOverlayEditor} textarea`)
    await textarea.click()
    await textarea.fill('Hello World')

    // Verify the overlay label in the timeline updated
    await expect(page.locator(S.overlayTextLabel)).toHaveText('Hello World')
  })

  // ==================== Remove Overlay ====================

  test('Remove Overlay button deletes the selected overlay', async ({ page }) => {
    // Add an overlay and select it
    await addTextOverlay(page)
    await expect(page.locator(S.timelineOverlay)).toHaveCount(1, { timeout: 5_000 })
    await page.locator(S.timelineOverlay).click()
    await expect(page.locator(S.textOverlayEditor)).toBeVisible()

    // Click "Remove Overlay" button
    const removeBtn = page.locator(`${S.textOverlayEditor} .toe-remove-btn`)
    await removeBtn.click()

    // Verify the overlay is removed
    await expect(page.locator(S.timelineOverlay)).toHaveCount(0, { timeout: 5_000 })

    // Verify the editor panel is no longer visible
    await expect(page.locator(S.textOverlayEditor)).not.toBeVisible()
  })

  // ==================== Context Menu Delete ====================

  test('right-click context menu Delete removes the overlay', async ({ page }) => {
    // Add an overlay
    await addTextOverlay(page)
    await expect(page.locator(S.timelineOverlay)).toHaveCount(1, { timeout: 5_000 })

    // Right-click on the overlay to open context menu
    await page.locator(S.timelineOverlay).click({ button: 'right' })
    await expect(page.locator('.timeline-context-menu')).toBeVisible()

    // Click the Delete menu item
    const deleteBtn = page.locator('.timeline-context-menu-item').filter({ hasText: 'Delete' })
    await deleteBtn.click()

    // Verify the overlay is removed
    await expect(page.locator(S.timelineOverlay)).toHaveCount(0, { timeout: 5_000 })

    // Verify the context menu is closed
    await expect(page.locator('.timeline-context-menu')).not.toBeVisible()
  })

  // ==================== Font Size Input ====================

  test('font size input changes the font size value', async ({ page }) => {
    // Add an overlay and select it
    await addTextOverlay(page)
    await page.locator(S.timelineOverlay).click()
    await expect(page.locator(S.textOverlayEditor)).toBeVisible()

    // Find the font size number input (first .toe-size-input; second may appear for animation duration)
    const fontSizeInput = page.locator(`${S.textOverlayEditor} .toe-size-input`).first()
    await fontSizeInput.fill('64')

    // Verify store has updated font size
    const fontSize = await page.evaluate(() => {
      const store = (window as any).__editorStore
      return store.getState().project.textOverlays[0].fontSize
    })
    expect(fontSize).toBe(64)
  })
})
