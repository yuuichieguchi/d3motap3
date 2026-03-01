import { useRef, useEffect, useState } from 'react'
import { extractPeaks } from '../utils/waveform'

interface ClipWaveformInput {
  clipId: string
  sourcePath: string
  pcmFormat?: { sampleRate: number; channels: number }
}

export function useWaveformData(
  clipInputs: ClipWaveformInput[],
  audioContext: AudioContext | null,
): Map<string, Float32Array> {
  const [waveformMap, setWaveformMap] = useState<Map<string, Float32Array>>(new Map())
  const cacheRef = useRef<Map<string, Float32Array>>(new Map())
  const inputsRef = useRef(clipInputs)
  inputsRef.current = clipInputs

  const stableKey = clipInputs.map((c) => `${c.clipId}:${c.sourcePath}`).join('|')

  useEffect(() => {
    if (!audioContext || !stableKey) return

    let cancelled = false
    const ctx = audioContext
    const inputs = inputsRef.current

    const loadAll = async (): Promise<void> => {
      const toLoad = inputs.filter((inp) => !cacheRef.current.has(inp.clipId))

      if (toLoad.length > 0) {
        await Promise.all(
          toLoad.map(async (input) => {
            try {
              const url = input.pcmFormat
                ? `audio://local${input.sourcePath}?sr=${input.pcmFormat.sampleRate}&ch=${input.pcmFormat.channels}`
                : `media://local${input.sourcePath}`

              const response = await fetch(url)
              if (!response.ok) return

              const arrayBuffer = await response.arrayBuffer()
              const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
              const peaks = extractPeaks(audioBuffer)

              // Always cache, even if cancelled — next effect run will find it
              cacheRef.current.set(input.clipId, peaks)
            } catch (err) {
              console.error('Waveform load failed for', input.clipId, err)
            }
          }),
        )
      }

      if (cancelled) return

      // Update state if we have any cached data (new or previously cached)
      if (cacheRef.current.size > 0) {
        const debugData: Record<string, { max: number; sum: number; length: number }> = {}
        for (const [clipId, peaks] of cacheRef.current) {
          let max = 0,
            sum = 0
          for (let i = 0; i < peaks.length; i++) {
            if (peaks[i] > max) max = peaks[i]
            sum += peaks[i]
          }
          debugData[clipId] = { max, sum, length: peaks.length }
        }
        ;(window as unknown as Record<string, unknown>).__waveformData = debugData

        setWaveformMap(new Map(cacheRef.current))
      }
    }

    loadAll()

    return (): void => {
      cancelled = true
    }
  }, [stableKey, audioContext])

  return waveformMap
}
