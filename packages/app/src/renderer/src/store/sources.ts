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

interface AndroidDevice {
  serial: string
  model: string
  state: string
}

interface IosDevice {
  deviceId: string
  name: string
  model: string
}

interface SourcesState {
  activeSources: SourceInfo[]
  availableWindows: WindowInfo[]
  availableWebcams: WebcamInfo[]
  availableAndroid: AndroidDevice[]
  availableIos: IosDevice[]
  isAdbAvailable: boolean
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
  refreshAvailableAndroid: () => Promise<void>
  refreshAvailableIos: () => Promise<void>
  checkAdbAvailable: () => Promise<void>
  reorderSources: (fromIndex: number, toIndex: number) => void
}

export const useSourcesStore = create<SourcesState>((set, get) => ({
  activeSources: [],
  availableWindows: [],
  availableWebcams: [],
  availableAndroid: [],
  availableIos: [],
  isAdbAvailable: false,
  error: null,

  setActiveSources: (activeSources) => set({ activeSources }),
  setAvailableWindows: (availableWindows) => set({ availableWindows }),
  setAvailableWebcams: (availableWebcams) => set({ availableWebcams }),
  setError: (error) => set({ error }),

  reorderSources: (fromIndex, toIndex) => {
    if (fromIndex === toIndex) return
    const sources = [...get().activeSources]
    const [moved] = sources.splice(fromIndex, 1)
    sources.splice(toIndex, 0, moved)
    set({ activeSources: sources })
  },

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

  refreshAvailableAndroid: async () => {
    try {
      const devices = await window.api.invoke('sources:list-available-android') as AndroidDevice[]
      set({ availableAndroid: devices, error: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message })
    }
  },

  refreshAvailableIos: async () => {
    try {
      const devices = await window.api.invoke('sources:list-available-ios') as IosDevice[]
      set({ availableIos: devices, error: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message })
    }
  },

  checkAdbAvailable: async () => {
    try {
      const available = await window.api.invoke('sources:is-adb-available') as boolean
      set({ isAdbAvailable: available })
    } catch {
      set({ isAdbAvailable: false })
    }
  },
}))
