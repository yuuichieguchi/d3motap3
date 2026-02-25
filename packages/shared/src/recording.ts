export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'processing'

export interface RecordingConfig {
  outputPath: string
  resolution: Resolution
  fps: number
  format: OutputFormat
}

export interface Resolution {
  width: number
  height: number
}

export type OutputFormat = 'mp4' | 'gif' | 'webm'

export interface RecordingProgress {
  status: RecordingStatus
  elapsedMs: number
  frameCount: number
}

export interface AudioConfig {
  captureSystemAudio: boolean
  captureMicrophone: boolean
  microphoneDeviceId?: string
}

export interface AudioDeviceInfo {
  id: string
  name: string
  isDefault: boolean
}
