import { useEffect, useRef, useCallback } from 'react'
import { useRecordingStore } from './store/recording'
import { SourcePanel } from './components/SourcePanel'
import { LayoutSelector } from './components/LayoutSelector'
import { ScriptPanel } from './components/ScriptPanel'
import { PreviewCanvas } from './components/PreviewCanvas'

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

export function App() {
  const store = useRecordingStore()
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load displays and check FFmpeg on mount
  useEffect(() => {
    const init = async () => {
      try {
        const available = await window.api.invoke('system:ffmpeg-available') as boolean
        store.setFfmpegAvailable(available)

        if (available) {
          const displays = await window.api.invoke('recording:list-displays') as Array<{ id: number; width: number; height: number }>
          store.setDisplays(displays)
        }
      } catch (err) {
        store.setError(err instanceof Error ? err.message : String(err))
      }
    }
    init()
  }, [])

  // Poll elapsed time while recording
  useEffect(() => {
    if (store.status === 'recording') {
      elapsedIntervalRef.current = setInterval(async () => {
        try {
          const elapsed = await window.api.invoke('recording:elapsed') as number
          store.setElapsedMs(elapsed)
        } catch {
          // ignore polling errors
        }
      }, 200)
    } else {
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current)
        elapsedIntervalRef.current = null
      }
    }
    return () => {
      if (elapsedIntervalRef.current) {
        clearInterval(elapsedIntervalRef.current)
      }
    }
  }, [store.status])

  const handleStartRecording = useCallback(async () => {
    try {
      store.setError(null)
      const display = store.displays[store.selectedDisplayIndex]
      if (!display) {
        store.setError('No display selected')
        return
      }

      const outputPath = await window.api.invoke('recording:start', {
        displayIndex: store.selectedDisplayIndex,
        width: display.width,
        height: display.height,
        fps: store.fps,
        format: store.format,
        quality: store.quality,
      }) as string

      store.setOutputPath(outputPath)
      store.setStatus('recording')
      store.setElapsedMs(0)
    } catch (err) {
      store.setError(err instanceof Error ? err.message : String(err))
    }
  }, [store])

  const handleStopRecording = useCallback(async () => {
    try {
      store.setStatus('processing')
      const result = await window.api.invoke('recording:stop') as {
        outputPath: string
        frameCount: number
        durationMs: number
        format: string
      }
      store.setLastResult(result)
      store.setStatus('idle')
    } catch (err) {
      store.setError(err instanceof Error ? err.message : String(err))
      store.setStatus('idle')
    }
  }, [store])

  const isRecording = store.status === 'recording'
  const isProcessing = store.status === 'processing'
  const canRecord = store.ffmpegAvailable === true && store.displays.length > 0

  return (
    <div className="app">
      <header className="app-header">
        <h1>d3motap3</h1>
        <span className={`status-badge ${store.status}`}>{store.status}</span>
      </header>
      <main className="app-main">
        {/* Left sidebar: Sources + Layout + Recording controls */}
        <div className="sidebar">
          <SourcePanel />
          <LayoutSelector />
          <ScriptPanel />

          {/* Existing recording controls section */}
          <div className="recording-section">
            <h3>Recording</h3>

            {store.ffmpegAvailable === false && (
              <div className="error-box">
                FFmpeg not found. Install with: brew install ffmpeg
              </div>
            )}

            {store.error && (
              <div className="error-box">{store.error}</div>
            )}

            {/* Display selector */}
            <div className="control-group">
              <label>Display</label>
              <select
                value={store.selectedDisplayIndex}
                onChange={(e) => store.setSelectedDisplayIndex(Number(e.target.value))}
                disabled={isRecording || isProcessing}
              >
                {store.displays.map((d, i) => (
                  <option key={d.id} value={i}>
                    Display {i + 1} ({d.width}x{d.height})
                  </option>
                ))}
                {store.displays.length === 0 && (
                  <option value={0}>No displays detected</option>
                )}
              </select>
            </div>

            {/* FPS / Format / Quality selectors */}
            <div className="control-group">
              <label>FPS</label>
              <select value={store.fps} onChange={(e) => store.setFps(Number(e.target.value))} disabled={isRecording || isProcessing}>
                <option value={15}>15</option>
                <option value={24}>24</option>
                <option value={30}>30</option>
                <option value={60}>60</option>
              </select>
            </div>

            <div className="control-group">
              <label>Format</label>
              <select value={store.format} onChange={(e) => store.setFormat(e.target.value)} disabled={isRecording || isProcessing}>
                <option value="mp4">MP4</option>
                <option value="gif">GIF</option>
                <option value="webm">WebM</option>
              </select>
            </div>

            <div className="control-group">
              <label>Quality</label>
              <select value={store.quality} onChange={(e) => store.setQuality(e.target.value)} disabled={isRecording || isProcessing}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>

            {/* Record buttons */}
            <div className="record-controls">
              {!isRecording && !isProcessing && (
                <button className="record-btn start" onClick={handleStartRecording} disabled={!canRecord}>
                  Start Recording
                </button>
              )}
              {isRecording && (
                <button className="record-btn stop" onClick={handleStopRecording}>
                  Stop Recording
                </button>
              )}
              {isProcessing && (
                <button className="record-btn processing" disabled>
                  Processing...
                </button>
              )}
            </div>

            {/* Elapsed time */}
            {isRecording && (
              <div className="elapsed-time">
                <span className="recording-dot" />
                {formatTime(store.elapsedMs)}
              </div>
            )}

            {/* Last result */}
            {store.lastResult && store.status === 'idle' && (
              <div className="result-box">
                <p>Recording saved</p>
                <p className="result-path">{store.lastResult.outputPath}</p>
                <p className="result-details">
                  {store.lastResult.frameCount} frames | {formatTime(store.lastResult.durationMs)} | {store.lastResult.format.toUpperCase()}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right main area: Preview */}
        <div className="preview-panel">
          <h2>Preview</h2>
          <PreviewCanvas />
          {isRecording && (
            <div className="recording-indicator">
              <span className="recording-dot large" />
              <span>{formatTime(store.elapsedMs)}</span>
            </div>
          )}
        </div>
      </main>
      <footer className="app-footer">
        <p>
          {store.ffmpegAvailable === true ? 'FFmpeg ready' : store.ffmpegAvailable === false ? 'FFmpeg not found' : 'Checking FFmpeg...'}
          {store.outputPath && ` | Output: ${store.outputPath}`}
        </p>
      </footer>
    </div>
  )
}
