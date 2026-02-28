/**
 * E2E tests for layout selection between Single, Side by Side, and PiP.
 *
 * Coverage:
 * - Single layout is selected by default
 * - Side by Side and PiP are disabled without 2 sources
 * - 2 sources enable Side by Side and PiP
 * - Side by Side shows Split Ratio slider
 * - PiP shows Position dropdown with 4 options
 * - PiP shows PiP Size slider with correct min/max/step attributes
 * - PiP Size slider value can be changed without errors
 *
 * LayoutSelector.tsx offers three layout options. Side by Side and PiP
 * require at least two active sources and are disabled otherwise.
 */

import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import { closeLeftoverDialogs, addDisplaySource, addTerminalSource, removeAllSources } from '../helpers/test-utils'

test.describe('Layout selection', () => {
  test.beforeEach(async ({ page }) => {
    await closeLeftoverDialogs(page)

    // Ensure Recording tab is active
    await page.locator('.header-tab').filter({ hasText: 'Recording' }).click()
    await page.waitForTimeout(300)

    // Remove all sources so we start clean
    await removeAllSources(page)

    // Reset layout to Single by clicking it
    await page.locator(S.layoutOption).filter({ hasText: 'Single' }).click()
    await page.waitForTimeout(200)
  })

  test.afterEach(async ({ page }) => {
    // Reset layout to Single
    await page.locator(S.layoutOption).filter({ hasText: 'Single' }).click()
    await page.waitForTimeout(200)
    await removeAllSources(page)
  })

  // ==================== Default State ====================

  test('Single layout is selected by default', async ({ page }) => {
    const selected = page.locator(S.layoutOptionSelected)
    await expect(selected).toContainText('Single')
  })

  // ==================== Disabled State ====================

  test('Side by Side and Picture in Picture are disabled without 2 sources', async ({ page }) => {
    const sideBySide = page.locator(S.layoutOption).filter({ hasText: 'Side by Side' })
    const pip = page.locator(S.layoutOption).filter({ hasText: 'Picture in Picture' })

    await expect(sideBySide).toBeDisabled()
    await expect(pip).toBeDisabled()
  })

  // ==================== Enabled State ====================

  test('Side by Side and Picture in Picture become enabled with 2 sources', async ({ page }) => {
    // Add two different sources
    await addDisplaySource(page)
    await addTerminalSource(page)

    const sideBySide = page.locator(S.layoutOption).filter({ hasText: 'Side by Side' })
    const pip = page.locator(S.layoutOption).filter({ hasText: 'Picture in Picture' })

    await expect(sideBySide).toBeEnabled()
    await expect(pip).toBeEnabled()
  })

  // ==================== SideBySide Controls ====================

  test('Selecting Side by Side shows Split Ratio slider', async ({ page }) => {
    // Need 2 sources to enable Side by Side
    await addDisplaySource(page)
    await addTerminalSource(page)

    // Click Side by Side layout
    await page.locator(S.layoutOption).filter({ hasText: 'Side by Side' }).click()
    await page.waitForTimeout(200)

    // Verify the control group with Split Ratio label is visible
    const controlGroup = page.locator(S.controlGroup).filter({ hasText: 'Split Ratio' })
    await expect(controlGroup).toBeVisible()

    // Verify it contains a range input
    const rangeInput = controlGroup.locator('input[type="range"]')
    await expect(rangeInput).toBeVisible()
  })

  // ==================== PiP Controls ====================

  test('Selecting Picture in Picture shows PiP Position dropdown', async ({ page }) => {
    // Need 2 sources to enable PiP
    await addDisplaySource(page)
    await addTerminalSource(page)

    // Click Picture in Picture layout
    await page.locator(S.layoutOption).filter({ hasText: 'Picture in Picture' }).click()
    await page.waitForTimeout(200)

    // Verify the control group with PiP Position label is visible
    const controlGroup = page.locator(S.controlGroup).filter({ hasText: 'PiP Position' })
    await expect(controlGroup).toBeVisible()

    // Verify the select dropdown has the 4 position options
    const select = controlGroup.locator('select')
    await expect(select).toBeVisible()

    const options = await select.locator('option').allTextContents()
    expect(options).toEqual(['Top Left', 'Top Right', 'Bottom Left', 'Bottom Right'])
  })

  // ==================== PiP Size Controls ====================

  test('Selecting Picture in Picture shows PiP Size slider', async ({ page }) => {
    // Need 2 sources to enable PiP
    await addDisplaySource(page)
    await addTerminalSource(page)

    // Click Picture in Picture layout
    await page.locator(S.layoutOption).filter({ hasText: 'Picture in Picture' }).click()
    await page.waitForTimeout(200)

    // Verify the control group with PiP Size label is visible
    const controlGroup = page.locator(S.controlGroup).filter({ hasText: 'PiP Size' })
    await expect(controlGroup).toBeVisible()

    // Verify it contains a range input
    const rangeInput = controlGroup.locator('input[type="range"]')
    await expect(rangeInput).toBeVisible()

    // Verify the range input has correct min, max, and step attributes
    await expect(rangeInput).toHaveAttribute('min', '0.1')
    await expect(rangeInput).toHaveAttribute('max', '0.5')
    await expect(rangeInput).toHaveAttribute('step', '0.01')
  })

  test('PiP Size slider value can be changed', async ({ page }) => {
    // Need 2 sources to enable PiP
    await addDisplaySource(page)
    await addTerminalSource(page)

    // Click Picture in Picture layout
    await page.locator(S.layoutOption).filter({ hasText: 'Picture in Picture' }).click()
    await page.waitForTimeout(200)

    // Get the range input from PiP Size control group
    const controlGroup = page.locator(S.controlGroup).filter({ hasText: 'PiP Size' })
    const input = controlGroup.locator('input[type="range"]')

    // Change the slider value
    await input.fill('0.35')

    // Trigger input event to ensure the change is processed
    await input.dispatchEvent('input')
    await page.waitForTimeout(200)

    // Verify the slider value is updated
    await expect(input).toHaveValue('0.35')

    // Verify the percentage display is updated
    const rangeValue = controlGroup.locator('.range-value')
    await expect(rangeValue).toHaveText('35%')

    // Verify no error box appears after changing the value
    await expect(page.locator('.error-box')).not.toBeVisible()
  })
})
