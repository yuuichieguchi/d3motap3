import { test, expect } from '../fixtures/electron-app'
import * as fs from 'fs'

const DIR = '/private/tmp/e2e-video-evidence'

test.describe('Audio editing operations on recorded audio', () => {
  test.beforeAll(() => {
    fs.mkdirSync(DIR, { recursive: true })
  })

  test('recorded audio tracks cannot be split, cut, or moved (bundle audio has no editing UI)', async ({ page }) => {
    // 1. Add display source
    await page.locator('.add-source-btn').click()
    await page.locator('.dialog').waitFor({ state: 'visible' })
    await page.locator('.source-option-btn').first().click()
    await page.locator('.dialog').waitFor({ state: 'hidden', timeout: 10000 })

    // 2. Enable System Audio toggle
    const toggles = page.locator('.toggle-switch')
    await toggles.nth(0).click()
    await page.waitForTimeout(300)

    // 3. Enable Microphone toggle
    await toggles.nth(1).click()
    await page.waitForTimeout(300)

    // 4. Start recording
    await page.getByRole('button', { name: 'Start Recording' }).click()
    await page.waitForTimeout(1000)

    // 5. Record for 8 seconds
    await page.waitForTimeout(8000)

    // 6. Stop recording
    const stopBtn = page.locator('.record-btn.stop')
    if (await stopBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await stopBtn.click()
    }

    // 7. Wait for processing
    await page.waitForTimeout(8000)

    // 8. Navigate to Editor tab
    await page.locator('.header-tab').filter({ hasText: 'Editor' }).click()
    await page.waitForTimeout(2000)
    await page.screenshot({ path: `${DIR}/audio-edit-01-editor-loaded.png` })

    // 9. Check: bundle audio track rows exist
    const bundleAudioRows = page.locator('.audio-track-row:not(.independent)')
    const bundleCount = await bundleAudioRows.count()
    console.log(`Bundle audio track rows: ${bundleCount}`)
    expect(bundleCount).toBeGreaterThan(0) // Should have System Audio and/or Mic rows

    // 10. Check: independent audio track rows do NOT exist (no editable audio)
    const independentAudioRows = page.locator('.audio-track-row.independent')
    const independentCount = await independentAudioRows.count()
    console.log(`Independent audio track rows (editable): ${independentCount}`)

    // 11. Check: .audio-track-bar elements exist (the static bars)
    const audioBars = page.locator('.audio-track-bar')
    const barCount = await audioBars.count()
    console.log(`Audio track bars (static, non-interactive): ${barCount}`)
    expect(barCount).toBeGreaterThan(0)

    // 12. Check: .independent-audio-clip elements do NOT exist
    const editableClips = page.locator('.independent-audio-clip')
    const editableCount = await editableClips.count()
    console.log(`Independent audio clips (editable): ${editableCount}`)

    await page.screenshot({ path: `${DIR}/audio-edit-02-audio-tracks-visible.png` })

    // 13. Try right-click on the first audio track bar - should NOT show context menu
    const firstBar = audioBars.first()
    await firstBar.scrollIntoViewIfNeeded()
    await firstBar.click({ button: 'right' })
    await page.waitForTimeout(500)
    
    // Check if any context menu appeared
    const contextMenu = page.locator('.context-menu')
    const menuVisible = await contextMenu.isVisible().catch(() => false)
    console.log(`Context menu appeared on right-click: ${menuVisible}`)
    await page.screenshot({ path: `${DIR}/audio-edit-03-right-click-attempt.png` })

    // 14. Try to click on the audio bar to "select" it
    await firstBar.click()
    await page.waitForTimeout(300)
    
    // Check if any selection styling appeared
    const selectedClips = page.locator('.independent-audio-clip.selected')
    const selectedCount = await selectedClips.count()
    console.log(`Selected audio clips after click: ${selectedCount}`)
    await page.screenshot({ path: `${DIR}/audio-edit-04-click-attempt.png` })

    // 15. Try Cmd+B (split) - should do nothing since no audio clip is selected
    await page.keyboard.press('Meta+b')
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${DIR}/audio-edit-05-split-attempt.png` })

    // 16. Try Cmd+C (copy) - should do nothing
    await page.keyboard.press('Meta+c')
    await page.waitForTimeout(300)

    // 17. Try Cmd+V (paste) - should do nothing
    await page.keyboard.press('Meta+v')
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${DIR}/audio-edit-06-copy-paste-attempt.png` })

    // 18. Dump the editor store state
    const state = await page.evaluate(() => {
      const store = (window as any).__editorStore
      if (!store) return null
      const s = store.getState()
      return {
        clipCount: s.project.clips.length,
        clips: s.project.clips.map((c: any) => ({
          id: c.id,
          audioTracks: c.audioTracks?.map((t: any) => ({
            id: t.id, label: t.label, type: t.type,
            clipCount: t.clips?.length,
          })),
        })),
        independentAudioTrackCount: s.project.independentAudioTracks.length,
        independentAudioTracks: s.project.independentAudioTracks.map((t: any) => ({
          id: t.id, label: t.label, clipCount: t.clips?.length,
        })),
        selectedAudioClipIds: s.selectedAudioClipIds,
        clipboardAudioClips: s.clipboardAudioClips?.length ?? 0,
      }
    })
    console.log('STORE STATE:', JSON.stringify(state, null, 2))
    fs.writeFileSync(`${DIR}/audio-edit-store-state.json`, JSON.stringify(state, null, 2))

    // 19. Summary assertion: prove the problem
    // Bundle audio tracks exist but have no editing UI
    expect(bundleCount, 'Bundle audio rows should exist after recording').toBeGreaterThan(0)
    expect(independentCount, 'NO independent (editable) audio tracks exist').toBe(0)
    expect(editableCount, 'NO editable audio clips (.independent-audio-clip) exist').toBe(0)
    
    // This means: audio is visible but CANNOT be split, cut, copied, pasted, or moved
    console.log('\n=== CONCLUSION ===')
    console.log(`Bundle audio tracks visible: ${bundleCount} (System Audio, Mic)`)
    console.log(`Editable audio tracks: ${independentCount}`)
    console.log(`Editable audio clips: ${editableCount}`)
    console.log('Result: Audio is displayed but has ZERO editing capabilities.')
    console.log('All editing operations (split, cut, copy, paste, move) are only')
    console.log('implemented for IndependentAudioTrack, which recording does NOT create.')
  })
})
