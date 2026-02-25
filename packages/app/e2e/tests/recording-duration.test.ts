import { test, expect } from '../fixtures/electron-app'
import { existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'

test.describe('Recording Duration Accuracy', () => {
  test('Recorded video duration matches wall-clock time', async ({ page }) => {
    const RECORDING_SECONDS = 5
    const TOLERANCE_RATIO = 0.15 // Allow 15% deviation from expected duration

    // Step 1: Add a display source (display 0 = main display)
    const addResult = await page.evaluate(async () => {
      try {
        const id = await (window as any).api.invoke('sources:add', 'display', JSON.stringify({
          type: 'Display',
          display_index: 0,
          width: 1280,
          height: 720,
        }))
        return { sourceId: id as number }
      } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) }
      }
    })

    // Skip if screen capture permissions are not granted
    if ('error' in addResult) {
      test.skip(true, `Screen capture unavailable: ${addResult.error}`)
      return
    }

    const sourceId = addResult.sourceId

    // Step 2: Set layout to single source
    await page.evaluate(async (srcId) => {
      await (window as any).api.invoke('layout:set', JSON.stringify({
        type: 'Single',
        source: srcId,
      }))
    }, sourceId)

    // Step 3: Use tmpdir as output directory so we know where the file goes
    const outputDir = tmpdir()

    // Step 4: Start V2 recording via IPC
    const outputPath = await page.evaluate(async ([dir]) => {
      return await (window as any).api.invoke('recording:start-v2', {
        outputWidth: 1280,
        outputHeight: 720,
        fps: 30,
        format: 'mp4',
        quality: 'low',
        outputDir: dir,
      }) as string
    }, [outputDir] as const)

    // Step 5: Wait for the target recording duration
    await new Promise(resolve => setTimeout(resolve, RECORDING_SECONDS * 1000))

    // Step 6: Stop recording and get result info
    const result = await page.evaluate(async () => {
      return await (window as any).api.invoke('recording:stop-v2') as {
        outputPath: string
        frameCount: number
        durationMs: number
        format: string
      }
    })

    // Step 7: Verify the output file exists
    expect(existsSync(result.outputPath)).toBe(true)

    // Step 8: Probe the recorded file with FFmpeg to get the actual video duration
    const probe = await page.evaluate(async (path) => {
      return await (window as any).api.invoke('editor:probe', path)
    }, result.outputPath)

    // Step 9: Assert the FFmpeg-probed duration matches wall-clock time within tolerance
    const probeDurationSec = probe.durationMs / 1000
    const ratio = probeDurationSec / RECORDING_SECONDS

    console.log(`Recording result: frameCount=${result.frameCount}, durationMs=${result.durationMs}`)
    console.log(`FFmpeg probe: durationMs=${probe.durationMs}, fps=${probe.fps}`)
    console.log(`Duration ratio: ${ratio.toFixed(3)} (probe=${probeDurationSec.toFixed(2)}s / expected=${RECORDING_SECONDS}s)`)

    expect(ratio).toBeGreaterThan(1 - TOLERANCE_RATIO) // At least 85% of expected
    expect(ratio).toBeLessThan(1 + TOLERANCE_RATIO)     // At most 115% of expected

    // Step 10: Cleanup - remove output file and test source
    try { unlinkSync(result.outputPath) } catch { /* ignore cleanup errors */ }

    await page.evaluate(async (id) => {
      await (window as any).api.invoke('sources:remove', id)
    }, sourceId)
  })
})
