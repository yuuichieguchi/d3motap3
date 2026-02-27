/**
 * E2E tests for Source management feature.
 *
 * Coverage:
 * - Empty state message display
 * - Add Source dialog with source type options
 * - Adding Display and Terminal sources via UI
 * - Source removal returning to empty state
 * - MAX_SOURCES (2) limit disabling Add button
 * - Dialog cancel adds no sources
 */

import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import { closeLeftoverDialogs, addDisplaySource, addTerminalSource, removeAllSources } from '../helpers/test-utils'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Source management', () => {
  test.beforeEach(async ({ page }) => {
    // Close any leftover dialogs from previous tests (shared Electron instance)
    await closeLeftoverDialogs(page)

    // Navigate to Recording tab
    await page.locator('.header-tab').filter({ hasText: 'Recording' }).click()
    await page.waitForTimeout(300)

    // Remove all existing sources
    await removeAllSources(page)
  })

  test.afterEach(async ({ page }) => {
    await removeAllSources(page)
  })

  // ==================== Empty State ====================

  test('empty state shows message when no sources are added', async ({ page }) => {
    // The empty message should be visible after removing all sources
    const emptyMsg = page.locator(S.emptyMessage)
    await expect(emptyMsg).toBeVisible({ timeout: 5_000 })
    await expect(emptyMsg).toContainText('No sources added')
  })

  // ==================== Add Source Dialog ====================

  test('Add Source button opens dialog with 7 source type options', async ({ page }) => {
    // Click Add Source button
    await page.locator(S.addSourceBtn).click()

    // Dialog should become visible
    await expect(page.locator(S.dialog)).toBeVisible({ timeout: 5_000 })

    // The type <select> should have 7 options
    const typeSelect = page.locator(`${S.dialog} select`).first()
    await expect(typeSelect).toBeVisible()
    const options = await typeSelect.locator('option').allTextContents()
    expect(options).toHaveLength(7)
    expect(options).toEqual(['Display', 'Window', 'Webcam', 'Android', 'iOS', 'Region', 'Terminal'])

    // Close the dialog to clean up
    await page.locator(S.dialogCloseBtn).click()
    await page.locator(S.dialog).waitFor({ state: 'hidden' })
  })

  // ==================== Adding Sources ====================

  test('adding a Display source shows it in the source list', async ({ page }) => {
    await addDisplaySource(page)

    // One source item should be present
    await expect(page.locator(S.sourceItem)).toHaveCount(1, { timeout: 10_000 })

    // Empty message should no longer be visible
    await expect(page.locator(S.emptyMessage)).not.toBeVisible()
  })

  // ==================== Removing Sources ====================

  test('removing a source returns to empty state', async ({ page }) => {
    // Add a source first
    await addDisplaySource(page)
    await expect(page.locator(S.sourceItem)).toHaveCount(1, { timeout: 10_000 })

    // Click the remove button
    await page.locator(S.sourceRemoveBtn).first().click()
    await page.waitForTimeout(300)

    // Source list should be empty
    await expect(page.locator(S.sourceItem)).toHaveCount(0, { timeout: 5_000 })

    // Empty message should reappear
    await expect(page.locator(S.emptyMessage)).toBeVisible({ timeout: 5_000 })
  })

  // ==================== MAX_SOURCES Limit ====================

  test('Add button is disabled when MAX_SOURCES (2) is reached', async ({ page }) => {
    // Add first source (Display)
    await addDisplaySource(page)
    await expect(page.locator(S.sourceItem)).toHaveCount(1, { timeout: 10_000 })

    // Add second source (Terminal)
    await addTerminalSource(page)
    await expect(page.locator(S.sourceItem)).toHaveCount(2, { timeout: 10_000 })

    // Add Source button should now be disabled
    await expect(page.locator(S.addSourceBtn)).toBeDisabled()
  })

  // ==================== Dialog Cancel ====================

  test('closing dialog without selecting a source adds nothing', async ({ page }) => {
    // Open the dialog
    await page.locator(S.addSourceBtn).click()
    await expect(page.locator(S.dialog)).toBeVisible({ timeout: 5_000 })

    // Close via the Cancel button
    await page.locator(S.dialogCloseBtn).click()
    await page.locator(S.dialog).waitFor({ state: 'hidden' })

    // No sources should have been added
    await expect(page.locator(S.sourceItem)).toHaveCount(0, { timeout: 5_000 })
  })
})
