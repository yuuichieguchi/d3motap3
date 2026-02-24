import { useRef, useCallback, useEffect } from 'react'
import { useEditorStore } from '../store/editor'
import { Timeline } from './Timeline'
import { TextOverlayEditor } from './TextOverlayEditor'

export function EditorView() {
  const store = useEditorStore()
  const videoRef = useRef<HTMLVideoElement>(null)
  const playbackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Get the clip at the current playback position
  const getClipAtTime = useCallback((timeMs: number) => {
    const clips = [...store.project.clips].sort((a, b) => a.order - b.order)
    let accumulated = 0
    for (const clip of clips) {
      const clipDuration = clip.originalDuration - clip.trimStart - clip.trimEnd
      if (timeMs < accumulated + clipDuration) {
        return {
          clip,
          clipStartTime: accumulated,
          localTime: timeMs - accumulated + clip.trimStart,
        }
      }
      accumulated += clipDuration
    }
    return null
  }, [store.project.clips])

  // Update video element when current time changes
  useEffect(() => {
    if (!videoRef.current) return
    const result = getClipAtTime(store.currentTimeMs)
    if (result) {
      // Check if we need to change the source
      if (videoRef.current.src !== result.clip.sourcePath) {
        videoRef.current.src = result.clip.sourcePath
      }
      videoRef.current.currentTime = result.localTime / 1000
    }
  }, [store.currentTimeMs, getClipAtTime])

  // Playback timer
  useEffect(() => {
    if (store.isPlaying) {
      playbackIntervalRef.current = setInterval(() => {
        const totalDuration = store.totalDuration()
        const newTime = store.currentTimeMs + 33 // ~30fps playback
        if (newTime >= totalDuration) {
          store.setCurrentTime(0)
          store.setPlaying(false)
        } else {
          store.setCurrentTime(newTime)
        }
      }, 33)
    } else {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current)
        playbackIntervalRef.current = null
      }
    }
    return () => {
      if (playbackIntervalRef.current) clearInterval(playbackIntervalRef.current)
    }
  }, [store.isPlaying])

  const handlePlayPause = useCallback(() => {
    store.setPlaying(!store.isPlaying)
  }, [store])

  const handleImport = useCallback(async () => {
    await store.importFile()
  }, [store])

  const handleAddText = useCallback(() => {
    const totalDuration = store.totalDuration()
    if (totalDuration <= 0) return
    const start = store.currentTimeMs
    const end = Math.min(start + 3000, totalDuration) // Default 3s overlay
    store.addTextOverlay('Text', start, end)
  }, [store])

  const handleSplit = useCallback(() => {
    if (!store.selectedClipId) return
    const result = getClipAtTime(store.currentTimeMs)
    if (result && result.clip.id === store.selectedClipId) {
      store.splitClip(store.selectedClipId, result.localTime)
    }
  }, [store, getClipAtTime])

  const handleExport = useCallback(async () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `d3motap3-edit-${timestamp}.mp4`
    // The path will be resolved by the export handler
    try {
      await store.startExport(filename)
    } catch (err) {
      console.error('Failed to start export:', err)
    }
  }, [store])

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    store.setCurrentTime(Number(e.target.value))
  }, [store])

  const totalDuration = store.totalDuration()

  function formatTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }

  return (
    <div className="editor-view">
      {/* Header */}
      <div className="editor-header">
        <h2>Editor</h2>
        <button
          className="editor-export-btn"
          onClick={handleExport}
          disabled={store.project.clips.length === 0 || store.exportStatus.status === 'exporting'}
        >
          Export
        </button>
      </div>

      {/* Video Preview */}
      <div className="editor-preview">
        {store.project.clips.length > 0 && (
          <video
            ref={videoRef}
            className="editor-video"
            controls={false}
            muted
          />
        )}
        {store.project.clips.length === 0 && (
          <div className="editor-empty-state">
            <p>No clips added</p>
            <button onClick={handleImport}>Import Video</button>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="editor-toolbar">
        <button onClick={handleImport}>+ Clip</button>
        <button onClick={handleAddText} disabled={totalDuration <= 0}>+ Text</button>
        <button onClick={handleSplit} disabled={!store.selectedClipId}>Split</button>
      </div>

      {/* Playback controls */}
      {totalDuration > 0 && (
        <div className="editor-playback">
          <button className="play-btn" onClick={handlePlayPause}>
            {store.isPlaying ? '⏸' : '▶'}
          </button>
          <span className="time-display">{formatTime(store.currentTimeMs)}</span>
          <input
            type="range"
            className="seek-bar"
            min={0}
            max={totalDuration}
            value={store.currentTimeMs}
            onChange={handleSeek}
          />
          <span className="time-display">{formatTime(totalDuration)}</span>
        </div>
      )}

      {/* Timeline */}
      <Timeline />

      {/* Text overlay editor */}
      <TextOverlayEditor />

      {/* Export status */}
      {store.exportStatus.status === 'exporting' && (
        <div className="export-progress-bar">
          <div
            className="export-progress-fill"
            style={{ width: `${store.exportStatus.progress}%` }}
          />
          <span>Exporting... {store.exportStatus.progress}%</span>
        </div>
      )}
      {store.exportStatus.status === 'completed' && (
        <div className="result-box">Export completed</div>
      )}
      {store.exportStatus.status === 'failed' && (
        <div className="error-box">Export failed: {store.exportStatus.error}</div>
      )}
    </div>
  )
}
