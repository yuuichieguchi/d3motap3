import { useRef, useEffect, useCallback } from 'react'
import type { IndependentAudioTrack } from '@d3motap3/shared'

interface AudioClipState {
  buffer: AudioBuffer
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
  const lastSeekTimeRef = useRef<number>(0)
  const playbackVersionRef = useRef<number>(0)
  const loadedTracksKeyRef = useRef<string>('')

  // Load audio buffers when tracks change
  useEffect(() => {
    if (!audioContext || tracks.length === 0) {
      loadedTracksKeyRef.current = ''
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
    const ctx = audioContext

    const loadAll = async () => {
      for (const track of tracks) {
        let trackState = trackStatesRef.current.get(track.id)
        if (!trackState) {
          const gainNode = ctx.createGain()
          gainNode.connect(ctx.destination)
          trackState = { gainNode, clips: new Map() }
          trackStatesRef.current.set(track.id, trackState)
        }

        for (const clip of track.clips) {
          if (trackState.clips.has(clip.id)) continue

          try {
            const url = `media://local${clip.sourcePath}`
            const response = await fetch(url)
            if (!response.ok) {
              console.error(`Failed to fetch audio clip ${clip.id}: ${response.status}`)
              continue
            }
            const arrayBuffer = await response.arrayBuffer()
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
            trackState.clips.set(clip.id, { buffer: audioBuffer, sourceNode: null })
          } catch (err) {
            console.error(`Failed to load audio clip ${clip.id}:`, err)
          }
        }
      }
    }

    loadAll()

    return () => {
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
    if (!ctx) return

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
          if (!clipState) continue

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
  }, [audioContext, tracks])

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
    if (tracks.length === 0) return

    if (isPlaying) {
      lastSeekTimeRef.current = currentTimeMs
      startPlayback(currentTimeMs)
    } else {
      stopPlayback()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, tracks.length, startPlayback, stopPlayback])

  // Handle seek during playback
  useEffect(() => {
    if (!isPlaying || tracks.length === 0) return

    const timeDiff = Math.abs(currentTimeMs - lastSeekTimeRef.current)
    lastSeekTimeRef.current = currentTimeMs

    if (timeDiff > 100) {
      startPlayback(currentTimeMs)
    }
  }, [currentTimeMs, isPlaying, tracks.length, startPlayback])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPlayback()
    }
  }, [stopPlayback])

  // Return the AudioContext getter for sharing
  return { audioContext }
}
