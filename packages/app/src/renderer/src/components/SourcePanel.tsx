import { useEffect } from 'react'
import { useSourcesStore } from '../store/sources'
import { useLayoutStore } from '../store/layout'
import { SourceItem } from './SourceItem'

interface SourcePanelProps {
  onAddSource: () => void
}

export function SourcePanel({ onAddSource }: SourcePanelProps) {
  const sourcesStore = useSourcesStore()
  const layoutStore = useLayoutStore()

  useEffect(() => {
    sourcesStore.refreshSources()
  }, [])

  // Auto-apply layout when sources change
  useEffect(() => {
    const sourceIds = sourcesStore.activeSources.map((s) => s.id)
    if (sourceIds.length > 0) {
      layoutStore.applyLayout(sourceIds)
    }
  }, [sourcesStore.activeSources.length, layoutStore.activeLayout])

  return (
    <div className="source-panel-v2">
      <div className="panel-header">
        <h3>Sources</h3>
        <button className="add-source-btn" onClick={onAddSource}>
          + Add
        </button>
      </div>

      {sourcesStore.error && (
        <div className="error-box">{sourcesStore.error}</div>
      )}

      <div className="source-list-container">
        {sourcesStore.activeSources.length === 0 ? (
          <p className="empty-message">No sources added. Click + Add to begin.</p>
        ) : (
          sourcesStore.activeSources.map((source) => (
            <SourceItem key={source.id} {...source} />
          ))
        )}
      </div>

    </div>
  )
}
