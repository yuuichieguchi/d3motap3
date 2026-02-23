import { useLayoutStore } from '../store/layout'
import { useSourcesStore } from '../store/sources'

const LAYOUTS = [
  { type: 'Single' as const, label: 'Single', icon: '[ ]' },
  { type: 'SideBySide' as const, label: 'Side by Side', icon: '[|]' },
  { type: 'Pip' as const, label: 'Picture in Picture', icon: '[.]' },
] as const

export function LayoutSelector() {
  const layoutStore = useLayoutStore()
  const activeSources = useSourcesStore((s) => s.activeSources)

  const handleSelect = (type: 'Single' | 'SideBySide' | 'Pip') => {
    layoutStore.setActiveLayout(type)
    const sourceIds = activeSources.map((s) => s.id)
    if (sourceIds.length > 0) {
      layoutStore.applyLayout(sourceIds)
    }
  }

  const needsTwoSources = layoutStore.activeLayout !== 'Single'
  const hasTwoSources = activeSources.length >= 2

  return (
    <div className="layout-selector">
      <h3>Layout</h3>

      <div className="layout-options">
        {LAYOUTS.map(({ type, label, icon }) => (
          <button
            key={type}
            className={`layout-option ${layoutStore.activeLayout === type ? 'selected' : ''}`}
            onClick={() => handleSelect(type)}
            disabled={type !== 'Single' && activeSources.length < 2}
            title={label}
          >
            <span className="layout-icon">{icon}</span>
            <span className="layout-label">{label}</span>
          </button>
        ))}
      </div>

      {needsTwoSources && !hasTwoSources && (
        <p className="layout-warning">Add at least 2 sources for this layout</p>
      )}

      {layoutStore.activeLayout === 'SideBySide' && (
        <div className="control-group">
          <label>Split Ratio</label>
          <input
            type="range"
            min="0.2"
            max="0.8"
            step="0.1"
            value={(layoutStore.layoutConfig.ratio as number) ?? 0.5}
            onChange={(e) => {
              layoutStore.setLayoutConfig({ ...layoutStore.layoutConfig, ratio: Number(e.target.value) })
              const sourceIds = activeSources.map((s) => s.id)
              if (sourceIds.length >= 2) {
                layoutStore.applyLayout(sourceIds)
              }
            }}
          />
        </div>
      )}

      {layoutStore.activeLayout === 'Pip' && (
        <div className="control-group">
          <label>PiP Position</label>
          <select
            value={(layoutStore.layoutConfig.pipPosition as string) ?? 'BottomRight'}
            onChange={(e) => {
              layoutStore.setLayoutConfig({ ...layoutStore.layoutConfig, pipPosition: e.target.value })
              const sourceIds = activeSources.map((s) => s.id)
              if (sourceIds.length >= 2) {
                layoutStore.applyLayout(sourceIds)
              }
            }}
          >
            <option value="TopLeft">Top Left</option>
            <option value="TopRight">Top Right</option>
            <option value="BottomLeft">Bottom Left</option>
            <option value="BottomRight">Bottom Right</option>
          </select>
        </div>
      )}

      {layoutStore.error && (
        <div className="error-box">{layoutStore.error}</div>
      )}
    </div>
  )
}
