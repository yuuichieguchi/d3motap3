/**
 * Shared E2E test helpers.
 *
 * Centralises common setup/teardown routines so individual test files stay
 * focused on the behaviour they verify.
 */

import { expect } from '@playwright/test'
import { S } from './selectors'
import type { Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

// ---------------------------------------------------------------------------
// Dialog cleanup
// ---------------------------------------------------------------------------

/**
 * Close any leftover dialog from a previous test (shared Electron instance).
 * Uses the dialog-close-btn rather than overlay click (dialog stopPropagation blocks it).
 */
export async function closeLeftoverDialogs(page: Page): Promise<void> {
  const closeBtn = page.locator(S.dialogCloseBtn)
  if (await closeBtn.isVisible({ timeout: 500 }).catch(() => false)) {
    await closeBtn.click()
    await page.locator(S.dialogOverlay).waitFor({ state: 'hidden' })
  }
}

// ---------------------------------------------------------------------------
// Source management
// ---------------------------------------------------------------------------

/**
 * Add a Display source via the Add Source dialog.
 * Opens dialog, selects the first display option, waits for dialog to close.
 */
export async function addDisplaySource(page: Page): Promise<void> {
  await page.locator(S.addSourceBtn).click()
  await page.locator(S.dialog).waitFor({ state: 'visible' })
  await page.locator(S.sourceOptionBtn).first().click()
  await page.locator(S.dialog).waitFor({ state: 'hidden', timeout: 10_000 })
}

/**
 * Add a Terminal source via the Add Source dialog.
 * Opens dialog, switches type to Terminal, clicks the first terminal option.
 */
export async function addTerminalSource(page: Page): Promise<void> {
  await page.locator(S.addSourceBtn).click()
  await page.locator(S.dialog).waitFor({ state: 'visible' })
  await page.locator(`${S.dialog} select`).selectOption('Terminal')
  await page.locator(S.sourceOptionBtn).first().click()
  await page.locator(S.dialog).waitFor({ state: 'hidden', timeout: 10_000 })
}

/**
 * Remove all existing sources by clicking remove buttons until none remain.
 */
export async function removeAllSources(page: Page): Promise<void> {
  while (true) {
    const btn = page.locator(S.sourceRemoveBtn).first()
    if (!(await btn.isVisible({ timeout: 500 }).catch(() => false))) break
    await btn.click()
    await page.waitForTimeout(300)
  }
}

// ---------------------------------------------------------------------------
// Editor store helpers
// ---------------------------------------------------------------------------

interface MockClipSpec {
  id: string
  duration: number
}

/**
 * Create mock clip data for populating the editor store.
 *
 * Accepts either a count (each clip defaults to 3000ms) or an explicit
 * array of `{ id, duration }` specs for finer control.
 */
export function makeMockClips(countOrSpecs: number | MockClipSpec[]) {
  if (typeof countOrSpecs === 'number') {
    return Array.from({ length: countOrSpecs }, (_, i) => ({
      id: `test-clip-${i}`,
      sourcePath: `/tmp/test-video-${i}.mp4`,
      originalDuration: 3000,
      trimStart: 0,
      trimEnd: 0,
      order: i,
    }))
  }
  return countOrSpecs.map((c, i) => ({
    id: c.id,
    sourcePath: `/tmp/test-video-${i}.mp4`,
    originalDuration: c.duration,
    trimStart: 0,
    trimEnd: 0,
    order: i,
  }))
}

/**
 * Navigate to the Editor tab and populate the store with mock clips.
 * Uses `window.__editorStore` (zustand store) to set state directly.
 * This is acceptable for test SETUP — actual tests interact via the UI.
 *
 * Always clears text overlays and resets selection/playback state.
 */
export async function setupEditorWithClips(
  page: Page,
  countOrSpecs: number | MockClipSpec[],
): Promise<void> {
  await page.locator('.header-tab').filter({ hasText: 'Editor' }).click()
  await page.waitForTimeout(300)

  const clipData = makeMockClips(countOrSpecs)
  await page.evaluate((data) => {
    const store = (window as any).__editorStore
    if (!store) throw new Error('__editorStore not exposed on window')
    store.setState({
      project: { ...store.getState().project, clips: data, textOverlays: [] },
      selectedClipIds: [],
      lastSelectedClipId: null,
      selectedOverlayId: null,
      currentTimeMs: 0,
      isPlaying: false,
    })
  }, clipData)

  await expect(page.locator(S.timelineClip)).toHaveCount(clipData.length, { timeout: 5_000 })
}

/**
 * Stop playback and reset the editor store to its initial state.
 */
export async function resetEditorStore(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = (window as any).__editorStore
    if (store) {
      store.getState().setPlaying(false)
    }
  })
  await page.waitForTimeout(100)
  await page.evaluate(() => {
    const store = (window as any).__editorStore
    if (store) store.getState().reset()
  })
}

