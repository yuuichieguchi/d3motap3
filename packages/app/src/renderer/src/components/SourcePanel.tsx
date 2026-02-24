import { useEffect, useState, useCallback } from 'react'
import { useSourcesStore } from '../store/sources'
import { useLayoutStore } from '../store/layout'
import { SourceItem } from './SourceItem'

const MAX_SOURCES = 2

interface SourcePanelProps {
  onAddSource: () => void
}

export function SourcePanel({ onAddSource }: SourcePanelProps) {
  const sourcesStore = useSourcesStore()
  const layoutStore = useLayoutStore()

  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
    setDragIndex(index)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (dragIndex !== null && dragIndex !== index) {
      sourcesStore.reorderSources(dragIndex, index)
    }
    setDragIndex(null)
    setDragOverIndex(null)
  }, [dragIndex, sourcesStore])

  const handleDragEnd = useCallback(() => {
    setDragIndex(null)
    setDragOverIndex(null)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as Node | null
    if (!e.currentTarget.contains(relatedTarget)) {
      setDragOverIndex(null)
    }
  }, [])

  useEffect(() => {
    sourcesStore.refreshSources()
  }, [])

  // Auto-apply layout when sources or their order change
  const sourceIdKey = sourcesStore.activeSources.map(s => s.id).join(',')

  useEffect(() => {
    const sourceIds = sourcesStore.activeSources.map((s) => s.id)
    if (sourceIds.length > 0) {
      layoutStore.applyLayout(sourceIds)
    }
  }, [sourceIdKey, layoutStore.activeLayout])

  return (
    <div className="source-panel-v2">
      <div className="panel-header">
        <h3>Sources</h3>
        <button className="add-source-btn" onClick={onAddSource} disabled={sourcesStore.activeSources.length >= MAX_SOURCES}>
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
          sourcesStore.activeSources.map((source, index) => (
            <SourceItem
              key={source.id}
              {...source}
              index={index}
              isDragging={dragIndex === index}
              isDragOver={dragOverIndex === index}
              showDragHandle={sourcesStore.activeSources.length >= 2}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
              onDragLeave={handleDragLeave}
            />
          ))
        )}
      </div>

    </div>
  )
}
