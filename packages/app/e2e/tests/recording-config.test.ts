/**
 * E2E tests for recording configuration controls.
 *
 * Coverage:
 * - Output Resolution dropdown: default value and change
 * - FPS dropdown: default value and change
 * - Format dropdown: default value and change
 * - Quality dropdown: default value and change
 * - System Audio / Microphone toggle switches
 * - GIF format hides audio toggles, non-GIF shows them
 * - Start Recording button disabled state based on source presence
 *
 * These tests operate the real Electron app UI — no mocks, no IPC shortcuts.
 */

import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import { closeLeftoverDialogs, addDisplaySource, removeAllSources } from '../helpers/test-utils'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Recording configuration', () => {
  test.beforeEach(async ({ page }) => {
    // Close any leftover dialogs from previous tests (shared Electron instance)
    await closeLeftoverDialogs(page)

    // Ensure Recording tab is active
    await page.locator('.header-tab').filter({ hasText: 'Recording' }).click()
    await page.waitForTimeout(300)

    // Reset format to mp4 FIRST so that audio toggles become visible
    // (GIF format hides them, making the toggle reset below impossible)
    const formatSelect = page
      .locator('.control-group')
      .filter({ hasText: 'Format' })
      .locator('select')
    await formatSelect.selectOption('mp4')
    await page.waitForTimeout(200)

    // Turn off audio toggles to reset state
    for (const label of ['System Audio', 'Microphone']) {
      const group = page
        .locator('.control-group.toggle')
        .filter({ hasText: label })
      const cb = group.locator('input[type="checkbox"]')
      if (await cb.isChecked().catch(() => false)) {
        const toggle = group.locator('.toggle-switch')
        await toggle.scrollIntoViewIfNeeded()
        await toggle.click()
        await page.waitForTimeout(300)
        // Verify the toggle actually turned off
        if (await cb.isChecked().catch(() => false)) {
          // Retry once if click did not register
          await toggle.click()
          await page.waitForTimeout(300)
        }
      }
    }

    // Reset Output Resolution to default
    const resSelect = page.locator('.control-group').filter({ hasText: 'Output Resolution' }).locator('select')
    await resSelect.selectOption('1920x1080')
    // Reset FPS to default
    const fpsSelect = page.locator('.control-group').filter({ hasText: 'FPS' }).locator('select')
    await fpsSelect.selectOption('30')
    // Reset Quality to default
    const qualitySelect = page.locator('.control-group').filter({ hasText: 'Quality' }).locator('select')
    await qualitySelect.selectOption('medium')

    // Remove all sources
    await removeAllSources(page)
  })

  // ==================== 1. Output Resolution ====================

  test('Output Resolution default value is 1920x1080 and can be changed', async ({ page }) => {
    const select = page
      .locator('.control-group')
      .filter({ hasText: 'Output Resolution' })
      .locator('select')

    // Verify default value
    await expect(select).toHaveValue('1920x1080')

    // Change to 1280x720
    await select.selectOption('1280x720')
    await expect(select).toHaveValue('1280x720')
  })

  // ==================== 2. FPS ====================

  test('FPS default value is 30 and can be changed', async ({ page }) => {
    const select = page
      .locator('.control-group')
      .filter({ hasText: 'FPS' })
      .locator('select')

    // Verify default value
    await expect(select).toHaveValue('30')

    // Change to 60
    await select.selectOption('60')
    await expect(select).toHaveValue('60')
  })

  // ==================== 3. Format ====================

  test('Format default value is mp4 and can be changed', async ({ page }) => {
    const select = page
      .locator('.control-group')
      .filter({ hasText: 'Format' })
      .locator('select')

    // Verify default value
    await expect(select).toHaveValue('mp4')

    // Change to webm
    await select.selectOption('webm')
    await expect(select).toHaveValue('webm')

    // Reset to mp4 for subsequent tests
    await select.selectOption('mp4')
    await expect(select).toHaveValue('mp4')
  })

  // ==================== 4. Quality ====================

  test('Quality default value is medium and can be changed', async ({ page }) => {
    const select = page
      .locator('.control-group')
      .filter({ hasText: 'Quality' })
      .locator('select')

    // Verify default value
    await expect(select).toHaveValue('medium')

    // Change to high
    await select.selectOption('high')
    await expect(select).toHaveValue('high')
  })

  // ==================== 5. Audio toggles ====================

  test('System Audio and Microphone toggles can be toggled on and off', async ({ page }) => {
    const sysAudioToggle = page
      .locator('.control-group.toggle')
      .filter({ hasText: 'System Audio' })
      .locator('.toggle-switch')
    const sysAudioCb = page
      .locator('.control-group.toggle')
      .filter({ hasText: 'System Audio' })
      .locator('input[type="checkbox"]')

    // System Audio should start unchecked (reset by beforeEach)
    await expect(sysAudioCb).not.toBeChecked()

    // Click toggle ON
    await sysAudioToggle.click()
    await expect(sysAudioCb).toBeChecked()

    // Click toggle OFF
    await sysAudioToggle.click()
    await expect(sysAudioCb).not.toBeChecked()

    // Repeat for Microphone
    const micToggle = page
      .locator('.control-group.toggle')
      .filter({ hasText: 'Microphone' })
      .locator('.toggle-switch')
    const micCb = page
      .locator('.control-group.toggle')
      .filter({ hasText: 'Microphone' })
      .locator('input[type="checkbox"]')

    await expect(micCb).not.toBeChecked()

    await micToggle.click()
    await expect(micCb).toBeChecked()

    await micToggle.click()
    await expect(micCb).not.toBeChecked()
  })

  // ==================== 6. GIF hides audio toggles ====================

  test('GIF format hides audio toggles and non-GIF shows them', async ({ page }) => {
    const formatSelect = page
      .locator('.control-group')
      .filter({ hasText: 'Format' })
      .locator('select')
    const sysAudioGroup = page
      .locator('.control-group.toggle')
      .filter({ hasText: 'System Audio' })
    const micGroup = page
      .locator('.control-group.toggle')
      .filter({ hasText: 'Microphone' })

    // Audio toggles should be visible in mp4 mode (default)
    await expect(sysAudioGroup).toBeVisible()
    await expect(micGroup).toBeVisible()

    // Change to GIF
    await formatSelect.selectOption('gif')
    await page.waitForTimeout(300)

    // Audio toggles should NOT be visible in GIF mode
    await expect(sysAudioGroup).not.toBeVisible()
    await expect(micGroup).not.toBeVisible()

    // Change back to mp4
    await formatSelect.selectOption('mp4')
    await page.waitForTimeout(300)

    // Audio toggles should be visible again
    await expect(sysAudioGroup).toBeVisible()
    await expect(micGroup).toBeVisible()
  })

  // ==================== 7. Start Recording button disabled state ====================

  test('Start Recording button is disabled without sources and enabled with a source', async ({ page }) => {
    const startBtn = page.getByRole('button', { name: 'Start Recording' })
    await startBtn.scrollIntoViewIfNeeded()

    // Without sources, button should be disabled
    await expect(startBtn).toBeDisabled()

    // Add a display source
    await addDisplaySource(page)

    // Button should now be enabled
    await expect(startBtn).not.toBeDisabled()

    // Remove source to clean up
    await removeAllSources(page)

    // Button should be disabled again
    await expect(startBtn).toBeDisabled()
  })
})
