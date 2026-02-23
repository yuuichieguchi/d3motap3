import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import type { ElectronApplication } from '@playwright/test'

async function setupAiMocks(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    (global as Record<string, unknown>).__aiMockState = { status: 'idle' }

    ipcMain.removeHandler('ai:start-narration')
    ipcMain.handle('ai:start-narration', () => {
      ;(global as Record<string, unknown>).__aiMockState = {
        status: 'processing',
        task: 'narration',
      }
      setTimeout(() => {
        ;(global as Record<string, unknown>).__aiMockState = {
          status: 'completed',
          result: 'Test narration result',
        }
      }, 600)
    })

    ipcMain.removeHandler('ai:start-script-gen')
    ipcMain.handle('ai:start-script-gen', () => {
      ;(global as Record<string, unknown>).__aiMockState = {
        status: 'processing',
        task: 'script',
      }
      setTimeout(() => {
        ;(global as Record<string, unknown>).__aiMockState = {
          status: 'completed',
          result: 'Test script result',
        }
      }, 600)
    })

    ipcMain.removeHandler('ai:status')
    ipcMain.handle('ai:status', () => {
      return JSON.stringify(
        (global as Record<string, unknown>).__aiMockState,
      )
    })

    ipcMain.removeHandler('ai:cancel')
    ipcMain.handle('ai:cancel', () => {
      ;(global as Record<string, unknown>).__aiMockState = { status: 'idle' }
    })

    ipcMain.removeHandler('ai:reset')
    ipcMain.handle('ai:reset', () => {
      ;(global as Record<string, unknown>).__aiMockState = { status: 'idle' }
    })
  })
}

test.describe('AI Panel', () => {
  test('API Key input exists', async ({ page }) => {
    const input = page.locator(`${S.aiSection} input[type="password"]`)
    await expect(input).toBeVisible()
    await expect(input).toHaveAttribute('placeholder', 'sk-ant-...')
  })

  test('Tab switching', async ({ page }) => {
    const narrationTab = page.locator(`${S.aiTabs} button`, {
      hasText: 'Narration',
    })
    const scriptGenTab = page.locator(`${S.aiTabs} button`, {
      hasText: 'Script Gen',
    })

    // Switch to Script Gen
    await scriptGenTab.click()
    await expect(scriptGenTab).toHaveClass(/active/)

    // Switch back to Narration
    await narrationTab.click()
    await expect(narrationTab).toHaveClass(/active/)
  })

  test('Placeholder changes with tab', async ({ page }) => {
    const narrationTab = page.locator(`${S.aiTabs} button`, {
      hasText: 'Narration',
    })
    const scriptGenTab = page.locator(`${S.aiTabs} button`, {
      hasText: 'Script Gen',
    })
    const textarea = page.locator(`${S.aiSection} textarea`)

    // Narration tab placeholder
    await narrationTab.click()
    await expect(textarea).toHaveAttribute(
      'placeholder',
      'Describe the video content...',
    )

    // Script Gen tab placeholder
    await scriptGenTab.click()
    await expect(textarea).toHaveAttribute(
      'placeholder',
      'e.g., Show git workflow with commits and branches',
    )

    // Reset to Narration
    await narrationTab.click()
  })

  test('Generate disabled when empty', async ({ page }) => {
    const generateBtn = page.locator(`${S.aiSection} ${S.recordBtnStart}`)
    await expect(generateBtn).toBeDisabled()
  })

  test('Generate enabled after input', async ({ page }) => {
    const apiKeyInput = page.locator(`${S.aiSection} input[type="password"]`)
    const textarea = page.locator(`${S.aiSection} textarea`)
    const generateBtn = page.locator(`${S.aiSection} ${S.recordBtnStart}`)

    await apiKeyInput.fill('test-key')
    await textarea.fill('test description')
    await expect(generateBtn).toBeEnabled()

    // Clean up
    await apiKeyInput.fill('')
    await textarea.fill('')
  })

  test.describe.serial('Processing flow', () => {
    test('Processing state shows Cancel', async ({ page, electronApp }) => {
      await setupAiMocks(electronApp)

      const apiKeyInput = page.locator(
        `${S.aiSection} input[type="password"]`,
      )
      const textarea = page.locator(`${S.aiSection} textarea`)
      const generateBtn = page.locator(`${S.aiSection} ${S.recordBtnStart}`)

      await apiKeyInput.fill('test-key')
      await textarea.fill('test description')
      await generateBtn.click()

      const cancelBtn = page.locator(`${S.aiSection} ${S.recordBtnStop}`)
      await expect(cancelBtn).toBeVisible({ timeout: 5000 })
      await expect(cancelBtn).toHaveText('Cancel')

      const statusText = page.locator(S.scriptStatus)
      await expect(statusText).toContainText('Generating')
    })

    test('Result display', async ({ page }) => {
      const resultBox = page.locator(S.resultBox)
      await expect(resultBox).toBeVisible({ timeout: 5000 })

      const resultContent = page.locator(`pre${S.aiResult}`)
      await expect(resultContent).toContainText('Test narration result')

      const clearBtn = resultBox.locator(S.resetBtn)
      await expect(clearBtn).toBeVisible()
      await expect(clearBtn).toHaveText('Clear')
    })

    test('Clear resets result', async ({ page }) => {
      const resultBox = page.locator(S.resultBox)
      await expect(resultBox).toBeVisible()

      const clearBtn = resultBox.locator(S.resetBtn)
      await clearBtn.click()

      await expect(resultBox).toBeHidden()
    })
  })

  test.describe.serial('Error flow', () => {
    test('Error display', async ({ page, electronApp }) => {
      // Set up mock that triggers failure
      await electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('ai:start-narration')
        ipcMain.handle('ai:start-narration', () => {
          ;(global as Record<string, unknown>).__aiMockState = {
            status: 'processing',
            task: 'narration',
          }
          setTimeout(() => {
            ;(global as Record<string, unknown>).__aiMockState = {
              status: 'failed',
              error: 'API key invalid',
            }
          }, 300)
        })

        ipcMain.removeHandler('ai:status')
        ipcMain.handle('ai:status', () => {
          return JSON.stringify(
            (global as Record<string, unknown>).__aiMockState,
          )
        })

        ipcMain.removeHandler('ai:reset')
        ipcMain.handle('ai:reset', () => {
          ;(global as Record<string, unknown>).__aiMockState = {
            status: 'idle',
          }
        })
      })

      const apiKeyInput = page.locator(
        `${S.aiSection} input[type="password"]`,
      )
      const textarea = page.locator(`${S.aiSection} textarea`)
      const generateBtn = page.locator(`${S.aiSection} ${S.recordBtnStart}`)

      await apiKeyInput.fill('test-key')
      await textarea.fill('test description')
      await generateBtn.click()

      const errorBox = page.locator(S.errorBox)
      await expect(errorBox).toBeVisible({ timeout: 5000 })
      await expect(errorBox).toContainText('API key invalid')

      const dismissBtn = errorBox.locator(S.resetBtn)
      await expect(dismissBtn).toBeVisible()
      await expect(dismissBtn).toHaveText('Dismiss')

      // Dismiss the error to clean up
      await dismissBtn.click()
      await expect(errorBox).toBeHidden()
    })
  })
})
