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
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        {
          label: 'Cut',
          accelerator: 'CmdOrCtrl+X',
          registerAccelerator: false,
          click: (): void => {
            const win = getMainWindow()
            if (win) win.webContents.send('menu:edit-action', 'cut')
          }
        },
        {
          label: 'Copy',
          accelerator: 'CmdOrCtrl+C',
          registerAccelerator: false,
          click: (): void => {
            const win = getMainWindow()
            if (win) win.webContents.send('menu:edit-action', 'copy')
          }
        },
        {
          label: 'Paste',
          accelerator: 'CmdOrCtrl+V',
          registerAccelerator: false,
          click: (): void => {
            const win = getMainWindow()
            if (win) win.webContents.send('menu:edit-action', 'paste')
          }
        },
        { type: 'separator' },
        {
          label: 'Split at Playhead',
          accelerator: 'CmdOrCtrl+B',
          click: (): void => {
            const win = getMainWindow()
            if (win) win.webContents.send('menu:edit-action', 'split')
          }
        },
        {
          label: 'Delete',
          accelerator: 'Backspace',
          registerAccelerator: false,
          click: (): void => {
            const win = getMainWindow()
            if (win) win.webContents.send('menu:edit-action', 'delete')
          }
        },
        { type: 'separator' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Track',
      submenu: [
        {
          label: 'Add Audio Track',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: (): void => {
            const win = getMainWindow()
            if (win) win.webContents.send('menu:add-empty-audio-track')
          }
        },
        {
          label: 'Import Audio File...',
          accelerator: 'CmdOrCtrl+Shift+U',
          click: async (): Promise<void> => {
            const win = getMainWindow()
            if (!win) return

            const result = await dialog.showOpenDialog(win, {
              properties: ['openFile'],
              filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] }]
            })

            if (result.canceled || result.filePaths.length === 0) return

            const filePath = result.filePaths[0]
            const fileName = filePath.split('/').pop() ?? 'audio'
            win.webContents.send('menu:import-audio', filePath, fileName)
          }
        }
      ]
    },
    { role: 'windowMenu' }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
