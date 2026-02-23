import { useState, useEffect } from 'react'
import { useSourcesStore } from '../store/sources'
import { useLayoutStore } from '../store/layout'
import { SourceItem } from './SourceItem'
import { AddSourceDialog } from './AddSourceDialog'

export function SourcePanel() {
  const [dialogOpen, setDialogOpen] = useState(false)
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
        <button className="add-source-btn" onClick={() => setDialogOpen(true)}>
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

      <AddSourceDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  )
}
