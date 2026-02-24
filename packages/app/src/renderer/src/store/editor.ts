import { create } from 'zustand'
import type { EditorProject, EditorClip, TextOverlay, VideoMetadata, EditorExportStatus } from '@d3motap3/shared'

let nextClipId = 1
let nextOverlayId = 1

interface EditorState {
  project: EditorProject
  selectedClipId: string | null
  selectedOverlayId: string | null
  currentTimeMs: number
  isPlaying: boolean
  clipMetadata: Map<string, VideoMetadata>
  clipThumbnails: Map<string, string[]>  // clip id -> data URL array
  exportStatus: EditorExportStatus
  exportPollingInterval: ReturnType<typeof setInterval> | null

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
  setPlaying: (playing: boolean) => void
  
  // Selection
  selectClip: (clipId: string | null) => void
  selectOverlay: (overlayId: string | null) => void
  
  // Export
  startExport: (outputPath: string) => Promise<void>
  startExportPolling: () => void
  stopExportPolling: () => void
  
  // Import
  importFile: () => Promise<void>
  
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
  selectedClipId: null,
  selectedOverlayId: null,
  currentTimeMs: 0,
  isPlaying: false,
  clipMetadata: new Map(),
  clipThumbnails: new Map(),
  exportStatus: { status: 'idle' },
  exportPollingInterval: null,

  setOutputResolution: (w, h) => set((state) => ({
    project: { ...state.project, outputWidth: w, outputHeight: h },
  })),

  addClip: async (sourcePath) => {
    try {
      // Probe video metadata
      const meta = await window.api.invoke('editor:probe', sourcePath) as VideoMetadata
      const clipId = `clip-${nextClipId++}`
      const newClip: EditorClip = {
        id: clipId,
        sourcePath,
        originalDuration: meta.durationMs,
        trimStart: 0,
        trimEnd: 0,
        order: get().project.clips.length,
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
        const thumbBuffers = await window.api.invoke('editor:thumbnails', sourcePath, 10, thumbWidth) as ArrayBuffer[]
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
        // Thumbnails are optional, don't fail the clip add
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
      selectedClipId: state.selectedClipId === clipId ? null : state.selectedClipId,
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
      id: `clip-${nextClipId++}`,
      sourcePath: clip.sourcePath,
      originalDuration: clip.originalDuration,
      trimStart: clip.trimStart + relativeMs,
      trimEnd: clip.trimEnd,
      order: clip.order + 1,
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
      selectedClipId: clip1.id,
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
  setPlaying: (playing) => set({ isPlaying: playing }),

  selectClip: (clipId) => set({ selectedClipId: clipId, selectedOverlayId: null }),
  selectOverlay: (overlayId) => set({ selectedOverlayId: overlayId, selectedClipId: null }),

  startExport: async (outputPath) => {
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

  importFile: async () => {
    try {
      const path = await window.api.invoke('dialog:open-file', {
        filters: [{ name: 'Video Files', extensions: ['mp4', 'mov', 'webm', 'avi', 'mkv'] }],
      }) as string | null
      if (path) {
        await get().addClip(path)
      }
    } catch (err) {
      console.error('Failed to import file:', err)
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
    set({
      project: {
        clips: [],
        textOverlays: [],
        outputWidth: 1920,
        outputHeight: 1080,
      },
      selectedClipId: null,
      selectedOverlayId: null,
      currentTimeMs: 0,
      isPlaying: false,
      clipMetadata: new Map(),
      clipThumbnails: new Map(),
      exportStatus: { status: 'idle' },
    })
  },
}))
