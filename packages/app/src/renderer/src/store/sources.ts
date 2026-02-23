import { create } from 'zustand'

interface SourceInfo {
  id: number
  name: string
  width: number
  height: number
  isActive: boolean
}

interface WindowInfo {
  windowId: number
  title: string
  appName: string
  isOnScreen: boolean
}

interface WebcamInfo {
  deviceIndex: number
  name: string
  description: string
}

interface SourcesState {
  activeSources: SourceInfo[]
  availableWindows: WindowInfo[]
  availableWebcams: WebcamInfo[]
  error: string | null

  setActiveSources: (sources: SourceInfo[]) => void
  setAvailableWindows: (windows: WindowInfo[]) => void
  setAvailableWebcams: (webcams: WebcamInfo[]) => void
  setError: (error: string | null) => void

  addSource: (sourceType: string, config: Record<string, unknown>) => Promise<number>
  removeSource: (sourceId: number) => Promise<void>
  refreshSources: () => Promise<void>
  refreshAvailableWindows: () => Promise<void>
  refreshAvailableWebcams: () => Promise<void>
}

export const useSourcesStore = create<SourcesState>((set) => ({
  activeSources: [],
  availableWindows: [],
  availableWebcams: [],
  error: null,

  setActiveSources: (activeSources) => set({ activeSources }),
  setAvailableWindows: (availableWindows) => set({ availableWindows }),
  setAvailableWebcams: (availableWebcams) => set({ availableWebcams }),
  setError: (error) => set({ error }),

  addSource: async (sourceType, config) => {
    try {
      const configJson = JSON.stringify({ type: sourceType, ...config })
      const sourceId = await window.api.invoke('sources:add', sourceType, configJson) as number
      const sources = await window.api.invoke('sources:list') as SourceInfo[]
      set({ activeSources: sources, error: null })
      return sourceId
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message })
      throw err
    }
  },

  removeSource: async (sourceId) => {
    try {
      await window.api.invoke('sources:remove', sourceId)
      const sources = await window.api.invoke('sources:list') as SourceInfo[]
      set({ activeSources: sources, error: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message })
    }
  },

  refreshSources: async () => {
    try {
      const sources = await window.api.invoke('sources:list') as SourceInfo[]
      set({ activeSources: sources, error: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message })
    }
  },

  refreshAvailableWindows: async () => {
    try {
      const windows = await window.api.invoke('sources:list-available-windows') as WindowInfo[]
      set({ availableWindows: windows, error: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message })
    }
  },

  refreshAvailableWebcams: async () => {
    try {
      const webcams = await window.api.invoke('sources:list-available-webcams') as WebcamInfo[]
      set({ availableWebcams: webcams, error: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message })
    }
  },
}))
