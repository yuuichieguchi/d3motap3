import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import type { ElectronApplication } from '@playwright/test'

async function setupScriptExecMocks(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    (global as any).__aiMockState = { status: 'idle' }
    ;(global as any).__scriptExecLog = [] as string[]
    ;(global as any).__scriptMockState = { status: 'idle' }

    // AI mocks
    ipcMain.removeHandler('ai:start-script-gen')
    ipcMain.handle('ai:start-script-gen', () => {
      ;(global as any).__aiMockState = {
        status: 'processing',
        task: 'script',
      }
      setTimeout(() => {
        ;(global as any).__aiMockState = {
          status: 'completed',
          result: 'name: test-script\nsteps:\n  - type: shell\n    command: echo hello',
        }
      }, 600)
    })

    ipcMain.removeHandler('ai:start-narration')
    ipcMain.handle('ai:start-narration', () => {
      ;(global as any).__aiMockState = {
        status: 'processing',
        task: 'narration',
      }
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

    // Script execution mocks
    ipcMain.removeHandler('script:save-temp')
    ipcMain.handle('script:save-temp', (_event: any, content: any) => {
      ;(global as any).__scriptExecLog.push(`save-temp:${content}`)
      return '/tmp/test-script.yaml'
    })

    ipcMain.removeHandler('script:run')
    ipcMain.handle('script:run', (_event: any, path: any) => {
      ;(global as any).__scriptExecLog.push(`run:${path}`)
      ;(global as any).__scriptMockState = {
        status: 'running',
        progress: 50,
        currentStep: 1,
        totalSteps: 2,
        stepDescription: 'Running shell command',
      }
      setTimeout(() => {
        ;(global as any).__scriptMockState = {
          status: 'completed',
          progress: 100,
          currentStep: 2,
          totalSteps: 2,
          stepDescription: 'Done',
        }
      }, 600)
    })

    ipcMain.removeHandler('script:status')
    ipcMain.handle('script:status', () => {
      return JSON.stringify((global as any).__scriptMockState)
    })

    ipcMain.removeHandler('script:stop')
    ipcMain.handle('script:stop', () => {
      ;(global as any).__scriptMockState = { status: 'idle' }
    })
  })
}

test.describe('Script Direct Execution', () => {
  test.describe.serial('Run generated script', () => {
    test('Setup AI script gen and execution mocks', async ({ page, electronApp }) => {
      await setupScriptExecMocks(electronApp)

      // Switch to Script Gen tab
      const scriptGenTab = page.locator(`${S.aiTabs} button`, {
        hasText: 'Script Gen',
      })
      await scriptGenTab.click()

      // Enter API key and description
      const apiKeyInput = page.locator(`${S.aiSection} input[type="password"]`)
      const textarea = page.locator(`${S.aiSection} textarea`)

      await apiKeyInput.fill('test-key')
      await textarea.fill('test script prompt')
    })

    test('Generate script and wait for completion', async ({ page }) => {
      const generateBtn = page.locator(`${S.aiSection} ${S.recordBtnStart}`)
      await generateBtn.click()

      const resultBox = page.locator(`${S.aiSection} ${S.resultBox}`)
      await expect(resultBox).toBeVisible({ timeout: 5000 })
      await expect(resultBox).toContainText('test-script')
    })

    test('script-run-btn is visible', async ({ page }) => {
      const runBtn = page.locator(S.scriptRunBtn)
      await expect(runBtn).toBeVisible()
      await expect(runBtn).toContainText('Run Script')
    })

    test('Click Run Script calls save-temp and run IPC', async ({ page, electronApp }) => {
      const runBtn = page.locator(S.scriptRunBtn)
      await runBtn.click()

      // Wait a moment for the async calls
      await page.waitForTimeout(500)

      const log = await electronApp.evaluate(() => {
        return (global as any).__scriptExecLog as string[]
      })

      // Verify save-temp was called with the script content
      const saveTempEntry = log.find((l: string) => l.startsWith('save-temp:'))
      expect(saveTempEntry).toBeTruthy()
      expect(saveTempEntry).toContain('test-script')

      // Verify run was called
      const runEntry = log.find((l: string) => l.startsWith('run:'))
      expect(runEntry).toBeTruthy()
      expect(runEntry).toContain('/tmp/test-script.yaml')
    })

    test('Script progress is displayed', async ({ page }) => {
      const scriptProgress = page.locator(S.scriptProgress)
      await expect(scriptProgress).toBeVisible({ timeout: 5000 })
    })
  })
})
