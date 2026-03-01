import type { AudioTrack, MixerSettings } from './project-bundle'

export interface EditorProject {
  clips: EditorClip[]
  textOverlays: TextOverlay[]
  independentAudioTracks: IndependentAudioTrack[]
  outputWidth: number
  outputHeight: number
}

export interface EditorClip {
  id: string
  sourcePath: string
  originalDuration: number // ms
  trimStart: number // ms
  trimEnd: number // ms
  order: number
  transition?: {
    type: 'fade' | 'dissolve' | 'wipe_left' | 'wipe_right'
    duration: number // ms
  }
  bundlePath?: string
  audioTracks?: AudioTrack[]
  mixerSettings?: MixerSettings
}

export interface TextOverlay {
  id: string
  text: string
  startTime: number // ms (relative to entire timeline)
  endTime: number // ms
  x: number // 0-1 (relative position)
  y: number // 0-1
  width: number // 0-1 (box width, 1 = full width)
  fontSize: number
  color: string // hex color
  fontFamily: string // 'sans-serif' | 'serif' | 'monospace' | system font name
  fontWeight: 'normal' | 'bold'
  fontStyle: 'normal' | 'italic'
  textAlign: 'left' | 'center' | 'right'
  backgroundColor: string | null // null = transparent
  borderColor: string | null // text stroke color
  borderWidth: number // 0 = no outline
  shadowColor: string | null
  shadowOffsetX: number
  shadowOffsetY: number
  animation: 'none' | 'fade-in' | 'fade-out' | 'fade-in-out' | 'slide-up' | 'slide-down'
  animationDuration: number // ms, default 500
}

export interface VideoMetadata {
  durationMs: number
  width: number
  height: number
  fps: number
  codec: string
}

export interface PcmFormat {
  sampleRate: number
  channels: number
  encoding: string       // 'f32le'
  bytesPerSample: number // 4
}

export interface IndependentAudioClip {
  id: string
  sourcePath: string           // absolute path to audio file
  originalDuration: number     // ms (from probe)
  trimStart: number            // ms (head trim)
  trimEnd: number              // ms (tail trim)
  timelineStartMs: number      // absolute position on timeline
  pcmFormat?: PcmFormat
}

export interface IndependentAudioTrack {
  id: string
  label: string                // "BGM", "SE", "Narration" etc
  clips: IndependentAudioClip[]
  volume: number               // 0-1
  muted: boolean
}

export type EditorExportStatus =
  | { status: 'idle' }
  | { status: 'exporting'; progress: number }
  | { status: 'completed'; progress: number }
  | { status: 'failed'; progress: number; error: string }

export interface EditorSaveData {
  version: number
  savedAt: string
  project: EditorProject
}
