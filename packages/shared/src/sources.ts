export type SourceType = 'desktop' | 'window' | 'region' | 'webcam' | 'terminal' | 'android' | 'ios'

export interface Source {
  id: string
  type: SourceType
  name: string
  enabled: boolean
}

export interface DesktopSource extends Source {
  type: 'desktop'
  displayId: number
}

export interface WindowSource extends Source {
  type: 'window'
  windowId: number
  appName: string
}

export interface RegionSource extends Source {
  type: 'region'
  x: number
  y: number
  width: number
  height: number
}

export interface WebcamSource extends Source {
  type: 'webcam'
  deviceId: string
}

export interface TerminalSource extends Source {
  type: 'terminal'
  shell: string
}

export interface AndroidSource extends Source {
  type: 'android'
  deviceSerial: string
}

export interface IosSource extends Source {
  type: 'ios'
  deviceId: string
}

export type AnySource =
  | DesktopSource
  | WindowSource
  | RegionSource
  | WebcamSource
  | TerminalSource
  | AndroidSource
  | IosSource
