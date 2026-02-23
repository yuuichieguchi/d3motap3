import { useCallback } from 'react'
import { useAiStore } from '../store/ai'

export function AiPanel() {
  const store = useAiStore()
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
