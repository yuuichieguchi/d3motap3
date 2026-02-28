import { useRef, useEffect, useCallback, useState } from 'react'
import type { AudioTrack, MixerSettings } from '@d3motap3/shared'

interface AudioTrackState {
  buffer: AudioBuffer | null
  sourceNode: AudioBufferSourceNode | null
  gainNode: GainNode
}

interface UseAudioPlaybackOptions {
  videoRef: React.RefObject<HTMLVideoElement | null>
  audioTracks: AudioTrack[] | undefined
  mixerSettings: MixerSettings | undefined
  bundlePath: string | undefined
  isPlaying: boolean
  currentTimeMs: number
}

export function useAudioPlayback({
  videoRef,
  audioTracks,
  mixerSettings,
  bundlePath,
  isPlaying,
  currentTimeMs,
}: UseAudioPlaybackOptions) {
  const audioContextRef = useRef<AudioContext | null>(null)
  const trackStatesRef = useRef<Map<string, AudioTrackState>>(new Map())
  const lastSeekTimeRef = useRef<number>(0)
  const [isLoaded, setIsLoaded] = useState(false)
  const currentBundleRef = useRef<string | undefined>(undefined)

  // Initialize AudioContext lazily
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }
    return audioContextRef.current
  }, [])

  // Load audio buffers from bundle
  useEffect(() => {
    if (!bundlePath || !audioTracks || audioTracks.length === 0) {
      setIsLoaded(false)
      currentBundleRef.current = undefined
      return
    }

    // Skip if already loaded for this bundle
    if (currentBundleRef.current === bundlePath && isLoaded) {
      return
    }

    currentBundleRef.current = bundlePath
    setIsLoaded(false)

    const ctx = getAudioContext()
    const loadPromises = audioTracks.map(async (track) => {
      if (track.clips.length === 0) return

      const clip = track.clips[0] // Initial implementation: single clip per track
      const pcmPath = `${bundlePath}/tracks/${clip.filename}`
      const url = `audio://local${pcmPath}?sr=${track.format.sampleRate}&ch=${track.format.channels}`

      try {
        const response = await fetch(url)
        if (!response.ok) {
          console.error(`Audio fetch failed for ${track.id}: ${response.status} ${response.statusText}`)
          ;(window as any).__audioLoadError = { trackId: track.id, phase: 'fetch', status: response.status, url }
          return
        }
        const arrayBuffer = await response.arrayBuffer()
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer)

        const gainNode = ctx.createGain()
        gainNode.connect(ctx.destination)

        trackStatesRef.current.set(track.id, {
          buffer: audioBuffer,
          sourceNode: null,
          gainNode,
        })
      } catch (err) {
        console.error(`Failed to load audio track ${track.id}:`, err)
        ;(window as any).__audioLoadError = { trackId: track.id, phase: 'catch', error: String(err), url }
      }
    })

    Promise.all(loadPromises).then(() => {
      const loaded = trackStatesRef.current.size > 0
      if (loaded) {
        setIsLoaded(true)
      }
      // Expose load completion for E2E test polling
      ;(window as any).__audioLoadState = { loaded, trackCount: trackStatesRef.current.size }
    })

    return () => {
      // Cleanup on unmount or bundle change
      for (const [, state] of trackStatesRef.current) {
        if (state.sourceNode) {
          try { state.sourceNode.stop() } catch { /* already stopped */ }
        }
        state.gainNode.disconnect()
      }
      trackStatesRef.current.clear()
    }
  }, [bundlePath, audioTracks, getAudioContext])

  // Apply mixer settings (volume/mute) in real-time
  useEffect(() => {
    if (!mixerSettings) return

    for (const setting of mixerSettings.tracks) {
      const state = trackStatesRef.current.get(setting.trackId)
      if (state) {
        state.gainNode.gain.value = setting.muted ? 0 : setting.volume
      }
    }
  }, [mixerSettings])

  // Start/stop audio source nodes
  const startAudioPlayback = useCallback((offsetSeconds: number) => {
    const ctx = audioContextRef.current
    if (!ctx || !isLoaded) return

    // Stop existing nodes
    for (const [, state] of trackStatesRef.current) {
      if (state.sourceNode) {
        try { state.sourceNode.stop() } catch { /* already stopped */ }
        state.sourceNode = null
      }
    }

    // Create new source nodes
    for (const [, state] of trackStatesRef.current) {
      if (!state.buffer) continue

      const source = ctx.createBufferSource()
      source.buffer = state.buffer
      source.connect(state.gainNode)

      const safeOffset = Math.max(0, Math.min(offsetSeconds, state.buffer.duration))
      source.start(0, safeOffset)
      state.sourceNode = source
    }

    // Expose debug info for E2E tests
    ;(window as any).__audioPlaybackDebug = {
      lastOffsetSeconds: Math.max(0, Math.min(offsetSeconds,
        [...trackStatesRef.current.values()].find(s => s.buffer)?.buffer?.duration ?? 0)),
      bufferDuration: [...trackStatesRef.current.values()].find(s => s.buffer)?.buffer?.duration ?? 0,
      activeSourceCount: [...trackStatesRef.current.values()].filter(s => s.sourceNode).length,
      contextState: ctx.state,
      isLoaded,
    }
  }, [isLoaded])

  const stopAudioPlayback = useCallback(() => {
    for (const [, state] of trackStatesRef.current) {
      if (state.sourceNode) {
        try { state.sourceNode.stop() } catch { /* already stopped */ }
        state.sourceNode = null
      }
    }
  }, [])

  // Handle play/pause
  useEffect(() => {
    if (!bundlePath || !isLoaded) return

    const ctx = audioContextRef.current
    if (!ctx) return

    let cancelled = false

    if (isPlaying) {
      ;(async () => {
        if (ctx.state === 'suspended') {
          await ctx.resume()
        }
        if (cancelled) return
        const offsetSeconds = currentTimeMs / 1000
        startAudioPlayback(offsetSeconds)
      })()
    } else {
      stopAudioPlayback()
      if (ctx.state === 'running') {
        ctx.suspend()
      }
    }

    return () => {
      cancelled = true
    }
  }, [isPlaying, bundlePath, isLoaded, startAudioPlayback, stopAudioPlayback])

  // Handle seek during playback
  useEffect(() => {
    if (!isPlaying || !bundlePath || !isLoaded) return

    // Only re-sync if the time difference is significant (user seek, not playback tick)
    const timeDiff = Math.abs(currentTimeMs - lastSeekTimeRef.current)
    lastSeekTimeRef.current = currentTimeMs

    // If time jumped more than 100ms, treat as a seek
    if (timeDiff > 100) {
      startAudioPlayback(currentTimeMs / 1000)
    }
  }, [currentTimeMs, isPlaying, bundlePath, isLoaded, startAudioPlayback])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudioPlayback()
      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }
    }
  }, [stopAudioPlayback])

  return {
    isAudioLoaded: isLoaded,
  }
}
