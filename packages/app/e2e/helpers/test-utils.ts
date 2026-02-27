/**
 * Shared E2E test helpers.
 *
 * Centralises common setup/teardown routines so individual test files stay
 * focused on the behaviour they verify.
 */

import { expect } from '@playwright/test'
import { S } from './selectors'
import type { Page } from '@playwright/test'

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
