import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import type { ElectronApplication } from '@playwright/test'

async function setupCaptionMocks(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    (global as any).__aiMockState = { status: 'idle' }
    ;(global as any).__captionLog = [] as string[]

    ipcMain.removeHandler('ai:start-narration')
    ipcMain.handle('ai:start-narration', () => {
      ;(global as any).__aiMockState = {
        status: 'processing',
        task: 'narration',
      }
      setTimeout(() => {
        ;(global as any).__aiMockState = {
          status: 'completed',
          result: 'Test caption narration',
        }
      }, 600)
    })

    ipcMain.removeHandler('ai:start-script-gen')
    ipcMain.handle('ai:start-script-gen', () => {
      ;(global as any).__aiMockState = {
        status: 'processing',
        task: 'script',
      }
      setTimeout(() => {
        ;(global as any).__aiMockState = {
          status: 'completed',
          result: 'Test script content',
        }
      }, 600)
    })

    ipcMain.removeHandler('ai:status')
    ipcMain.handle('ai:status', () => {
      return JSON.stringify((global as any).__aiMockState)
    })

    ipcMain.removeHandler('ai:cancel')
    ipcMain.handle('ai:cancel', () => {
      ;(global as any).__aiMockState = { status: 'idle' }
    })

    ipcMain.removeHandler('ai:reset')
    ipcMain.handle('ai:reset', () => {
      ;(global as any).__aiMockState = { status: 'idle' }
    })

    // Caption IPC mocks
    ipcMain.removeHandler('caption:set')
    ipcMain.handle('caption:set', (_event: any, text: any, position: any) => {
      ;(global as any).__captionLog.push(`set:${text}:${position}`)
    })

    ipcMain.removeHandler('caption:clear')
    ipcMain.handle('caption:clear', () => {
      ;(global as any).__captionLog.push('clear')
    })
  })
}

test.describe('Caption Controls', () => {
  test.describe.serial('After narration', () => {
    test('Setup AI and caption mocks', async ({ page, electronApp }) => {
      await setupCaptionMocks(electronApp)

      // Enter API key and description
      const apiKeyInput = page.locator(`${S.aiSection} input[type="password"]`)
      const textarea = page.locator(`${S.aiSection} textarea`)

      await apiKeyInput.fill('test-key')
      await textarea.fill('test description')
    })

    test('Generate narration and wait for completion', async ({ page }) => {
      const generateBtn = page.locator(`${S.aiSection} ${S.recordBtnStart}`)
      await generateBtn.click()

      // Wait for result
      const resultBox = page.locator(`${S.aiSection} ${S.resultBox}`)
      await expect(resultBox).toBeVisible({ timeout: 5000 })
      await expect(resultBox).toContainText('Test caption narration')
    })

    test('caption-controls visible with Apply and Clear buttons', async ({ page }) => {
      const captionControls = page.locator(S.captionControls)
      await expect(captionControls).toBeVisible()

      const applyBtn = page.locator(S.captionBtnApply)
      await expect(applyBtn).toBeVisible()
      await expect(applyBtn).toContainText('Apply as Caption')

      const clearBtn = page.locator(S.captionBtnClear)
      await expect(clearBtn).toBeVisible()
      await expect(clearBtn).toContainText('Clear Caption')
    })

    test('Apply calls caption:set IPC', async ({ page, electronApp }) => {
      const applyBtn = page.locator(S.captionBtnApply)
      await applyBtn.click()

      const log = await electronApp.evaluate(() => {
        return (global as any).__captionLog as string[]
      })
      expect(log).toContain('set:Test caption narration:bottom')
    })

    test('Clear calls caption:clear IPC', async ({ page, electronApp }) => {
      const clearBtn = page.locator(S.captionBtnClear)
      await clearBtn.click()

      const log = await electronApp.evaluate(() => {
        return (global as any).__captionLog as string[]
      })
      expect(log).toContain('clear')
    })

    test('Script Gen tab hides caption-controls', async ({ page }) => {
      // First clear the narration result
      const resetBtn = page.locator(`${S.aiSection} ${S.resultBox} ${S.resetBtn}`)
      await resetBtn.click()

      // Switch to Script Gen tab
      const scriptGenTab = page.locator(`${S.aiTabs} button`, {
        hasText: 'Script Gen',
      })
      await scriptGenTab.click()

      // Generate a script
      const textarea = page.locator(`${S.aiSection} textarea`)
      await textarea.fill('test script description')

      const generateBtn = page.locator(`${S.aiSection} ${S.recordBtnStart}`)
      await generateBtn.click()

      const resultBox = page.locator(`${S.aiSection} ${S.resultBox}`)
      await expect(resultBox).toBeVisible({ timeout: 5000 })

      // caption-controls should NOT be visible
      const captionControls = page.locator(S.captionControls)
      await expect(captionControls).not.toBeVisible()

      // script-run-controls should be visible instead
      const scriptRunControls = page.locator(S.scriptRunControls)
      await expect(scriptRunControls).toBeVisible()

      // Clean up - switch back to Narration and clear
      const clearBtn = page.locator(`${S.aiSection} ${S.resultBox} ${S.resetBtn}`)
      await clearBtn.click()

      const narrationTab = page.locator(`${S.aiTabs} button`, {
        hasText: 'Narration',
      })
      await narrationTab.click()
    })
  })
})
