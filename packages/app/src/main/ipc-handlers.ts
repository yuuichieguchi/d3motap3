import { ipcMain, dialog, app, shell } from 'electron'
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

  // Audio devices
  ipcMain.handle('audio:list-input-devices', () => {
    return nativeBridge.listAudioInputDevices()
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
    outputDir?: string
    captureSystemAudio?: boolean
    captureMicrophone?: boolean
    microphoneDeviceId?: string
  }) => {
    return nativeBridge.startRecordingV2(config)
  })

  ipcMain.handle('recording:select-output-dir', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
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

  // Video Editor
  ipcMain.handle('editor:probe', (_event, path: string) => {
    return nativeBridge.editorProbe(path)
  })

  ipcMain.handle('editor:thumbnails', (_event, path: string, count: number, width: number) => {
    return nativeBridge.editorThumbnails(path, count, width)
  })

  ipcMain.handle('editor:export', (_event, projectJson: string, outputPath: string) => {
    return nativeBridge.editorExport(projectJson, outputPath)
  })

  ipcMain.handle('editor:export-status', () => {
    return nativeBridge.editorExportStatus()
  })

  ipcMain.handle('editor:probe-bundle', (_event, bundlePath: string) => {
    return nativeBridge.editorProbeBundle(bundlePath)
  })

  ipcMain.handle('editor:probe-audio', (_event, path: string) => {
    return nativeBridge.editorProbeAudio(path)
  })

  ipcMain.handle('editor:save-project', async (_event, bundlePath: string, jsonContent: string) => {
    if (!bundlePath.endsWith('.d3m')) throw new Error('Invalid bundle path')
    const { writeFile } = await import('fs/promises')
    await writeFile(join(bundlePath, 'editor.json'), jsonContent, 'utf-8')
  })

  ipcMain.handle('editor:load-project', async (_event, bundlePath: string) => {
    if (!bundlePath.endsWith('.d3m')) return null
    const { readFile } = await import('fs/promises')
    try {
      const content = await readFile(join(bundlePath, 'editor.json'), 'utf-8')
      return content
    } catch {
      return null
    }
  })

  // Punch-in recording
  ipcMain.handle('editor:punch-in-start', (_event, outputPath: string, microphoneDeviceId: string | null) => {
    return nativeBridge.punchInStart(outputPath, microphoneDeviceId)
  })

  ipcMain.handle('editor:punch-in-stop', () => {
    return nativeBridge.punchInStop()
  })

  ipcMain.handle('editor:is-punch-in-active', () => {
    return nativeBridge.isPunchInActive()
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

  ipcMain.handle('dialog:save-file', async (_event, options: {
    defaultDir?: 'home' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' | 'temp'
    defaultFilename?: string
    filters?: Array<{ name: string; extensions: string[] }>
  }) => {
    const dir = options.defaultDir ? app.getPath(options.defaultDir) : app.getPath('videos')
    const defaultPath = options.defaultFilename ? join(dir, options.defaultFilename) : dir
    const result = await dialog.showSaveDialog({
      defaultPath,
      filters: options.filters,
    })
    if (result.canceled || !result.filePath) {
      return null
    }
    return result.filePath
  })

  ipcMain.handle('shell:show-item-in-folder', (_event, fullPath: string) => {
    if (typeof fullPath === 'string' && fullPath.length > 0) {
      shell.showItemInFolder(fullPath)
    }
  })

  // Region Selector
  ipcMain.handle('region:open-selector', (_event, displayIndex: number) => {
    const { openRegionSelector } = require('./index') as typeof import('./index')
    openRegionSelector(displayIndex)
  })

  ipcMain.handle('region:confirm', (_event, rect: { x: number; y: number; width: number; height: number }) => {
    // Validate rect values
    if (!rect || typeof rect.x !== 'number' || typeof rect.y !== 'number' ||
        typeof rect.width !== 'number' || typeof rect.height !== 'number' ||
        !Number.isFinite(rect.x) || !Number.isFinite(rect.y) ||
        !Number.isFinite(rect.width) || !Number.isFinite(rect.height) ||
        rect.width <= 0 || rect.height <= 0) {
      const { closeRegionSelector } = require('./index') as typeof import('./index')
      closeRegionSelector()
      return
    }
    const { getMainWindow, closeRegionSelector } = require('./index') as typeof import('./index')
    const mainWin = getMainWindow()
    if (mainWin) {
      mainWin.webContents.send('region:selected', {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
    }
    closeRegionSelector()
  })

  ipcMain.handle('region:cancel', () => {
    const { closeRegionSelector } = require('./index') as typeof import('./index')
    closeRegionSelector()
  })

  // Mixer window
  ipcMain.handle('mixer:open', () => {
    const { openMixerWindow } = require('./index') as typeof import('./index')
    openMixerWindow()
  })

  ipcMain.handle('mixer:request-state', () => {
    const { getMainWindow } = require('./index') as typeof import('./index')
    const mainWin = getMainWindow()
    if (mainWin) {
      mainWin.webContents.send('mixer:get-state')
    }
  })

  ipcMain.handle('mixer:set-volume', (_event, clipId: string, trackId: string, volume: number) => {
    const { getMainWindow } = require('./index') as typeof import('./index')
    const mainWin = getMainWindow()
    if (mainWin) {
      mainWin.webContents.send('mixer:update', { type: 'volume', clipId, trackId, value: volume })
    }
  })

  ipcMain.handle('mixer:set-muted', (_event, clipId: string, trackId: string, muted: boolean) => {
    const { getMainWindow } = require('./index') as typeof import('./index')
    const mainWin = getMainWindow()
    if (mainWin) {
      mainWin.webContents.send('mixer:update', { type: 'muted', clipId, trackId, value: muted })
    }
  })

  ipcMain.handle('mixer:respond-state', (_event, state: unknown) => {
    const { getMixerWindow } = require('./index') as typeof import('./index')
    const mixerWin = getMixerWindow()
    if (mixerWin) {
      mixerWin.webContents.send('mixer:state-update', state)
    }
  })
}