/**
 * Full cleanup: stop playback, reset store, close context menus.
 */
export async function cleanupEditor(page: Page): Promise<void> {
  await resetEditorStore(page)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
}

// ---------------------------------------------------------------------------
// Bundle mock clips
// ---------------------------------------------------------------------------

/**
 * Create mock clip data that includes a bundle clip with audio tracks.
 * Used for testing audio playback with .d3m bundles.
 */
export function makeBundleMockClips() {
  return [
    {
      id: 'normal-1',
      sourcePath: '/tmp/v1.mp4',
      originalDuration: 3000,
      trimStart: 0,
      trimEnd: 0,
      order: 0,
    },
    {
      id: 'bundle-1',
      sourcePath: '/tmp/test-bundle.d3m/video.mp4',
      originalDuration: 3000,
      trimStart: 0,
      trimEnd: 0,
      order: 1,
      bundlePath: '/tmp/test-bundle.d3m',
      audioTracks: [
        {
          id: 'sys-1',
          type: 'system',
          label: 'System Audio',
          clips: [{ id: 'ac1', filename: 'sys.pcm', startMs: 0, endMs: 3000, offsetMs: 0 }],
          format: { sampleRate: 48000, channels: 2, encoding: 'f32le' as const, bytesPerSample: 4 as const },
        },
        {
          id: 'mic-1',
          type: 'mic',
          label: 'Microphone',
          clips: [{ id: 'ac2', filename: 'mic.pcm', startMs: 0, endMs: 3000, offsetMs: 0 }],
          format: { sampleRate: 48000, channels: 1, encoding: 'f32le' as const, bytesPerSample: 4 as const },
        },
      ],
      mixerSettings: {
        tracks: [
          { trackId: 'sys-1', volume: 1, muted: false },
          { trackId: 'mic-1', volume: 1, muted: false },
        ],
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Test bundle creation
// ---------------------------------------------------------------------------

/**
 * Create a test .d3m bundle directory with real PCM audio files.
 * Generates a 440Hz sine wave (f32le, 48kHz, stereo, 1 second) for the
 * system audio track and silence for the mic track.
 */
export async function createTestBundle(bundlePath: string): Promise<void> {
  const tracksDir = path.join(bundlePath, 'tracks')
  fs.mkdirSync(tracksDir, { recursive: true })

  // Generate 1 second of 440Hz sine wave: f32le, 48000Hz, stereo
  const sampleRate = 48000
  const channels = 2
  const durationSec = 1
  const numSamples = sampleRate * durationSec
  const buffer = Buffer.alloc(numSamples * channels * 4) // f32le = 4 bytes

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    const value = Math.sin(2 * Math.PI * 440 * t) * 0.5 // 440Hz, 50% amplitude
    for (let ch = 0; ch < channels; ch++) {
      buffer.writeFloatLE(value, (i * channels + ch) * 4)
    }
  }

  fs.writeFileSync(path.join(tracksDir, 'sys.pcm'), buffer)

  // Also create a mono mic PCM (silence is fine for test)
  const monoBuffer = Buffer.alloc(sampleRate * 1 * 4 * durationSec)
  fs.writeFileSync(path.join(tracksDir, 'mic.pcm'), monoBuffer)

  // Create minimal project.json
  const project = {
    version: 1,
    createdAt: new Date().toISOString(),
    video: { filename: 'video.mp4', durationMs: 3000, width: 1920, height: 1080, fps: 30, codec: 'h264' },
    audioTracks: [
      {
        id: 'sys-1', type: 'system', label: 'System Audio',
        clips: [{ id: 'ac1', filename: 'sys.pcm', startMs: 0, endMs: 3000, offsetMs: 0 }],
        format: { sampleRate: 48000, channels: 2, encoding: 'f32le', bytesPerSample: 4 },
      },
      {
        id: 'mic-1', type: 'mic', label: 'Microphone',
        clips: [{ id: 'ac2', filename: 'mic.pcm', startMs: 0, endMs: 3000, offsetMs: 0 }],
        format: { sampleRate: 48000, channels: 1, encoding: 'f32le', bytesPerSample: 4 },
      },
    ],
    mixer: {
      tracks: [
        { trackId: 'sys-1', volume: 1, muted: false },
        { trackId: 'mic-1', volume: 1, muted: false },
      ],
    },
  }
  fs.writeFileSync(path.join(bundlePath, 'project.json'), JSON.stringify(project, null, 2))
}
