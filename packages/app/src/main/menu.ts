import { Menu, dialog, BrowserWindow } from 'electron'

export function setupApplicationMenu(getMainWindow: () => BrowserWindow | null): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Project...',
          accelerator: 'CmdOrCtrl+O',
          click: async (): Promise<void> => {
            const win = getMainWindow()
            if (!win) return

            const result = await dialog.showOpenDialog(win, {
              properties: ['openFile'],
              filters: [{ name: 'd3motap3 Project', extensions: ['d3m'] }]
            })

            if (result.canceled || result.filePaths.length === 0) return

            win.webContents.send('open-bundle', result.filePaths[0])
          }
        },
        {
          label: 'Import Media...',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: async (): Promise<void> => {
            const win = getMainWindow()
            if (!win) return

            const result = await dialog.showOpenDialog(win, {
              properties: ['openFile'],
              filters: [{ name: 'Video Files', extensions: ['mp4', 'mov', 'webm', 'avi', 'mkv'] }]
            })

            if (result.canceled || result.filePaths.length === 0) return

            win.webContents.send('import-media', result.filePaths[0])
          }
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    { role: 'editMenu' },
    { role: 'windowMenu' }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
