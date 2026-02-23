import { create } from 'zustand'
import type { ScriptExecutionStatus } from '@d3motap3/shared'

interface ScriptState {
  yamlPath: string | null
  status: ScriptExecutionStatus
  pollingInterval: ReturnType<typeof setInterval> | null

  setYamlPath: (path: string | null) => void
  run: () => Promise<void>
  cancel: () => Promise<void>
  startPolling: () => void
  stopPolling: () => void
}

export const useScriptStore = create<ScriptState>((set, get) => ({
  yamlPath: null,
  status: { status: 'idle' },
  pollingInterval: null,

  setYamlPath: (path) => set({ yamlPath: path }),

  run: async () => {
    const { yamlPath } = get()
    if (!yamlPath) return

    try {
      await window.api.invoke('script:run', yamlPath)
      get().startPolling()
    } catch (err) {
      set({
        status: {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          step: null,
        },
      })
    }
  },

  cancel: async () => {
    try {
      await window.api.invoke('script:cancel')
    } catch {
      // ignore
    }
  },

  startPolling: () => {
    const existing = get().pollingInterval
    if (existing) return

    const interval = setInterval(async () => {
      try {
        const json = (await window.api.invoke('script:status')) as string
        const status = JSON.parse(json) as ScriptExecutionStatus
        set({ status })

        // Stop polling when done
        if (status.status === 'completed' || status.status === 'failed' || status.status === 'idle') {
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
