import { test, expect } from '../fixtures/electron-app'
import { closeLeftoverDialogs, cleanupEditor, createTestBundle, createTestWav } from '../helpers/test-utils'
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

  test('Audio plays after split, delete first half, and save (bug: startPlayback only at time=0)', async ({ electronApp, page }: any) => {
    // This test reproduces the bug where independent audio clips fail to play
    // after: split -> delete first half -> save. The root cause is that
    // startPlayback is called only once at time=0 when isPlaying becomes true,
    // but the remaining clip starts at a later time (e.g. 1500ms). As the
    // playback engine advances time in small increments (~16ms per frame),
    // the seek effect threshold (timeDiff > 100) is never exceeded, so
    // startPlayback is never re-triggered when time crosses the clip boundary.

    const TEST_WAV = path.join(TEST_BUNDLE, 'test-audio.wav')

    // Step 1: Create a real 440Hz sine WAV file (3 seconds) for the audio clip
    createTestWav(TEST_WAV, 3)

    // Step 2: Navigate to Editor and load a project with one independent audio clip
    await page.locator('.header-tab').filter({ hasText: 'Editor' }).click()
    await page.waitForTimeout(300)

    await page.evaluate(async (args: { bundlePath: string; wavPath: string }) => {
      const store = (window as any).__editorStore
      await store.getState().loadSavedProject(args.bundlePath, {
        version: 1,
        savedAt: new Date().toISOString(),
        project: {
          clips: [{
            id: 'clip-1',
            sourcePath: 'bundle.mp4',
            originalDuration: 5000,
            trimStart: 0,
            trimEnd: 0,
            order: 0,
          }],
          textOverlays: [],
          independentAudioTracks: [{
            id: 'audio-track-1',
            label: 'Test Audio',
            volume: 1,
            muted: false,
            clips: [{
              id: 'audio-clip-1',
              sourcePath: args.wavPath,
              originalDuration: 3000,
              trimStart: 0,
              trimEnd: 0,
              timelineStartMs: 0,
            }],
          }],
          outputWidth: 1920,
          outputHeight: 1080,
        },
      })
    }, { bundlePath: TEST_BUNDLE, wavPath: TEST_WAV })

    // Wait for audio to load
    await page.waitForFunction(() => {
      const state = (window as any).__independentAudioLoadState
      return state && state.loaded === true
    }, { timeout: 10_000 })

    // Step 3: Select the audio clip and split at 1500ms (midpoint)
    const splitPoint = 1500
    await page.evaluate((splitMs: number) => {
      const store = (window as any).__editorStore
      store.getState().selectAudioClip('audio-clip-1', 'single')
      store.getState().seekTo(splitMs)
      store.getState().splitAtPlayhead()
    }, splitPoint)

    await page.waitForTimeout(300)

    // Step 4: Verify split produced two clips, find the first half and delete it
    const splitResult = await page.evaluate(() => {
      const store = (window as any).__editorStore
      const tracks = store.getState().project.independentAudioTracks
      const clips = tracks[0]?.clips || []
      return clips.map((c: any) => ({
        id: c.id,
        timelineStartMs: c.timelineStartMs,
        trimStart: c.trimStart,
        trimEnd: c.trimEnd,
        originalDuration: c.originalDuration,
      }))
    })

    expect(splitResult).toHaveLength(2)

    // Find the first half (starts at 0) and select it for deletion
    const firstHalfClip = splitResult.find((c: any) => c.timelineStartMs === 0)
    expect(firstHalfClip).toBeTruthy()

    await page.evaluate((clipId: string) => {
      const store = (window as any).__editorStore
      store.getState().selectAudioClip(clipId, 'single')
      store.getState().removeSelectedAudioClips()
    }, firstHalfClip.id)

    await page.waitForTimeout(300)

    // Step 5: Verify only the second half remains (starts at 1500ms)
    const remainingClips = await page.evaluate(() => {
      const store = (window as any).__editorStore
      const tracks = store.getState().project.independentAudioTracks
      return (tracks[0]?.clips || []).map((c: any) => ({
        id: c.id,
        timelineStartMs: c.timelineStartMs,
        trimStart: c.trimStart,
        trimEnd: c.trimEnd,
        originalDuration: c.originalDuration,
      }))
    })

    expect(remainingClips).toHaveLength(1)
    expect(remainingClips[0].timelineStartMs).toBe(splitPoint)

    // Step 6: Save the project
    await electronApp.evaluate(({ BrowserWindow }: any) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.webContents.send('menu:save-project')
    })
    await page.waitForTimeout(1000)

    // Verify save succeeded
    const editorJsonPath = path.join(TEST_BUNDLE, 'editor.json')
    expect(fs.existsSync(editorJsonPath)).toBe(true)

    // Step 7: Reload the saved project (simulates reopening)
    const savedContent = JSON.parse(fs.readFileSync(editorJsonPath, 'utf-8'))
    await page.evaluate(async (args: { bundlePath: string; savedData: any }) => {
      const store = (window as any).__editorStore
      await store.getState().loadSavedProject(args.bundlePath, args.savedData)
    }, { bundlePath: TEST_BUNDLE, savedData: savedContent })

    // Wait for audio to reload after project restore
    await page.waitForFunction(() => {
      const state = (window as any).__independentAudioLoadState
      return state && state.loaded === true
    }, { timeout: 10_000 })

    await page.waitForTimeout(500)

    // Step 8: Start playback from time=0 (this is the bug trigger)
    // The remaining clip starts at 1500ms, so startPlayback(0) will find
    // no overlapping clips and start nothing.
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.setState({ currentTimeMs: 0, isPlaying: true })
    })

    // Wait a moment for the initial play effect to fire at time=0
    await page.waitForTimeout(200)

    // Step 9: Simulate real playback time advancement in small increments
    // In the real app, requestAnimationFrame advances time ~16ms per frame.
    // The seek effect in useIndependentAudioPlayback only calls startPlayback
    // when timeDiff > 100ms. By advancing in small steps (50ms), the threshold
    // is never exceeded, so startPlayback is never re-called when time crosses
    // from before the clip (0-1500ms) into the clip boundary (1500ms+).
    await page.evaluate(async (targetMs: number) => {
      const store = (window as any).__editorStore
      const step = 50 // ~3 frames at 60fps, still under the 100ms threshold
      for (let t = step; t <= targetMs + 200; t += step) {
        store.setState({ currentTimeMs: t })
        // Yield to allow React effects to process each state update
        await new Promise(r => setTimeout(r, 5))
      }
    }, splitPoint)

    // Wait for audio to potentially start playing after reaching clip region
    await page.waitForTimeout(800)

    // Step 10: Check audio signal level - should be > 0 if audio is playing
    // BUG: startPlayback was only called once at time=0 where no clip exists.
    // The small-increment time advancement never triggers startPlayback again
    // because each step (50ms) is below the 100ms threshold. The audio for
    // the remaining clip (starting at 1500ms) is never started.
    const signalLevel = await page.evaluate(() => {
      const fn = (window as any).__getIndependentAudioSignalLevel
      return fn ? fn() : -1
    })

    // Screenshot evidence before assertion
    fs.mkdirSync(VIDEO_DIR, { recursive: true })
    await page.screenshot({ path: path.join(VIDEO_DIR, 'save-project-06-audio-after-split-delete-save.png') })

    // The signal level should be > 0 because we are within the remaining clip's
    // time range and audio should be playing. With the bug, it will be 0 because
    // startPlayback was never re-called when time crossed into the clip boundary.
    console.log(`[DEBUG] Audio signal level at ${splitPoint}ms: ${signalLevel}`)
    expect(signalLevel).toBeGreaterThan(0)
  })
})
