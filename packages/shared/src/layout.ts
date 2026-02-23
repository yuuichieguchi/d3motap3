export type LayoutType = 'single' | 'side_by_side' | 'pip' | 'stack' | 'custom'

export interface SingleLayout {
  type: 'single'
  primary: string  // source id
}

export interface SideBySideLayout {
  type: 'side_by_side'
  left: string
  right: string
  ratio: number  // 0-1, left panel width ratio
}

export interface PipLayout {
  type: 'pip'
  primary: string
  pip: string
  pipPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  pipScale: number  // 0-1
}

export interface StackLayout {
  type: 'stack'
  top: string
  bottom: string
  ratio: number
}

export interface CustomLayout {
  type: 'custom'
  regions: LayoutRegion[]
}

export interface LayoutRegion {
  sourceId: string
  x: number
  y: number
  width: number
  height: number
}

export type AnyLayout =
  | SingleLayout
  | SideBySideLayout
  | PipLayout
  | StackLayout
  | CustomLayout
