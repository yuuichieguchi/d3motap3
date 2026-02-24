import { useCallback } from 'react'
import { useAiStore } from '../store/ai'
import { useScriptStore } from '../store/script'

export function AiPanel() {
  const store = useAiStore()
  const scriptStore = useScriptStore()
  const { status } = store

  const isProcessing = status.status === 'processing'

  const handleGenerate = useCallback(async () => {
    if (store.activeTab === 'narration') {
      await store.startNarration()
    } else {
      await store.startScriptGen()
    }
  }, [store])

  const handleCancel = useCallback(async () => {
    await store.cancel()
  }, [store])

  const handleReset = useCallback(async () => {
    await store.reset()
  }, [store])

  const handleApplyCaption = useCallback(async () => {
    if (status.status === 'completed') {
      try {
        await window.api.invoke('caption:set', status.result, 'bottom')
      } catch (err) {
        console.error('Failed to set caption:', err)
      }
    }
  }, [status])

  const handleRunScript = useCallback(async () => {
    if (status.status !== 'completed') return
    try {
      const tmpPath = await window.api.invoke('script:save-temp', status.result) as string
      scriptStore.setYamlPath(tmpPath)
      await scriptStore.run()
    } catch (err) {
      console.error('Failed to run script:', err)
    }
  }, [status, scriptStore])

  const handleClearCaption = useCallback(async () => {
    try {
      await window.api.invoke('caption:clear')
    } catch (err) {
      console.error('Failed to clear caption:', err)
    }
  }, [])

  return (
    <div className="ai-section">
      <h3>AI Assistant</h3>

      {/* API Key */}
      <div className="control-group">
        <label>API Key</label>
        <input
          type="password"
          placeholder="sk-ant-..."
          value={store.apiKey}
          onChange={(e) => store.setApiKey(e.target.value)}
          disabled={isProcessing}
        />
      </div>

      {/* Tab selector */}
      <div className="ai-tabs">
        <button
          className={store.activeTab === 'narration' ? 'active' : ''}
          onClick={() => store.setActiveTab('narration')}
          disabled={isProcessing}
        >
          Narration
        </button>
        <button
          className={store.activeTab === 'script' ? 'active' : ''}
          onClick={() => store.setActiveTab('script')}
          disabled={isProcessing}
        >
          Script Gen
        </button>
      </div>

      {/* Description input */}
      <div className="control-group">
        <label>
          {store.activeTab === 'narration'
            ? 'Video Description'
            : 'What should the demo show?'}
        </label>
        <textarea
          rows={3}
          placeholder={
            store.activeTab === 'narration'
              ? 'Describe the video content...'
              : 'e.g., Show git workflow with commits and branches'
          }
          value={store.description}
          onChange={(e) => store.setDescription(e.target.value)}
          disabled={isProcessing}
        />
      </div>

      {/* Generate / Cancel */}
      <div className="record-controls">
        {!isProcessing && (
          <button
            className="record-btn start"
            onClick={handleGenerate}
            disabled={!store.apiKey.trim() || !store.description.trim()}
          >
            Generate
          </button>
        )}
        {isProcessing && (
          <button className="record-btn stop" onClick={handleCancel}>
            Cancel
          </button>
        )}
      </div>

      {/* Processing indicator */}
      {isProcessing && (
        <div className="script-status">
          Generating {status.task === 'narration' ? 'narration' : 'script'}...
        </div>
      )}

      {/* Result */}
      {status.status === 'completed' && (
        <div className="result-box">
          <div className="ai-result-header">
            <p>Generation complete</p>
            <button className="reset-btn" onClick={handleReset}>
              Clear
            </button>
          </div>
          <pre className="ai-result">{status.result}</pre>
          {store.activeTab === 'narration' && (
            <div className="caption-controls">
              <button className="caption-btn apply" onClick={handleApplyCaption}>
                Apply as Caption
              </button>
              <button className="caption-btn clear" onClick={handleClearCaption}>
                Clear Caption
              </button>
            </div>
          )}
          {store.activeTab === 'script' && (
            <div className="script-run-controls">
              <button className="script-run-btn" onClick={handleRunScript}>
                Run Script
              </button>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {status.status === 'failed' && (
        <div className="error-box">
          <p>{status.error}</p>
          <button className="reset-btn" onClick={handleReset}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
