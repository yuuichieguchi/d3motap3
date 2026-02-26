import { useRef, useCallback, useEffect } from 'react'
import { useEditorStore } from '../store/editor'
import { Timeline } from './Timeline'
import { TextOverlayEditor } from './TextOverlayEditor'

export function EditorView() {
  const store = useEditorStore()
  const videoRef = useRef<HTMLVideoElement>(null)
  const currentSourcePathRef = useRef<string | null>(null)
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
    const isPlaying = useEditorStore.getState().isPlaying
    const result = getClipAtTime(store.currentTimeMs)
    if (result) {
      const clipChanged = currentSourcePathRef.current !== result.clip.sourcePath
      if (clipChanged) {
        currentSourcePathRef.current = result.clip.sourcePath
        videoRef.current.src = `media://local${result.clip.sourcePath}`
        videoRef.current.currentTime = result.localTime / 1000
        if (isPlaying) {
          videoRef.current.play()
        }
      } else if (!isPlaying) {
        // Only seek when not playing (user scrubbing the timeline)
        videoRef.current.currentTime = result.localTime / 1000
      }
    } else {
      currentSourcePathRef.current = null
    }
  }, [store.currentTimeMs, getClipAtTime])

  // Playback: video.play()/pause() + setInterval for UI timeline sync
  useEffect(() => {
    if (store.isPlaying) {
      if (videoRef.current) {
        videoRef.current.play()
      }
      playbackIntervalRef.current = setInterval(() => {
        const state = useEditorStore.getState()
        const totalDuration = state.totalDuration()
        const newTime = state.currentTimeMs + 33 // ~30fps UI update
        if (newTime >= totalDuration) {
          state.setCurrentTime(0)
          state.setPlaying(false)
        } else {
          state.setCurrentTime(newTime)
        }
      }, 33)
    } else {
      if (videoRef.current) {
        videoRef.current.pause()
      }
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
    if (!store.lastSelectedClipId) return
    const result = getClipAtTime(store.currentTimeMs)
    if (result && result.clip.id === store.lastSelectedClipId) {
      store.splitClip(store.lastSelectedClipId, result.localTime)
    }
  }, [store, getClipAtTime])

  const handleExport = useCallback(async () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const defaultFilename = `d3motap3-edit-${timestamp}.mp4`
    try {
      const outputPath = await window.api.invoke('dialog:save-file', {
        defaultDir: 'videos',
        defaultFilename,
        filters: [{ name: 'Video Files', extensions: ['mp4'] }],
      }) as string | null
      if (!outputPath) return
      await store.startExport(outputPath)
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
        <button onClick={handleSplit} disabled={!store.lastSelectedClipId}>Split</button>
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
        <div className="result-box">
          <p>Export completed</p>
          {store.exportOutputPath && (
            <>
              <p className="result-path">{store.exportOutputPath}</p>
              <button
                className="show-in-finder-btn"
                onClick={() => { window.api.invoke('shell:show-item-in-folder', store.exportOutputPath!).catch(() => {}) }}
              >
                Show in Finder
              </button>
            </>
          )}
        </div>
      )}
      {store.exportStatus.status === 'failed' && (
        <div className="error-box">Export failed: {store.exportStatus.error}</div>
      )}
    </div>
  )
}
