import { useState, useEffect } from 'react'
import { useSourcesStore } from '../store/sources'
import { useRecordingStore } from '../store/recording'

interface AddSourceDialogProps {
  open: boolean
  onClose: () => void
}

export function AddSourceDialog({ open, onClose }: AddSourceDialogProps) {
  const [sourceType, setSourceType] = useState<'Display' | 'Window' | 'Webcam' | 'Terminal' | 'Android' | 'Ios' | 'Region'>('Display')
  const sourcesStore = useSourcesStore()
  const recordingStore = useRecordingStore()
  const [regionDisplay, setRegionDisplay] = useState(0)
  const [regionX, setRegionX] = useState(0)
  const [regionY, setRegionY] = useState(0)
  const [regionW, setRegionW] = useState(800)
  const [regionH, setRegionH] = useState(600)
  const [regionSelected, setRegionSelected] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    if (open) {
      setRegionSelected(false)
      setShowAdvanced(false)
      if (sourceType === 'Window') {
        sourcesStore.refreshAvailableWindows()
      } else if (sourceType === 'Webcam') {
        sourcesStore.refreshAvailableWebcams()
      } else if (sourceType === 'Android') {
        sourcesStore.checkAdbAvailable()
        sourcesStore.refreshAvailableAndroid()
      } else if (sourceType === 'Ios') {
        sourcesStore.refreshAvailableIos()
      }
    }
  }, [open, sourceType])

  useEffect(() => {
    if (!window.api?.on) return
    const unsubscribe = window.api.on('region:selected', (...args: unknown[]) => {
      const rect = args[0] as { x: number; y: number; width: number; height: number }
      setRegionX(rect.x)
      setRegionY(rect.y)
      setRegionW(rect.width)
      setRegionH(rect.height)
      setRegionSelected(true)
    })
    return unsubscribe
  }, [])

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
          <select value={sourceType} onChange={(e) => setSourceType(e.target.value as 'Display' | 'Window' | 'Webcam' | 'Terminal' | 'Android' | 'Ios' | 'Region')}>
            <option value="Display">Display</option>
            <option value="Window">Window</option>
            <option value="Webcam">Webcam</option>
            <option value="Android">Android</option>
            <option value="Ios">iOS</option>
            <option value="Region">Region</option>
            <option value="Terminal">Terminal</option>
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

        {sourceType === 'Android' && (
          <div className="source-list">
            {!sourcesStore.isAdbAvailable ? (
              <p>ADB is not installed or not found in PATH. Install Android SDK Platform Tools to use Android sources.</p>
            ) : sourcesStore.availableAndroid.length === 0 ? (
              <p>No Android devices detected. Connect a device via USB with USB debugging enabled.</p>
            ) : (
              sourcesStore.availableAndroid.map((d) => (
                <button
                  key={d.serial}
                  className="source-option-btn"
                  onClick={() => handleAdd({
                    device_serial: d.serial,
                    width: 1080,
                    height: 1920,
                  })}
                >
                  {d.model || d.serial} ({d.state})
                </button>
              ))
            )}
          </div>
        )}

        {sourceType === 'Ios' && (
          <div className="source-list">
            {sourcesStore.availableIos.length === 0 ? (
              <p>No iOS devices detected. Connect a device via USB (macOS only).</p>
            ) : (
              sourcesStore.availableIos.map((d) => (
                <button
                  key={d.deviceId}
                  className="source-option-btn"
                  onClick={() => handleAdd({
                    device_id: d.deviceId,
                    width: 1170,
                    height: 2532,
                  })}
                >
                  {d.name} ({d.model})
                </button>
              ))
            )}
          </div>
        )}

        {sourceType === 'Region' && (
          <div className="source-list">
            <div className="control-group">
              <label>Display</label>
              <select value={regionDisplay} onChange={(e) => setRegionDisplay(Number(e.target.value))}>
                {recordingStore.displays.map((d, i) => (
                  <option key={d.id} value={i}>Display {i + 1} ({d.width}x{d.height})</option>
                ))}
              </select>
            </div>
            <button
              className="source-option-btn"
              onClick={() => window.api?.invoke('region:open-selector', regionDisplay)}
              style={{ marginBottom: 8 }}
            >
              Select Region...
            </button>
            {regionSelected && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Selected: {regionX}, {regionY} — {regionW} × {regionH}
              </div>
            )}
            <button
              className="source-option-btn"
              style={{
                background: regionSelected ? 'rgba(0, 122, 255, 0.15)' : undefined,
                borderColor: regionSelected ? 'var(--accent)' : undefined,
              }}
              disabled={!regionSelected && regionW <= 0}
              onClick={() => handleAdd({
                display_index: regionDisplay,
                x: regionX,
                y: regionY,
                region_width: regionW,
                region_height: regionH,
              })}
            >
              Add Region
            </button>
            <div style={{ marginTop: 8 }}>
              <button
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  fontSize: 11,
                  cursor: 'pointer',
                  padding: '4px 0',
                }}
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                {showAdvanced ? '▼' : '▶'} Advanced (manual input)
              </button>
              {showAdvanced && (
                <div style={{ marginTop: 4 }}>
                  <div className="control-group">
                    <label>X</label>
                    <input type="number" min={0} value={regionX} onChange={(e) => { setRegionX(Number(e.target.value)); setRegionSelected(true) }} style={{ width: '100%', padding: '4px 6px', background: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.45)', borderRadius: 8, fontSize: 13, color: 'var(--text-primary)' }} />
                  </div>
                  <div className="control-group">
                    <label>Y</label>
                    <input type="number" min={0} value={regionY} onChange={(e) => { setRegionY(Number(e.target.value)); setRegionSelected(true) }} style={{ width: '100%', padding: '4px 6px', background: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.45)', borderRadius: 8, fontSize: 13, color: 'var(--text-primary)' }} />
                  </div>
                  <div className="control-group">
                    <label>Width</label>
                    <input type="number" min={1} value={regionW} onChange={(e) => { setRegionW(Number(e.target.value)); setRegionSelected(true) }} style={{ width: '100%', padding: '4px 6px', background: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.45)', borderRadius: 8, fontSize: 13, color: 'var(--text-primary)' }} />
                  </div>
                  <div className="control-group">
                    <label>Height</label>
                    <input type="number" min={1} value={regionH} onChange={(e) => { setRegionH(Number(e.target.value)); setRegionSelected(true) }} style={{ width: '100%', padding: '4px 6px', background: 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.45)', borderRadius: 8, fontSize: 13, color: 'var(--text-primary)' }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {sourceType === 'Terminal' && (
          <div className="source-list">
            <button
              className="source-option-btn"
              onClick={() => handleAdd({
                shell: '/bin/zsh',
                rows: 24,
                cols: 80,
                width: 960,
                height: 540,
              })}
            >
              Default Terminal (zsh, 80x24)
            </button>
            <button
              className="source-option-btn"
              onClick={() => handleAdd({
                shell: '/bin/bash',
                rows: 40,
                cols: 120,
                width: 1920,
                height: 1080,
              })}
            >
              Large Terminal (bash, 120x40)
            </button>
          </div>
        )}

        <button className="dialog-close-btn" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}
