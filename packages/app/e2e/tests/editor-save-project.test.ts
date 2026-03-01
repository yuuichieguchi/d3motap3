import { test, expect } from '../fixtures/electron-app'
import { closeLeftoverDialogs, cleanupEditor, createTestBundle } from '../helpers/test-utils'
import * as fs from 'fs'
import * as path from 'path'

const TEST_BUNDLE = '/tmp/e2e-save-test.d3m'
const VIDEO_DIR = '/private/tmp/e2e-video-evidence'

test.describe('Save / Load Project', () => {
  test.beforeEach(async ({ page }: any) => {
    await closeLeftoverDialogs(page)
    // Clean up any previous test bundle
    if (fs.existsSync(TEST_BUNDLE)) {
      fs.rmSync(TEST_BUNDLE, { recursive: true })
    }
    // Create test bundle
    await createTestBundle(TEST_BUNDLE)
    // Create a dummy video file inside the bundle
    fs.writeFileSync(path.join(TEST_BUNDLE, 'bundle.mp4'), Buffer.alloc(1024))
  })

  test.afterEach(async ({ page }: any) => {
    await cleanupEditor(page)
    if (fs.existsSync(TEST_BUNDLE)) {
      fs.rmSync(TEST_BUNDLE, { recursive: true })
    }
  })

  test('Save Project creates editor.json in the bundle', async ({ electronApp, page }: any) => {
    // Navigate to editor and set up state via store
    await page.locator('.header-tab').filter({ hasText: 'Editor' }).click()
    await page.waitForTimeout(300)

    // Set up editor state with a bundle clip + text overlay
    await page.evaluate((bundlePath: string) => {
      const store = (window as any).__editorStore
      store.setState({
        project: {
          clips: [{
            id: 'clip-1',
            sourcePath: `${bundlePath}/bundle.mp4`,
            originalDuration: 3000,
            trimStart: 0,
            trimEnd: 0,
            order: 0,
          }],
          textOverlays: [{
            id: 'overlay-1',
            text: 'Hello Save Test',
            startTime: 0,
            endTime: 2000,
            x: 0.1,
            y: 0.5,
            width: 0.8,
            fontSize: 36,
            color: '#ffffff',
            fontFamily: 'sans-serif',
            fontWeight: 'normal',
            fontStyle: 'normal',
            textAlign: 'center',
            backgroundColor: null,
            borderColor: null,
            borderWidth: 0,
            shadowColor: null,
            shadowOffsetX: 0,
            shadowOffsetY: 0,
            animation: 'none',
            animationDuration: 500,
          }],
          independentAudioTracks: [],
          outputWidth: 1920,
          outputHeight: 1080,
        },
        currentBundlePath: bundlePath,
        isDirty: true,
      })
    }, TEST_BUNDLE)

    await page.waitForTimeout(300)

    // Trigger save via menu:save-project IPC event
    await electronApp.evaluate(({ BrowserWindow }: any) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.webContents.send('menu:save-project')
    })

    // Wait for save to complete
    await page.waitForTimeout(1000)

    // Verify editor.json was created
    const editorJsonPath = path.join(TEST_BUNDLE, 'editor.json')
    expect(fs.existsSync(editorJsonPath)).toBe(true)

    const content = JSON.parse(fs.readFileSync(editorJsonPath, 'utf-8'))
    expect(content.version).toBe(1)
    expect(content.savedAt).toBeTruthy()
    expect(content.project.clips).toHaveLength(1)
    // Path should be relative (bundle.mp4, not absolute)
    expect(content.project.clips[0].sourcePath).toBe('bundle.mp4')
    expect(content.project.textOverlays).toHaveLength(1)
    expect(content.project.textOverlays[0].text).toBe('Hello Save Test')

    // Verify isDirty was reset
    const isDirty = await page.evaluate(() => {
      return (window as any).__editorStore.getState().isDirty
    })
    expect(isDirty).toBe(false)

    // Screenshot evidence
    fs.mkdirSync(VIDEO_DIR, { recursive: true })
    await page.screenshot({ path: path.join(VIDEO_DIR, 'save-project-01-after-save.png') })
  })

  test('Load Project restores editor state from editor.json', async ({ electronApp, page }: any) => {
    // Pre-create editor.json in the bundle
    const saveData = {
      version: 1,
      savedAt: '2026-03-01T00:00:00.000Z',
      project: {
        clips: [{
          id: 'clip-1',
          sourcePath: 'bundle.mp4',
          originalDuration: 3000,
          trimStart: 200,
          trimEnd: 300,
          order: 0,
        }],
        textOverlays: [{
          id: 'overlay-1',
          text: 'Restored Overlay',
          startTime: 100,
          endTime: 1500,
          x: 0.2,
          y: 0.4,
          width: 0.6,
          fontSize: 42,
          color: '#ff0000',
          fontFamily: 'serif',
          fontWeight: 'bold',
          fontStyle: 'normal',
          textAlign: 'left',
          backgroundColor: null,
          borderColor: null,
          borderWidth: 0,
          shadowColor: null,
          shadowOffsetX: 0,
          shadowOffsetY: 0,
          animation: 'fade-in',
          animationDuration: 500,
        }],
        independentAudioTracks: [],
        outputWidth: 1920,
        outputHeight: 1080,
      },
    }
    fs.writeFileSync(
      path.join(TEST_BUNDLE, 'editor.json'),
      JSON.stringify(saveData, null, 2),
    )

    // Open the bundle via IPC (simulating menu open or Finder double-click)
    await electronApp.evaluate(({ BrowserWindow }: any, bundlePath: string) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.webContents.send('open-bundle', bundlePath)
    }, TEST_BUNDLE)

    // Wait for load to complete
    await page.waitForTimeout(2000)

    // Verify the editor view is shown
    await expect(page.locator('.editor-view')).toBeVisible({ timeout: 5000 })

    // Verify project state was restored
    const state = await page.evaluate(() => {
      const store = (window as any).__editorStore
      const s = store.getState()
      return {
        clipCount: s.project.clips.length,
        clipTrimStart: s.project.clips[0]?.trimStart,
        clipTrimEnd: s.project.clips[0]?.trimEnd,
        overlayCount: s.project.textOverlays.length,
        overlayText: s.project.textOverlays[0]?.text,
        overlayColor: s.project.textOverlays[0]?.color,
        overlayFontWeight: s.project.textOverlays[0]?.fontWeight,
        overlayAnimation: s.project.textOverlays[0]?.animation,
        currentBundlePath: s.currentBundlePath,
        isDirty: s.isDirty,
      }
    })

    expect(state.clipCount).toBe(1)
    expect(state.clipTrimStart).toBe(200)
    expect(state.clipTrimEnd).toBe(300)
    expect(state.overlayCount).toBe(1)
    expect(state.overlayText).toBe('Restored Overlay')
    expect(state.overlayColor).toBe('#ff0000')
    expect(state.overlayFontWeight).toBe('bold')
    expect(state.overlayAnimation).toBe('fade-in')
    expect(state.currentBundlePath).toBe(TEST_BUNDLE)
    expect(state.isDirty).toBe(false)

    // Screenshot evidence
    await page.screenshot({ path: path.join(VIDEO_DIR, 'save-project-02-after-load.png') })
  })

  test('New Project resets editor and returns to recording view', async ({ electronApp, page }: any) => {
    // Navigate to editor tab first
    await page.locator('.header-tab').filter({ hasText: 'Editor' }).click()
    await page.waitForTimeout(300)

    // Set up some state
    await page.evaluate((bundlePath: string) => {
      const store = (window as any).__editorStore
      store.setState({
        project: {
          clips: [{
            id: 'clip-1',
            sourcePath: `${bundlePath}/bundle.mp4`,
            originalDuration: 3000,
            trimStart: 0,
            trimEnd: 0,
            order: 0,
          }],
          textOverlays: [],
          independentAudioTracks: [],
          outputWidth: 1920,
          outputHeight: 1080,
        },
        currentBundlePath: bundlePath,
      })
    }, TEST_BUNDLE)

    await page.waitForTimeout(300)

    // Trigger New Project via IPC
    await electronApp.evaluate(({ BrowserWindow }: any) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.webContents.send('menu:new-project')
    })

    await page.waitForTimeout(500)

    // Verify recording view is shown (recording section visible)
    await expect(page.locator('.recording-section')).toBeVisible({ timeout: 5000 })

    // Verify editor state was reset
    const state = await page.evaluate(() => {
      const store = (window as any).__editorStore
      const s = store.getState()
      return {
        clipCount: s.project.clips.length,
        currentBundlePath: s.currentBundlePath,
        isDirty: s.isDirty,
      }
    })

    expect(state.clipCount).toBe(0)
    expect(state.currentBundlePath).toBeNull()
    expect(state.isDirty).toBe(false)

    // Screenshot evidence
    await page.screenshot({ path: path.join(VIDEO_DIR, 'save-project-03-new-project.png') })
  })

  test('Save Project menu is disabled when clean, enabled when dirty', async ({ electronApp, page }: any) => {
    // Navigate to editor tab
    await page.locator('.header-tab').filter({ hasText: 'Editor' }).click()
    await page.waitForTimeout(300)

    // Step 1: Load project via loadSavedProject (uses _suppressDirty internally)
    // This is the proper way to set up a "clean" editor state with isDirty: false
    await page.evaluate(async (bundlePath: string) => {
      const store = (window as any).__editorStore
      await store.getState().loadSavedProject(bundlePath, {
        version: 1,
        savedAt: new Date().toISOString(),
        project: {
          clips: [{
            id: 'clip-1',
            sourcePath: 'bundle.mp4',
            originalDuration: 3000,
            trimStart: 0,
            trimEnd: 0,
            order: 0,
          }],
          textOverlays: [],
          independentAudioTracks: [],
          outputWidth: 1920,
          outputHeight: 1080,
        },
      })
    }, TEST_BUNDLE)

    await page.waitForTimeout(500)

    // Verify isDirty is false and Save Project menu is disabled
    const disabledWhenClean = await electronApp.evaluate(({ Menu }: any) => {
      return Menu.getApplicationMenu()?.getMenuItemById('save-project')?.enabled
    })
    expect(disabledWhenClean).toBe(false)

    // Step 2: Make a project change to trigger isDirty via the subscribe handler
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      const state = store.getState()
      store.setState({
        project: { ...state.project, outputWidth: 1280 },
      })
    })

    // Wait for IPC to propagate the dirty state to the main process menu
    await page.waitForTimeout(500)

    // isDirty should now be true and Save Project menu should be enabled
    const enabledWhenDirty = await electronApp.evaluate(({ Menu }: any) => {
      return Menu.getApplicationMenu()?.getMenuItemById('save-project')?.enabled
    })
    expect(enabledWhenDirty).toBe(true)

    // Screenshot evidence: menu enabled state
    fs.mkdirSync(VIDEO_DIR, { recursive: true })
    await page.screenshot({ path: path.join(VIDEO_DIR, 'save-project-04-menu-enabled-dirty.png') })

    // Step 3: Trigger save via menu:save-project IPC
    await electronApp.evaluate(({ BrowserWindow }: any) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.webContents.send('menu:save-project')
    })

    // Wait for save to complete
    await page.waitForTimeout(1000)

    // After save, isDirty should be false and menu should be disabled again
    const isDirtyAfterSave = await page.evaluate(() => {
      return (window as any).__editorStore.getState().isDirty
    })
    expect(isDirtyAfterSave).toBe(false)

    const disabledAfterSave = await electronApp.evaluate(({ Menu }: any) => {
      return Menu.getApplicationMenu()?.getMenuItemById('save-project')?.enabled
    })
    expect(disabledAfterSave).toBe(false)

    // Screenshot evidence: menu disabled after save
    await page.screenshot({ path: path.join(VIDEO_DIR, 'save-project-05-menu-disabled-after-save.png') })
  })
})
