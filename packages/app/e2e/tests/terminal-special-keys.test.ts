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

    ipcMain.removeHandler('sources:list')
    ipcMain.handle('sources:list', () => [
      { id: 1, name: 'Terminal', width: 800, height: 600, isActive: true, sourceType: 'terminal' },
    ])

    ipcMain.removeHandler('sources:add')
    ipcMain.handle('sources:add', () => 1)

    ipcMain.removeHandler('sources:remove')
    ipcMain.handle('sources:remove', () => {})

    ipcMain.removeHandler('terminal:write-input')
    ipcMain.handle('terminal:write-input', (_event: any, _sourceId: any, data: any) => {
      let decoded: string
      if (Buffer.isBuffer(data)) {
        decoded = data.toString('utf-8')
      } else if (data instanceof Uint8Array || Array.isArray(data)) {
        decoded = String.fromCharCode(...data)
      } else {
        decoded = String(data)
      }
      ;(global as any).__terminalWriteLog.push(decoded)
    })

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

test.describe('Terminal Special Keys', () => {
  test.describe.serial('All key types', () => {
    test('Setup terminal source', async ({ page, electronApp }) => {
      await setupTerminalSource(electronApp)
      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })
    })

    test('Focus terminal input area', async ({ page }) => {
      const inputArea = page.locator(S.terminalInputArea)
      await expect(inputArea).toBeVisible({ timeout: 5000 })
      await inputArea.click()

      const focused = page.locator(S.terminalFocused)
      await expect(focused).toBeVisible()
    })

    test('Backspace sends 0x7f', async ({ page, electronApp }) => {
      await electronApp.evaluate(() => {
        ;(global as any).__terminalWriteLog = []
      })

      const inputArea = page.locator(S.terminalInputArea)
      await inputArea.press('Backspace')

      const log = await electronApp.evaluate(() => {
        return (global as any).__terminalWriteLog as string[]
      })
      expect(log.length).toBeGreaterThan(0)
      expect(log[0]).toBe('\x7f')
    })

    test('Tab sends \\t', async ({ page, electronApp }) => {
      await electronApp.evaluate(() => {
        ;(global as any).__terminalWriteLog = []
      })

      const inputArea = page.locator(S.terminalInputArea)
      await inputArea.press('Tab')

      const log = await electronApp.evaluate(() => {
        return (global as any).__terminalWriteLog as string[]
      })
      expect(log.length).toBeGreaterThan(0)
      expect(log[0]).toBe('\t')
    })

    test('Escape sends 0x1b', async ({ page, electronApp }) => {
      await electronApp.evaluate(() => {
        ;(global as any).__terminalWriteLog = []
      })

      const inputArea = page.locator(S.terminalInputArea)
      await inputArea.press('Escape')

      const log = await electronApp.evaluate(() => {
        return (global as any).__terminalWriteLog as string[]
      })
      expect(log.length).toBeGreaterThan(0)
      expect(log[0]).toBe('\x1b')
    })

    test('ArrowUp sends \\x1b[A', async ({ page, electronApp }) => {
      await electronApp.evaluate(() => {
        ;(global as any).__terminalWriteLog = []
      })

      const inputArea = page.locator(S.terminalInputArea)
      await inputArea.press('ArrowUp')

      const log = await electronApp.evaluate(() => {
        return (global as any).__terminalWriteLog as string[]
      })
      expect(log.length).toBeGreaterThan(0)
      expect(log[0]).toBe('\x1b[A')
    })

    test('ArrowDown sends \\x1b[B', async ({ page, electronApp }) => {
      await electronApp.evaluate(() => {
        ;(global as any).__terminalWriteLog = []
      })

      const inputArea = page.locator(S.terminalInputArea)
      await inputArea.press('ArrowDown')

      const log = await electronApp.evaluate(() => {
        return (global as any).__terminalWriteLog as string[]
      })
      expect(log.length).toBeGreaterThan(0)
      expect(log[0]).toBe('\x1b[B')
    })

    test('ArrowRight sends \\x1b[C', async ({ page, electronApp }) => {
      await electronApp.evaluate(() => {
        ;(global as any).__terminalWriteLog = []
      })

      const inputArea = page.locator(S.terminalInputArea)
      await inputArea.press('ArrowRight')

      const log = await electronApp.evaluate(() => {
        return (global as any).__terminalWriteLog as string[]
      })
      expect(log.length).toBeGreaterThan(0)
      expect(log[0]).toBe('\x1b[C')
    })

    test('ArrowLeft sends \\x1b[D', async ({ page, electronApp }) => {
      await electronApp.evaluate(() => {
        ;(global as any).__terminalWriteLog = []
      })

      const inputArea = page.locator(S.terminalInputArea)
      await inputArea.press('ArrowLeft')

      const log = await electronApp.evaluate(() => {
        return (global as any).__terminalWriteLog as string[]
      })
      expect(log.length).toBeGreaterThan(0)
      expect(log[0]).toBe('\x1b[D')
    })
  })
})
