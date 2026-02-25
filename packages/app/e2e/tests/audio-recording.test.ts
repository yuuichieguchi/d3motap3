import { test, expect } from '../fixtures/electron-app'
import { existsSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { hasAudioStream } from '../helpers/ffprobe'

test.describe('Audio Recording', () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      const isRecording = await (window as any).api.invoke('recording:is-recording-v2')
      if (isRecording) {
        await (window as any).api.invoke('recording:stop-v2')
      }
    }).catch(() => {})

    await page.evaluate(async () => {
      const sources = await (window as any).api.invoke('sources:list')
      for (const src of sources) {
        await (window as any).api.invoke('sources:remove', src.id)
      }
    }).catch(() => {})
  })

  test('List audio input devices returns valid array', async ({ page }) => {
    const devices = await page.evaluate(async () => {
      return await (window as any).api.invoke('audio:list-input-devices') as Array<{
        id: string
        name: string
        isDefault: boolean
      }>
    })

    expect(Array.isArray(devices)).toBe(true)
    expect(devices.length).toBeGreaterThanOrEqual(0)

    for (const device of devices) {
      expect(typeof device.id).toBe('string')
      expect(typeof device.name).toBe('string')
      expect(typeof device.isDefault).toBe('boolean')
    }
  })

  test('Recording with system audio produces audio stream', async ({ page }) => {
    // Step 1: Add a display source
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

    const outputDir = tmpdir()

    // Step 3: Start recording with system audio enabled
    await page.evaluate(async ([dir]) => {
      await (window as any).api.invoke('recording:start-v2', {
        outputWidth: 1280,
        outputHeight: 720,
        fps: 30,
        format: 'mp4',
        quality: 'low',
        outputDir: dir,
        captureSystemAudio: true,
      })
    }, [outputDir] as const)

    // Step 4: Wait for recording to capture some frames
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Step 5: Stop recording and get result
    const result = await page.evaluate(async () => {
      return await (window as any).api.invoke('recording:stop-v2') as {
        outputPath: string
        frameCount: number
        durationMs: number
        format: string
      }
    })

    // Step 6: Verify output file exists
    expect(existsSync(result.outputPath)).toBe(true)

    // Step 7: Verify the file contains an audio stream
    expect(hasAudioStream(result.outputPath)).toBe(true)

    // Step 8: Cleanup
    try { unlinkSync(result.outputPath) } catch { /* ignore cleanup errors */ }

    await page.evaluate(async (id) => {
      await (window as any).api.invoke('sources:remove', id)
    }, sourceId)
  })

  test('Recording without audio has no audio stream', async ({ page }) => {
    // Step 1: Add a display source
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

    const outputDir = tmpdir()

    // Step 3: Start recording without audio
    await page.evaluate(async ([dir]) => {
      await (window as any).api.invoke('recording:start-v2', {
        outputWidth: 1280,
        outputHeight: 720,
        fps: 30,
        format: 'mp4',
        quality: 'low',
        outputDir: dir,
        captureSystemAudio: false,
      })
    }, [outputDir] as const)

    // Step 4: Wait for recording to capture some frames
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Step 5: Stop recording and get result
    const result = await page.evaluate(async () => {
      return await (window as any).api.invoke('recording:stop-v2') as {
        outputPath: string
        frameCount: number
        durationMs: number
        format: string
      }
    })

    // Step 6: Verify output file exists
    expect(existsSync(result.outputPath)).toBe(true)

    // Step 7: Verify the file does NOT contain an audio stream
    expect(hasAudioStream(result.outputPath)).toBe(false)

    // Step 8: Cleanup
    try { unlinkSync(result.outputPath) } catch { /* ignore cleanup errors */ }

    await page.evaluate(async (id) => {
      await (window as any).api.invoke('sources:remove', id)
    }, sourceId)
  })

  test('GIF recording with audio option completes without error', async ({ page }) => {
    // Step 1: Add a display source
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

    const outputDir = tmpdir()

    // Step 3: Start GIF recording with audio option (should be silently ignored)
    await page.evaluate(async ([dir]) => {
      await (window as any).api.invoke('recording:start-v2', {
        outputWidth: 1280,
        outputHeight: 720,
        fps: 30,
        format: 'gif',
        quality: 'low',
        outputDir: dir,
        captureSystemAudio: true,
      })
    }, [outputDir] as const)

    // Step 4: Wait for recording to capture some frames
    await new Promise(resolve => setTimeout(resolve, 3000))

    // Step 5: Stop recording and get result
    const result = await page.evaluate(async () => {
      return await (window as any).api.invoke('recording:stop-v2') as {
        outputPath: string
        frameCount: number
        durationMs: number
        format: string
      }
    })

    // Step 6: Verify output file exists
    expect(existsSync(result.outputPath)).toBe(true)

    // Step 7: Verify the result format is GIF
    expect(result.format).toBe('gif')
    expect(hasAudioStream(result.outputPath)).toBe(false)

    // Step 8: Cleanup
    try { unlinkSync(result.outputPath) } catch { /* ignore cleanup errors */ }

    await page.evaluate(async (id) => {
      await (window as any).api.invoke('sources:remove', id)
    }, sourceId)
  })
})
