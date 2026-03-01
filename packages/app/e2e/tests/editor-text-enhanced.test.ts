/**
 * E2E tests for enhanced text overlay features (iMovie-level).
 *
 * Coverage:
 * - Preset dialog opens on "+ Text" click
 * - Preset selection creates overlay with correct properties
 * - Overlay drag-move shifts start/end times
 * - Left trim handle adjusts startTime
 * - Right trim handle adjusts endTime
 * - Bold/Italic toggle buttons work
 * - Animation selection updates store
 * - Preview overlay displays for active text
 */

import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import { closeLeftoverDialogs, setupEditorWithClips, cleanupEditor } from '../helpers/test-utils'

test.describe('Enhanced text overlay features', () => {
  test.beforeEach(async ({ page }) => {
    await closeLeftoverDialogs(page)
    await setupEditorWithClips(page, 2)
  })

  test.afterEach(async ({ page }) => {
    await cleanupEditor(page)
  })

  // ==================== Preset Dialog ====================

  test('+ Text button opens preset dialog', async ({ page }) => {
    const textBtn = page.locator(S.editorToolbar).locator('button').filter({ hasText: '+ Text' })
    await textBtn.click()

    // Verify the text preset dialog is visible
    await expect(page.locator('.text-preset-dialog')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.preset-section')).toHaveCount(2) // Position + Size sections
    await expect(page.locator('.preset-add-btn')).toBeVisible()
  })

  // ==================== Preset Creates Overlay ====================

  test('selecting presets and clicking Add creates overlay with correct properties', async ({ page }) => {
    const textBtn = page.locator(S.editorToolbar).locator('button').filter({ hasText: '+ Text' })
    await textBtn.click()
    await expect(page.locator('.text-preset-dialog')).toBeVisible({ timeout: 5000 })

    // Select "Lower Third" position (index 1)
    await page.locator('.preset-section').first().locator('.preset-option').nth(1).click()
    // Select "Large (72px)" size (index 2)
    await page.locator('.preset-section').nth(1).locator('.preset-option').nth(2).click()

    // Click Add
    await page.locator('.preset-add-btn').click()

    // Dialog should close
    await expect(page.locator('.text-preset-dialog')).not.toBeVisible()

    // Verify overlay in timeline
    await expect(page.locator(S.timelineOverlay)).toHaveCount(1, { timeout: 5000 })

    // Verify properties in store
    const props = await page.evaluate(() => {
      const store = (window as any).__editorStore
      const overlay = store.getState().project.textOverlays[0]
      return {
        x: overlay.x,
        y: overlay.y,
        textAlign: overlay.textAlign,
        fontSize: overlay.fontSize,
        fontWeight: overlay.fontWeight,
      }
    })
    expect(props.x).toBeCloseTo(0.05) // Lower Third x
    expect(props.y).toBeCloseTo(0.82) // Lower Third y
    expect(props.textAlign).toBe('left')
    expect(props.fontSize).toBe(72)
    expect(props.fontWeight).toBe('bold')
  })

  // ==================== Drag Move ====================

  test('moveTextOverlay shifts startTime and endTime preserving duration', async ({ page }) => {
    // Add overlay at time 0-2000ms
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().addTextOverlay('Drag Test', 0, 2000, {
        fontFamily: 'sans-serif', fontWeight: 'normal', fontStyle: 'normal',
        textAlign: 'center', backgroundColor: null, borderColor: null,
        borderWidth: 0, shadowColor: null, shadowOffsetX: 0, shadowOffsetY: 0,
        animation: 'none', animationDuration: 500,
      })
    })
    await expect(page.locator(S.timelineOverlay)).toHaveCount(1, { timeout: 5000 })

    // Use store API to move overlay (Playwright+Electron mouse drag limitation)
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      const overlay = store.getState().project.textOverlays[0]
      store.getState().moveTextOverlay(overlay.id, 1500)
    })

    const times = await page.evaluate(() => {
      const store = (window as any).__editorStore
      const overlay = store.getState().project.textOverlays[0]
      return { startTime: overlay.startTime, endTime: overlay.endTime }
    })
    expect(times.startTime).toBe(1500)
    expect(times.endTime).toBe(3500)
    expect(times.endTime - times.startTime).toBe(2000)
  })

  // ==================== Left Trim Handle ====================

  test('trimTextOverlay adjusts startTime while preserving endTime', async ({ page }) => {
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().addTextOverlay('Trim L', 1000, 3000, {
        fontFamily: 'sans-serif', fontWeight: 'normal', fontStyle: 'normal',
        textAlign: 'center', backgroundColor: null, borderColor: null,
        borderWidth: 0, shadowColor: null, shadowOffsetX: 0, shadowOffsetY: 0,
        animation: 'none', animationDuration: 500,
      })
    })
    await expect(page.locator(S.timelineOverlay)).toHaveCount(1, { timeout: 5000 })

    // Use store API for trim (Playwright+Electron mouse drag limitation)
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      const overlay = store.getState().project.textOverlays[0]
      store.getState().trimTextOverlay(overlay.id, 1500, 3000)
    })

    const times = await page.evaluate(() => {
      const store = (window as any).__editorStore
      const overlay = store.getState().project.textOverlays[0]
      return { startTime: overlay.startTime, endTime: overlay.endTime }
    })
    expect(times.startTime).toBe(1500) // startTime increased
    expect(times.endTime).toBe(3000) // endTime unchanged
  })

  // ==================== Right Trim Handle ====================

  test('trimTextOverlay adjusts endTime while preserving startTime', async ({ page }) => {
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().addTextOverlay('Trim R', 1000, 5000, {
        fontFamily: 'sans-serif', fontWeight: 'normal', fontStyle: 'normal',
        textAlign: 'center', backgroundColor: null, borderColor: null,
        borderWidth: 0, shadowColor: null, shadowOffsetX: 0, shadowOffsetY: 0,
        animation: 'none', animationDuration: 500,
      })
    })
    await expect(page.locator(S.timelineOverlay)).toHaveCount(1, { timeout: 5000 })

    // Use store API for trim (Playwright+Electron mouse drag limitation)
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      const overlay = store.getState().project.textOverlays[0]
      store.getState().trimTextOverlay(overlay.id, 1000, 4000)
    })

    const times = await page.evaluate(() => {
      const store = (window as any).__editorStore
      const overlay = store.getState().project.textOverlays[0]
      return { startTime: overlay.startTime, endTime: overlay.endTime }
    })
    expect(times.startTime).toBe(1000) // startTime unchanged
    expect(times.endTime).toBe(4000) // endTime decreased
  })

  // ==================== Bold/Italic Toggle ====================

  test('Bold and Italic toggle buttons work', async ({ page }) => {
    // Add overlay and select it
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().addTextOverlay('Style Test', 0, 2000, {
        fontFamily: 'sans-serif', fontWeight: 'normal', fontStyle: 'normal',
        textAlign: 'center', backgroundColor: null, borderColor: null,
        borderWidth: 0, shadowColor: null, shadowOffsetX: 0, shadowOffsetY: 0,
        animation: 'none', animationDuration: 500,
      })
    })
    await expect(page.locator(S.timelineOverlay)).toHaveCount(1, { timeout: 5000 })
    await page.locator(S.timelineOverlay).click()
    await expect(page.locator(S.textOverlayEditor)).toBeVisible()

    // Click Bold button
    const boldBtn = page.locator('.style-toggle-btn').filter({ hasText: 'B' })
    await boldBtn.click()

    // Verify Bold is active
    await expect(boldBtn).toHaveClass(/active/)

    // Click Italic button
    const italicBtn = page.locator('.style-toggle-btn').filter({ hasText: 'I' })
    await italicBtn.click()

    // Verify Italic is active
    await expect(italicBtn).toHaveClass(/active/)

    // Verify store
    const styles = await page.evaluate(() => {
      const store = (window as any).__editorStore
      const overlay = store.getState().project.textOverlays[0]
      return { fontWeight: overlay.fontWeight, fontStyle: overlay.fontStyle }
    })
    expect(styles.fontWeight).toBe('bold')
    expect(styles.fontStyle).toBe('italic')
  })

  // ==================== Animation Selection ====================

  test('animation selection updates store', async ({ page }) => {
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().addTextOverlay('Anim Test', 0, 2000, {
        fontFamily: 'sans-serif', fontWeight: 'normal', fontStyle: 'normal',
        textAlign: 'center', backgroundColor: null, borderColor: null,
        borderWidth: 0, shadowColor: null, shadowOffsetX: 0, shadowOffsetY: 0,
        animation: 'none', animationDuration: 500,
      })
    })
    await expect(page.locator(S.timelineOverlay)).toHaveCount(1, { timeout: 5000 })
    await page.locator(S.timelineOverlay).click()
    await expect(page.locator(S.textOverlayEditor)).toBeVisible()

    // Find the animation select
    const animSelect = page.locator(`${S.textOverlayEditor} select`).last()
    await animSelect.selectOption('fade-in')

    const anim = await page.evaluate(() => {
      const store = (window as any).__editorStore
      return store.getState().project.textOverlays[0].animation
    })
    expect(anim).toBe('fade-in')
  })

  // ==================== Preview Overlay ====================

  test('preview overlay displays for text in current time range', async ({ page }) => {
    // Add overlay covering 0-3000ms
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().addTextOverlay('Preview Me', 0, 3000, {
        fontFamily: 'sans-serif', fontWeight: 'normal', fontStyle: 'normal',
        textAlign: 'center', backgroundColor: null, borderColor: null,
        borderWidth: 0, shadowColor: null, shadowOffsetX: 0, shadowOffsetY: 0,
        animation: 'none', animationDuration: 500,
      })
      // Ensure currentTimeMs is within range
      store.setState({ currentTimeMs: 1000 })
    })

    // Verify preview overlay text is visible
    await expect(page.locator('.preview-overlay-text')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.preview-overlay-text')).toHaveText('Preview Me')
  })
})
