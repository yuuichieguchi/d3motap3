import { app, BrowserWindow, screen, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { stat, open } from 'fs/promises'
import { registerIpcHandlers } from './ipc-handlers'

const is = {
  dev: process.env.NODE_ENV === 'development' || !app.isPackaged
}

protocol.registerSchemesAsPrivileged([{
  scheme: 'media',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
}])

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
