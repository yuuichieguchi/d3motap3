import { create } from 'zustand'
import type { EditorProject, EditorClip, TextOverlay, VideoMetadata, EditorExportStatus, AudioTrack, MixerSettings, D3mProject } from '@d3motap3/shared'

let nextClipId = 1
let nextOverlayId = 1

let _userSeek = false

export function consumeUserSeek(): boolean {
  const v = _userSeek
  _userSeek = false
  return v
}

export interface ClipboardEntry {
  sourcePath: string
  originalDuration: number
  trimStart: number
  trimEnd: number
  bundlePath?: string
  audioTracks?: AudioTrack[]
  mixerSettings?: MixerSettings
}

interface EditorState {
  project: EditorProject
  selectedClipIds: string[]
  lastSelectedClipId: string | null
  selectedOverlayId: string | null
  currentTimeMs: number
  isPlaying: boolean
  clipMetadata: Map<string, VideoMetadata>
  clipThumbnails: Map<string, string[]>  // clip id -> data URL array
  exportStatus: EditorExportStatus
  exportPollingInterval: ReturnType<typeof setInterval> | null
  exportOutputPath: string | null
  clipboardClips: ClipboardEntry[] | null

  // Project actions
  setOutputResolution: (w: number, h: number) => void
  
  // Clip actions
  addClip: (sourcePath: string) => Promise<void>
  removeClip: (clipId: string) => void
  updateClipTrim: (clipId: string, trimStart: number, trimEnd: number) => void
  reorderClips: (clipId: string, newOrder: number) => void
  setTransition: (clipId: string, type: 'fade' | 'dissolve' | 'wipe_left' | 'wipe_right', duration: number) => void
  removeTransition: (clipId: string) => void
  splitClip: (clipId: string, atMs: number) => void
  
  // Text overlay actions
  addTextOverlay: (text: string, startTime: number, endTime: number) => void
  removeTextOverlay: (overlayId: string) => void
  updateTextOverlay: (overlayId: string, updates: Partial<TextOverlay>) => void
  
  // Playback
  setCurrentTime: (ms: number) => void
  seekTo: (ms: number) => void
  setPlaying: (playing: boolean) => void
  
  // Selection
  selectClip: (clipId: string | null, mode?: 'single' | 'toggle' | 'range') => void
  removeSelectedClips: () => void
  selectOverlay: (overlayId: string | null) => void

  // Clipboard & split actions
  copySelectedClips: () => void
  cutSelectedClips: () => void
  pasteClips: () => void
  splitAtPlayhead: () => void
  canSplit: () => boolean
  
  // Export
  startExport: (outputPath: string) => Promise<void>
  startExportPolling: () => void
  stopExportPolling: () => void
  dismissExportStatus: () => void

  // Mixer actions
  setTrackVolume: (clipId: string, trackId: string, volume: number) => void
  setTrackMuted: (clipId: string, trackId: string, muted: boolean) => void

  // Punch-in actions
  isPunchingIn: boolean
  punchInStartMs: number
  startPunchIn: () => Promise<void>
  stopPunchIn: () => Promise<void>

  // Computed
  totalDuration: () => number
  
  // Reset
  reset: () => void
}

