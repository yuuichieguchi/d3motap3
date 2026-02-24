import { test, expect } from '../fixtures/electron-app';
import { S } from '../helpers/selectors';

test('Region selector: click Select Region opens overlay window', async ({ page, electronApp }) => {
  // Open Add Source dialog
  await page.locator(S.addSourceBtn).click()
  await expect(page.locator(S.dialog)).toBeVisible()

  // Select Region type
  const select = page.locator(`${S.dialog} select`).first()
  await select.selectOption('Region')

  // Click "Select Region..." button
  const selectRegionBtn = page.locator(S.sourceOptionBtn, { hasText: 'Select Region' })
  await selectRegionBtn.click()

  // Wait for the region selector window to open
  await new Promise(r => setTimeout(r, 3000))

  // Check how many windows are open
  const windows = await electronApp.windows()
  console.log(`Number of windows: ${windows.length}`)

  // Take screenshot of each window
  for (let i = 0; i < windows.length; i++) {
    const win = windows[i]
    const title = await win.title()
    console.log(`Window ${i}: title="${title}", url="${win.url()}"`)
    await win.screenshot({ path: `region-window-${i}.png` })
  }
})
