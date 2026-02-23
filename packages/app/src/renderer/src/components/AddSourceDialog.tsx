import { useState, useEffect } from 'react'
import { useSourcesStore } from '../store/sources'
import { useRecordingStore } from '../store/recording'

interface AddSourceDialogProps {
  open: boolean
  onClose: () => void
}

export function AddSourceDialog({ open, onClose }: AddSourceDialogProps) {
  const [sourceType, setSourceType] = useState<'Display' | 'Window' | 'Webcam'>('Display')
  const sourcesStore = useSourcesStore()
  const recordingStore = useRecordingStore()

  useEffect(() => {
    if (open) {
      if (sourceType === 'Window') {
        sourcesStore.refreshAvailableWindows()
      } else if (sourceType === 'Webcam') {
        sourcesStore.refreshAvailableWebcams()
      }
    }
  }, [open, sourceType])

  const handleAdd = async (config: Record<string, unknown>) => {
    try {
      await sourcesStore.addSource(sourceType, config)
      onClose()
    } catch {
      // error is set in store
    }
  }

  if (!open) return null

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Add Source</h3>

        <div className="control-group">
          <label>Type</label>
          <select value={sourceType} onChange={(e) => setSourceType(e.target.value as 'Display' | 'Window' | 'Webcam')}>
            <option value="Display">Display</option>
            <option value="Window">Window</option>
            <option value="Webcam">Webcam</option>
          </select>
        </div>

        {sourceType === 'Display' && (
          <div className="source-list">
            {recordingStore.displays.map((d, i) => (
              <button
                key={d.id}
                className="source-option-btn"
                onClick={() => handleAdd({ display_index: i, width: d.width, height: d.height })}
              >
                Display {i + 1} ({d.width}x{d.height})
              </button>
            ))}
            {recordingStore.displays.length === 0 && <p>No displays detected</p>}
          </div>
        )}

        {sourceType === 'Window' && (
          <div className="source-list">
            {sourcesStore.availableWindows.map((w) => (
              <button
                key={w.windowId}
                className="source-option-btn"
                onClick={() => handleAdd({ window_id: w.windowId, width: 1920, height: 1080 })}
              >
                {w.appName} - {w.title || '(untitled)'}
              </button>
            ))}
            {sourcesStore.availableWindows.length === 0 && <p>No windows available</p>}
          </div>
        )}

        {sourceType === 'Webcam' && (
          <div className="source-list">
            {sourcesStore.availableWebcams.map((c) => (
              <button
                key={c.deviceIndex}
                className="source-option-btn"
                onClick={() => handleAdd({ device_index: c.deviceIndex, width: 1280, height: 720 })}
              >
                {c.name}
              </button>
            ))}
            {sourcesStore.availableWebcams.length === 0 && <p>No webcams detected</p>}
          </div>
        )}

        <button className="dialog-close-btn" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}
