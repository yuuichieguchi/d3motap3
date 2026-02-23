export interface ScriptMetadata {
  name: string
  description?: string
  output: {
    resolution: string  // "1920x1080"
    fps: number
  }
}

export interface ScriptSetup {
  sources: ScriptSource[]
  initialLayout: ScriptLayout
}

export interface ScriptSource {
  id: string
  type: string
  shell?: string
  device?: string
}

export interface ScriptLayout {
  type: string
  primary?: string
  left?: string
  right?: string
}

export type ScriptAction =
  | TerminalAction
  | SetLayoutAction
  | ZoomAction
  | WaitAction
  | CaptionAction

export interface TerminalAction {
  type: 'terminal'
  command: string
  waitFor?: WaitCondition
}

export interface SetLayoutAction {
  type: 'set_layout'
  layout: ScriptLayout
  transitionMs?: number
}

export interface ZoomAction {
  type: 'zoom'
  target: { source: string }
  level: number
  durationMs?: number
}

export interface WaitAction {
  type: 'wait'
  durationMs: number
}

export interface CaptionAction {
  type: 'caption'
  text: string
  position: 'top' | 'bottom' | 'center'
  durationMs?: number
}

export interface WaitCondition {
  type: 'text' | 'timeout'
  pattern?: string
  timeoutMs?: number
}

export interface ScriptStep {
  action: ScriptAction
  caption?: {
    text: string
    position: 'top' | 'bottom' | 'center'
  }
}

export interface Script {
  metadata: ScriptMetadata
  setup: ScriptSetup
  steps: ScriptStep[]
}
