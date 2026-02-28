/**
 * E2E tests for independent audio tracks — REAL USER FLOWS.
 *
 * Unlike the store-injection tests in independent-audio.test.ts, these tests
 * exercise the actual UI flows a user would follow: importing audio via the
 * context menu (with dialog mocked in the MAIN process via ipcMain), dragging
 * clips, trimming, replacing audio, splitting, and copy/cut/paste.
 *
 * Store injection is ONLY used for video clip setup (prerequisite for audio
 * tracks to render, since they depend on totalDuration > 0).
 *
 * Coverage:
 * - Import Audio File via timeline context menu
 * - Playback produces audio signal after UI import
 * - Drag-move clip via mouse events
 * - Trim clip via right trim handle
 * - Replace Audio via clip context menu
 * - Volume/Mute change + playback signal persists
 * - Split at Playhead via context menu after import
 * - Cut/Copy/Paste keyboard shortcuts with imported clip
 *
 * Key technique: `window.api` is frozen via `contextBridge.exposeInMainWorld()`.
 * You CANNOT override `window.api.invoke` in the renderer. Instead, mock IPC
 * handlers in the main process via `electronApp.evaluate(({ ipcMain }) => ...)`.
 */

import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import {
  closeLeftoverDialogs,
  setupEditorWithClips,
  cleanupEditor,
  createTestWav,
} from '../helpers/test-utils'
import * as fs from 'fs'

const TEST_WAV_PATH = '/tmp/test-indie-e2e-tone.wav'
const TEST_WAV_2_PATH = '/tmp/test-indie-e2e-tone2.wav'

/**
 * Import an audio file via the timeline context menu.
 * Mocks `dialog:open-file` in the main process to return the given file path,
 * then right-clicks the timeline, clicks "Import Audio File...", and waits
 * for the audio clip to appear.
 */
async function importAudioViaContextMenu(
  electronApp: ElectronApplication,
  page: Page,
  wavPath: string,
): Promise<void> {
  await electronApp.evaluate(({ ipcMain }, path) => {
    ipcMain.removeHandler('dialog:open-file')
    ipcMain.handle('dialog:open-file', () => path)
  }, wavPath)

  const timeline = page.locator('.timeline')
  await timeline.click({ button: 'right', position: { x: 10, y: 10 } })
  const menu = page.locator('.timeline-context-menu')
  await expect(menu).toBeVisible({ timeout: 3_000 })
  await menu
    .locator('.timeline-context-menu-item')
    .filter({ hasText: 'Import Audio File' })
    .click()

  await expect(page.locator('.independent-audio-clip')).toHaveCount(1, { timeout: 10_000 })
}

