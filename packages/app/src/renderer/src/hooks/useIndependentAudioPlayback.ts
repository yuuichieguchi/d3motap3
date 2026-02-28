import { useRef, useEffect, useCallback, useState } from 'react'
import type { IndependentAudioTrack } from '@d3motap3/shared'

interface AudioClipState {
  buffer: AudioBuffer | null
  sourceNode: AudioBufferSourceNode | null
}

interface TrackState {
  gainNode: GainNode
  clips: Map<string, AudioClipState> // clipId -> state
}

interface UseIndependentAudioPlaybackOptions {
  audioContext: AudioContext | null
  tracks: IndependentAudioTrack[]
  isPlaying: boolean
  currentTimeMs: number
}

export function useIndependentAudioPlayback({
  audioContext,
  tracks,
  isPlaying,
  currentTimeMs,
}: UseIndependentAudioPlaybackOptions) {
  const trackStatesRef = useRef<Map<string, TrackState>>(new Map())
  const analyserRef = useRef<AnalyserNode | null>(null)
  const lastSeekTimeRef = useRef<number>(0)
  const playbackVersionRef = useRef<number>(0)
  const loadedTracksKeyRef = useRef<string>('')
  const [isLoaded, setIsLoaded] = useState(false)

  // Load audio buffers when tracks change
  useEffect(() => {
    if (!audioContext || tracks.length === 0) {
      loadedTracksKeyRef.current = ''
      setIsLoaded(false)
      return
    }

    // Build a key from all clip source paths to detect changes
    const tracksKey = tracks
      .flatMap((t) => t.clips.map((c) => `${c.id}:${c.sourcePath}`))
      .join('|')

    if (loadedTracksKeyRef.current === tracksKey) {
      return // Already loaded
    }

    loadedTracksKeyRef.current = tracksKey
    setIsLoaded(false)
    const ctx = audioContext
    let cancelled = false

    const loadAll = async () => {
      for (const track of tracks) {
        if (cancelled) return

        let trackState = trackStatesRef.current.get(track.id)
        if (!trackState) {
          const gainNode = ctx.createGain()
          // Route through analyser for signal verification
          if (!analyserRef.current) {
            analyserRef.current = ctx.createAnalyser()
            analyserRef.current.fftSize = 256
            analyserRef.current.connect(ctx.destination)
          }
          gainNode.connect(analyserRef.current)
          trackState = { gainNode, clips: new Map() }
          trackStatesRef.current.set(track.id, trackState)
        }

        for (const clip of track.clips) {
          if (cancelled) return
          if (trackState.clips.has(clip.id)) continue

          try {
            const url = `media://local${clip.sourcePath}`
            const response = await fetch(url)
            if (cancelled) return
            if (!response.ok) {
              console.error(`Failed to fetch audio clip ${clip.id}: ${response.status}`)
              ;(window as any).__independentAudioLoadError = {
                clipId: clip.id, phase: 'fetch', status: response.status, url,
              }
              continue
            }
            const arrayBuffer = await response.arrayBuffer()
            if (cancelled) return
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
            if (cancelled) return
            trackState.clips.set(clip.id, { buffer: audioBuffer, sourceNode: null })
          } catch (err) {
            console.error(`Failed to load audio clip ${clip.id}:`, err)
            ;(window as any).__independentAudioLoadError = {
              clipId: clip.id, phase: 'catch', error: String(err),
            }
          }
        }
      }
    }

    loadAll().then(() => {
      if (cancelled) return

      const totalClips = [...trackStatesRef.current.values()]
        .reduce((sum, ts) => sum + ts.clips.size, 0)
      const loaded = totalClips > 0
      if (loaded) {
        setIsLoaded(true)
      }
      ;(window as any).__independentAudioLoadState = {
        loaded,
        trackCount: trackStatesRef.current.size,
        clipCount: totalClips,
      }

      // Expose signal level reader for E2E verification as soon as audio is loaded
      ;(window as any).__getIndependentAudioSignalLevel = () => {
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
    })

    return () => {
      cancelled = true

      // Cleanup debug globals to prevent leaks between E2E tests
      delete (window as any).__independentAudioLoadState
      delete (window as any).__independentAudioLoadError
      delete (window as any).__getIndependentAudioSignalLevel

      // Cleanup on track changes
      for (const [, state] of trackStatesRef.current) {
        for (const [, clipState] of state.clips) {
          if (clipState.sourceNode) {
            try { clipState.sourceNode.stop() } catch { /* already stopped */ }
          }
        }
        state.gainNode.disconnect()
      }
      trackStatesRef.current.clear()
      if (analyserRef.current) {
        analyserRef.current.disconnect()
        analyserRef.current = null
      }
    }
  }, [audioContext, tracks])

  // Apply volume/mute settings
  useEffect(() => {
    for (const track of tracks) {
      const state = trackStatesRef.current.get(track.id)
      if (state) {
        state.gainNode.gain.value = track.muted ? 0 : track.volume
      }
    }
  }, [tracks])

  // Start audio playback for clips that overlap the current time
  const startPlayback = useCallback(async (timeMs: number) => {
    const ctx = audioContext
    if (!ctx || !isLoaded) return

    const version = ++playbackVersionRef.current

    if (ctx.state !== 'running') {
      await ctx.resume()
    }

    if (playbackVersionRef.current !== version) return

    // Stop all existing sources
    for (const [, trackState] of trackStatesRef.current) {
      for (const [, clipState] of trackState.clips) {
        if (clipState.sourceNode) {
          try { clipState.sourceNode.stop() } catch { /* already stopped */ }
          clipState.sourceNode = null
        }
      }
    }

    // Start sources for clips that overlap current time
    for (const track of tracks) {
      if (track.muted) continue
      const trackState = trackStatesRef.current.get(track.id)
      if (!trackState) continue

      for (const clip of track.clips) {
        const clipDuration = clip.originalDuration - clip.trimStart - clip.trimEnd
        const clipEnd = clip.timelineStartMs + clipDuration

        // Check if this clip overlaps the current time
        if (timeMs >= clip.timelineStartMs && timeMs < clipEnd) {
          const clipState = trackState.clips.get(clip.id)
          if (!clipState?.buffer) continue

          const source = ctx.createBufferSource()
          source.buffer = clipState.buffer
          source.connect(trackState.gainNode)

          // Calculate offset within the audio buffer
          const offsetInClip = timeMs - clip.timelineStartMs
          const bufferOffset = (clip.trimStart + offsetInClip) / 1000
          const safeOffset = Math.max(0, Math.min(bufferOffset, clipState.buffer.duration))

          source.start(0, safeOffset)
          clipState.sourceNode = source
        }
      }
    }

  }, [audioContext, tracks, isLoaded])

  const stopPlayback = useCallback(() => {
    playbackVersionRef.current++

    for (const [, trackState] of trackStatesRef.current) {
      for (const [, clipState] of trackState.clips) {
        if (clipState.sourceNode) {
          try { clipState.sourceNode.stop() } catch { /* already stopped */ }
          clipState.sourceNode = null
        }
      }
    }
  }, [])

  // Handle play/pause
  useEffect(() => {
    if (tracks.length === 0 || !isLoaded) return

    if (isPlaying) {
      lastSeekTimeRef.current = currentTimeMs
      startPlayback(currentTimeMs)
    } else {
      stopPlayback()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, tracks.length, isLoaded, startPlayback, stopPlayback])

  // Handle seek during playback
  useEffect(() => {
    if (!isPlaying || tracks.length === 0 || !isLoaded) return

    const timeDiff = Math.abs(currentTimeMs - lastSeekTimeRef.current)
    lastSeekTimeRef.current = currentTimeMs

    if (timeDiff > 100) {
      startPlayback(currentTimeMs)
    }
  }, [currentTimeMs, isPlaying, tracks.length, isLoaded, startPlayback])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPlayback()
      if (analyserRef.current) {
        analyserRef.current.disconnect()
        analyserRef.current = null
      }
    }
  }, [stopPlayback])

  // Return the AudioContext getter for sharing
  return { audioContext }
}
