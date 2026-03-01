/**
 * E2E test for waveform display race condition fix.
 *
 * Bug: useWaveformData hook has a loadingRef race condition. When a clip starts
 * loading and the effect re-runs (due to store update), the second run skips
 * the clip because loadingRef says it's still loading, but the first run was
 * cancelled and never cached the data. Result: waveform data never loads.
 *
 * Fix: Remove loadingRef, use Promise.all for parallel loading, expose
 * window.__waveformData for E2E verification.
 *
 * Verifies:
 * - System audio waveform data loads reliably after recording (no race condition)
 * - window.__waveformData contains entries with actual peak data (max > 0)
 * - .waveform-canvas elements render inside .audio-track-row
 * - .audio-track-row elements have proper CSS spacing (margin-top: 4px)
 */

import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import {
  closeLeftoverDialogs,
  removeAllSources,
} from '../helpers/test-utils'
import * as fs from 'fs'

const EVIDENCE_DIR = '/private/tmp/e2e-video-evidence'

test.describe('Waveform race condition fix', () => {
  test.beforeEach(async ({ page }) => {
    await closeLeftoverDialogs(page)

    // Navigate to Recording tab
    await page.locator('.header-tab').filter({ hasText: 'Recording' }).click()
    await page.waitForTimeout(300)

    // Turn OFF both Microphone and System Audio toggles
    for (const label of ['Microphone', 'System Audio']) {
      const group = page.locator('.control-group.toggle').filter({ hasText: label })
      if (await group.locator('input[type="checkbox"]').isChecked().catch(() => false)) {
        await group.locator('.toggle-switch').click()
        await page.waitForTimeout(200)
      }
    }

    // Remove all existing sources
    await removeAllSources(page)
  })

  test('system audio waveform loads without race condition', async ({ page }) => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })

    // Step 1: Add a Display source
    await page.locator(S.addSourceBtn).click()
    await page.locator(S.dialog).waitFor({ state: 'visible' })
    await page.locator(`${S.dialog} select`).first().selectOption('Display')
    await page.locator(S.sourceOptionBtn).first().click()
    await page.locator(S.dialog).waitFor({ state: 'hidden', timeout: 10_000 })
    await expect(page.locator(S.sourceItem)).toHaveCount(1, { timeout: 10_000 })

    // Step 2: Enable System Audio only
    const systemAudioGroup = page.locator('.control-group.toggle').filter({ hasText: 'System Audio' })
    await systemAudioGroup.locator('.toggle-switch').click()
    await expect(systemAudioGroup.locator('input[type="checkbox"]')).toBeChecked()

    // Step 3: Start recording
    const startBtn = page.getByRole('button', { name: 'Start Recording' })
    await startBtn.scrollIntoViewIfNeeded()
    await startBtn.click()

    const stopBtn = page.getByRole('button', { name: 'Stop Recording' })
    await expect(stopBtn).toBeVisible({ timeout: 10_000 })

    // Step 4: Wait 2 seconds for recording
    await page.waitForTimeout(2000)

    // Step 5: Stop recording
    await stopBtn.click()

    // Step 6: Wait for editor to load (or error, or return to recording)
    await expect(
      page.locator(S.editorView)
        .or(page.locator(S.errorBox))
        .or(page.getByRole('button', { name: 'Start Recording' }))
    ).toBeVisible({ timeout: 60_000 })

    // Step 7: Check for recording errors
    const errorBox = page.locator(S.errorBox)
    if (await errorBox.isVisible().catch(() => false)) {
      const errorText = await errorBox.textContent()
      expect(false, `Recording failed with error: ${errorText}`).toBe(true)
    }

    // Navigate to Editor tab
    await page.locator('.header-tab').filter({ hasText: 'Editor' }).click()
    await page.waitForTimeout(500)

    // Step 8: Wait for timeline to be visible
    await expect(page.locator(S.timeline)).toBeVisible({ timeout: 10_000 })

    // Step 9: Wait for window.__waveformData to have entries with max > 0
    // This is the key assertion: the fix exposes waveform peak stats at
    // window.__waveformData. The buggy implementation does NOT expose this,
    // so this test will FAIL until the fix is applied.
    const waveformLoaded = await page.waitForFunction(
      () => {
        const data = (window as any).__waveformData
        if (!data) return false
        // data is a Map-like structure: { clipId: { max, sum, length } }
        const entries = data instanceof Map ? Array.from(data.values()) : Object.values(data)
        if (entries.length === 0) return false
        // At least one entry must have actual audio data (max > 0)
        return entries.some((entry: any) => entry && entry.max > 0)
      },
      { timeout: 15_000, polling: 500 },
    ).catch(() => null)

    expect(
      waveformLoaded,
      'window.__waveformData should have entries with max > 0 within 15 seconds. ' +
      'This fails on the buggy implementation because loadingRef race condition ' +
      'prevents waveform data from ever loading.',
    ).not.toBeNull()

    // Step 10: Verify waveform data structure
    const waveformStats = await page.evaluate(() => {
      const data = (window as any).__waveformData
      if (!data) return null
      const entries = data instanceof Map ? Array.from(data.entries()) : Object.entries(data)
      return entries.map(([clipId, stats]: [string, any]) => ({
        clipId,
        max: stats.max,
        sum: stats.sum,
        length: stats.length,
      }))
    })

    expect(waveformStats, 'window.__waveformData should contain entries').not.toBeNull()
    expect(waveformStats!.length, 'Should have at least 1 waveform entry').toBeGreaterThanOrEqual(1)

    for (const entry of waveformStats!) {
      expect(
        entry.max,
        `Waveform entry ${entry.clipId} should have max > 0 (actual audio data, not empty)`,
      ).toBeGreaterThan(0)
    }

    // Step 11: Verify .waveform-canvas elements are visible inside .audio-track-row
    const waveformCanvases = page.locator('.audio-track-row .waveform-canvas')
    const canvasCount = await waveformCanvases.count()
    expect(canvasCount, 'Should have at least 1 waveform canvas in audio track rows').toBeGreaterThanOrEqual(1)

    for (let i = 0; i < canvasCount; i++) {
      await expect(waveformCanvases.nth(i)).toBeVisible()
      const box = await waveformCanvases.nth(i).boundingBox()
      expect(box, `Waveform canvas ${i} should have a bounding box`).not.toBeNull()
      expect(box!.width, `Waveform canvas ${i} width > 0`).toBeGreaterThan(0)
      expect(box!.height, `Waveform canvas ${i} height > 0`).toBeGreaterThan(0)
    }

    // Step 12: Take screenshot evidence
    await page.screenshot({ path: `${EVIDENCE_DIR}/waveform-race-fix-01.png` })
  })

  test('audio track rows have proper spacing', async ({ page }) => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })

    // Same setup: record with system audio to get audio tracks in editor

    // Step 1: Add a Display source
    await page.locator(S.addSourceBtn).click()
    await page.locator(S.dialog).waitFor({ state: 'visible' })
    await page.locator(`${S.dialog} select`).first().selectOption('Display')
    await page.locator(S.sourceOptionBtn).first().click()
    await page.locator(S.dialog).waitFor({ state: 'hidden', timeout: 10_000 })
    await expect(page.locator(S.sourceItem)).toHaveCount(1, { timeout: 10_000 })

    // Step 2: Enable System Audio only
    const systemAudioGroup = page.locator('.control-group.toggle').filter({ hasText: 'System Audio' })
    await systemAudioGroup.locator('.toggle-switch').click()
    await expect(systemAudioGroup.locator('input[type="checkbox"]')).toBeChecked()

    // Step 3: Start recording
    const startBtn = page.getByRole('button', { name: 'Start Recording' })
    await startBtn.scrollIntoViewIfNeeded()
    await startBtn.click()

    const stopBtn = page.getByRole('button', { name: 'Stop Recording' })
    await expect(stopBtn).toBeVisible({ timeout: 10_000 })

    // Step 4: Wait and stop
    await page.waitForTimeout(2000)
    await stopBtn.click()

    // Step 5: Wait for editor
    await expect(
      page.locator(S.editorView)
        .or(page.locator(S.errorBox))
        .or(page.getByRole('button', { name: 'Start Recording' }))
    ).toBeVisible({ timeout: 60_000 })

    const errorBox = page.locator(S.errorBox)
    if (await errorBox.isVisible().catch(() => false)) {
      const errorText = await errorBox.textContent()
      expect(false, `Recording failed with error: ${errorText}`).toBe(true)
    }

    // Navigate to Editor tab
    await page.locator('.header-tab').filter({ hasText: 'Editor' }).click()
    await page.waitForTimeout(500)
    await expect(page.locator(S.timeline)).toBeVisible({ timeout: 10_000 })

    // Step 6: Check audio-track-row spacing
    const audioTrackRows = page.locator('.audio-track-row')
    const rowCount = await audioTrackRows.count()
    expect(rowCount, 'Should have at least 1 audio track row').toBeGreaterThanOrEqual(1)

    if (rowCount >= 2) {
      // Verify vertical spacing between consecutive audio-track-row elements
      const firstBox = await audioTrackRows.nth(0).boundingBox()
      const secondBox = await audioTrackRows.nth(1).boundingBox()

      expect(firstBox, 'First audio-track-row should have bounding box').not.toBeNull()
      expect(secondBox, 'Second audio-track-row should have bounding box').not.toBeNull()

      // The gap between the bottom of the first row and top of the second row
      // should be >= 4px (margin-top: 4px on .audio-track-row)
      const gap = secondBox!.y - (firstBox!.y + firstBox!.height)
      expect(
        gap,
        `Gap between audio track rows should be >= 4px (margin-top: 4px), got ${gap}px`,
      ).toBeGreaterThanOrEqual(4)
    }

    // Take evidence screenshot
    await page.screenshot({ path: `${EVIDENCE_DIR}/waveform-race-fix-spacing-01.png` })
  })
})
