/**
 * E2E tests for independent audio tracks on the Editor timeline.
 *
 * Coverage:
 * - Track & clip display (rows render, labels show, correct count)
 * - Audio clip selection (single-click, Cmd+Click toggle, cross-type deselect)
 * - Split (splitAudioClip produces two clips from one)
 * - Context menu (all items present, Delete removes clip, Split at Playhead)
 * - Add Audio Track button (creates empty tracks with sequential labels)
 * - Keyboard shortcuts (Delete/Backspace removes, Cmd+C/V copy-paste)
 * - Trim handles (visible on audio clips)
 * - Move clip (drag repositions)
 *
 * Test setup:
 * Uses `window.__editorStore` (zustand) to inject independent audio tracks
 * into the store. Actual test interactions use real UI clicks, right-clicks,
 * and keyboard shortcuts against the rendered AudioTrackRow components.
 *
 * Audio context menu items (from Timeline.tsx):
 *   Copy, Cut, Paste, Split at Playhead, Replace Audio..., Delete
 */

import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import { closeLeftoverDialogs, setupEditorWithClips, cleanupEditor } from '../helpers/test-utils'
import type { Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigate to the Editor tab, populate video clips, and inject independent
 * audio tracks with clips directly into the zustand store.
 *
 * Creates two tracks:
 *   - "BGM" with two clips (5000ms and 2000ms)
 *   - "SE" with no clips (empty track)
 */
async function setupEditorWithAudio(page: Page, videoClipCount: number = 2): Promise<void> {
  await setupEditorWithClips(page, videoClipCount)

  await page.evaluate(() => {
    const store = (window as any).__editorStore
    if (!store) throw new Error('__editorStore not exposed')
    const state = store.getState()
    store.setState({
      project: {
        ...state.project,
        independentAudioTracks: [
          {
            id: 'test-audio-track-1',
            label: 'BGM',
            clips: [
              {
                id: 'test-audio-clip-1',
                sourcePath: '/tmp/test-bgm.mp3',
                originalDuration: 5000,
                trimStart: 0,
                trimEnd: 0,
                timelineStartMs: 0,
              },
              {
                id: 'test-audio-clip-2',
                sourcePath: '/tmp/test-effect.wav',
                originalDuration: 2000,
                trimStart: 0,
                trimEnd: 0,
                timelineStartMs: 3000,
              },
            ],
            volume: 1,
            muted: false,
          },
          {
            id: 'test-audio-track-2',
            label: 'SE',
            clips: [],
            volume: 0.8,
            muted: false,
          },
        ],
      },
      selectedAudioClipIds: [],
      lastSelectedAudioClipId: null,
    })
  })

  // Wait for audio clips to render
  await expect(page.locator('.independent-audio-clip')).toHaveCount(2, { timeout: 5_000 })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Independent audio tracks', () => {
  test.beforeEach(async ({ page }) => {
    await closeLeftoverDialogs(page)
  })

  test.afterEach(async ({ page }) => {
    await cleanupEditor(page)
  })

  // ==================== Track & Clip Display ====================

  test('audio track rows appear after injecting via store', async ({ page }) => {
    await setupEditorWithAudio(page)

    // Two independent audio track rows should be rendered
    const audioTrackRows = page.locator('.audio-track-row.independent')
    await expect(audioTrackRows).toHaveCount(2)

    // Labels should match the track names
    await expect(audioTrackRows.nth(0).locator('.timeline-row-label')).toContainText('BGM')
    await expect(audioTrackRows.nth(1).locator('.timeline-row-label')).toContainText('SE')
  })

  test('audio clips display with correct labels from source path', async ({ page }) => {
    await setupEditorWithAudio(page)

    const audioClips = page.locator('.independent-audio-clip')
    await expect(audioClips).toHaveCount(2)

    // Labels are derived from sourcePath filename (truncated to 16 chars)
    const firstLabel = audioClips.nth(0).locator('.audio-clip-label')
    await expect(firstLabel).toContainText('test-bgm.mp3')

    const secondLabel = audioClips.nth(1).locator('.audio-clip-label')
    await expect(secondLabel).toContainText('test-effect.wav')
  })

  test('audio clips have trim handles', async ({ page }) => {
    await setupEditorWithAudio(page)

    const audioClips = page.locator('.independent-audio-clip')
    const firstClip = audioClips.nth(0)

    await expect(firstClip.locator('.trim-handle.left')).toBeVisible()
    await expect(firstClip.locator('.trim-handle.right')).toBeVisible()
  })

  test('audio clip widths are proportional to their duration', async ({ page }) => {
    await setupEditorWithAudio(page)

    const audioClips = page.locator('.independent-audio-clip')
    const clip1Box = await audioClips.nth(0).boundingBox()
    const clip2Box = await audioClips.nth(1).boundingBox()
    expect(clip1Box).not.toBeNull()
    expect(clip2Box).not.toBeNull()

    // Clip 1 is 5000ms, clip 2 is 2000ms — clip 1 should be wider
    expect(clip1Box!.width).toBeGreaterThan(clip2Box!.width)

    // Rough ratio check: 5000:2000 = 2.5x
    const ratio = clip1Box!.width / clip2Box!.width
    expect(ratio).toBeGreaterThan(2.0)
    expect(ratio).toBeLessThan(3.0)
  })

  test('muted track shows muted icon', async ({ page }) => {
    await setupEditorWithClips(page, 2)

    // Inject a muted track
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      const state = store.getState()
      store.setState({
        project: {
          ...state.project,
          independentAudioTracks: [
            {
              id: 'muted-track',
              label: 'Muted BGM',
              clips: [],
              volume: 1,
              muted: true,
            },
          ],
        },
      })
    })
    await page.waitForTimeout(200)

    // The muted icon should render (Unicode 🔇)
    const trackRow = page.locator('.audio-track-row.independent')
    const icon = trackRow.locator('.audio-track-icon')
    // When muted=true, the icon should be the muted speaker emoji
    const iconText = await icon.textContent()
    expect(iconText).toContain('\u{1F507}') // 🔇
  })

  // ==================== Selection ====================

  test('clicking audio clip selects it (adds selected class)', async ({ page }) => {
    await setupEditorWithAudio(page)

    const audioClips = page.locator('.independent-audio-clip')
    await audioClips.nth(0).click()

    await expect(audioClips.nth(0)).toHaveClass(/selected/)
    await expect(audioClips.nth(1)).not.toHaveClass(/selected/)

    // Verify store state
    const selectedIds = await page.evaluate(() => {
      return (window as any).__editorStore.getState().selectedAudioClipIds
    })
    expect(selectedIds).toEqual(['test-audio-clip-1'])
  })

  test('clicking another audio clip deselects the first', async ({ page }) => {
    await setupEditorWithAudio(page)

    const audioClips = page.locator('.independent-audio-clip')

    // Select first
    await audioClips.nth(0).click()
    await expect(audioClips.nth(0)).toHaveClass(/selected/)

    // Click second — first should deselect
    await audioClips.nth(1).click()
    await expect(audioClips.nth(0)).not.toHaveClass(/selected/)
    await expect(audioClips.nth(1)).toHaveClass(/selected/)
  })

  test('selecting audio clip deselects video clips', async ({ page }) => {
    await setupEditorWithAudio(page)

    // First select a video clip
    const videoClips = page.locator(S.timelineClip)
    await videoClips.nth(0).click()
    await expect(videoClips.nth(0)).toHaveClass(/selected/)

    // Now select an audio clip
    const audioClips = page.locator('.independent-audio-clip')
    await audioClips.nth(0).click()

    // Video should be deselected, audio should be selected
    await expect(videoClips.nth(0)).not.toHaveClass(/selected/)
    await expect(audioClips.nth(0)).toHaveClass(/selected/)
  })

  test('Cmd+Click toggles audio clip selection', async ({ page }) => {
    await setupEditorWithAudio(page)

    const audioClips = page.locator('.independent-audio-clip')

    // Select first clip
    await audioClips.nth(0).click()
    await expect(audioClips.nth(0)).toHaveClass(/selected/)

    // Cmd+Click second clip to add to selection
    await audioClips.nth(1).click({ modifiers: ['Meta'] })
    await expect(audioClips.nth(0)).toHaveClass(/selected/)
    await expect(audioClips.nth(1)).toHaveClass(/selected/)

    const selectedIds = await page.evaluate(() => {
      return (window as any).__editorStore.getState().selectedAudioClipIds
    })
    expect(selectedIds).toContain('test-audio-clip-1')
    expect(selectedIds).toContain('test-audio-clip-2')

    // Cmd+Click first clip to deselect it
    await audioClips.nth(0).click({ modifiers: ['Meta'] })
    await expect(audioClips.nth(0)).not.toHaveClass(/selected/)
    await expect(audioClips.nth(1)).toHaveClass(/selected/)
  })

  // ==================== Split ====================

  test('splitAudioClip splits clip into two at given time', async ({ page }) => {
    await setupEditorWithAudio(page)

    // Split the first clip at 2500ms (midpoint of 5000ms clip starting at 0)
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().splitAudioClip('test-audio-track-1', 'test-audio-clip-1', 2500)
    })

    // Should now have 3 clips in total (split produced 2 from 1, plus the original second clip)
    const audioClips = page.locator('.independent-audio-clip')
    await expect(audioClips).toHaveCount(3, { timeout: 5_000 })
  })

  test('split via context menu at playhead position', async ({ page }) => {
    await setupEditorWithAudio(page)

    // Select the first audio clip
    const audioClips = page.locator('.independent-audio-clip')
    await audioClips.nth(0).click()
    await expect(audioClips.nth(0)).toHaveClass(/selected/)

    // Seek playhead to 2000ms (inside the first 5000ms clip that starts at 0)
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().seekTo(2000)
    })
    await page.waitForTimeout(100)

    // Right-click the first clip to open audio context menu
    await audioClips.nth(0).click({ button: 'right', position: { x: 10, y: 10 } })

    const menu = page.locator('.timeline-context-menu')
    await expect(menu).toBeVisible({ timeout: 3_000 })

    // Click "Split at Playhead"
    // The audio context menu is portaled to document.body and may extend
    // past the viewport when opened near the bottom of the window.
    // Use dispatchEvent to bypass Playwright's viewport boundary check.
    const splitItem = menu.locator('.timeline-context-menu-item').filter({ hasText: 'Split at Playhead' })
    await expect(splitItem).toBeEnabled()
    await splitItem.dispatchEvent('click')

    // Should now have 3 clips (split one into two)
    await expect(audioClips).toHaveCount(3, { timeout: 5_000 })
  })

  test('Split at Playhead is disabled when playhead is outside audio clip', async ({ page }) => {
    await setupEditorWithAudio(page)

    // Seek playhead to 5500ms (between clip1 end at 5000ms and clip2 start at 3000ms+2000ms=5000ms)
    // Actually clip2 starts at 3000ms with duration 2000ms, so it ends at 5000ms
    // Playhead at 5500ms is outside both clips
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().seekTo(5500)
    })
    await page.waitForTimeout(100)

    // Right-click the first clip
    const audioClips = page.locator('.independent-audio-clip')
    await audioClips.nth(0).click({ button: 'right', position: { x: 10, y: 10 } })

    const menu = page.locator('.timeline-context-menu')
    await expect(menu).toBeVisible({ timeout: 3_000 })

    // Split at Playhead should be disabled
    const splitItem = menu.locator('.timeline-context-menu-item').filter({ hasText: 'Split at Playhead' })
    await expect(splitItem).toBeVisible()
    await expect(splitItem).toBeDisabled()

    // Close menu
    await page.keyboard.press('Escape')
  })

  // ==================== Context Menu ====================

  test('right-click on audio clip shows context menu with audio-specific items', async ({ page }) => {
    await setupEditorWithAudio(page)

    const audioClips = page.locator('.independent-audio-clip')
    await audioClips.nth(0).click({ button: 'right' })

    const menu = page.locator('.timeline-context-menu')
    await expect(menu).toBeVisible({ timeout: 3_000 })

    // Audio clip context menu should contain these items
    const items = menu.locator('.timeline-context-menu-item')
    const texts = await items.allTextContents()

    expect(texts.some(t => t.includes('Copy'))).toBe(true)
    expect(texts.some(t => t.includes('Cut'))).toBe(true)
    expect(texts.some(t => t.includes('Paste'))).toBe(true)
    expect(texts.some(t => t.includes('Split at Playhead'))).toBe(true)
    expect(texts.some(t => t.includes('Replace Audio'))).toBe(true)
    expect(texts.some(t => t.includes('Delete'))).toBe(true)

    // Close menu
    await page.keyboard.press('Escape')
  })

  test('context menu has separators between groups', async ({ page }) => {
    await setupEditorWithAudio(page)

    const audioClips = page.locator('.independent-audio-clip')
    await audioClips.nth(0).click({ button: 'right' })

    const menu = page.locator('.timeline-context-menu')
    await expect(menu).toBeVisible({ timeout: 3_000 })

    // Audio context menu layout:
    //   Copy, Cut, Paste
    //   --- separator ---
    //   Split at Playhead
    //   --- separator ---
    //   Replace Audio...
    //   --- separator ---
    //   Delete
    const separators = menu.locator('.context-menu-separator')
    await expect(separators).toHaveCount(3)

    await page.keyboard.press('Escape')
  })

  test('context menu Delete removes selected audio clip', async ({ page }) => {
    await setupEditorWithAudio(page)

    const audioClips = page.locator('.independent-audio-clip')
    await expect(audioClips).toHaveCount(2)

    // Right-click first clip and click Delete
    await audioClips.nth(0).click({ button: 'right' })
    const menu = page.locator('.timeline-context-menu')
    await expect(menu).toBeVisible({ timeout: 3_000 })

    // Delete is at the bottom of the portaled context menu — may be outside viewport.
    // Use dispatchEvent to bypass Playwright's viewport boundary check.
    const deleteBtn = menu.locator('.timeline-context-menu-item.danger')
    await deleteBtn.dispatchEvent('click')

    // Should have 1 clip remaining
    await expect(audioClips).toHaveCount(1, { timeout: 5_000 })
  })

  test('context menu shows count when multiple audio clips selected', async ({ page }) => {
    await setupEditorWithAudio(page)

    const audioClips = page.locator('.independent-audio-clip')

    // Multi-select both clips
    await audioClips.nth(0).click()
    await audioClips.nth(1).click({ modifiers: ['Meta'] })
    await expect(audioClips.nth(0)).toHaveClass(/selected/)
    await expect(audioClips.nth(1)).toHaveClass(/selected/)

    // Right-click on first clip (already selected — should preserve multi-selection)
    await audioClips.nth(0).click({ button: 'right' })
    const menu = page.locator('.timeline-context-menu')
    await expect(menu).toBeVisible({ timeout: 3_000 })

    // Delete button should show count "(2 selected)"
    const deleteBtn = menu.locator('.timeline-context-menu-item.danger')
    await expect(deleteBtn).toContainText('2')

    await page.keyboard.press('Escape')
  })

  test('right-click on non-selected audio clip single-selects it', async ({ page }) => {
    await setupEditorWithAudio(page)

    const audioClips = page.locator('.independent-audio-clip')

    // Select first clip
    await audioClips.nth(0).click()
    await expect(audioClips.nth(0)).toHaveClass(/selected/)

    // Right-click on second clip (not selected)
    await audioClips.nth(1).click({ button: 'right' })

    // Second clip should be selected, first deselected
    await expect(audioClips.nth(1)).toHaveClass(/selected/)
    await expect(audioClips.nth(0)).not.toHaveClass(/selected/)

    // Context menu should be visible
    await expect(page.locator('.timeline-context-menu')).toBeVisible()

    await page.keyboard.press('Escape')
  })

  test('Paste is disabled when audio clipboard is empty', async ({ page }) => {
    await setupEditorWithAudio(page)

    const audioClips = page.locator('.independent-audio-clip')
    await audioClips.nth(0).click({ button: 'right' })

    const menu = page.locator('.timeline-context-menu')
    await expect(menu).toBeVisible({ timeout: 3_000 })

    const pasteItem = menu.locator('.timeline-context-menu-item').filter({ hasText: 'Paste' })
    await expect(pasteItem).toBeVisible()
    await expect(pasteItem).toBeDisabled()

    await page.keyboard.press('Escape')
  })

  // ==================== Add Audio Track ====================

  test('clicking "+ Audio Track" button adds a new empty track', async ({ page }) => {
    await setupEditorWithClips(page, 2)

    const addBtn = page.locator('.add-audio-track-btn')
    await expect(addBtn).toBeVisible()

    // Click once — should add "Audio 1"
    await addBtn.click()
    const audioTrackRows = page.locator('.audio-track-row.independent')
    await expect(audioTrackRows).toHaveCount(1, { timeout: 3_000 })
    await expect(audioTrackRows.nth(0).locator('.timeline-row-label')).toContainText('Audio 1')

    // Click again — should add "Audio 2"
    await addBtn.click()
    await expect(audioTrackRows).toHaveCount(2, { timeout: 3_000 })
    await expect(audioTrackRows.nth(1).locator('.timeline-row-label')).toContainText('Audio 2')
  })

  test('add-audio-track button not visible when no clips in timeline', async ({ page }) => {
    // Navigate to Editor without any clips
    await page.locator('.header-tab').filter({ hasText: 'Editor' }).click()
    await page.waitForTimeout(300)

    // When there are no clips, the timeline shows "No clips in timeline"
    // and the add-audio-track button should not be visible
    const addBtn = page.locator('.add-audio-track-btn')
    await expect(addBtn).not.toBeVisible()
  })

  // ==================== Keyboard Shortcuts ====================

  test('Backspace key removes selected audio clips', async ({ page }) => {
    await setupEditorWithAudio(page)

    const audioClips = page.locator('.independent-audio-clip')
    await audioClips.nth(0).click()
    await expect(audioClips.nth(0)).toHaveClass(/selected/)

    await page.keyboard.press('Backspace')

    // First clip should be gone, one remaining
    await expect(audioClips).toHaveCount(1, { timeout: 5_000 })
  })

  test('Delete key removes selected audio clips', async ({ page }) => {
    await setupEditorWithAudio(page)

    const audioClips = page.locator('.independent-audio-clip')
    await audioClips.nth(0).click()
    await expect(audioClips.nth(0)).toHaveClass(/selected/)

    await page.keyboard.press('Delete')

    await expect(audioClips).toHaveCount(1, { timeout: 5_000 })
  })

  test('Backspace with multiple audio clips selected removes all of them', async ({ page }) => {
    await setupEditorWithAudio(page)

    const audioClips = page.locator('.independent-audio-clip')

    // Multi-select
    await audioClips.nth(0).click()
    await audioClips.nth(1).click({ modifiers: ['Meta'] })

    const selectedIds = await page.evaluate(() => {
      return (window as any).__editorStore.getState().selectedAudioClipIds
    })
    expect(selectedIds).toHaveLength(2)

    await page.keyboard.press('Backspace')

    // All clips should be gone
    await expect(audioClips).toHaveCount(0, { timeout: 5_000 })
  })

  // ==================== Copy / Paste ====================

  test('Cmd+C copies and Cmd+V pastes audio clips', async ({ page }) => {
    await setupEditorWithAudio(page)

    const audioClips = page.locator('.independent-audio-clip')
    await expect(audioClips).toHaveCount(2)

    // Select first clip
    await audioClips.nth(0).click()
    await expect(audioClips.nth(0)).toHaveClass(/selected/)

    // Copy (Cmd+C)
    await page.keyboard.press('Meta+c')

    // Verify clipboard is set in store
    const hasClipboard = await page.evaluate(() => {
      const state = (window as any).__editorStore.getState()
      return state.clipboardAudioClips !== null && state.clipboardAudioClips.length > 0
    })
    expect(hasClipboard).toBe(true)

    // Paste (Cmd+V)
    await page.keyboard.press('Meta+v')

    // Should have 3 clips now (original 2 + 1 pasted)
    await expect(audioClips).toHaveCount(3, { timeout: 5_000 })
  })

  test('Cmd+X cuts and Cmd+V pastes audio clips', async ({ page }) => {
    await setupEditorWithAudio(page)

    const audioClips = page.locator('.independent-audio-clip')
    await expect(audioClips).toHaveCount(2)

    // Select first clip
    await audioClips.nth(0).click()
    await expect(audioClips.nth(0)).toHaveClass(/selected/)

    // Cut (Cmd+X)
    await page.keyboard.press('Meta+x')

    // Should have 1 clip (first was removed)
    await expect(audioClips).toHaveCount(1, { timeout: 5_000 })

    // Paste (Cmd+V)
    await page.keyboard.press('Meta+v')

    // Should have 2 clips again
    await expect(audioClips).toHaveCount(2, { timeout: 5_000 })
  })

  test('context menu Copy then Paste inserts duplicate audio clip', async ({ page }) => {
    await setupEditorWithAudio(page)

    const audioClips = page.locator('.independent-audio-clip')
    await expect(audioClips).toHaveCount(2)

    // Select first clip, right-click -> Copy
    await audioClips.nth(0).click()
    await audioClips.nth(0).click({ button: 'right' })

    const menu = page.locator('.timeline-context-menu')
    await expect(menu).toBeVisible({ timeout: 3_000 })

    const copyItem = menu.locator('.timeline-context-menu-item').filter({ hasText: 'Copy' })
    await copyItem.click()

    // Menu should close
    await expect(menu).not.toBeVisible()

    // Right-click again to paste
    await audioClips.nth(0).click({ button: 'right' })
    await expect(menu).toBeVisible({ timeout: 3_000 })

    const pasteItem = menu.locator('.timeline-context-menu-item').filter({ hasText: 'Paste' })
    await expect(pasteItem).toBeEnabled()
    await pasteItem.click()

    // Should have 3 clips
    await expect(audioClips).toHaveCount(3, { timeout: 5_000 })
  })

  // ==================== Move Clip ====================

  test('moveAudioClip repositions clip on the timeline', async ({ page }) => {
    await setupEditorWithAudio(page)

    const audioClips = page.locator('.independent-audio-clip')
    const firstClipBefore = await audioClips.nth(0).boundingBox()
    expect(firstClipBefore).not.toBeNull()

    // Move the first clip from 0ms to 1000ms via store
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().moveAudioClip('test-audio-track-1', 'test-audio-clip-1', 1000)
    })
    await page.waitForTimeout(200)

    const firstClipAfter = await audioClips.nth(0).boundingBox()
    expect(firstClipAfter).not.toBeNull()

    // The clip should have moved to the right
    expect(firstClipAfter!.x).toBeGreaterThan(firstClipBefore!.x)
  })

  // ==================== Trim ====================

  test('trimAudioClip adjusts clip duration', async ({ page }) => {
    await setupEditorWithAudio(page)

    const audioClips = page.locator('.independent-audio-clip')
    const firstClipBefore = await audioClips.nth(0).boundingBox()
    expect(firstClipBefore).not.toBeNull()

    // Trim 1000ms from the start of the first clip (originally 5000ms)
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().trimAudioClip('test-audio-track-1', 'test-audio-clip-1', 1000, 0)
    })
    await page.waitForTimeout(200)

    const firstClipAfter = await audioClips.nth(0).boundingBox()
    expect(firstClipAfter).not.toBeNull()

    // The clip should be narrower after trimming
    expect(firstClipAfter!.width).toBeLessThan(firstClipBefore!.width)
  })

  // ==================== Store State Integrity ====================

  test('removing a track removes it from the store', async ({ page }) => {
    await setupEditorWithAudio(page)

    // Remove track via store
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().removeAudioTrack('test-audio-track-1')
    })
    await page.waitForTimeout(200)

    // Only the SE track row should remain
    const audioTrackRows = page.locator('.audio-track-row.independent')
    await expect(audioTrackRows).toHaveCount(1)
    await expect(audioTrackRows.nth(0).locator('.timeline-row-label')).toContainText('SE')

    // No audio clips should be visible (SE track is empty)
    const audioClips = page.locator('.independent-audio-clip')
    await expect(audioClips).toHaveCount(0)
  })

  test('reset clears all independent audio tracks', async ({ page }) => {
    await setupEditorWithAudio(page)

    // Verify tracks exist
    await expect(page.locator('.audio-track-row.independent')).toHaveCount(2)

    // Reset the store
    await page.evaluate(() => {
      const store = (window as any).__editorStore
      store.getState().reset()
    })
    await page.waitForTimeout(200)

    // No independent audio track rows should remain
    const audioTrackRows = page.locator('.audio-track-row.independent')
    await expect(audioTrackRows).toHaveCount(0)
  })
})
