import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'

test.describe('Layout Selection', () => {
  test('three layout buttons exist', async ({ page }) => {
    const options = page.locator(S.layoutOption)
    await expect(options).toHaveCount(3)

    await expect(options.nth(0)).toContainText('Single')
    await expect(options.nth(1)).toContainText('Side by Side')
    await expect(options.nth(2)).toContainText('Picture in Picture')
  })

  test('SideBySide and PiP disabled with < 2 sources', async ({ page }) => {
    const options = page.locator(S.layoutOption)

    await expect(options.nth(1)).toBeDisabled()
    await expect(options.nth(2)).toBeDisabled()
  })

  test('warning not visible when Single layout is selected', async ({ page }) => {
    const warning = page.locator(S.layoutWarning)
    await expect(warning).toBeHidden()
  })

  test.describe.serial('with sources', () => {
    test('enable SideBySide after adding 2 sources', async ({ page }) => {
      // Add first Terminal source
      await page.locator(S.addSourceBtn).click()
      const select = page.locator(`${S.dialog} select`)
      await select.selectOption('Terminal')
      const defaultTerminalBtn = page.locator(S.sourceOptionBtn, {
        hasText: 'Default Terminal',
      })
      await defaultTerminalBtn.click()
      await expect(page.locator(S.dialogOverlay)).toBeHidden()
      await expect(page.locator(S.sourceItem).first()).toBeVisible({ timeout: 10000 })

      // Add second Terminal source
      await page.locator(S.addSourceBtn).click()
      await page.locator(`${S.dialog} select`).selectOption('Terminal')
      await page.locator(S.sourceOptionBtn, { hasText: 'Default Terminal' }).click()
      await expect(page.locator(S.dialogOverlay)).toBeHidden()
      await expect(page.locator(S.sourceItem)).toHaveCount(2, { timeout: 10000 })

      // SideBySide should now be enabled
      const sideBySideBtn = page.locator(S.layoutOption).nth(1)
      await expect(sideBySideBtn).toBeEnabled()
    })

    test('switch to SideBySide', async ({ page }) => {
      const sideBySideBtn = page.locator(S.layoutOption).nth(1)
      await sideBySideBtn.click()

      const selected = page.locator(S.layoutOptionSelected)
      await expect(selected).toContainText('Side by Side')
    })

    test('SideBySide shows Split Ratio slider', async ({ page }) => {
      const slider = page.locator(`${S.layoutSelector} input[type="range"]`)
      await expect(slider).toBeVisible()
    })

    test('switch to PiP shows position select', async ({ page }) => {
      const pipBtn = page.locator(S.layoutOption).nth(2)
      await pipBtn.click()

      const positionSelect = page.locator(`${S.layoutSelector} select`)
      await expect(positionSelect).toBeVisible()

      const options = positionSelect.locator('option')
      const texts = await options.allTextContents()

      expect(texts).toContain('Top Left')
      expect(texts).toContain('Top Right')
      expect(texts).toContain('Bottom Left')
      expect(texts).toContain('Bottom Right')
    })

    test('cleanup: remove sources', async ({ page }) => {
      // Switch back to Single first so buttons are not disabled
      await page.locator(S.layoutOption).nth(0).click()
      await expect(page.locator(S.layoutOptionSelected)).toContainText('Single')

      // Remove both sources
      await page.locator(S.sourceRemoveBtn).first().click()
      await expect(page.locator(S.sourceItem)).toHaveCount(1, { timeout: 5000 })

      await page.locator(S.sourceRemoveBtn).first().click()
      await expect(page.locator(S.emptyMessage)).toBeVisible()
    })
  })
})