test.describe('Independent audio - real user flow', () => {
  test.beforeAll(async () => {
    createTestWav(TEST_WAV_PATH, 2) // 2 seconds 440Hz sine
    createTestWav(TEST_WAV_2_PATH, 3) // 3 seconds for replace test
  })

  test.afterAll(() => {
    fs.rmSync(TEST_WAV_PATH, { force: true })
    fs.rmSync(TEST_WAV_2_PATH, { force: true })
  })

  test.beforeEach(async ({ electronApp, page }) => {
    await closeLeftoverDialogs(page)
    // Restore real dialog handler in case previous test mocked it.
    // electronApp.evaluate passes the `electron` module as the first argument,
    // so we destructure both `ipcMain` and `dialog` from it (no `require` needed).
    await electronApp.evaluate(({ ipcMain, dialog }) => {
      try {
        ipcMain.removeHandler('dialog:open-file')
      } catch {
        /* handler may not exist */
      }
      ipcMain.handle('dialog:open-file', async (_event, options) => {
        const result = await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: options?.filters,
        })
        if (result.canceled || result.filePaths.length === 0) return null
        return result.filePaths[0]
      })
    })
  })

  test.afterEach(async ({ page }) => {
    await cleanupEditor(page)
  })

  // ==================== Test 1: Import Audio File via context menu ====================

  test('import audio file via timeline context menu', async ({ electronApp, page }) => {
    // Setup: need video clips for totalDuration > 0 (audio tracks won't render otherwise)
    await setupEditorWithClips(page, 2) // 2 video clips, 3000ms each = 6000ms total

    await importAudioViaContextMenu(electronApp, page, TEST_WAV_PATH)

    // Wait for audio track row to appear
    const audioTrackRow = page.locator('.audio-track-row.independent')
    await expect(audioTrackRow).toHaveCount(1, { timeout: 10_000 })

    const audioClip = page.locator('.independent-audio-clip')

    // Verify label derived from filename
    const label = audioClip.locator('.audio-clip-label')
    await expect(label).toContainText('test-indie-e2e-t') // truncated to 16 chars

    // Verify store state
    const trackData = await page.evaluate((expectedPath) => {
      const store = (window as any).__editorStore
      const tracks = store.getState().project.independentAudioTracks
      return {
        trackCount: tracks.length,
        clipCount: tracks[0]?.clips?.length ?? 0,
        sourcePath: tracks[0]?.clips?.[0]?.sourcePath ?? null,
        originalDuration: tracks[0]?.clips?.[0]?.originalDuration ?? 0,
      }
    }, TEST_WAV_PATH)

    expect(trackData.trackCount).toBe(1)
    expect(trackData.clipCount).toBe(1)
    expect(trackData.sourcePath).toBe(TEST_WAV_PATH)
    expect(trackData.originalDuration).toBeGreaterThan(0)
  })

  // ==================== Test 2: Playback produces audio signal after UI import ====================

  test('playback produces audio signal after import via UI', async ({ electronApp, page }) => {
    await setupEditorWithClips(page, 2)

    await importAudioViaContextMenu(electronApp, page, TEST_WAV_PATH)

    // Wait for audio buffers to load
    await page.waitForFunction(
      () => (window as any).__independentAudioLoadState?.loaded === true,
      { timeout: 15_000, polling: 200 },
    )

    // Click Play
    await page.locator(S.playBtn).click()
    await page.waitForTimeout(300)

    // Sample signal
    const samples: number[] = []
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(100)
      const level = await page.evaluate(() => {
        const fn = (window as any).__getIndependentAudioSignalLevel
        return fn ? fn() : -1
      })
      samples.push(level)
    }

    // Stop playback
    await page.locator(S.playBtn).click()

    // Verify signal
    const nonZeroCount = samples.filter((s) => s > 0).length
    const maxSignal = Math.max(...samples)
    expect(
      nonZeroCount,
      `Expected >=3 non-zero samples, got ${nonZeroCount}/10: [${samples.map((s) => s.toFixed(3)).join(', ')}]`,
    ).toBeGreaterThanOrEqual(3)
    expect(
      maxSignal,
      `Peak signal >=0.05, got ${maxSignal.toFixed(4)}`,
    ).toBeGreaterThan(0.05)
  })

  // ==================== Test 3: Drag-move clip via mouse events ====================

  test('drag-move audio clip changes its position', async ({ electronApp, page }) => {
    await setupEditorWithClips(page, 2)

    await importAudioViaContextMenu(electronApp, page, TEST_WAV_PATH)

    // Get initial position
    const clip = page.locator('.independent-audio-clip')
    const boxBefore = await clip.boundingBox()
    expect(boxBefore).not.toBeNull()

    // Simulate drag: mousedown on clip center, then mousemove 100px right, then mouseup
    const centerX = boxBefore!.x + boxBefore!.width / 2
    const centerY = boxBefore!.y + boxBefore!.height / 2

    // mousedown via Playwright (this fires on the element)
    await page.mouse.move(centerX, centerY)
    await page.mouse.down()

    // mousemove via dispatchEvent (Electron workaround — page.mouse.move during
    // a drag does NOT reliably dispatch window-level mousemove events)
    const targetX = centerX + 100
    await page.evaluate((x) => {
      window.dispatchEvent(
        new MouseEvent('mousemove', { clientX: x, bubbles: true }),
      )
    }, targetX)
    await page.waitForTimeout(50)

    // mouseup
    await page.evaluate(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    await page.waitForTimeout(200)

    // Verify position changed
    const boxAfter = await clip.boundingBox()
    expect(boxAfter).not.toBeNull()
    expect(boxAfter!.x).toBeGreaterThan(boxBefore!.x)
  })

  // ==================== Test 4: Trim clip via trim handle ====================

  test('trim audio clip via right trim handle changes width', async ({ electronApp, page }) => {
    await setupEditorWithClips(page, 2)

    await importAudioViaContextMenu(electronApp, page, TEST_WAV_PATH)

    // Get initial width
    const clip = page.locator('.independent-audio-clip')
    const boxBefore = await clip.boundingBox()
    expect(boxBefore).not.toBeNull()

    // Find right trim handle
    // Trim handle mousedown has e.stopPropagation() so it won't trigger clip move.
    // Window-level mousemove/mouseup listeners handle the rest.
    const trimHandle = clip.locator('.trim-handle.right')
    const handleBox = await trimHandle.boundingBox()
    expect(handleBox).not.toBeNull()

    // Drag trim handle 50px left to trim the clip
    const handleCenterX = handleBox!.x + handleBox!.width / 2
    const handleCenterY = handleBox!.y + handleBox!.height / 2

    await page.mouse.move(handleCenterX, handleCenterY)
    await page.mouse.down()

    await page.evaluate((x) => {
      window.dispatchEvent(
        new MouseEvent('mousemove', { clientX: x, bubbles: true }),
      )
    }, handleCenterX - 50)
    await page.waitForTimeout(50)

    await page.evaluate(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    await page.waitForTimeout(200)

    // Verify width decreased
    const boxAfter = await clip.boundingBox()
    expect(boxAfter).not.toBeNull()
    expect(boxAfter!.width).toBeLessThan(boxBefore!.width)
  })

  // ==================== Test 5: Replace Audio via context menu ====================

  test('replace audio via context menu changes source path', async ({ electronApp, page }) => {
    await setupEditorWithClips(page, 2)

    // Import first audio file
    await importAudioViaContextMenu(electronApp, page, TEST_WAV_PATH)

    // Verify initial source path
    const initialPath = await page.evaluate(() => {
      const store = (window as any).__editorStore
      return store.getState().project.independentAudioTracks[0]?.clips[0]?.sourcePath
    })
    expect(initialPath).toBe(TEST_WAV_PATH)

    // Now mock dialog to return a DIFFERENT file
    await electronApp.evaluate(({ ipcMain }, wavPath) => {
      ipcMain.removeHandler('dialog:open-file')
      ipcMain.handle('dialog:open-file', () => wavPath)
    }, TEST_WAV_2_PATH)

    // Right-click the audio clip to open context menu with "Replace Audio..."
    const clip = page.locator('.independent-audio-clip')
    await clip.click({ button: 'right' })
    const menu = page.locator('.timeline-context-menu')
    await expect(menu).toBeVisible({ timeout: 3_000 })

    const replaceItem = menu
      .locator('.timeline-context-menu-item')
      .filter({ hasText: 'Replace Audio' })
    // Context menu is portaled to document.body and may be off-screen — use dispatchEvent
    await expect(replaceItem).toBeVisible()
    await replaceItem.dispatchEvent('click')

    // Wait for the replacement to complete (probe + store update)
    await page.waitForFunction(
      (expectedPath) => {
        const store = (window as any).__editorStore
        const tracks = store.getState().project.independentAudioTracks
        return tracks[0]?.clips[0]?.sourcePath === expectedPath
      },
      TEST_WAV_2_PATH,
      { timeout: 10_000, polling: 200 },
    )

    // Verify the source path changed
    const newPath = await page.evaluate(() => {
      const store = (window as any).__editorStore
      return store.getState().project.independentAudioTracks[0]?.clips[0]?.sourcePath
    })
    expect(newPath).toBe(TEST_WAV_2_PATH)
  })

  // ==================== Test 6: Volume/Mute change + playback signal persists ====================

  test('audio signal persists after volume change via mixer UI', async ({
    electronApp,
    page,
  }) => {
    await setupEditorWithClips(page, 2)

    // Import audio via UI
    await importAudioViaContextMenu(electronApp, page, TEST_WAV_PATH)

    // Wait for audio to load
    await page.waitForFunction(
      () => (window as any).__independentAudioLoadState?.loaded === true,
      { timeout: 15_000, polling: 200 },
    )

    // Open mixer and change volume
    await page.locator('.editor-mixer-btn').click()
    await page.waitForTimeout(1000)

    const windows = electronApp.windows()
    const mixerPage = windows.find((w) => w !== page)
    expect(mixerPage).toBeTruthy()

    if (mixerPage) {
      await mixerPage
        .locator('.mixer-window-tracks')
        .waitFor({ state: 'visible', timeout: 5000 })

      // Change volume
      const volumeSliders = mixerPage.locator('.mixer-window-volume')
      await expect(volumeSliders.first()).toBeVisible({ timeout: 3000 })
      await volumeSliders.first().fill('50')
      await page.waitForTimeout(500)

      await mixerPage.close()
    }

    // Play and verify signal
    await page.locator(S.playBtn).click()
    await page.waitForTimeout(300)

    const samples: number[] = []
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(100)
      const level = await page.evaluate(() => {
        const fn = (window as any).__getIndependentAudioSignalLevel
        return fn ? fn() : -1
      })
      samples.push(level)
    }

    await page.locator(S.playBtn).click()

    const nonZeroCount = samples.filter((s) => s > 0).length
    const maxSignal = Math.max(...samples)
    expect(
      nonZeroCount,
      `Expected >=3 non-zero after vol change: [${samples.map((s) => s.toFixed(3)).join(', ')}]`,
    ).toBeGreaterThanOrEqual(3)
    expect(
      maxSignal,
      `Peak >=0.05 after vol change, got ${maxSignal.toFixed(4)}`,
    ).toBeGreaterThan(0.05)
  })

  // ==================== Test 7: Split at Playhead via UI after import ====================

  test('split at playhead via context menu after import', async ({ electronApp, page }) => {
    await setupEditorWithClips(page, 2)

    // Import audio via UI
    await importAudioViaContextMenu(electronApp, page, TEST_WAV_PATH)

    // Seek playhead to middle of clip
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      const clip = store.getState().project.independentAudioTracks[0]?.clips[0]
      if (clip) {
        const midpoint =
          clip.timelineStartMs +
          (clip.originalDuration - clip.trimStart - clip.trimEnd) / 2
        store.getState().seekTo(midpoint)
      }
    })
    await page.waitForTimeout(100)

    // Select the clip and right-click
    const audioClip = page.locator('.independent-audio-clip')
    await audioClip.click()
    await audioClip.click({ button: 'right', position: { x: 10, y: 10 } })

    const ctxMenu = page.locator('.timeline-context-menu')
    await expect(ctxMenu).toBeVisible({ timeout: 3_000 })

    // Click "Split at Playhead"
    const splitItem = ctxMenu
      .locator('.timeline-context-menu-item')
      .filter({ hasText: 'Split at Playhead' })
    await expect(splitItem).toBeEnabled()
    await splitItem.dispatchEvent('click')

    // Should now have 2 clips
    await expect(page.locator('.independent-audio-clip')).toHaveCount(2, { timeout: 5_000 })
  })

  // ==================== Test 8: Cut/Copy/Paste with imported clip ====================

  test('cut, copy, paste keyboard shortcuts work with imported clip', async ({
    electronApp,
    page,
  }) => {
    await setupEditorWithClips(page, 2)

    // Import audio
    await importAudioViaContextMenu(electronApp, page, TEST_WAV_PATH)

    const audioClips = page.locator('.independent-audio-clip')

    // Select, Copy, Paste
    await audioClips.first().click()
    await expect(audioClips.first()).toHaveClass(/selected/)

    await page.keyboard.press('Meta+c')
    await page.keyboard.press('Meta+v')

    await expect(audioClips).toHaveCount(2, { timeout: 5_000 })

    // Select first clip for Cut.
    // After paste, clips may overlap (pasted clip starts at same position or nearby).
    // Use force:true to bypass Playwright's actionability check for pointer interception.
    await audioClips.first().click({ force: true })
    await page.keyboard.press('Meta+x')
    await expect(audioClips).toHaveCount(1, { timeout: 5_000 })

    // Paste back
    await page.keyboard.press('Meta+v')
    await expect(audioClips).toHaveCount(2, { timeout: 5_000 })
  })

  // ==================== Evidence Collection ====================

  test('evidence: screenshot + signal data collection', async ({ electronApp, page }) => {
    const evidenceDir = '/private/tmp/e2e-video-evidence'
    fs.mkdirSync(evidenceDir, { recursive: true })

    await setupEditorWithClips(page, 2)

    // Screenshot 1: Editor with video clips (before audio import)
    await page.screenshot({ path: `${evidenceDir}/01-editor-before-import.png` })

    // Import audio via context menu
    await importAudioViaContextMenu(electronApp, page, TEST_WAV_PATH)

    // Screenshot 2: Audio clip imported
    await page.screenshot({ path: `${evidenceDir}/02-audio-clip-imported.png` })

    // Wait for audio buffers to load
    await page.waitForFunction(
      () => (window as any).__independentAudioLoadState?.loaded === true,
      { timeout: 15_000, polling: 200 },
    )

    // Play and capture signal
    await page.locator(S.playBtn).click()
    await page.waitForTimeout(300)

    // Screenshot 3: During playback
    await page.screenshot({ path: `${evidenceDir}/03-during-playback.png` })

    const samples: number[] = []
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(100)
      const level = await page.evaluate(() => {
        const fn = (window as any).__getIndependentAudioSignalLevel
        return fn ? fn() : -1
      })
      samples.push(level)
    }

    await page.locator(S.playBtn).click()

    // Screenshot 4: After stop
    await page.screenshot({ path: `${evidenceDir}/04-after-stop.png` })

    // Save signal data
    const signalData = {
      timestamp: new Date().toISOString(),
      testWavPath: TEST_WAV_PATH,
      samples,
      nonZeroCount: samples.filter(s => s > 0).length,
      maxSignal: Math.max(...samples),
      avgSignal: samples.reduce((a, b) => a + b, 0) / samples.length,
    }
    fs.writeFileSync(`${evidenceDir}/signal-data.json`, JSON.stringify(signalData, null, 2))

    // Open mixer
    await page.locator('.editor-mixer-btn').click()
    await page.waitForTimeout(1000)

    const windows = electronApp.windows()
    const mixerPage = windows.find(w => w !== page)
    if (mixerPage) {
      await mixerPage.locator('.mixer-window-tracks').waitFor({ state: 'visible', timeout: 5000 })

      // Screenshot 5: Mixer window with independent audio track
      await mixerPage.screenshot({ path: `${evidenceDir}/05-mixer-window.png` })
      await mixerPage.close()
    }

    // Verify signal data
    expect(signalData.nonZeroCount).toBeGreaterThanOrEqual(3)
    expect(signalData.maxSignal).toBeGreaterThan(0.05)
  })
})
