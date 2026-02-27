/**
 * E2E tests for tab navigation between Recording and Editor views.
 *
 * Coverage:
 * - Recording tab shows recording section and hides editor view
 * - Clicking Editor tab switches to Editor view
 * - Clicking Recording tab returns to Recording view from Editor
 *
 * The app header contains two tabs (Recording / Editor) implemented as
 * <button className="header-tab active?"> elements. Clicking a tab sets
 * `currentView` state, which conditionally renders `.recording-section`
 * or `.editor-view`.
 */

import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import { closeLeftoverDialogs } from '../helpers/test-utils'

test.describe('Tab navigation', () => {
  test.beforeEach(async ({ page }) => {
    await closeLeftoverDialogs(page)
    // Reset editor store
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      if (store) store.getState().reset()
    })
    // Ensure on Recording tab
    await page.locator('.header-tab').filter({ hasText: 'Recording' }).click()
    await page.waitForTimeout(300)
  })

  test('Recording tab shows recording section and hides editor view', async ({ page }) => {
    const recordingTab = page.locator('.header-tab').filter({ hasText: 'Recording' })
    const editorTab = page.locator('.header-tab').filter({ hasText: 'Editor' })

    // Recording tab should have the active class
    await expect(recordingTab).toHaveClass(/active/)

    // Editor tab should NOT have the active class
    await expect(editorTab).not.toHaveClass(/active/)

    // Recording section should be visible
    await expect(page.locator(S.recordingSection)).toBeVisible()

    // Editor view should NOT be visible
    await expect(page.locator(S.editorView)).not.toBeVisible()
  })

  test('clicking Editor tab switches to Editor view', async ({ page }) => {
    const recordingTab = page.locator('.header-tab').filter({ hasText: 'Recording' })
    const editorTab = page.locator('.header-tab').filter({ hasText: 'Editor' })

    // Click the Editor tab
    await editorTab.click()
    await page.waitForTimeout(300)

    // Editor tab should now have the active class
    await expect(editorTab).toHaveClass(/active/)

    // Recording tab should NOT have the active class
    await expect(recordingTab).not.toHaveClass(/active/)

    // Editor view should be visible
    await expect(page.locator(S.editorView)).toBeVisible()

    // Recording section should NOT be visible
    await expect(page.locator(S.recordingSection)).not.toBeVisible()
  })

  test('clicking Recording tab returns from Editor to Recording view', async ({ page }) => {
    const recordingTab = page.locator('.header-tab').filter({ hasText: 'Recording' })
    const editorTab = page.locator('.header-tab').filter({ hasText: 'Editor' })

    // First navigate to Editor tab
    await editorTab.click()
    await page.waitForTimeout(300)

    // Verify we are on Editor view
    await expect(page.locator(S.editorView)).toBeVisible()
    await expect(page.locator(S.recordingSection)).not.toBeVisible()

    // Click Recording tab to return
    await recordingTab.click()
    await page.waitForTimeout(300)

    // Recording tab should have the active class
    await expect(recordingTab).toHaveClass(/active/)

    // Editor tab should NOT have the active class
    await expect(editorTab).not.toHaveClass(/active/)

    // Recording section should be visible
    await expect(page.locator(S.recordingSection)).toBeVisible()

    // Editor view should NOT be visible
    await expect(page.locator(S.editorView)).not.toBeVisible()
  })
})