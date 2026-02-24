import { useState, useCallback, useEffect } from 'react'
import { useEditorStore } from '../store/editor'

interface ExportDialogProps {
  open: boolean
  onClose: () => void
}

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  const store = useEditorStore()
  const [outputPath, setOutputPath] = useState('')
  const { exportStatus } = store

  // Generate default filename on open
  useEffect(() => {
    if (open && !outputPath) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      setOutputPath(`d3motap3-edit-${timestamp}.mp4`)
    }
  }, [open])

  const handleExport = useCallback(async () => {
    if (!outputPath.trim()) return
    try {
      await store.startExport(outputPath)
    } catch (err) {
      console.error('Failed to start export:', err)
    }
  }, [store, outputPath])

  const handleClose = useCallback(() => {
    if (exportStatus.status !== 'exporting') {
      onClose()
    }
  }, [exportStatus, onClose])

  if (!open) return null

  const isExporting = exportStatus.status === 'exporting'
  const isCompleted = exportStatus.status === 'completed'
  const isFailed = exportStatus.status === 'failed'
  const progress = 'progress' in exportStatus ? exportStatus.progress : 0

  return (
    <div className="dialog-overlay" onClick={handleClose}>
      <div className="dialog-content" onClick={(e) => e.stopPropagation()}>
        <h3>Export Video</h3>

        {!isExporting && !isCompleted && !isFailed && (
          <>
            <div className="control-group">
              <label>Output Resolution</label>
              <span>{store.project.outputWidth}x{store.project.outputHeight}</span>
            </div>

            <div className="control-group">
              <label>Clips</label>
              <span>{store.project.clips.length} clip(s)</span>
            </div>

            <div className="control-group">
              <label>Output Filename</label>
              <input
                type="text"
                value={outputPath}
                onChange={(e) => setOutputPath(e.target.value)}
              />
            </div>

            <div className="record-controls">
              <button className="record-btn start" onClick={handleExport}>
                Start Export
              </button>
              <button className="record-btn" onClick={handleClose}>
                Cancel
              </button>
            </div>
          </>
        )}

        {isExporting && (
          <div className="export-progress">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <p className="progress-text">Exporting... {progress}%</p>
          </div>
        )}

        {isCompleted && (
          <div className="result-box">
            <p>Export completed</p>
            <p className="result-path">{outputPath}</p>
            <button className="record-btn start" onClick={handleClose}>
              Done
            </button>
          </div>
        )}

        {isFailed && (
          <div className="error-box">
            <p>Export failed</p>
            <p>{'error' in exportStatus ? exportStatus.error : 'Unknown error'}</p>
            <button className="record-btn" onClick={handleClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
