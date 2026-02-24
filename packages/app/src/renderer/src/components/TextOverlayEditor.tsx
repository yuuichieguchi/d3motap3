import { useCallback } from 'react'
import { useEditorStore } from '../store/editor'

export function TextOverlayEditor() {
  const store = useEditorStore()
  const overlay = store.project.textOverlays.find((o) => o.id === store.selectedOverlayId)

  const handleUpdate = useCallback((updates: Record<string, unknown>) => {
    if (!store.selectedOverlayId) return
    store.updateTextOverlay(store.selectedOverlayId, updates)
  }, [store])

  const handleRemove = useCallback(() => {
    if (!store.selectedOverlayId) return
    store.removeTextOverlay(store.selectedOverlayId)
  }, [store])

  if (!overlay) return null

  return (
    <div className="text-overlay-editor">
      <h3>Text Overlay</h3>

      <div className="control-group">
        <label>Text</label>
        <textarea
          rows={2}
          value={overlay.text}
          onChange={(e) => handleUpdate({ text: e.target.value })}
        />
      </div>

      <div className="control-group">
        <label>Font Size</label>
        <input
          type="range"
          min={12}
          max={128}
          value={overlay.fontSize}
          onChange={(e) => handleUpdate({ fontSize: Number(e.target.value) })}
        />
        <span>{overlay.fontSize}px</span>
      </div>

      <div className="control-group">
        <label>Color</label>
        <input
          type="color"
          value={overlay.color}
          onChange={(e) => handleUpdate({ color: e.target.value })}
        />
      </div>

      <div className="control-group">
        <label>Position X</label>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(overlay.x * 100)}
          onChange={(e) => handleUpdate({ x: Number(e.target.value) / 100 })}
        />
        <span>{Math.round(overlay.x * 100)}%</span>
      </div>

      <div className="control-group">
        <label>Position Y</label>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(overlay.y * 100)}
          onChange={(e) => handleUpdate({ y: Number(e.target.value) / 100 })}
        />
        <span>{Math.round(overlay.y * 100)}%</span>
      </div>

      <div className="control-group">
        <label>Start (ms)</label>
        <input
          type="number"
          min={0}
          value={Math.round(overlay.startTime)}
          onChange={(e) => handleUpdate({ startTime: Number(e.target.value) })}
        />
      </div>

      <div className="control-group">
        <label>End (ms)</label>
        <input
          type="number"
          min={0}
          value={Math.round(overlay.endTime)}
          onChange={(e) => handleUpdate({ endTime: Number(e.target.value) })}
        />
      </div>

      <div className="record-controls">
        <button className="record-btn stop" onClick={handleRemove}>
          Remove Overlay
        </button>
      </div>
    </div>
  )
}
