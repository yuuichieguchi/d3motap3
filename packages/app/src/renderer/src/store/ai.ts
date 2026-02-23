import { create } from 'zustand'
import type { AiStatus } from '@d3motap3/shared'

interface AiState {
  apiKey: string
  description: string
  status: AiStatus
  activeTab: 'narration' | 'script'
  pollingInterval: ReturnType<typeof setInterval> | null

  setApiKey: (key: string) => void
  setDescription: (desc: string) => void
  setActiveTab: (tab: 'narration' | 'script') => void
  startNarration: () => Promise<void>
  startScriptGen: () => Promise<void>
  cancel: () => Promise<void>
  reset: () => Promise<void>
  startPolling: () => void
  stopPolling: () => void
}

export const useAiStore = create<AiState>((set, get) => ({
  apiKey: '',
  description: '',
  status: { status: 'idle' },
  activeTab: 'narration',
  pollingInterval: null,

  setApiKey: (key) => set({ apiKey: key }),
  setDescription: (desc) => set({ description: desc }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  startNarration: async () => {
    const { description, apiKey } = get()
    if (!description.trim() || !apiKey.trim()) return

    try {
      await window.api.invoke('ai:start-narration', description, apiKey)
      get().startPolling()
    } catch (err) {
      set({
        status: {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        },
      })
    }
  },

  startScriptGen: async () => {
    const { description, apiKey } = get()
    if (!description.trim() || !apiKey.trim()) return

    try {
      await window.api.invoke('ai:start-script-gen', description, apiKey)
      get().startPolling()
    } catch (err) {
      set({
        status: {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        },
      })
    }
  },

  cancel: async () => {
    try {
      await window.api.invoke('ai:cancel')
    } catch {
      // ignore
    }
  },

  reset: async () => {
    try {
      await window.api.invoke('ai:reset')
      set({ status: { status: 'idle' } })
    } catch {
      // ignore
    }
    get().stopPolling()
  },

  startPolling: () => {
    const existing = get().pollingInterval
    if (existing) return

    const interval = setInterval(async () => {
      try {
        const json = (await window.api.invoke('ai:status')) as string
        const status = JSON.parse(json) as AiStatus
        set({ status })

        if (status.status === 'completed' || status.status === 'failed') {
          get().stopPolling()
        }
      } catch {
        // ignore polling errors
      }
    }, 200)

    set({ pollingInterval: interval })
  },

  stopPolling: () => {
    const interval = get().pollingInterval
    if (interval) {
      clearInterval(interval)
      set({ pollingInterval: null })
    }
  },
}))
