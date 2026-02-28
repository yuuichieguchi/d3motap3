import { app, BrowserWindow, screen, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { stat, open } from 'fs/promises'
import { registerIpcHandlers } from './ipc-handlers'

const is = {
  dev: process.env.NODE_ENV === 'development' || !app.isPackaged
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  },
  {
    scheme: 'audio',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

let regionSelectorWindow: BrowserWindow | null = null

export function openRegionSelector(displayIndex: number): void {
  if (regionSelectorWindow) {
    regionSelectorWindow.close()
    regionSelectorWindow = null
  }

  const displays = screen.getAllDisplays()
  const display = displays[displayIndex] || displays[0]

  regionSelectorWindow = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  regionSelectorWindow.setSimpleFullScreen(true)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    regionSelectorWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/region-selector.html`)
  } else {
    regionSelectorWindow.loadFile(join(__dirname, '../renderer/region-selector.html'))
  }

  regionSelectorWindow.webContents.once('did-finish-load', () => {
    regionSelectorWindow?.webContents.send('region:display-info', {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
    })
  })

  regionSelectorWindow.on('closed', () => {
    regionSelectorWindow = null
  })
}

export function closeRegionSelector(): void {
  if (regionSelectorWindow) {
    regionSelectorWindow.setSimpleFullScreen(false)
    regionSelectorWindow.close()
    regionSelectorWindow = null
  }
}

let mainWindow: BrowserWindow | null = null
let pendingOpenFile: string | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

const MEDIA_MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
}

app.whenReady().then(() => {
  protocol.handle('media', async (request) => {
    try {
      const filePath = decodeURIComponent(new URL(request.url).pathname)
      const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
      const mime = MEDIA_MIME[ext]
      if (!mime) {
        return new Response('Forbidden', { status: 403 })
      }

      const fileSize = (await stat(filePath)).size
      const range = request.headers.get('Range')

      if (range) {
        const m = range.match(/bytes=(\d+)-(\d*)/)
        if (m) {
          const start = parseInt(m[1], 10)
          const end = m[2] ? Math.min(parseInt(m[2], 10), fileSize - 1) : fileSize - 1
          if (start >= fileSize || start > end) {
            return new Response('Range Not Satisfiable', {
              status: 416,
              headers: { 'Content-Range': `bytes */${fileSize}` },
            })
          }
          const len = end - start + 1
          const buf = Buffer.alloc(len)
          const fh = await open(filePath, 'r')
          try {
            await fh.read(buf, 0, len, start)
          } finally {
            await fh.close()
          }
          return new Response(buf, {
            status: 206,
            headers: {
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': String(len),
              'Content-Type': mime,
            },
          })
        }
      }

      return net.fetch(pathToFileURL(filePath).toString())
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return new Response('Not Found', { status: 404 })
      }
      return new Response('Internal Server Error', { status: 500 })
    }
  })

  protocol.handle('audio', async (request) => {
    try {
      const url = new URL(request.url)
      const filePath = decodeURIComponent(url.pathname)
      const sampleRate = parseInt(url.searchParams.get('sr') || '48000', 10)
      const channels = parseInt(url.searchParams.get('ch') || '2', 10)

      const { readFile } = await import('fs/promises')
      const pcmData = await readFile(filePath)

      // Build WAV header for the PCM data (f32le format)
      const bitsPerSample = 32
      const bytesPerSample = bitsPerSample / 8
      const blockAlign = channels * bytesPerSample
      const byteRate = sampleRate * blockAlign
      const dataSize = pcmData.byteLength
      const headerSize = 44
      const fileSize = headerSize + dataSize

      const header = Buffer.alloc(headerSize)
      // RIFF header
      header.write('RIFF', 0)
      header.writeUInt32LE(fileSize - 8, 4)
      header.write('WAVE', 8)
      // fmt chunk
      header.write('fmt ', 12)
      header.writeUInt32LE(16, 16) // chunk size
      header.writeUInt16LE(3, 20) // format: IEEE float
      header.writeUInt16LE(channels, 22)
      header.writeUInt32LE(sampleRate, 24)
      header.writeUInt32LE(byteRate, 28)
      header.writeUInt16LE(blockAlign, 30)
      header.writeUInt16LE(bitsPerSample, 32)
      // data chunk
      header.write('data', 36)
      header.writeUInt32LE(dataSize, 40)

      const wavBuffer = Buffer.concat([header, pcmData])

      return new Response(wavBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Length': String(wavBuffer.byteLength),
        },
      })
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return new Response('Not Found', { status: 404 })
      }
      return new Response('Internal Server Error', { status: 500 })
    }
  })

  registerIpcHandlers()
  mainWindow = createWindow()

  if (pendingOpenFile) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow!.webContents.send('open-bundle', pendingOpenFile!)
      pendingOpenFile = null
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (filePath.endsWith('.d3m')) {
    if (mainWindow) {
      mainWindow.webContents.send('open-bundle', filePath)
    } else {
      pendingOpenFile = filePath
    }
  }
})
