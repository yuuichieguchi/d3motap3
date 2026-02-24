import { create } from 'zustand'

export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'processing'

interface DisplayInfo {
  id: number
  width: number
  height: number
}

interface RecordingResult {
  outputPath: string
  frameCount: number
  durationMs: number
  format: string
}

interface RecordingState {
  status: RecordingStatus
  elapsedMs: number
  outputPath: string | null
  lastResult: RecordingResult | null
  displays: DisplayInfo[]
  outputWidth: number
  outputHeight: number
  fps: number
  format: string
  quality: string
  outputDir: string
  ffmpegAvailable: boolean | null
  error: string | null

  setStatus: (status: RecordingStatus) => void
  setElapsedMs: (ms: number) => void
  setOutputPath: (path: string | null) => void
  setLastResult: (result: RecordingResult | null) => void
  setDisplays: (displays: DisplayInfo[]) => void
  setOutputResolution: (w: number, h: number) => void
  setFps: (fps: number) => void
  setFormat: (format: string) => void
  setQuality: (quality: string) => void
  setOutputDir: (dir: string) => void
  setFfmpegAvailable: (available: boolean) => void
  setError: (error: string | null) => void
  reset: () => void
}

export const useRecordingStore = create<RecordingState>((set) => ({
  status: 'idle',
  elapsedMs: 0,
  outputPath: null,
  lastResult: null,
  displays: [],
  outputWidth: 1920,
  outputHeight: 1080,
  fps: 30,
  format: 'mp4',
  quality: 'medium',
  outputDir: '',
  ffmpegAvailable: null,
  error: null,

  setStatus: (status) => set({ status, error: null }),
  setElapsedMs: (elapsedMs) => set({ elapsedMs }),
  setOutputPath: (outputPath) => set({ outputPath }),
  setLastResult: (lastResult) => set({ lastResult }),
  setDisplays: (displays) => set({ displays }),
  setOutputResolution: (w, h) => set({ outputWidth: w, outputHeight: h }),
  setFps: (fps) => set({ fps }),
  setFormat: (format) => set({ format }),
  setQuality: (quality) => set({ quality }),
  setOutputDir: (outputDir) => set({ outputDir }),
  setFfmpegAvailable: (ffmpegAvailable) => set({ ffmpegAvailable }),
  setError: (error) => set({ error }),
  reset: () => set({
    status: 'idle',
    elapsedMs: 0,
    outputPath: null,
    lastResult: null,
    error: null,
  }),
}))
