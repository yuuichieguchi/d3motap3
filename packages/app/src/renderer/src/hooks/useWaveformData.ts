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
  const loadingRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!audioContext || clipInputs.length === 0) return

    let cancelled = false
    const ctx = audioContext

    const loadMissing = async () => {
      const updates: [string, Float32Array][] = []

      for (const input of clipInputs) {
        if (cancelled) return
        if (cacheRef.current.has(input.clipId)) continue
        if (loadingRef.current.has(input.clipId)) continue

        loadingRef.current.add(input.clipId)

        try {
          const url = input.pcmFormat
            ? `audio://local${input.sourcePath}?sr=${input.pcmFormat.sampleRate}&ch=${input.pcmFormat.channels}`
            : `media://local${input.sourcePath}`

          const response = await fetch(url)
          if (cancelled) return
          if (!response.ok) continue

          const arrayBuffer = await response.arrayBuffer()
          if (cancelled) return

          const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
          if (cancelled) return

          const peaks = extractPeaks(audioBuffer)
          cacheRef.current.set(input.clipId, peaks)
          updates.push([input.clipId, peaks])
        } catch {
          // Silently skip failed loads
        } finally {
          loadingRef.current.delete(input.clipId)
        }
      }

      if (!cancelled && updates.length > 0) {
        setWaveformMap(new Map(cacheRef.current))
      }
    }

    loadMissing()

    return () => {
      cancelled = true
    }
  }, [clipInputs, audioContext])

  // Return cached data immediately if available
  if (cacheRef.current.size > 0 && waveformMap.size === 0) {
    return cacheRef.current
  }

  return waveformMap
}
