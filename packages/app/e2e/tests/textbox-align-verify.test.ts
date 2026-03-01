/**
 * E2E visual demonstration test for textbox alignment feature and header fix.
 *
 * This test is designed to be run with video recording enabled so that the
 * L/C/R alignment reflow behaviour can be visually verified in the recorded
 * video evidence.
 *
 * Coverage:
 * - Add text overlay via "+ Text" button
 * - Cycle through L / C / R alignment on the default (Title) preset
 * - Apply "Lower 3rd" preset and cycle L / C / R again
 * - Verify that alignment only changes textAlign, never x/width
 */

import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import { closeLeftoverDialogs, setupEditorWithClips, cleanupEditor } from '../helpers/test-utils'
import { mkdirSync } from 'fs'

const EVIDENCE_DIR = '/private/tmp/e2e-video-evidence'

test.describe('Textbox alignment visual verification', () => {
  test.beforeEach(async ({ page }) => {
    await closeLeftoverDialogs(page)
    await setupEditorWithClips(page, 2)
  })

  test.afterEach(async ({ page }) => {
    await cleanupEditor(page)
  })

  test('textbox model - L/C/R alignment reflows text without moving box', async ({ page }) => {
    mkdirSync(EVIDENCE_DIR, { recursive: true })

    // Step 1: Click "+ Text" button to add an overlay
    const textBtn = page.locator(S.editorToolbar).locator('button').filter({ hasText: '+ Text' })
    await textBtn.click()
    await expect(page.locator(S.timelineOverlay)).toHaveCount(1, { timeout: 5000 })

    // Step 2: Seek to time 500ms so the overlay is visible in the preview
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.setState({ currentTimeMs: 500 })
    })
    await page.waitForTimeout(300)

    // Step 3: Select the overlay in the timeline to show the editor panel
    await page.locator(S.timelineOverlay).click()
    await expect(page.locator(S.textOverlayEditor)).toBeVisible()

    // Capture initial box position (default: x=0, width=1, center aligned)
    const initial = await page.evaluate(() => {
      const store = (window as any).__editorStore
      const o = store.getState().project.textOverlays[0]
      return { x: o.x, width: o.width }
    })

    await page.screenshot({ path: `${EVIDENCE_DIR}/01-default-center.png` })

    // Step 5: Click L button — text reflows left, box stays put
    await page.locator('.align-btn').filter({ hasText: 'L' }).click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${EVIDENCE_DIR}/02-align-left.png` })

    const afterL = await page.evaluate(() => {
      const store = (window as any).__editorStore
      const o = store.getState().project.textOverlays[0]
      return { x: o.x, width: o.width, textAlign: o.textAlign }
    })
    expect(afterL.textAlign).toBe('left')
    expect(afterL.x).toBe(initial.x)
    expect(afterL.width).toBe(initial.width)

    // Step 6: Click C button — text reflows center, box stays put
    await page.locator('.align-btn').filter({ hasText: 'C' }).click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${EVIDENCE_DIR}/03-align-center.png` })

    const afterC = await page.evaluate(() => {
      const store = (window as any).__editorStore
      const o = store.getState().project.textOverlays[0]
      return { x: o.x, width: o.width, textAlign: o.textAlign }
    })
    expect(afterC.textAlign).toBe('center')
    expect(afterC.x).toBe(initial.x)
    expect(afterC.width).toBe(initial.width)

    // Step 7: Click R button — text reflows right, box stays put
    await page.locator('.align-btn').filter({ hasText: 'R' }).click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${EVIDENCE_DIR}/04-align-right.png` })

    const afterR = await page.evaluate(() => {
      const store = (window as any).__editorStore
      const o = store.getState().project.textOverlays[0]
      return { x: o.x, width: o.width, textAlign: o.textAlign }
    })
    expect(afterR.textAlign).toBe('right')
    expect(afterR.x).toBe(initial.x)
    expect(afterR.width).toBe(initial.width)

    // Step 8: Click "Lower 3rd" preset — box moves to lower-left, narrower width
    await page.locator('.toe-preset-btn').filter({ hasText: 'Lower 3rd' }).click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${EVIDENCE_DIR}/05-lower3rd-left.png` })

    const lower3rd = await page.evaluate(() => {
      const store = (window as any).__editorStore
      const o = store.getState().project.textOverlays[0]
      return { x: o.x, width: o.width, textAlign: o.textAlign }
    })
    expect(lower3rd.x).toBeCloseTo(0.03)
    expect(lower3rd.width).toBeCloseTo(0.5)
    expect(lower3rd.textAlign).toBe('left')

    // Step 9: Cycle L / C / R on the Lower 3rd box
    await page.locator('.align-btn').filter({ hasText: 'C' }).click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${EVIDENCE_DIR}/06-lower3rd-center.png` })

    const lower3rdC = await page.evaluate(() => {
      const store = (window as any).__editorStore
      const o = store.getState().project.textOverlays[0]
      return { x: o.x, width: o.width, textAlign: o.textAlign }
    })
    expect(lower3rdC.textAlign).toBe('center')
    expect(lower3rdC.x).toBeCloseTo(0.03)
    expect(lower3rdC.width).toBeCloseTo(0.5)

    await page.locator('.align-btn').filter({ hasText: 'R' }).click()
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${EVIDENCE_DIR}/07-lower3rd-right.png` })

    const lower3rdR = await page.evaluate(() => {
      const store = (window as any).__editorStore
      const o = store.getState().project.textOverlays[0]
      return { x: o.x, width: o.width, textAlign: o.textAlign }
    })
    expect(lower3rdR.textAlign).toBe('right')
    expect(lower3rdR.x).toBeCloseTo(0.03)
    expect(lower3rdR.width).toBeCloseTo(0.5)

    // Screenshot of header traffic light position
    await page.screenshot({ path: `${EVIDENCE_DIR}/08-header-traffic-light.png` })

    console.log(`Screenshot evidence saved to: ${EVIDENCE_DIR}`)
  })
})
