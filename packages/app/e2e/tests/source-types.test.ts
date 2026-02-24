import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import type { ElectronApplication } from '@playwright/test'

async function setupBaseMocks(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('system:ffmpeg-available')
    ipcMain.handle('system:ffmpeg-available', () => true)

    ipcMain.removeHandler('system:ffmpeg-version')
    ipcMain.handle('system:ffmpeg-version', () => '6.0')

    ipcMain.removeHandler('recording:list-displays')
    ipcMain.handle('recording:list-displays', () => [
      { id: 0, width: 1920, height: 1080 },
    ])

    ipcMain.removeHandler('sources:list')
    ipcMain.handle('sources:list', () => [])

    ipcMain.removeHandler('sources:add')
    ipcMain.handle('sources:add', () => 1)

    ipcMain.removeHandler('sources:remove')
    ipcMain.handle('sources:remove', () => {})
  })
}

test.describe('Source Type Selection', () => {
  test.describe('Display source', () => {
    test.describe.serial('Display source flow', () => {
      test('setup mocks for display source', async ({ page, electronApp }) => {
        await setupBaseMocks(electronApp)

        // Override with 2 displays and sources:add/list that track added source
        await electronApp.evaluate(({ ipcMain }) => {
          (global as any).__sourcesMockState = { sources: [] }

          ipcMain.removeHandler('recording:list-displays')
          ipcMain.handle('recording:list-displays', () => [
            { id: 0, width: 1920, height: 1080 },
            { id: 1, width: 2560, height: 1440 },
          ])

          ipcMain.removeHandler('sources:add')
          ipcMain.handle('sources:add', () => {
            const state = (global as any).__sourcesMockState
            state.sources = [
              { id: 1, name: 'Display 1', width: 1920, height: 1080, isActive: true },
            ]
            return 1
          })

          ipcMain.removeHandler('sources:list')
          ipcMain.handle('sources:list', () => {
            return (global as any).__sourcesMockState.sources
          })

          ipcMain.removeHandler('sources:remove')
          ipcMain.handle('sources:remove', () => {
            (global as any).__sourcesMockState.sources = []
          })
        })

        await page.reload()
        await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })
      })

      test('type dropdown defaults to Display', async ({ page }) => {
        await page.locator(S.addSourceBtn).click()

        const select = page.locator(`${S.dialog} select`)
        await expect(select).toHaveValue('Display')

        await page.locator(S.dialogCloseBtn).click()
      })

      test('two display buttons visible', async ({ page }) => {
        await page.locator(S.addSourceBtn).click()

        const buttons = page.locator(S.sourceOptionBtn)
        await expect(buttons).toHaveCount(2)
        await expect(buttons.nth(0)).toHaveText('Display 1 (1920x1080)')
        await expect(buttons.nth(1)).toHaveText('Display 2 (2560x1440)')

        await page.locator(S.dialogCloseBtn).click()
      })

      test('click Display 1 closes dialog and adds source', async ({ page }) => {
        await page.locator(S.addSourceBtn).click()

        const firstDisplay = page.locator(S.sourceOptionBtn, {
          hasText: 'Display 1 (1920x1080)',
        })
        await firstDisplay.click()

        await expect(page.locator(S.dialogOverlay)).toBeHidden()
        await expect(page.locator(S.sourceItem)).toBeVisible({ timeout: 10000 })
      })
    })
  })

  test.describe('Window source', () => {
    test.describe.serial('Window source with windows', () => {
      test('setup mocks for window source', async ({ page, electronApp }) => {
        await setupBaseMocks(electronApp)

        await electronApp.evaluate(({ ipcMain }) => {
          (global as any).__sourcesMockState = { sources: [] }

          ipcMain.removeHandler('sources:list-available-windows')
          ipcMain.handle('sources:list-available-windows', () => [
            { windowId: 1, title: 'Document', appName: 'TextEdit', isOnScreen: true },
            { windowId: 2, title: 'Browser', appName: 'Safari', isOnScreen: true },
          ])

          ipcMain.removeHandler('sources:add')
          ipcMain.handle('sources:add', () => {
            const state = (global as any).__sourcesMockState
            state.sources = [
              { id: 1, name: 'TextEdit - Document', width: 1920, height: 1080, isActive: true },
            ]
            return 1
          })

          ipcMain.removeHandler('sources:list')
          ipcMain.handle('sources:list', () => {
            return (global as any).__sourcesMockState.sources
          })
        })

        await page.reload()
        await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })
      })

      test('two window buttons visible', async ({ page }) => {
        await page.locator(S.addSourceBtn).click()

        const select = page.locator(`${S.dialog} select`)
        await select.selectOption('Window')

        const buttons = page.locator(S.sourceOptionBtn)
        await expect(buttons).toHaveCount(2)
        await expect(buttons.nth(0)).toHaveText('TextEdit - Document')
        await expect(buttons.nth(1)).toHaveText('Safari - Browser')

        await page.locator(S.dialogCloseBtn).click()
      })

      test('click first window closes dialog', async ({ page }) => {
        await page.locator(S.addSourceBtn).click()

        const select = page.locator(`${S.dialog} select`)
        await select.selectOption('Window')

        const firstWindow = page.locator(S.sourceOptionBtn, {
          hasText: 'TextEdit - Document',
        })
        await firstWindow.click()

        await expect(page.locator(S.dialogOverlay)).toBeHidden()
      })
    })
  })

  test.describe('Window source empty', () => {
    test('shows empty message when no windows available', async ({ page, electronApp }) => {
      await setupBaseMocks(electronApp)

      await electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('sources:list-available-windows')
        ipcMain.handle('sources:list-available-windows', () => [])
      })

      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      await page.locator(S.addSourceBtn).click()

      const select = page.locator(`${S.dialog} select`)
      await select.selectOption('Window')

      await expect(page.locator(`${S.dialog} ${S.sourceList} p`)).toContainText('No windows available')

      await page.locator(S.dialogCloseBtn).click()
    })
  })

  test.describe('Webcam source', () => {
    test.describe.serial('Webcam source with devices', () => {
      test('setup mocks for webcam source', async ({ page, electronApp }) => {
        await setupBaseMocks(electronApp)

        await electronApp.evaluate(({ ipcMain }) => {
          (global as any).__sourcesMockState = { sources: [] }

          ipcMain.removeHandler('sources:list-available-webcams')
          ipcMain.handle('sources:list-available-webcams', () => [
            { deviceIndex: 0, name: 'FaceTime HD Camera', description: 'Built-in' },
          ])

          ipcMain.removeHandler('sources:add')
          ipcMain.handle('sources:add', () => {
            const state = (global as any).__sourcesMockState
            state.sources = [
              { id: 1, name: 'FaceTime HD Camera', width: 1280, height: 720, isActive: true },
            ]
            return 1
          })

          ipcMain.removeHandler('sources:list')
          ipcMain.handle('sources:list', () => {
            return (global as any).__sourcesMockState.sources
          })
        })

        await page.reload()
        await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })
      })

      test('webcam button visible', async ({ page }) => {
        await page.locator(S.addSourceBtn).click()

        const select = page.locator(`${S.dialog} select`)
        await select.selectOption('Webcam')

        const buttons = page.locator(S.sourceOptionBtn)
        await expect(buttons).toHaveCount(1)
        await expect(buttons.first()).toHaveText('FaceTime HD Camera')

        await page.locator(S.dialogCloseBtn).click()
      })

      test('click webcam closes dialog', async ({ page }) => {
        await page.locator(S.addSourceBtn).click()

        const select = page.locator(`${S.dialog} select`)
        await select.selectOption('Webcam')

        const webcamBtn = page.locator(S.sourceOptionBtn, {
          hasText: 'FaceTime HD Camera',
        })
        await webcamBtn.click()

        await expect(page.locator(S.dialogOverlay)).toBeHidden()
      })
    })
  })

  test.describe('Webcam source empty', () => {
    test('shows empty message when no webcams detected', async ({ page, electronApp }) => {
      await setupBaseMocks(electronApp)

      await electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('sources:list-available-webcams')
        ipcMain.handle('sources:list-available-webcams', () => [])
      })

      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      await page.locator(S.addSourceBtn).click()

      const select = page.locator(`${S.dialog} select`)
      await select.selectOption('Webcam')

      await expect(page.locator(`${S.dialog} ${S.sourceList} p`)).toContainText('No webcams detected')

      await page.locator(S.dialogCloseBtn).click()
    })
  })

  test.describe('Region source', () => {
    test.describe.serial('Region source flow', () => {
      test('setup mocks for region source', async ({ page, electronApp }) => {
        await setupBaseMocks(electronApp)

        await electronApp.evaluate(({ ipcMain }) => {
          (global as any).__sourcesMockState = { sources: [] }

          ipcMain.removeHandler('recording:list-displays')
          ipcMain.handle('recording:list-displays', () => [
            { id: 0, width: 1920, height: 1080 },
          ])

          ipcMain.removeHandler('sources:add')
          ipcMain.handle('sources:add', () => {
            const state = (global as any).__sourcesMockState
            state.sources = [
              { id: 1, name: 'Region', width: 1024, height: 768, isActive: true },
            ]
            return 1
          })

          ipcMain.removeHandler('sources:list')
          ipcMain.handle('sources:list', () => {
            return (global as any).__sourcesMockState.sources
          })
        })

        await page.reload()
        await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })
      })

      test('region UI has select region button and advanced toggle', async ({ page }) => {
        await page.locator(S.addSourceBtn).click()

        const select = page.locator(`${S.dialog} select`).first()
        await select.selectOption('Region')

        // Display select visible
        const regionControls = page.locator(`${S.dialog} ${S.sourceList} ${S.controlGroup}`)
        await expect(regionControls).toHaveCount(1)
        const displaySelect = regionControls.nth(0).locator('select')
        await expect(displaySelect).toBeVisible()

        // "Select Region..." button visible
        const selectRegionBtn = page.locator(S.sourceOptionBtn, { hasText: 'Select Region' })
        await expect(selectRegionBtn).toBeVisible()

        // "Add Region" button visible
        const addRegionBtn = page.locator(S.sourceOptionBtn, { hasText: 'Add Region' })
        await expect(addRegionBtn).toBeVisible()

        // Click "Advanced" toggle to reveal manual inputs
        const advancedBtn = page.locator('button', { hasText: 'Advanced' })
        await advancedBtn.click()

        // Now X/Y/Width/Height inputs should be visible
        const xInput = page.locator(`${S.dialog} input[type="number"]`).nth(0)
        await expect(xInput).toBeVisible()
        await expect(xInput).toHaveValue('0')

        const yInput = page.locator(`${S.dialog} input[type="number"]`).nth(1)
        await expect(yInput).toBeVisible()
        await expect(yInput).toHaveValue('0')

        const wInput = page.locator(`${S.dialog} input[type="number"]`).nth(2)
        await expect(wInput).toBeVisible()
        await expect(wInput).toHaveValue('800')

        const hInput = page.locator(`${S.dialog} input[type="number"]`).nth(3)
        await expect(hInput).toBeVisible()
        await expect(hInput).toHaveValue('600')

        await page.locator(S.dialogCloseBtn).click()
        await expect(page.locator(S.dialogOverlay)).toBeHidden()
      })

      test('change dimensions via advanced input and add region closes dialog', async ({ page }) => {
        await page.locator(S.addSourceBtn).click()
        await expect(page.locator(S.dialog)).toBeVisible()

        const select = page.locator(`${S.dialog} select`).first()
        await select.selectOption('Region')

        // Ensure Advanced section is open (toggle if needed)
        const advancedBtn = page.locator('button', { hasText: 'Advanced' })
        await expect(advancedBtn).toBeVisible()
        const numberInputs = page.locator(`${S.dialog} input[type="number"]`)
        const inputCount = await numberInputs.count()
        if (inputCount < 4) {
          // Advanced is closed, click to open
          await advancedBtn.click()
        }
        // Wait for all 4 inputs (X, Y, Width, Height) to be present
        await expect(numberInputs).toHaveCount(4)

        // Change Width (nth(2)) to 1024
        const wInput = numberInputs.nth(2)
        await expect(wInput).toBeVisible()
        await wInput.fill('1024')
        await expect(wInput).toHaveValue('1024')

        // Change Height (nth(3)) to 768
        const hInput = numberInputs.nth(3)
        await expect(hInput).toBeVisible()
        await hInput.fill('768')
        await expect(hInput).toHaveValue('768')

        // Click Add Region button
        const addRegionBtn = page.locator(S.sourceOptionBtn, { hasText: 'Add Region' })
        await addRegionBtn.click()

        await expect(page.locator(S.dialogOverlay)).toBeHidden()
        await expect(page.locator(S.sourceItem)).toBeVisible({ timeout: 10000 })
      })
    })
  })

  test.describe('Android source - ADB not available', () => {
    test('shows ADB not installed message', async ({ page, electronApp }) => {
      await setupBaseMocks(electronApp)

      await electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('sources:is-adb-available')
        ipcMain.handle('sources:is-adb-available', () => false)

        ipcMain.removeHandler('sources:list-available-android')
        ipcMain.handle('sources:list-available-android', () => [])
      })

      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      await page.locator(S.addSourceBtn).click()

      const select = page.locator(`${S.dialog} select`)
      await select.selectOption('Android')

      await expect(page.locator(`${S.dialog} ${S.sourceList} p`)).toContainText('ADB is not installed')

      await page.locator(S.dialogCloseBtn).click()
    })
  })

  test.describe('Android source - no devices', () => {
    test('shows no devices message when ADB available but no devices', async ({ page, electronApp }) => {
      await setupBaseMocks(electronApp)

      await electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('sources:is-adb-available')
        ipcMain.handle('sources:is-adb-available', () => true)

        ipcMain.removeHandler('sources:list-available-android')
        ipcMain.handle('sources:list-available-android', () => [])
      })

      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      await page.locator(S.addSourceBtn).click()

      const select = page.locator(`${S.dialog} select`)
      await select.selectOption('Android')

      await expect(page.locator(`${S.dialog} ${S.sourceList} p`)).toContainText('No Android devices detected')

      await page.locator(S.dialogCloseBtn).click()
    })
  })

  test.describe('Android source - with devices', () => {
    test('shows device button when devices available', async ({ page, electronApp }) => {
      await setupBaseMocks(electronApp)

      await electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('sources:is-adb-available')
        ipcMain.handle('sources:is-adb-available', () => true)

        ipcMain.removeHandler('sources:list-available-android')
        ipcMain.handle('sources:list-available-android', () => [
          { serial: 'abc123', model: 'Pixel 7', state: 'device' },
        ])
      })

      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      await page.locator(S.addSourceBtn).click()

      const select = page.locator(`${S.dialog} select`)
      await select.selectOption('Android')

      const deviceBtn = page.locator(S.sourceOptionBtn, { hasText: 'Pixel 7 (device)' })
      await expect(deviceBtn).toBeVisible()

      await page.locator(S.dialogCloseBtn).click()
    })
  })

  test.describe('iOS source', () => {
    test('shows device button when iOS devices available', async ({ page, electronApp }) => {
      await setupBaseMocks(electronApp)

      await electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('sources:list-available-ios')
        ipcMain.handle('sources:list-available-ios', () => [
          { deviceId: 'dev1', name: 'iPhone 15', model: 'iPhone15,3' },
        ])
      })

      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      await page.locator(S.addSourceBtn).click()

      const select = page.locator(`${S.dialog} select`)
      await select.selectOption('Ios')

      const deviceBtn = page.locator(S.sourceOptionBtn, { hasText: 'iPhone 15 (iPhone15,3)' })
      await expect(deviceBtn).toBeVisible()

      await page.locator(S.dialogCloseBtn).click()
    })
  })

  test.describe('iOS source empty', () => {
    test('shows no devices message', async ({ page, electronApp }) => {
      await setupBaseMocks(electronApp)

      await electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('sources:list-available-ios')
        ipcMain.handle('sources:list-available-ios', () => [])
      })

      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      await page.locator(S.addSourceBtn).click()

      const select = page.locator(`${S.dialog} select`)
      await select.selectOption('Ios')

      await expect(page.locator(`${S.dialog} ${S.sourceList} p`)).toContainText('No iOS devices detected')

      await page.locator(S.dialogCloseBtn).click()
    })
  })

  test.describe('Dialog behavior', () => {
    test('cancel button closes dialog', async ({ page, electronApp }) => {
      await setupBaseMocks(electronApp)

      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      await page.locator(S.addSourceBtn).click()
      await expect(page.locator(S.dialogOverlay)).toBeVisible()

      await page.locator(S.dialogCloseBtn).click()
      await expect(page.locator(S.dialogOverlay)).toBeHidden()
    })

    test('overlay click closes dialog', async ({ page, electronApp }) => {
      await setupBaseMocks(electronApp)

      await page.reload()
      await page.locator(S.appHeader).waitFor({ state: 'visible', timeout: 30000 })

      await page.locator(S.addSourceBtn).click()
      await expect(page.locator(S.dialogOverlay)).toBeVisible()

      // Click overlay outside the dialog to close
      await page.locator(S.dialogOverlay).click({ position: { x: 5, y: 5 } })
      await expect(page.locator(S.dialogOverlay)).toBeHidden()
    })
  })
})
