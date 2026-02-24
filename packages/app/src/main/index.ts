import { app, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc-handlers'

const is = {
  dev: process.env.NODE_ENV === 'development' || !app.isPackaged
}

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
    fullscreen: true,
    transparent: true,
    frame: false,
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
    regionSelectorWindow.close()
    regionSelectorWindow = null
  }
}

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

app.whenReady().then(() => {
  registerIpcHandlers()
  mainWindow = createWindow()

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
