export interface EditorProject {
  clips: EditorClip[]
  textOverlays: TextOverlay[]
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
}

export interface TextOverlay {
  id: string
  text: string
  startTime: number // ms (relative to entire timeline)
  endTime: number // ms
  x: number // 0-1 (relative position)
  y: number // 0-1
  fontSize: number
  color: string // hex color
}

export interface VideoMetadata {
  durationMs: number
  width: number
  height: number
  fps: number
  codec: string
}

export type EditorExportStatus =
  | { status: 'idle' }
  | { status: 'exporting'; progress: number }
  | { status: 'completed'; progress: number }
  | { status: 'failed'; progress: number; error: string }
