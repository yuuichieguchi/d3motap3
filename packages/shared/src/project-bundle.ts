export interface D3mProject {
  version: 1
  createdAt: string
  video: {
    filename: string
    durationMs: number
    width: number
    height: number
    fps: number
    codec: string
  }
  audioTracks: AudioTrack[]
  mixer: MixerSettings
}

export interface AudioTrack {
  id: string
  type: 'system' | 'mic'
  label: string
  clips: AudioClip[]
  format: AudioFormat
}

export interface AudioClip {
  id: string
  filename: string
  startMs: number
  endMs: number
  offsetMs: number
}

export interface AudioFormat {
  sampleRate: number
  channels: number
  encoding: 'f32le'
  bytesPerSample: 4
}

export interface MixerSettings {
  tracks: TrackMixerSetting[]
}

export interface TrackMixerSetting {
  trackId: string
  volume: number
  muted: boolean
}
