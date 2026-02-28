/**
 * E2E tests for terminal source bugfixes.
 *
 * Coverage:
 * - Bug 2: Terminal source X (remove) button is visible and clickable
 * - Bug 3: Pressing Escape unfocuses the terminal input area
 *
 * These tests operate the real Electron app UI — no mocks, no IPC shortcuts.
 */

import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import { closeLeftoverDialogs, addTerminalSource, removeAllSources } from '../helpers/test-utils'

const EVIDENCE_DIR = '/private/tmp/e2e-video-evidence'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Terminal source bugfixes', () => {
  test.beforeEach(async ({ page }) => {
    // Close any leftover dialogs from previous tests (shared Electron instance)
    await closeLeftoverDialogs(page)

    // Navigate to Recording tab
    await page.locator('.header-tab').filter({ hasText: 'Recording' }).click()
    await page.waitForTimeout(300)

    // Remove all existing sources to start clean
    await removeAllSources(page)
  })

  test.afterEach(async ({ page }) => {
    // Clean up: remove all sources so subsequent tests start fresh
    await removeAllSources(page)
  })

  // ==================== Bug 2: Remove button visible ====================

  test('Bug 2: Terminal source remove button is visible', async ({ page }) => {
    // Arrange: Add a terminal source
    await addTerminalSource(page)
    await expect(page.locator(S.sourceItem)).toHaveCount(1, { timeout: 10_000 })

    // Screenshot: terminal source with X button visible
    await page.screenshot({ path: `${EVIDENCE_DIR}/bug2-terminal-x-button-visible.png` })

    // Assert: The remove button (X) should be visible on the terminal source
    const removeBtn = page.locator(S.sourceRemoveBtn).first()
    await expect(removeBtn).toBeVisible({ timeout: 5_000 })

    // Verify the button contains "x"
    await expect(removeBtn).toHaveText('x')

    // Verify the button is clickable (not covered by other elements)
    // We click it and confirm the source is actually removed
    await removeBtn.click()
    await page.waitForTimeout(300)

    // Screenshot: after removal
    await page.screenshot({ path: `${EVIDENCE_DIR}/bug2-terminal-after-remove.png` })

    await expect(page.locator(S.sourceItem)).toHaveCount(0, { timeout: 5_000 })
  })

  // ==================== Bug 3: ESC unfocuses terminal ====================

  test('Bug 3: Escape key unfocuses terminal input area', async ({ page }) => {
    // Arrange: Add a terminal source
    await addTerminalSource(page)
    await expect(page.locator(S.sourceItem)).toHaveCount(1, { timeout: 10_000 })

    // The terminal input area should exist and show unfocused text
    const terminalInput = page.locator(S.terminalInputArea)
    await expect(terminalInput).toBeVisible({ timeout: 5_000 })
    await expect(terminalInput).toHaveText('Click to type...')

    // Screenshot: unfocused state
    await page.screenshot({ path: `${EVIDENCE_DIR}/bug3-terminal-unfocused.png` })

    // Act: Click the terminal input area to focus it
    await terminalInput.click()
    await page.waitForTimeout(300)

    // Assert: Should now show focused state
    await expect(page.locator(S.terminalFocused)).toBeVisible({ timeout: 5_000 })
    await expect(terminalInput).toHaveText('Typing... (Esc to unfocus)')

    // Screenshot: focused state
    await page.screenshot({ path: `${EVIDENCE_DIR}/bug3-terminal-focused.png` })

    // Act: Press Escape to unfocus
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // Assert: Should return to unfocused state
    await expect(page.locator(S.terminalFocused)).not.toBeVisible({ timeout: 5_000 })
    await expect(terminalInput).toHaveText('Click to type...')

    // Screenshot: back to unfocused after ESC
    await page.screenshot({ path: `${EVIDENCE_DIR}/bug3-terminal-after-esc.png` })
  })
})
