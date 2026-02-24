import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import type { ElectronApplication } from '@playwright/test'

async function setupLayoutMocks(electronApp: ElectronApplication, sourceCount: number): Promise<void> {
  await electronApp.evaluate(({ ipcMain }, count) => {
    ipcMain.removeHandler('system:ffmpeg-available')
    ipcMain.handle('system:ffmpeg-available', () => true)

    ipcMain.removeHandler('system:ffmpeg-version')
    ipcMain.handle('system:ffmpeg-version', () => '6.0')

    ipcMain.removeHandler('recording:list-displays')
    ipcMain.handle('recording:list-displays', () => [
      { id: 0, width: 1920, height: 1080 },
    ])

    ipcMain.removeHandler('layout:set')
    ipcMain.handle('layout:set', () => {})

    const sources = Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      name: `Terminal ${i + 1}`,
      width: 800,
      height: 600,
      isActive: true,
    }))

    ipcMain.removeHandler('sources:list')
    ipcMain.handle('sources:list', () => sources)

    ipcMain.removeHandler('sources:add')
    ipcMain.handle('sources:add', () => sources.length + 1)

    ipcMain.removeHandler('sources:remove')
    ipcMain.handle('sources:remove', () => {})
  }, sourceCount)
}

test.describe.serial('Layout Selection', () => {
  test('setup: reset view state', async ({ page, electronApp }) => {
    await setupLayoutMocks(electronApp, 0)
    await page.reload()
    await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })
  })

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
    test('setup: mock 2 sources', async ({ page, electronApp }) => {
      await setupLayoutMocks(electronApp, 2)
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      // Verify 2 sources are rendered
      await expect(page.locator(S.sourceItem)).toHaveCount(2, { timeout: 10000 })
    })

    test('SideBySide enabled with 2 sources', async ({ page }) => {
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
  })
})
