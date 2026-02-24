import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import type { ElectronApplication } from '@playwright/test'

async function setupTerminalSource(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    (global as any).__terminalWriteLog = [] as string[]

    ipcMain.removeHandler('system:ffmpeg-available')
    ipcMain.handle('system:ffmpeg-available', () => true)

    ipcMain.removeHandler('system:ffmpeg-version')
    ipcMain.handle('system:ffmpeg-version', () => '6.0')

    ipcMain.removeHandler('recording:list-displays')
    ipcMain.handle('recording:list-displays', () => [
      { id: 0, width: 1920, height: 1080 },
    ])

    // Return a terminal source
    ipcMain.removeHandler('sources:list')
    ipcMain.handle('sources:list', () => [
      { id: 1, name: 'Terminal', width: 800, height: 600, isActive: true, sourceType: 'terminal' },
    ])

    // Mock sources:add to return terminal source
    ipcMain.removeHandler('sources:add')
    ipcMain.handle('sources:add', () => 1)

    // Mock sources:remove
    ipcMain.removeHandler('sources:remove')
    ipcMain.handle('sources:remove', () => {})

    // Mock terminal:write-input
    ipcMain.removeHandler('terminal:write-input')
    ipcMain.handle('terminal:write-input', (_event: any, _sourceId: any, data: any) => {
      ;(global as any).__terminalWriteLog.push(
        Array.isArray(data) ? String.fromCharCode(...data) : String(data),
      )
    })

    // Available sources for dialog
    ipcMain.removeHandler('sources:list-available-windows')
    ipcMain.handle('sources:list-available-windows', () => [])

    ipcMain.removeHandler('sources:list-available-webcams')
    ipcMain.handle('sources:list-available-webcams', () => [])

    ipcMain.removeHandler('sources:list-available-android')
    ipcMain.handle('sources:list-available-android', () => [])

    ipcMain.removeHandler('sources:list-available-ios')
    ipcMain.handle('sources:list-available-ios', () => [])

    ipcMain.removeHandler('sources:is-adb-available')
    ipcMain.handle('sources:is-adb-available', () => false)
  })
}

test.describe('Terminal Keyboard Input', () => {
  test.describe.serial('Input area', () => {
    test('Setup terminal source', async ({ page, electronApp }) => {
      await setupTerminalSource(electronApp)
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })
    })

    test('terminal-input-area is visible', async ({ page }) => {
      const inputArea = page.locator(S.terminalInputArea)
      await expect(inputArea).toBeVisible({ timeout: 5000 })
    })

    test('Shows "Click to type..." text', async ({ page }) => {
      const inputArea = page.locator(S.terminalInputArea)
      await expect(inputArea).toContainText('Click to type...')
    })

    test('Click adds terminal-focused class', async ({ page }) => {
      const inputArea = page.locator(S.terminalInputArea)
      await inputArea.click()

      const focused = page.locator(S.terminalFocused)
      await expect(focused).toBeVisible()
      await expect(focused).toContainText('Typing...')
    })

    test('Key input sends terminal:write-input IPC', async ({ page, electronApp }) => {
      // Clear the log
      await electronApp.evaluate(() => {
        ;(global as any).__terminalWriteLog = []
      })

      const inputArea = page.locator(S.terminalInputArea)
      await inputArea.press('a')

      // Check that IPC was called
      const log = await electronApp.evaluate(() => {
        return (global as any).__terminalWriteLog as string[]
      })
      expect(log.length).toBeGreaterThan(0)
      expect(log[0]).toBe('a')
    })

    test('Special keys send correct escape sequences', async ({ page, electronApp }) => {
      await electronApp.evaluate(() => {
        ;(global as any).__terminalWriteLog = []
      })

      const inputArea = page.locator(S.terminalInputArea)
      await inputArea.press('Enter')

      const log = await electronApp.evaluate(() => {
        return (global as any).__terminalWriteLog as string[]
      })
      expect(log.length).toBeGreaterThan(0)
      expect(log[0]).toBe('\r')
    })

    test('Blur removes terminal-focused class', async ({ page }) => {
      // Click away from the terminal input area
      await page.locator(S.appHeader).click()

      const focused = page.locator(S.terminalFocused)
      await expect(focused).not.toBeVisible()

      // Original input area should still be visible but unfocused
      const inputArea = page.locator(S.terminalInputArea)
      await expect(inputArea).toBeVisible()
      await expect(inputArea).toContainText('Click to type...')
    })
  })
})