export const useEditorStore = create<EditorState>((set, get) => ({
  project: {
    clips: [],
    textOverlays: [],
    outputWidth: 1920,
    outputHeight: 1080,
  },
  selectedClipIds: [],
  lastSelectedClipId: null,
  selectedOverlayId: null,
  currentTimeMs: 0,
  isPlaying: false,
  clipMetadata: new Map(),
  clipThumbnails: new Map(),
  exportStatus: { status: 'idle' },
  exportPollingInterval: null,
  exportOutputPath: null,
  isPunchingIn: false,
  punchInStartMs: 0,
  clipboardClips: null,

  setOutputResolution: (w, h) => set((state) => ({
    project: { ...state.project, outputWidth: w, outputHeight: h },
  })),

  addClip: async (sourcePath) => {
    try {
      const isBundle = sourcePath.endsWith('.d3m')
      let videoPath: string
      let meta: VideoMetadata
      let bundlePath: string | undefined
      let audioTracks: AudioTrack[] | undefined
      let mixerSettings: MixerSettings | undefined

      if (isBundle) {
        // .d3m bundle: read project.json for metadata
        const projectJson = await window.api.invoke('editor:probe-bundle', sourcePath) as string
        const project: D3mProject = JSON.parse(projectJson)

        // Find the video file inside the bundle
        videoPath = `${sourcePath}/${project.video.filename}`
        meta = {
          durationMs: project.video.durationMs,
          width: project.video.width,
          height: project.video.height,
          fps: project.video.fps,
          codec: project.video.codec,
        }
        bundlePath = sourcePath
        audioTracks = project.audioTracks
        mixerSettings = project.mixer
      } else {
        // Regular video file: probe with ffprobe
        videoPath = sourcePath
        meta = await window.api.invoke('editor:probe', sourcePath) as VideoMetadata
      }

      const clipId = `clip-${nextClipId++}`
      const newClip: EditorClip = {
        id: clipId,
        sourcePath: videoPath,
        originalDuration: meta.durationMs,
        trimStart: 0,
        trimEnd: 0,
        order: get().project.clips.length,
        bundlePath,
        audioTracks,
        mixerSettings,
      }
      set((state) => {
        const newMetadata = new Map(state.clipMetadata)
        newMetadata.set(clipId, meta)
        return {
          project: {
            ...state.project,
            clips: [...state.project.clips, newClip],
          },
          clipMetadata: newMetadata,
        }
      })

      // Generate thumbnails in background
      try {
        const thumbWidth = Math.min(Math.round(320 * window.devicePixelRatio), 640)
        const thumbBuffers = await window.api.invoke('editor:thumbnails', videoPath, 10, thumbWidth) as ArrayBuffer[]
        const thumbUrls = thumbBuffers.map((buf) => {
          const blob = new Blob([buf], { type: 'image/jpeg' })
          return URL.createObjectURL(blob)
        })
        set((state) => {
          const newThumbs = new Map(state.clipThumbnails)
          newThumbs.set(clipId, thumbUrls)
          return { clipThumbnails: newThumbs }
        })
      } catch {
        // Thumbnails are optional
      }
    } catch (err) {
      console.error('Failed to add clip:', err)
    }
  },

  removeClip: (clipId) => set((state) => {
    const clips = state.project.clips.filter((c) => c.id !== clipId)
    // Re-order remaining clips
    clips.sort((a, b) => a.order - b.order)
    clips.forEach((c, i) => { c.order = i })
    const newMetadata = new Map(state.clipMetadata)
    newMetadata.delete(clipId)
    const newThumbs = new Map(state.clipThumbnails)
    // Revoke thumbnail URLs
    const oldUrls = newThumbs.get(clipId)
    if (oldUrls) oldUrls.forEach(URL.revokeObjectURL)
    newThumbs.delete(clipId)
    return {
      project: { ...state.project, clips },
      clipMetadata: newMetadata,
      clipThumbnails: newThumbs,
      selectedClipIds: state.selectedClipIds.filter(id => id !== clipId),
      lastSelectedClipId: state.lastSelectedClipId === clipId ? null : state.lastSelectedClipId,
    }
  }),

  updateClipTrim: (clipId, trimStart, trimEnd) => set((state) => ({
    project: {
      ...state.project,
      clips: state.project.clips.map((c) =>
        c.id === clipId ? { ...c, trimStart, trimEnd } : c
      ),
    },
  })),

  reorderClips: (clipId, newOrder) => set((state) => {
    const clips = [...state.project.clips]
    const clip = clips.find((c) => c.id === clipId)
    if (!clip) return state
    const oldOrder = clip.order
    clips.forEach((c) => {
      if (c.id === clipId) {
        c.order = newOrder
      } else if (oldOrder < newOrder && c.order > oldOrder && c.order <= newOrder) {
        c.order--
      } else if (oldOrder > newOrder && c.order >= newOrder && c.order < oldOrder) {
        c.order++
      }
    })
    return { project: { ...state.project, clips } }
  }),

  setTransition: (clipId, type, duration) => set((state) => ({
    project: {
      ...state.project,
      clips: state.project.clips.map((c) =>
        c.id === clipId ? { ...c, transition: { type, duration } } : c
      ),
    },
  })),

  removeTransition: (clipId) => set((state) => ({
    project: {
      ...state.project,
      clips: state.project.clips.map((c) =>
        c.id === clipId ? { ...c, transition: undefined } : c
      ),
    },
  })),

  splitClip: (clipId, atMs) => set((state) => {
    const clipIndex = state.project.clips.findIndex((c) => c.id === clipId)
    if (clipIndex === -1) return state
    const clip = state.project.clips[clipIndex]
    const relativeMs = atMs - clip.trimStart
    if (relativeMs <= 0 || relativeMs >= clip.originalDuration - clip.trimStart - clip.trimEnd) return state
    
    const clip1: EditorClip = {
      ...clip,
      id: `clip-${nextClipId++}`,
      trimEnd: clip.originalDuration - clip.trimStart - relativeMs,
      transition: undefined,
    }
    const clip2: EditorClip = {
      ...clip,
      id: `clip-${nextClipId++}`,
      trimStart: clip.trimStart + relativeMs,
      trimEnd: clip.trimEnd,
      order: clip.order + 1,
      transition: undefined,
    }
    
    const clips = state.project.clips.filter((c) => c.id !== clipId)
    // Shift orders for clips after the split point
    clips.forEach((c) => {
      if (c.order >= clip.order + 1) c.order++
    })
    clips.push(clip1, clip2)
    clips.sort((a, b) => a.order - b.order)
    
    return {
      project: { ...state.project, clips },
      selectedClipIds: [clip1.id],
      lastSelectedClipId: clip1.id,
    }
  }),

  addTextOverlay: (text, startTime, endTime) => set((state) => ({
    project: {
      ...state.project,
      textOverlays: [...state.project.textOverlays, {
        id: `overlay-${nextOverlayId++}`,
        text,
        startTime,
        endTime,
        x: 0.5,
        y: 0.9,
        fontSize: 48,
        color: '#ffffff',
      }],
    },
  })),

  removeTextOverlay: (overlayId) => set((state) => ({
    project: {
      ...state.project,
      textOverlays: state.project.textOverlays.filter((o) => o.id !== overlayId),
    },
    selectedOverlayId: state.selectedOverlayId === overlayId ? null : state.selectedOverlayId,
  })),

  updateTextOverlay: (overlayId, updates) => set((state) => ({
    project: {
      ...state.project,
      textOverlays: state.project.textOverlays.map((o) =>
        o.id === overlayId ? { ...o, ...updates } : o
      ),
    },
  })),

  setCurrentTime: (ms) => set({ currentTimeMs: ms }),
  seekTo: (ms) => {
    _userSeek = true
    set({ currentTimeMs: ms })
  },
  setPlaying: (playing) => set({ isPlaying: playing }),

  selectClip: (clipId, mode = 'single') => set((state) => {
    if (clipId === null) {
      return { selectedClipIds: [], lastSelectedClipId: null, selectedOverlayId: null }
    }

    switch (mode) {
      case 'toggle': {
        const isSelected = state.selectedClipIds.includes(clipId)
        const newIds = isSelected
          ? state.selectedClipIds.filter(id => id !== clipId)
          : [...state.selectedClipIds, clipId]
        return {
          selectedClipIds: newIds,
          lastSelectedClipId: isSelected ? (newIds.length > 0 ? newIds[newIds.length - 1] : null) : clipId,
          selectedOverlayId: null,
        }
      }
      case 'range': {
        const anchor = state.lastSelectedClipId
        if (!anchor) {
          return { selectedClipIds: [clipId], lastSelectedClipId: clipId, selectedOverlayId: null }
        }
        const sorted = [...state.project.clips].sort((a, b) => a.order - b.order)
        const anchorIdx = sorted.findIndex(c => c.id === anchor)
        const targetIdx = sorted.findIndex(c => c.id === clipId)
        if (anchorIdx === -1 || targetIdx === -1) {
          return { selectedClipIds: [clipId], lastSelectedClipId: clipId, selectedOverlayId: null }
        }
        const start = Math.min(anchorIdx, targetIdx)
        const end = Math.max(anchorIdx, targetIdx)
        const rangeIds = sorted.slice(start, end + 1).map(c => c.id)
        return { selectedClipIds: rangeIds, selectedOverlayId: null }
      }
      default:
        return { selectedClipIds: [clipId], lastSelectedClipId: clipId, selectedOverlayId: null }
    }
  }),

  removeSelectedClips: () => set((state) => {
    const idsToRemove = new Set(state.selectedClipIds)
    if (idsToRemove.size === 0) return state

    const clips = state.project.clips
      .filter(c => !idsToRemove.has(c.id))
      .sort((a, b) => a.order - b.order)
      .map((c, i) => ({ ...c, order: i }))

    const newMetadata = new Map(state.clipMetadata)
    const newThumbs = new Map(state.clipThumbnails)
    for (const id of idsToRemove) {
      newMetadata.delete(id)
      const oldUrls = newThumbs.get(id)
      if (oldUrls) oldUrls.forEach(URL.revokeObjectURL)
      newThumbs.delete(id)
    }

    return {
      project: { ...state.project, clips },
      clipMetadata: newMetadata,
      clipThumbnails: newThumbs,
      selectedClipIds: [],
      lastSelectedClipId: null,
    }
  }),

  selectOverlay: (overlayId) => set({ selectedOverlayId: overlayId, selectedClipIds: [], lastSelectedClipId: null }),

  copySelectedClips: () => {
    const state = get()
    const selectedIds = new Set(state.selectedClipIds)
    if (selectedIds.size === 0) return

    const entries: ClipboardEntry[] = state.project.clips
      .filter((c) => selectedIds.has(c.id))
      .sort((a, b) => a.order - b.order)
      .map((c) => ({
        sourcePath: c.sourcePath,
        originalDuration: c.originalDuration,
        trimStart: c.trimStart,
        trimEnd: c.trimEnd,
        bundlePath: c.bundlePath,
        audioTracks: c.audioTracks,
        mixerSettings: c.mixerSettings,
      }))

    set({ clipboardClips: entries })
  },

  cutSelectedClips: () => {
    const state = get()
    if (state.selectedClipIds.length === 0) return
    state.copySelectedClips()
    state.removeSelectedClips()
  },

  pasteClips: () => {
    const state = get()
    const { clipboardClips } = state
    if (!clipboardClips || clipboardClips.length === 0) return

    // Determine insertion point
    let insertOrder: number
    if (state.lastSelectedClipId) {
      const selectedClip = state.project.clips.find((c) => c.id === state.lastSelectedClipId)
      insertOrder = selectedClip ? selectedClip.order + 1 : state.project.clips.length
    } else {
      insertOrder = state.project.clips.length
    }

    // Shift subsequent clips' orders up
    const updatedClips = state.project.clips.map((c) =>
      c.order >= insertOrder
        ? { ...c, order: c.order + clipboardClips.length }
        : c
    )

    // Create new clips from clipboard entries
    const newClipIds: string[] = []
    const newClips: EditorClip[] = clipboardClips.map((entry, i) => {
      const clipId = `clip-${nextClipId++}`
      newClipIds.push(clipId)
      return {
        id: clipId,
        sourcePath: entry.sourcePath,
        originalDuration: entry.originalDuration,
        trimStart: entry.trimStart,
        trimEnd: entry.trimEnd,
        order: insertOrder + i,
        bundlePath: entry.bundlePath,
        audioTracks: entry.audioTracks,
        mixerSettings: entry.mixerSettings,
      }
    })

    set({
      project: {
        ...state.project,
        clips: [...updatedClips, ...newClips],
      },
      selectedClipIds: newClipIds,
      lastSelectedClipId: newClipIds[newClipIds.length - 1],
    })
  },

  splitAtPlayhead: () => {
    const state = get()
    if (!state.lastSelectedClipId) return

    const sorted = [...state.project.clips].sort((a, b) => a.order - b.order)
    let accumulated = 0
    for (const clip of sorted) {
      const clipDuration = clip.originalDuration - clip.trimStart - clip.trimEnd
      if (clip.id === state.lastSelectedClipId) {
        // Check if playhead falls within this clip
        if (state.currentTimeMs > accumulated && state.currentTimeMs < accumulated + clipDuration) {
          const localTime = state.currentTimeMs - accumulated + clip.trimStart
          get().splitClip(clip.id, localTime)
        }
        return
      }
      accumulated += clipDuration
    }
  },

  canSplit: () => {
    const state = get()
    if (!state.lastSelectedClipId) return false

    const sorted = [...state.project.clips].sort((a, b) => a.order - b.order)
    let accumulated = 0
    for (const clip of sorted) {
      const clipDuration = clip.originalDuration - clip.trimStart - clip.trimEnd
      if (clip.id === state.lastSelectedClipId) {
        // Playhead must be strictly within the clip (not at start or end)
        return state.currentTimeMs > accumulated && state.currentTimeMs < accumulated + clipDuration
      }
      accumulated += clipDuration
    }
    return false
  },

  startExport: async (outputPath) => {
    set({ exportOutputPath: null })
    const { project } = get()
    // Convert camelCase to snake_case for Rust backend
    const projectForRust = {
      clips: project.clips.map((c) => ({
        id: c.id,
        source_path: c.sourcePath,
        original_duration: c.originalDuration,
        trim_start: c.trimStart,
        trim_end: c.trimEnd,
        order: c.order,
        transition: c.transition ? {
          type: c.transition.type,
          duration: c.transition.duration,
        } : undefined,
        bundle_path: c.bundlePath,
        audio_tracks: c.audioTracks?.map((t) => ({
          id: t.id,
          type: t.type,
          label: t.label,
          clips: t.clips.map((ac) => ({
            id: ac.id,
            filename: ac.filename,
            startMs: ac.startMs,
            endMs: ac.endMs,
            offsetMs: ac.offsetMs,
          })),
          format: {
            sampleRate: t.format.sampleRate,
            channels: t.format.channels,
            encoding: t.format.encoding,
            bytesPerSample: t.format.bytesPerSample,
          },
        })),
        mixer_settings: c.mixerSettings ? {
          tracks: c.mixerSettings.tracks.map((t) => ({
            trackId: t.trackId,
            volume: t.volume,
            muted: t.muted,
          })),
        } : undefined,
      })),
      text_overlays: project.textOverlays.map((o) => ({
        id: o.id,
        text: o.text,
        start_time: o.startTime,
        end_time: o.endTime,
        x: o.x,
        y: o.y,
        font_size: o.fontSize,
        color: o.color,
      })),
      output_width: project.outputWidth,
      output_height: project.outputHeight,
    }
    try {
      await window.api.invoke('editor:export', JSON.stringify(projectForRust), outputPath)
      set({ exportOutputPath: outputPath })
      get().startExportPolling()
    } catch (err) {
      set({ exportStatus: { status: 'failed', progress: 0, error: err instanceof Error ? err.message : String(err) } })
    }
  },

  startExportPolling: () => {
    const existing = get().exportPollingInterval
    if (existing) return

    const interval = setInterval(async () => {
      try {
        const json = await window.api.invoke('editor:export-status') as string
        const status = JSON.parse(json) as EditorExportStatus
        set({ exportStatus: status })
        if (status.status === 'completed' || status.status === 'failed') {
          get().stopExportPolling()
        }
      } catch {
        // ignore polling errors
      }
    }, 200)

    set({ exportPollingInterval: interval })
  },

  stopExportPolling: () => {
    const interval = get().exportPollingInterval
    if (interval) {
      clearInterval(interval)
      set({ exportPollingInterval: null })
    }
  },

  dismissExportStatus: () => set({ exportStatus: { status: 'idle' } }),

  setTrackVolume: (clipId, trackId, volume) => set((state) => ({
    project: {
      ...state.project,
      clips: state.project.clips.map((c) => {
        if (c.id !== clipId || !c.mixerSettings) return c
        return {
          ...c,
          mixerSettings: {
            ...c.mixerSettings,
            tracks: c.mixerSettings.tracks.map((t) =>
              t.trackId === trackId ? { ...t, volume: Math.max(0, Math.min(1, volume)) } : t
            ),
          },
        }
      }),
    },
  })),

  setTrackMuted: (clipId, trackId, muted) => set((state) => ({
    project: {
      ...state.project,
      clips: state.project.clips.map((c) => {
        if (c.id !== clipId || !c.mixerSettings) return c
        return {
          ...c,
          mixerSettings: {
            ...c.mixerSettings,
            tracks: c.mixerSettings.tracks.map((t) =>
              t.trackId === trackId ? { ...t, muted } : t
            ),
          },
        }
      }),
    },
  })),

  startPunchIn: async () => {
    const state = get()
    // Find the active bundle clip
    const bundleClip = state.project.clips.find((c) => c.bundlePath)
    if (!bundleClip || !bundleClip.bundlePath) return

    // Generate output base path for punch-in (without .pcm extension,
    // because derive_audio_path will append .mic_audio.pcm)
    const punchId = crypto.randomUUID()
    const outputPath = `${bundleClip.bundlePath}/tracks/punch-${punchId}`

    try {
      await window.api.invoke('editor:punch-in-start', outputPath, null)
      set({ isPunchingIn: true, punchInStartMs: state.currentTimeMs })
      // Start video playback during punch-in
      state.setPlaying(true)
    } catch (err) {
      console.error('Failed to start punch-in:', err)
    }
  },

  stopPunchIn: async () => {
    try {
      const resultJson = await window.api.invoke('editor:punch-in-stop') as string
      const result = JSON.parse(resultJson) as {
        micPath: string | null
        sampleRate: number
        channels: number
      }

      set({ isPunchingIn: false })
      const state = get()
      state.setPlaying(false)

      // Find the active bundle clip and update its mic track
      const bundleClip = state.project.clips.find((c) => c.bundlePath)
      if (!bundleClip || !result.micPath || !bundleClip.audioTracks) return

      const punchStartMs = state.punchInStartMs
      const punchEndMs = state.currentTimeMs

      const micTrack = bundleClip.audioTracks.find((t) => t.type === 'mic')
      if (!micTrack) return

      // Extract just the filename from the full path
      const filename = result.micPath.split('/').pop() || result.micPath

      const punchClip = {
        id: crypto.randomUUID(),
        filename,
        startMs: punchStartMs,
        endMs: punchEndMs,
        offsetMs: 0,
      }

      // Update the mic track's clips in the store
      set((s) => ({
        project: {
          ...s.project,
          clips: s.project.clips.map((c) => {
            if (c.id !== bundleClip.id || !c.audioTracks) return c
            return {
              ...c,
              audioTracks: c.audioTracks.map((t) => {
                if (t.type !== 'mic') return t
                return {
                  ...t,
                  clips: [...t.clips, punchClip],
                }
              }),
            }
          }),
        },
      }))
    } catch (err) {
      console.error('Failed to stop punch-in:', err)
      set({ isPunchingIn: false })
    }
  },

  totalDuration: () => {
    const { clips } = get().project
    return clips.reduce((total, clip) => {
      return total + clip.originalDuration - clip.trimStart - clip.trimEnd
    }, 0)
  },

  reset: () => {
    get().stopExportPolling()
    // Revoke all thumbnail URLs
    const { clipThumbnails } = get()
    clipThumbnails.forEach((urls) => urls.forEach(URL.revokeObjectURL))
    nextClipId = 1
    nextOverlayId = 1
    _userSeek = false
    set({
      project: {
        clips: [],
        textOverlays: [],
        outputWidth: 1920,
        outputHeight: 1080,
      },
      selectedClipIds: [],
      lastSelectedClipId: null,
      selectedOverlayId: null,
      currentTimeMs: 0,
      isPlaying: false,
      clipMetadata: new Map(),
      clipThumbnails: new Map(),
      exportStatus: { status: 'idle' },
      exportOutputPath: null,
      isPunchingIn: false,
      punchInStartMs: 0,
      clipboardClips: null,
    })
  },
}))

if (typeof window !== 'undefined') {
  (window as any).__editorStore = useEditorStore
}
