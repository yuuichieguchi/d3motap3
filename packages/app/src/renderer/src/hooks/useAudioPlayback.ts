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
  const analyserRef = useRef<AnalyserNode | null>(null)
  const trackStatesRef = useRef<Map<string, AudioTrackState>>(new Map())
  const lastSeekTimeRef = useRef<number>(0)
  const playbackVersionRef = useRef<number>(0)
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
        // Route through analyser for signal verification, then to speakers
        if (!analyserRef.current) {
          analyserRef.current = ctx.createAnalyser()
          analyserRef.current.fftSize = 256
          analyserRef.current.connect(ctx.destination)
        }
        gainNode.connect(analyserRef.current)

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
      if (analyserRef.current) {
        analyserRef.current.disconnect()
        analyserRef.current = null
      }
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
  // MUST be async: ctx.resume() must complete before source.start() for audio to play
  const startAudioPlayback = useCallback(async (offsetSeconds: number) => {
    const ctx = audioContextRef.current
    if (!ctx || !isLoaded) return

    // Increment version to invalidate any prior in-flight startAudioPlayback call.
    const version = ++playbackVersionRef.current

    // Ensure AudioContext is running BEFORE creating source nodes.
    // source.start() on a suspended context queues but produces no output until resume.
    if (ctx.state !== 'running') {
      await ctx.resume()
    }

    // If another call superseded us while we were awaiting resume(), bail out.
    if (playbackVersionRef.current !== version) return

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

    // Expose real-time signal level reader for E2E verification.
    // Call this AFTER playback has been running for >100ms to get meaningful data.
    ;(window as any).__getAudioSignalLevel = () => {
      if (!analyserRef.current) return 0
      const buf = new Float32Array(analyserRef.current.fftSize)
      analyserRef.current.getFloatTimeDomainData(buf)
      let peak = 0
      for (let i = 0; i < buf.length; i++) {
        const abs = Math.abs(buf[i])
        if (abs > peak) peak = abs
      }
      return peak
    }
  }, [isLoaded])

  const stopAudioPlayback = useCallback(() => {
    // Increment version to cancel any in-flight async startAudioPlayback call.
    playbackVersionRef.current++

    for (const [, state] of trackStatesRef.current) {
      if (state.sourceNode) {
        try { state.sourceNode.stop() } catch { /* already stopped */ }
        state.sourceNode = null
      }
    }

    if (audioContextRef.current?.state === 'running') {
      audioContextRef.current.suspend()
    }
  }, [])

  // Handle play/pause
  useEffect(() => {
    if (!bundlePath || !isLoaded) return

    if (isPlaying) {
      // Sync lastSeekTimeRef BEFORE starting playback so the seek effect's
      // first tick (≈33ms later) sees a small timeDiff and doesn't restart audio.
      lastSeekTimeRef.current = currentTimeMs
      const offsetSeconds = currentTimeMs / 1000
      startAudioPlayback(offsetSeconds)
    } else {
      stopAudioPlayback()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- currentTimeMs intentionally excluded:
  // including it would restart audio every 33ms (setInterval tick). The seek effect handles time changes.
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
      if (analyserRef.current) {
        analyserRef.current.disconnect()
        analyserRef.current = null
      }
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
