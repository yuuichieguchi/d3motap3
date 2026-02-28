import { test, expect } from '../fixtures/electron-app'
import * as fs from 'fs'

const DIR = '/private/tmp/e2e-video-evidence'

test.describe('Bundle audio promotion: recorded audio becomes editable independent tracks', () => {
  test.beforeAll(() => {
    fs.mkdirSync(DIR, { recursive: true })
  })

  test('after recording, bundle audio is promoted to independentAudioTracks with editing UI', async ({ page }) => {
    // ==================== Setup: Record with system audio + mic ====================

    // 1. Add display source (required for recording)
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

    // ==================== Assertion 1: Store state after promotion ====================

    const stateAfterLoad = await page.evaluate(() => {
      const store = (window as any).__editorStore
      if (!store) return null
      const s = store.getState()
      return {
        clipCount: s.project.clips.length,
        clips: s.project.clips.map((c: any) => ({
          id: c.id,
          audioTracks: c.audioTracks,
          hasAudioTracks: !!(c.audioTracks && c.audioTracks.length > 0),
        })),
        independentAudioTrackCount: s.project.independentAudioTracks.length,
        independentAudioTracks: s.project.independentAudioTracks.map((t: any) => ({
          id: t.id,
          label: t.label,
          clipCount: t.clips?.length ?? 0,
        })),
      }
    })
    console.log('STORE STATE AFTER LOAD:', JSON.stringify(stateAfterLoad, null, 2))
    fs.writeFileSync(`${DIR}/audio-edit-store-state-after-load.json`, JSON.stringify(stateAfterLoad, null, 2))

    // After promotion, independentAudioTracks should have at least 1 track
    // (System Audio and/or Mic promoted from bundle audioTracks)
    expect(
      stateAfterLoad?.independentAudioTrackCount,
      'independentAudioTracks should have >= 1 track after bundle audio promotion'
    ).toBeGreaterThanOrEqual(1)

    // After promotion, clip.audioTracks should be undefined (removed after promotion)
    for (const clip of stateAfterLoad?.clips ?? []) {
      expect(
        clip.audioTracks,
        `clip ${clip.id} audioTracks should be undefined after promotion`
      ).toBeUndefined()
    }

    // ==================== Assertion 2: UI elements ====================

    // .independent-audio-clip elements should be visible on the timeline
    const editableClips = page.locator('.independent-audio-clip')
    const editableClipCount = await editableClips.count()
    console.log(`Independent audio clips (editable) count: ${editableClipCount}`)
    expect(
      editableClipCount,
      '.independent-audio-clip elements should exist after promotion'
    ).toBeGreaterThanOrEqual(1)

    // .audio-track-bar elements should NOT exist (bundle audioTracks were removed)
    const bundleBars = page.locator('.audio-track-bar')
    const bundleBarCount = await bundleBars.count()
    console.log(`Bundle audio track bars (should be 0 after promotion): ${bundleBarCount}`)
    expect(
      bundleBarCount,
      '.audio-track-bar elements should NOT exist after promotion (bundle audioTracks removed)'
    ).toBe(0)

    // .audio-track-row.independent rows should exist (AudioTrackRow components rendered)
    const independentRows = page.locator('.audio-track-row.independent')
    const independentRowCount = await independentRows.count()
    console.log(`Independent audio track rows: ${independentRowCount}`)
    expect(
      independentRowCount,
      '.audio-track-row.independent rows should exist after promotion'
    ).toBeGreaterThanOrEqual(1)

    await page.screenshot({ path: `${DIR}/audio-edit-02-promoted-tracks-visible.png` })

    // ==================== Assertion 3: Right-click context menu ====================

    // Right-click on the first .independent-audio-clip should open a context menu
    const firstClip = editableClips.first()
    await firstClip.scrollIntoViewIfNeeded()
    await firstClip.click({ button: 'right' })
    await page.waitForTimeout(500)

    const contextMenu = page.locator('.timeline-context-menu')
    const menuVisible = await contextMenu.isVisible()
    console.log(`Context menu visible after right-click on audio clip: ${menuVisible}`)
    expect(menuVisible, 'Context menu should appear when right-clicking an independent audio clip').toBe(true)

    // The context menu should have Split, Cut, Copy, Paste options
    const splitMenuItem = contextMenu.locator('button', { hasText: 'Split at Playhead' })
    expect(await splitMenuItem.count(), 'Split at Playhead menu item should exist').toBe(1)
    const cutMenuItem = contextMenu.locator('button', { hasText: 'Cut' })
    expect(await cutMenuItem.count(), 'Cut menu item should exist').toBe(1)

    await page.screenshot({ path: `${DIR}/audio-edit-03-context-menu.png` })

    // Dismiss context menu by pressing Escape
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // ==================== Assertion 4: Split (Cmd+B) ====================

    // Click the first audio clip to select it
    await firstClip.click()
    await page.waitForTimeout(300)

    // Verify the clip is selected
    const selectedClips = page.locator('.independent-audio-clip.selected')
    const selectedCount = await selectedClips.count()
    console.log(`Selected audio clips after click: ${selectedCount}`)
    expect(selectedCount, 'Clicking an audio clip should select it').toBeGreaterThanOrEqual(1)

    // Move the playhead to the middle of the SELECTED audio clip so split is possible.
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      if (!store) return
      const s = store.getState()
      // Find the selected audio clip and seek to its midpoint
      const selectedId = s.lastSelectedAudioClipId
      for (const track of s.project.independentAudioTracks) {
        const clip = track.clips.find((c: any) => c.id === selectedId)
        if (clip) {
          const clipDuration = clip.originalDuration - clip.trimStart - clip.trimEnd
          const midpoint = clip.timelineStartMs + clipDuration / 2
          s.seekTo(midpoint)
          break
        }
      }
    })
    await page.waitForTimeout(300)

    // Record the clip count before split
    const clipCountBeforeSplit = await editableClips.count()
    console.log(`Audio clip count before split: ${clipCountBeforeSplit}`)

    // Press Cmd+B to split
    await page.keyboard.press('Meta+b')
    await page.waitForTimeout(500)

    // After split, clip count should increase by 1 (one clip becomes two)
    const clipCountAfterSplit = await editableClips.count()
    console.log(`Audio clip count after split: ${clipCountAfterSplit}`)
    expect(
      clipCountAfterSplit,
      'Cmd+B should split the selected audio clip, increasing clip count'
    ).toBeGreaterThan(clipCountBeforeSplit)

    await page.screenshot({ path: `${DIR}/audio-edit-04-after-split.png` })

    // ==================== Assertion 5: Cut (Cmd+X) and Paste (Cmd+V) ====================

    // Select the first audio clip
    const clipsAfterSplit = page.locator('.independent-audio-clip')
    await clipsAfterSplit.first().click()
    await page.waitForTimeout(300)

    const clipCountBeforeCut = await clipsAfterSplit.count()
    console.log(`Audio clip count before cut: ${clipCountBeforeCut}`)

    // Cmd+X to cut the selected clip
    await page.keyboard.press('Meta+x')
    await page.waitForTimeout(500)

    const clipCountAfterCut = await page.locator('.independent-audio-clip').count()
    console.log(`Audio clip count after cut: ${clipCountAfterCut}`)
    expect(
      clipCountAfterCut,
      'Cmd+X should remove the selected audio clip'
    ).toBeLessThan(clipCountBeforeCut)

    await page.screenshot({ path: `${DIR}/audio-edit-05-after-cut.png` })

    // Cmd+V to paste the cut clip back
    await page.keyboard.press('Meta+v')
    await page.waitForTimeout(500)

    const clipCountAfterPaste = await page.locator('.independent-audio-clip').count()
    console.log(`Audio clip count after paste: ${clipCountAfterPaste}`)
    expect(
      clipCountAfterPaste,
      'Cmd+V should paste the cut audio clip back, restoring clip count'
    ).toBeGreaterThan(clipCountAfterCut)

    await page.screenshot({ path: `${DIR}/audio-edit-06-after-paste.png` })

    // ==================== Final state dump ====================

    const finalState = await page.evaluate(() => {
      const store = (window as any).__editorStore
      if (!store) return null
      const s = store.getState()
      return {
        clipCount: s.project.clips.length,
        clips: s.project.clips.map((c: any) => ({
          id: c.id,
          audioTracks: c.audioTracks,
        })),
        independentAudioTrackCount: s.project.independentAudioTracks.length,
        independentAudioTracks: s.project.independentAudioTracks.map((t: any) => ({
          id: t.id,
          label: t.label,
          clipCount: t.clips?.length ?? 0,
          clips: t.clips?.map((c: any) => ({
            id: c.id,
            sourcePath: c.sourcePath,
            timelineStartMs: c.timelineStartMs,
            originalDuration: c.originalDuration,
            trimStart: c.trimStart,
            trimEnd: c.trimEnd,
          })),
        })),
        selectedAudioClipIds: s.selectedAudioClipIds,
        clipboardAudioClips: s.clipboardAudioClips?.length ?? 0,
      }
    })
    console.log('FINAL STORE STATE:', JSON.stringify(finalState, null, 2))
    fs.writeFileSync(`${DIR}/audio-edit-store-state-final.json`, JSON.stringify(finalState, null, 2))

    console.log('\n=== CONCLUSION ===')
    console.log('Bundle audio promotion test complete.')
    console.log(`Independent audio tracks: ${finalState?.independentAudioTrackCount}`)
    console.log(`Total independent audio clips: ${clipCountAfterPaste}`)
    console.log('All editing operations (select, split, cut, paste) verified.')

    // Cleanup: navigate back to Recording tab to avoid polluting subsequent tests
    await page.locator('.header-tab').filter({ hasText: 'Recording' }).click()
    await page.waitForTimeout(500)
  })
})
