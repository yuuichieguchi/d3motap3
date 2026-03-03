import { useCallback, useEffect, useRef } from 'react'
import { useScriptStore } from '../store/script'

interface Props {
  onScriptCompleted?: (outputPath: string) => void
}

export function ScriptPanel({ onScriptCompleted }: Props) {
  const store = useScriptStore()
  const { status } = store
  const handledPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (status.status === 'completed' && onScriptCompleted && status.output_path !== handledPathRef.current) {
      handledPathRef.current = status.output_path
      onScriptCompleted(status.output_path)
    }
    if (status.status !== 'completed') {
      handledPathRef.current = null
    }
  }, [status, onScriptCompleted])

  const handleSelectFile = useCallback(async () => {
    try {
      const path = (await window.api.invoke('dialog:open-file', {
        filters: [{ name: 'YAML Script', extensions: ['yml', 'yaml'] }],
      })) as string | null
      if (path) {
        store.setYamlPath(path)
      }
    } catch (err) {
      console.error('Failed to open file dialog:', err)
    }
  }, [store])

  const handleRun = useCallback(async () => {
    await store.run()
  }, [store])

  const handleCancel = useCallback(async () => {
    await store.cancel()
  }, [store])

  const isRunning =
    status.status === 'parsing' ||
    status.status === 'setting_up' ||
    status.status === 'running' ||
    status.status === 'stopping'

  return (
    <div className="script-section">
      <h3>Script</h3>

      {/* File selection */}
      <div className="control-group">
        <button onClick={handleSelectFile} disabled={isRunning}>
          Select YAML
        </button>
        {store.yamlPath && (
          <span className="file-path" title={store.yamlPath}>
            {store.yamlPath.split('/').pop()}
          </span>
        )}
      </div>

      {/* Run / Cancel */}
      <div className="record-controls">
        {!isRunning && (
          <button
            className="record-btn start"
            onClick={handleRun}
            disabled={!store.yamlPath}
          >
            Run Script
          </button>
        )}
        {isRunning && (
          <button className="record-btn stop" onClick={handleCancel}>
            Cancel
          </button>
        )}
      </div>

      {/* Status display */}
      {status.status === 'running' && (
        <div className="script-progress">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{
                width: `${((status.current_step + 1) / status.total_steps) * 100}%`,
              }}
            />
          </div>
          <span className="progress-text">
            Step {status.current_step + 1}/{status.total_steps}
          </span>
          <span className="step-description">{status.step_description}</span>
        </div>
      )}

      {status.status === 'parsing' && <div className="script-status">Parsing YAML...</div>}
      {status.status === 'setting_up' && <div className="script-status">Setting up sources...</div>}
      {status.status === 'stopping' && <div className="script-status">Stopping recording...</div>}

      {status.status === 'completed' && (
        <div className="result-box">
          <p>Script completed</p>
          <p className="result-path">{status.output_path}</p>
          <p className="result-details">
            Duration: {Math.round(status.duration_ms / 1000)}s
          </p>
        </div>
      )}

      {status.status === 'failed' && (
        <div className="error-box">
          <p>Script failed{status.step !== null ? ` at step ${status.step + 1}` : ''}</p>
          <p>{status.error}</p>
        </div>
      )}
    </div>
  )
}
