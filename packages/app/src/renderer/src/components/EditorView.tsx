import { useState, useRef, useCallback, useEffect } from 'react'
import { useEditorStore, consumeUserSeek } from '../store/editor'
import { useAudioPlayback } from '../hooks/useAudioPlayback'
import { useIndependentAudioPlayback } from '../hooks/useIndependentAudioPlayback'
import { Timeline } from './Timeline'
import { TextOverlayEditor } from './TextOverlayEditor'

export function EditorView() {
  const store = useEditorStore()
  const videoRef = useRef<HTMLVideoElement>(null)
  const currentSourcePathRef = useRef<string | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  const getSharedAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext()
    }
    return audioContextRef.current
  }, [])
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

  // Get active clip's bundle info for audio playback
  const activeClipResult = getClipAtTime(store.currentTimeMs)
  const activeBundle = activeClipResult?.clip.bundlePath
    ? {
        bundlePath: activeClipResult.clip.bundlePath,
        audioTracks: activeClipResult.clip.audioTracks,
        mixerSettings: activeClipResult.clip.mixerSettings,
      }
    : undefined

  // Web Audio API playback for .d3m bundles
  useAudioPlayback({
    videoRef,
    audioTracks: activeBundle?.audioTracks,
    mixerSettings: activeBundle?.mixerSettings,
    bundlePath: activeBundle?.bundlePath,
    isPlaying: store.isPlaying,
    currentTimeMs: activeClipResult?.localTime ?? 0,
  })

  // Independent audio playback
  useIndependentAudioPlayback({
    audioContext: store.project.independentAudioTracks.length > 0 ? getSharedAudioContext() : null,
    tracks: store.project.independentAudioTracks,
    isPlaying: store.isPlaying,
    currentTimeMs: store.currentTimeMs,
  })

  const isBundleClip = !!activeBundle

  // Update video element when current time changes
  useEffect(() => {
    if (!videoRef.current) return
    const isPlaying = useEditorStore.getState().isPlaying
    const result = getClipAtTime(store.currentTimeMs)
    if (result) {
      const clipChanged = currentSourcePathRef.current !== result.clip.sourcePath
      if (clipChanged) {
        consumeUserSeek()
        currentSourcePathRef.current = result.clip.sourcePath
        videoRef.current.src = `media://local${result.clip.sourcePath}`
        videoRef.current.currentTime = result.localTime / 1000
        if (isPlaying) {
          videoRef.current.play()
        }
      } else if (!isPlaying) {
        // Seek when not playing (user scrubbing the timeline)
        videoRef.current.currentTime = result.localTime / 1000
      } else if (consumeUserSeek()) {
        // Seek during playback (user operated seek bar or timeline)
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

  const deleteSelected = useCallback(() => {
    const s = useEditorStore.getState()
    if (s.selectedOverlayId) {
      s.removeTextOverlay(s.selectedOverlayId)
    } else if (s.selectedAudioClipIds.length > 0) {
      s.removeSelectedAudioClips()
    } else {
      s.removeSelectedClips()
    }
  }, [])

  // Menu Edit action handler (IPC from native menu)
  useEffect(() => {
    const unsubscribe = window.api.on('menu:edit-action', (...args: unknown[]) => {
      const action = args[0] as string
      const active = document.activeElement
      const isTextInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable)
      if (isTextInput && action !== 'split') return

      switch (action) {
        case 'copy':
          if (useEditorStore.getState().selectedAudioClipIds.length > 0) {
            useEditorStore.getState().copySelectedAudioClips()
          } else {
            useEditorStore.getState().copySelectedClips()
          }
          break
        case 'cut':
          if (useEditorStore.getState().selectedAudioClipIds.length > 0) {
            useEditorStore.getState().cutSelectedAudioClips()
          } else {
            useEditorStore.getState().cutSelectedClips()
          }
          break
        case 'paste':
          if (useEditorStore.getState().clipboardAudioClips) {
            useEditorStore.getState().pasteAudioClips()
          } else {
            useEditorStore.getState().pasteClips()
          }
          break
        case 'split':
          useEditorStore.getState().splitAtPlayhead()
          break
        case 'delete':
          deleteSelected()
          break
        case 'undo':
          useEditorStore.temporal.getState().undo()
          break
        case 'redo':
          useEditorStore.temporal.getState().redo()
          break
      }
    })
    return unsubscribe
  }, [deleteSelected])

  // Keyboard shortcuts for clip operations
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement
      const isTextInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable)

      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (isTextInput) return
        e.preventDefault()
        deleteSelected()
        return
      }

      if (!e.metaKey && !e.ctrlKey) return
      if (isTextInput) return

      switch (e.key) {
        case 'c':
          e.preventDefault()
          if (useEditorStore.getState().selectedAudioClipIds.length > 0) {
            useEditorStore.getState().copySelectedAudioClips()
          } else {
            useEditorStore.getState().copySelectedClips()
          }
          break
        case 'x':
          e.preventDefault()
          if (useEditorStore.getState().selectedAudioClipIds.length > 0) {
            useEditorStore.getState().cutSelectedAudioClips()
          } else {
            useEditorStore.getState().cutSelectedClips()
          }
          break
        case 'v':
          e.preventDefault()
          if (useEditorStore.getState().clipboardAudioClips) {
            useEditorStore.getState().pasteAudioClips()
          } else {
            useEditorStore.getState().pasteClips()
          }
          break
        case 'b':
          e.preventDefault()
          useEditorStore.getState().splitAtPlayhead()
          break
        case 'z':
          e.preventDefault()
          if (e.shiftKey) {
            useEditorStore.temporal.getState().redo()
          } else {
            useEditorStore.temporal.getState().undo()
          }
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [deleteSelected])

  // Mixer window state sync
  useEffect(() => {
    const sendMixerState = () => {
      const s = useEditorStore.getState()
      const clip = s.project.clips.find((c) => c.bundlePath && c.mixerSettings)
      const tracks: Array<{ id: string; label: string }> = []
      const settings: Array<{ trackId: string; volume: number; muted: boolean }> = []
      let clipId = ''

      if (clip && clip.mixerSettings && clip.audioTracks) {
        clipId = clip.id
        for (const t of clip.audioTracks) {
          tracks.push({ id: t.id, label: t.label })
        }
        for (const st of clip.mixerSettings.tracks) {
          settings.push(st)
        }
      }

      // Include independent audio tracks
      for (const t of s.project.independentAudioTracks) {
        tracks.push({ id: `ind-${t.id}`, label: t.label })
        settings.push({ trackId: `ind-${t.id}`, volume: t.volume, muted: t.muted })
      }

      if (tracks.length > 0) {
        window.api.invoke('mixer:respond-state', {
          clipId: clipId || 'independent',
          tracks,
          settings,
        }).catch(() => {})
      } else {
        window.api.invoke('mixer:respond-state', null).catch(() => {})
      }
    }

    const unsubGetState = window.api.on('mixer:get-state', () => {
      sendMixerState()
    })

    const unsubUpdate = window.api.on('mixer:update', (...args: unknown[]) => {
      const data = args[0] as { type: string; clipId: string; trackId: string; value: number | boolean }
      const s = useEditorStore.getState()
      // Check if this is an independent audio track update
      if (data.trackId.startsWith('ind-')) {
        const realTrackId = data.trackId.slice(4) // Remove 'ind-' prefix
        if (data.type === 'volume') {
          s.setAudioTrackVolume(realTrackId, data.value as number)
        } else if (data.type === 'muted') {
          s.setAudioTrackMuted(realTrackId, data.value as boolean)
        }
      } else {
        if (data.type === 'volume') {
          s.setTrackVolume(data.clipId, data.trackId, data.value as number)
        } else if (data.type === 'muted') {
          s.setTrackMuted(data.clipId, data.trackId, data.value as boolean)
        }
      }
    })

    const unsubStore = useEditorStore.subscribe((state, prevState) => {
      if (state.project.clips !== prevState.project.clips || state.project.independentAudioTracks !== prevState.project.independentAudioTracks) {
        sendMixerState()
      }
    })

    return () => {
      unsubGetState()
      unsubUpdate()
      unsubStore()
    }
  }, [])

  const handlePlayPause = useCallback(() => {
    store.setPlaying(!store.isPlaying)
  }, [store])

  const handleAddText = useCallback(() => {
    const totalDuration = store.totalDuration()
    if (totalDuration <= 0) return
    const start = Math.min(store.currentTimeMs, totalDuration - 100)
    const end = Math.min(start + 3000, totalDuration)
    store.addTextOverlay('Text', start, end, {
      x: 0.5,
      y: 0.9,
      textAlign: 'center',
      fontSize: 48,
      fontWeight: 'normal',
    })
  }, [store])

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

  const [isDragOver, setIsDragOver] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    const videoExts = ['.mp4', '.mov', '.webm', '.avi', '.mkv']
    const audioExts = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac']
    for (const file of files) {
      const filePath = window.webUtils?.getPathForFile(file)
      if (!filePath) continue
      const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'))
      if (videoExts.includes(ext)) {
        await store.addClip(filePath)
      } else if (audioExts.includes(ext)) {
        // Create a new track per file, using file name (no extension) as label
        const baseName = file.name.replace(/\.[^.]+$/, '')
        store.addAudioTrack(baseName)
        const tracks = useEditorStore.getState().project.independentAudioTracks
        const trackId = tracks[tracks.length - 1].id
        await useEditorStore.getState().addAudioClip(trackId, filePath)
      }
    }
  }, [store])

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    store.seekTo(Number(e.target.value))
  }, [store])

  const totalDuration = store.totalDuration()

  function formatTime(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }

  return (
    <div className="editor-view" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <div className="editor-main">
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
            <>
              <video
                ref={videoRef}
                className="editor-video"
                controls={false}
                muted={isBundleClip}
              />
              <div className="preview-overlay-container">
                {store.project.textOverlays
                  .filter((o) => store.currentTimeMs >= o.startTime && store.currentTimeMs <= o.endTime)
                  .map((o) => {
                    const progress = o.endTime > o.startTime ? (store.currentTimeMs - o.startTime) / (o.endTime - o.startTime) : 0
                    const duration = o.endTime - o.startTime
                    const animDurRatio = duration > 0 ? Math.min(o.animationDuration / duration, 0.5) : 0
                    let opacity = 1
                    let translateY = 0

                    if (o.animation === 'fade-in' && progress < animDurRatio) {
                      opacity = progress / animDurRatio
                    } else if (o.animation === 'fade-out' && progress > 1 - animDurRatio) {
                      opacity = (1 - progress) / animDurRatio
                    } else if (o.animation === 'fade-in-out') {
                      if (progress < animDurRatio) opacity = progress / animDurRatio
                      else if (progress > 1 - animDurRatio) opacity = (1 - progress) / animDurRatio
                    } else if (o.animation === 'slide-up' && progress < animDurRatio) {
                      translateY = 50 * (1 - progress / animDurRatio)
                    } else if (o.animation === 'slide-down' && progress < animDurRatio) {
                      translateY = -50 * (1 - progress / animDurRatio)
                    }

                    const isSelected = store.selectedOverlayId === o.id
                    return (
                      <div
                        key={o.id}
                        className={`preview-overlay-text ${isSelected ? 'selected' : ''}`}
                        style={{
                          position: 'absolute',
                          left: `${o.x * 100}%`,
                          top: `${o.y * 100}%`,
                          transform: `translate(${o.textAlign === 'center' ? '-50%' : o.textAlign === 'right' ? '-100%' : '0'}, ${translateY}px)`,
                          fontSize: `${o.fontSize * 0.3}px`,
                          fontFamily: o.fontFamily,
                          fontWeight: o.fontWeight,
                          fontStyle: o.fontStyle,
                          color: o.color,
                          textAlign: o.textAlign,
                          backgroundColor: o.backgroundColor ?? undefined,
                          padding: o.backgroundColor ? '2px 6px' : undefined,
                          WebkitTextStroke: o.borderColor ? `${o.borderWidth}px ${o.borderColor}` : undefined,
                          textShadow: o.shadowColor
                            ? `${o.shadowOffsetX}px ${o.shadowOffsetY}px 2px ${o.shadowColor}`
                            : undefined,
                          opacity,
                          whiteSpace: 'pre-wrap',
                          cursor: 'pointer',
                          pointerEvents: 'auto',
                        }}
                        onClick={(e) => { e.stopPropagation(); store.selectOverlay(o.id) }}
                      >
                        {o.text}
                      </div>
                    )
                  })}
              </div>
            </>
          )}
          {store.project.clips.length === 0 && (
            <div className="editor-empty-state">
              <p>No clips added</p>
              <p className="editor-empty-hint">
                Drop media files here, or ⌘O to open a project
              </p>
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="editor-toolbar">
          <button onClick={handleAddText} disabled={totalDuration <= 0}>+ Text</button>
          {(isBundleClip || store.project.independentAudioTracks.length > 0) && (
            <button className="editor-mixer-btn" onClick={() => window.api.invoke('mixer:open').catch(() => {})}>Mixer</button>
          )}
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
        <Timeline getAudioContext={getSharedAudioContext} />

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
            <button className="result-box-close-btn" onClick={() => store.dismissExportStatus()}>×</button>
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

        {isDragOver && (
          <div className="editor-drop-overlay">
            <p>Drop to import media</p>
          </div>
        )}
      </div>

      {/* Sidebar: Text overlay editor */}
      {store.selectedOverlayId && (
        <div className="editor-sidebar">
          <TextOverlayEditor />
        </div>
      )}
    </div>
  )
}
