import {
  hello,
  add,
  listDisplays,
  startRecording,
  stopRecording,
  getRecordingElapsedMs,
  isRecording,
  isFfmpegAvailable,
  ffmpegVersion,
  addSource,
  removeSource,
  listSources,
  listWindows,
  listWebcams,
  listAndroidDevices,
  isAdbAvailable,
  listIosDevices,
  setLayout,
  getPreviewFrame,
  startRecordingV2,
  stopRecordingV2,
  getRecordingV2ElapsedMs,
  isRecordingV2,
  terminalWriteInput,
  terminalResize,
  scriptRun,
  scriptCancel,
  scriptStatus,
  aiStartNarration,
  aiStartScriptGen,
  aiStatus,
  aiCancel,
  aiReset,
  setCaption,
  clearCaption,
  editorProbe,
  editorThumbnails,
  editorExport,
  editorExportStatus,
  listAudioInputDevices,
} from '@d3motap3/core'
import type {
  DisplayInfo,
  RecordingResultInfo,
  SourceInfoJs,
  WindowInfoJs,
  WebcamInfoJs,
  AdbDeviceJs,
  IosDeviceJs,
  VideoMetadataJs,
  AudioDeviceInfoJs,
} from '@d3motap3/core'
import { existsSync } from 'fs'
import { app } from 'electron'
import { join, isAbsolute, resolve } from 'path'

export const nativeBridge = {
  hello(): string {
    return hello()
  },
  add(a: number, b: number): number {
    return add(a, b)
  },
  listDisplays(): DisplayInfo[] {
    return listDisplays()
  },
  startRecording(config: {
    displayIndex: number
    width: number
    height: number
    fps: number
    format: string
    quality: string
  }): string {
    const outputDir = app.getPath('videos')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const ext = config.format || 'mp4'
    const outputPath = join(outputDir, `d3motap3-${timestamp}.${ext}`)

    startRecording(
      config.displayIndex,
      config.width,
      config.height,
      config.fps,
      outputPath,
      config.format,
      config.quality,
    )
    return outputPath
  },
  stopRecording(): RecordingResultInfo {
    return stopRecording()
  },
  getRecordingElapsedMs(): number {
    return getRecordingElapsedMs()
  },
  isRecording(): boolean {
    return isRecording()
  },
  isFfmpegAvailable(): boolean {
    return isFfmpegAvailable()
  },
  ffmpegVersion(): string {
    return ffmpegVersion()
  },

  // Multi-source management
  addSource(sourceType: string, configJson: string): number {
    return addSource(sourceType, configJson)
  },
  removeSource(sourceId: number): void {
    removeSource(sourceId)
  },
  listSources(): SourceInfoJs[] {
    return listSources()
  },
  listWindows(): WindowInfoJs[] {
    return listWindows()
  },
  listWebcams(): WebcamInfoJs[] {
    return listWebcams()
  },

  // Mobile device listing
  listAndroidDevices(): AdbDeviceJs[] {
    return listAndroidDevices()
  },
  isAdbAvailable(): boolean {
    return isAdbAvailable()
  },
  listIosDevices(): IosDeviceJs[] {
    return listIosDevices()
  },

  // Audio devices
  listAudioInputDevices(): AudioDeviceInfoJs[] {
    return listAudioInputDevices()
  },

  // Layout
  setLayout(layoutJson: string): void {
    setLayout(layoutJson)
  },

  // Preview
  getPreviewFrame(maxWidth: number, maxHeight: number): Buffer | null {
    return getPreviewFrame(maxWidth, maxHeight) ?? null
  },

  // V2 Recording
  startRecordingV2(config: {
    outputWidth: number
    outputHeight: number
    fps: number
    format: string
    quality: string
    outputDir?: string
    captureSystemAudio?: boolean
    captureMicrophone?: boolean
    microphoneDeviceId?: string
  }): string {
    let outputDir: string
    if (config.outputDir && isAbsolute(config.outputDir) && existsSync(resolve(config.outputDir))) {
      outputDir = config.outputDir
    } else {
      outputDir = app.getPath('videos')
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const outputPath = join(outputDir, `d3motap3-${timestamp}.d3m`)

    startRecordingV2(
      config.outputWidth,
      config.outputHeight,
      config.fps,
      outputPath,
      config.format,
      config.quality,
      config.captureSystemAudio ?? false,
      config.captureMicrophone ?? false,
      config.microphoneDeviceId ?? null,
    )
    return outputPath
  },
  stopRecordingV2(): RecordingResultInfo {
    return stopRecordingV2()
  },
  getRecordingV2ElapsedMs(): number {
    return getRecordingV2ElapsedMs()
  },
  isRecordingV2(): boolean {
    return isRecordingV2()
  },

  // Terminal PTY
  terminalWriteInput(sourceId: number, data: Buffer): void {
    terminalWriteInput(sourceId, data)
  },
  terminalResize(sourceId: number, rows: number, cols: number): void {
    terminalResize(sourceId, rows, cols)
  },

  // Script Engine
  scriptRun(yamlPath: string, outputPath: string): void {
    scriptRun(yamlPath, outputPath)
  },
  scriptCancel(): void {
    scriptCancel()
  },
  scriptStatus(): string {
    return scriptStatus()
  },

  // AI Integration
  aiStartNarration(description: string, apiKey: string): void {
    aiStartNarration(description, apiKey)
  },
  aiStartScriptGen(description: string, apiKey: string): void {
    aiStartScriptGen(description, apiKey)
  },
  aiStatus(): string {
    return aiStatus()
  },
  aiCancel(): void {
    aiCancel()
  },
  aiReset(): void {
    aiReset()
  },

  // Caption overlay
  setCaption(text: string, position: string): void {
    setCaption(text, position)
  },
  clearCaption(): void {
    clearCaption()
  },

  // Video Editor
  editorProbe(path: string): VideoMetadataJs {
    return editorProbe(path)
  },
  editorThumbnails(path: string, count: number, width: number): Buffer[] {
    return editorThumbnails(path, count, width)
  },
  editorExport(projectJson: string, outputPath: string): void {
    editorExport(projectJson, outputPath)
  },
  editorExportStatus(): string {
    return editorExportStatus()
  },
}
