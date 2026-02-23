import { ipcMain, dialog, app } from 'electron'
import { join } from 'path'
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

  // Mobile devices
  ipcMain.handle('sources:list-available-android', () => {
    return nativeBridge.listAndroidDevices()
  })

  ipcMain.handle('sources:list-available-ios', () => {
    return nativeBridge.listIosDevices()
  })

  ipcMain.handle('sources:is-adb-available', () => {
    return nativeBridge.isAdbAvailable()
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

  // Terminal PTY
  ipcMain.handle('terminal:write-input', (_event, sourceId: number, data: Buffer) => {
    return nativeBridge.terminalWriteInput(sourceId, data)
  })

  ipcMain.handle('terminal:resize', (_event, sourceId: number, rows: number, cols: number) => {
    return nativeBridge.terminalResize(sourceId, rows, cols)
  })

  // Script Engine
  ipcMain.handle('script:run', (_event, yamlPath: string) => {
    const outputDir = app.getPath('videos')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const outputPath = join(outputDir, `d3motap3-script-${timestamp}.mp4`)
    return nativeBridge.scriptRun(yamlPath, outputPath)
  })

  ipcMain.handle('script:cancel', () => {
    return nativeBridge.scriptCancel()
  })

  ipcMain.handle('script:status', () => {
    return nativeBridge.scriptStatus()
  })

  ipcMain.handle('script:save-temp', async (_event, yamlContent: string) => {
    const { writeFile } = await import('fs/promises')
    const tmpDir = app.getPath('temp')
    const timestamp = Date.now()
    const tmpPath = join(tmpDir, `d3motap3-script-${timestamp}.yaml`)
    await writeFile(tmpPath, yamlContent, 'utf-8')
    return tmpPath
  })

  // AI Integration
  ipcMain.handle('ai:start-narration', (_event, description: string, apiKey: string) => {
    return nativeBridge.aiStartNarration(description, apiKey)
  })

  ipcMain.handle('ai:start-script-gen', (_event, description: string, apiKey: string) => {
    return nativeBridge.aiStartScriptGen(description, apiKey)
  })

  ipcMain.handle('ai:status', () => {
    return nativeBridge.aiStatus()
  })

  ipcMain.handle('ai:cancel', () => {
    return nativeBridge.aiCancel()
  })

  ipcMain.handle('ai:reset', () => {
    return nativeBridge.aiReset()
  })

  // Caption overlay
  ipcMain.handle('caption:set', (_event, text: string, position: string) => {
    return nativeBridge.setCaption(text, position)
  })

  ipcMain.handle('caption:clear', () => {
    return nativeBridge.clearCaption()
  })

  // Dialog
  ipcMain.handle('dialog:open-file', async (_event, options: { filters?: Array<{ name: string; extensions: string[] }> }) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: options?.filters,
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })
}
