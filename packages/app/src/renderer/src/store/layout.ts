import { create } from 'zustand'

type LayoutType = 'Single' | 'SideBySide' | 'Pip'

interface LayoutState {
  activeLayout: LayoutType
  layoutConfig: Record<string, unknown>
  error: string | null

  setActiveLayout: (layout: LayoutType) => void
  setLayoutConfig: (config: Record<string, unknown>) => void
  setError: (error: string | null) => void

  applyLayout: (sourceIds: number[]) => Promise<void>
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  activeLayout: 'Single',
  layoutConfig: {},
  error: null,

  setActiveLayout: (activeLayout) => set({ activeLayout }),
  setLayoutConfig: (layoutConfig) => set({ layoutConfig }),
  setError: (error) => set({ error }),

  applyLayout: async (sourceIds) => {
    try {
      const { activeLayout, layoutConfig } = get()
      let layoutJson: Record<string, unknown>

      switch (activeLayout) {
        case 'Single':
          layoutJson = {
            type: 'Single',
            source: sourceIds[0] ?? 0,
          }
          break
        case 'SideBySide':
          layoutJson = {
            type: 'SideBySide',
            left: sourceIds[0] ?? 0,
            right: sourceIds[1] ?? 0,
            ratio: (layoutConfig.ratio as number) ?? 0.5,
          }
          break
        case 'Pip':
          layoutJson = {
            type: 'Pip',
            primary: sourceIds[0] ?? 0,
            pip: sourceIds[1] ?? 0,
            pip_position: (layoutConfig.pipPosition as string) ?? 'BottomRight',
            pip_scale: (layoutConfig.pipScale as number) ?? 0.25,
          }
          break
      }

      await window.api.invoke('layout:set', JSON.stringify(layoutJson))
      set({ error: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ error: message })
    }
  },
}))
