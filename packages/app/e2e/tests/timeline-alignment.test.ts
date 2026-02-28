/**
 * E2E test for timeline track alignment.
 *
 * Verifies that:
 * - The Video label exists in the clip track
 * - The playhead overlay exists at the timeline level (not inside clip-track)
 * - The playhead spans the full height of the timeline
 * - Video and audio labels have the same horizontal position (both 100px wide)
 */

import { test, expect } from '../fixtures/electron-app'
import { S } from '../helpers/selectors'
import {
  closeLeftoverDialogs,
  cleanupEditor,
} from '../helpers/test-utils'

test.describe('Timeline alignment', () => {
  test.beforeEach(async ({ page }) => {
    await closeLeftoverDialogs(page)
    // Set up editor with a bundle clip that has audio tracks so we can verify
    // both video and audio label alignment
    await page.locator('.header-tab').filter({ hasText: 'Editor' }).click()
    await page.waitForTimeout(300)

    // Populate store with a bundle clip that includes audio tracks
    const clipData = [
      {
        id: 'align-clip-0',
        sourcePath: '/tmp/align-test-video.mp4',
        originalDuration: 5000,
        trimStart: 0,
        trimEnd: 0,
        order: 0,
        audioTracks: [
          {
            id: 'sys-align',
            type: 'system',
            label: 'System Audio',
            clips: [{ id: 'ac-align-1', filename: 'sys.pcm', startMs: 0, endMs: 5000, offsetMs: 0 }],
            format: { sampleRate: 48000, channels: 2, encoding: 'f32le' as const, bytesPerSample: 4 as const },
          },
        ],
        mixerSettings: {
          tracks: [{ trackId: 'sys-align', volume: 1, muted: false }],
        },
      },
    ]

    await page.evaluate((data) => {
      const store = (window as unknown as Record<string, unknown>).__editorStore as {
        getState: () => Record<string, unknown>
        setState: (s: Record<string, unknown>) => void
      }
      if (!store) throw new Error('__editorStore not exposed on window')
      store.setState({
        project: {
          ...(store.getState().project as Record<string, unknown>),
          clips: data,
          textOverlays: [],
          independentAudioTracks: [],
        },
        selectedClipIds: [],
        lastSelectedClipId: null,
        selectedOverlayId: null,
        selectedAudioClipIds: [],
        lastSelectedAudioClipId: null,
        clipboardAudioClips: null,
        currentTimeMs: 0,
        isPlaying: false,
      })
    }, clipData)

    // Wait for timeline clip to render
    await expect(page.locator(S.timelineClip)).toHaveCount(1, { timeout: 5_000 })
  })

  test.afterEach(async ({ page }) => {
    await cleanupEditor(page)
  })

  test('video and audio tracks are horizontally aligned with full-height playhead', async ({ page }) => {
    // -----------------------------------------------------------------------
    // 1. Verify Video label exists in clip-track
    // -----------------------------------------------------------------------
    const videoLabel = page.locator('.clip-track .timeline-row-label')
    await expect(videoLabel).toBeVisible()
    await expect(videoLabel).toContainText('Video')

    // -----------------------------------------------------------------------
    // 2. Verify playhead overlay exists at timeline level
    // -----------------------------------------------------------------------
    const playheadOverlay = page.locator('.timeline-playhead-overlay')
    await expect(playheadOverlay).toBeVisible()

    // Verify playhead is inside the overlay (not inside clip-track)
    const playhead = page.locator('.timeline-playhead-overlay .timeline-playhead')
    await expect(playhead).toBeVisible()

    // Verify NO playhead exists directly in clip-track
    const oldPlayhead = page.locator('.clip-track > .timeline-playhead')
    await expect(oldPlayhead).toHaveCount(0)

    // -----------------------------------------------------------------------
    // 3. Verify Video label width is 100px
    // -----------------------------------------------------------------------
    const videoLabelBox = await videoLabel.boundingBox()
    expect(videoLabelBox).toBeTruthy()
    expect(videoLabelBox!.width).toBe(100)

    // -----------------------------------------------------------------------
    // 4. Verify audio track labels match video label position/width
    // -----------------------------------------------------------------------
    const audioLabels = page.locator('.audio-track-row .timeline-row-label')
    const audioLabelCount = await audioLabels.count()
    expect(audioLabelCount).toBeGreaterThan(0)

    const audioLabelBox = await audioLabels.first().boundingBox()
    expect(audioLabelBox).toBeTruthy()
    // Video and audio labels should start at the same X position
    expect(videoLabelBox!.x).toBe(audioLabelBox!.x)
    // Audio label should also be 100px wide
    expect(audioLabelBox!.width).toBe(100)

    // -----------------------------------------------------------------------
    // 5. Verify playhead overlay spans full timeline height
    // -----------------------------------------------------------------------
    const timeline = page.locator(S.timeline)
    const timelineBox = await timeline.boundingBox()
    const overlayBox = await playheadOverlay.boundingBox()
    expect(timelineBox).toBeTruthy()
    expect(overlayBox).toBeTruthy()
    // Overlay should span the full height of the timeline (allow 2px tolerance)
    expect(overlayBox!.height).toBeGreaterThanOrEqual(timelineBox!.height - 2)

    // -----------------------------------------------------------------------
    // 6. Verify the playhead-overlay label width matches track labels
    //    (ensuring the playhead line aligns with clip content)
    // -----------------------------------------------------------------------
    const overlayLabel = page.locator('.timeline-playhead-overlay .timeline-row-label')
    const overlayLabelBox = await overlayLabel.boundingBox()
    expect(overlayLabelBox).toBeTruthy()
    expect(overlayLabelBox!.width).toBe(100)
    expect(overlayLabelBox!.x).toBe(videoLabelBox!.x)

    // -----------------------------------------------------------------------
    // 7. Take screenshot for visual evidence
    // -----------------------------------------------------------------------
    await page.screenshot({
      path: '/private/tmp/e2e-video-evidence/timeline-alignment.png',
      fullPage: false,
    })

    // Copy video evidence
    const videoPath = await page.video()?.path()
    if (videoPath) {
      const fs = await import('fs')
      fs.copyFileSync(videoPath, '/private/tmp/e2e-video-evidence/timeline-alignment.webm')
    }
  })
})
