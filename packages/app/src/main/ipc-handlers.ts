import { ipcMain } from 'electron'
import { nativeBridge } from './native-bridge'

export function registerIpcHandlers(): void {
  ipcMain.handle('native:hello', () => {
    return nativeBridge.hello()
  })

  ipcMain.handle('native:add', (_event, a: number, b: number) => {
    return nativeBridge.add(a, b)
  })

  ipcMain.handle('recording:list-displays', () => {
    return nativeBridge.listDisplays()
  })

  ipcMain.handle('recording:start', (_event, config: {
    displayIndex: number
    width: number
    height: number
    fps: number
    format: string
    quality: string
  }) => {
    return nativeBridge.startRecording(config)
  })

  ipcMain.handle('recording:stop', () => {
    return nativeBridge.stopRecording()
  })

  ipcMain.handle('recording:elapsed', () => {
    return nativeBridge.getRecordingElapsedMs()
  })

  ipcMain.handle('recording:is-recording', () => {
    return nativeBridge.isRecording()
  })

  ipcMain.handle('system:ffmpeg-available', () => {
    return nativeBridge.isFfmpegAvailable()
  })

  ipcMain.handle('system:ffmpeg-version', () => {
    return nativeBridge.ffmpegVersion()
  })

  // Multi-source management
  ipcMain.handle('sources:add', (_event, sourceType: string, configJson: string) => {
    return nativeBridge.addSource(sourceType, configJson)
  })

  ipcMain.handle('sources:remove', (_event, sourceId: number) => {
    return nativeBridge.removeSource(sourceId)
  })

  ipcMain.handle('sources:list', () => {
    return nativeBridge.listSources()
  })

  ipcMain.handle('sources:list-available-windows', () => {
    return nativeBridge.listWindows()
  })

  ipcMain.handle('sources:list-available-webcams', () => {
    return nativeBridge.listWebcams()
  })

  // Layout
  ipcMain.handle('layout:set', (_event, layoutJson: string) => {
    return nativeBridge.setLayout(layoutJson)
  })

  // Preview
  ipcMain.handle('preview:frame', (_event, maxWidth: number, maxHeight: number) => {
    return nativeBridge.getPreviewFrame(maxWidth, maxHeight)
  })

  // V2 Recording
  ipcMain.handle('recording:start-v2', (_event, config: {
    outputWidth: number
    outputHeight: number
    fps: number
    format: string
    quality: string
  }) => {
    return nativeBridge.startRecordingV2(config)
  })

  ipcMain.handle('recording:stop-v2', () => {
    return nativeBridge.stopRecordingV2()
  })

  ipcMain.handle('recording:elapsed-v2', () => {
    return nativeBridge.getRecordingV2ElapsedMs()
  })

  ipcMain.handle('recording:is-recording-v2', () => {
    return nativeBridge.isRecordingV2()
  })
}
