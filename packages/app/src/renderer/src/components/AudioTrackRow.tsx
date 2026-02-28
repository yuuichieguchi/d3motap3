import { useCallback, useRef } from 'react'
import { useEditorStore } from '../store/editor'
import type { IndependentAudioTrack } from '@d3motap3/shared'

interface AudioTrackRowProps {
  track: IndependentAudioTrack
  totalDuration: number
  onContextMenu: (e: React.MouseEvent, clipId: string, trackId: string) => void
}

export function AudioTrackRow({ track, totalDuration, onContextMenu }: AudioTrackRowProps) {
  const store = useEditorStore()
  const rowRef = useRef<HTMLDivElement>(null)

  const handleClipClick = useCallback(
    (e: React.MouseEvent, clipId: string) => {
      e.stopPropagation()
      if (e.metaKey || e.ctrlKey) {
        store.selectAudioClip(clipId, 'toggle')
      } else {
        store.selectAudioClip(clipId, 'single')
      }
    },
    [store],
  )

  const handleMoveStart = useCallback(
    (e: React.MouseEvent, clipId: string) => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement
      if (target.classList.contains('trim-handle')) return

      e.preventDefault()
      e.stopPropagation()

      const clip = track.clips.find((c) => c.id === clipId)
      if (!clip || !rowRef.current) return

      const rowRect = rowRef.current.getBoundingClientRect()
      const startX = e.clientX
      const startMs = clip.timelineStartMs

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startX
        const msPerPx = totalDuration / rowRect.width
        const newStartMs = Math.max(0, startMs + dx * msPerPx)
        useEditorStore.getState().moveAudioClip(track.id, clipId, newStartMs)
      }

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
      }

      document.body.style.cursor = 'grabbing'
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    },
    [track, totalDuration],
  )

  const handleTrimStart = useCallback(
    (e: React.MouseEvent, clipId: string, side: 'left' | 'right') => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()

      const clip = track.clips.find((c) => c.id === clipId)
      if (!clip || !rowRef.current) return

      const rowRect = rowRef.current.getBoundingClientRect()
      const startX = e.clientX
      const origTrimStart = clip.trimStart
      const origTrimEnd = clip.trimEnd
      const origTimelineStart = clip.timelineStartMs

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startX
        const msPerPx = totalDuration / rowRect.width
        const deltaMs = dx * msPerPx

        if (side === 'left') {
          const newTrimStart = Math.max(0, Math.min(
            clip.originalDuration - origTrimEnd - 1,
            origTrimStart + deltaMs
          ))
          const newTimelineStart = origTimelineStart + (newTrimStart - origTrimStart)
          useEditorStore.getState().trimAudioClip(track.id, clipId, newTrimStart, origTrimEnd)
          useEditorStore.getState().moveAudioClip(track.id, clipId, newTimelineStart)
        } else {
          const newTrimEnd = Math.max(0, Math.min(
            clip.originalDuration - origTrimStart - 1,
            origTrimEnd - deltaMs
          ))
          useEditorStore.getState().trimAudioClip(track.id, clipId, origTrimStart, newTrimEnd)
        }
      }

      const handleMouseUp = () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
      }

      document.body.style.cursor = 'col-resize'
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    },
    [track, totalDuration],
  )

  if (totalDuration <= 0) return null

  return (
    <div className="timeline-row audio-track-row independent">
      <div className="timeline-row-label">
        <span className="audio-track-icon">{track.muted ? '\u{1F507}' : '\u{1F50A}'}</span>
        <span>{track.label}</span>
      </div>
      <div className="timeline-row-content" ref={rowRef} style={{ position: 'relative' }}>
        {track.clips.map((clip) => {
          const clipDuration = clip.originalDuration - clip.trimStart - clip.trimEnd
          const left = (clip.timelineStartMs / totalDuration) * 100
          const width = (clipDuration / totalDuration) * 100
          const isSelected = store.selectedAudioClipIds.includes(clip.id)

          return (
            <div
              key={clip.id}
              className={`independent-audio-clip ${isSelected ? 'selected' : ''}`}
              style={{
                position: 'absolute',
                left: `${left}%`,
                width: `${width}%`,
                height: '100%',
              }}
              onClick={(e) => handleClipClick(e, clip.id)}
              onMouseDown={(e) => handleMoveStart(e, clip.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (!store.selectedAudioClipIds.includes(clip.id)) {
                  store.selectAudioClip(clip.id, 'single')
                }
                onContextMenu(e, clip.id, track.id)
              }}
              title={`${clip.sourcePath.split('/').pop()} (${Math.round(clipDuration)}ms)`}
            >
              <div
                className="trim-handle left"
                onMouseDown={(e) => handleTrimStart(e, clip.id, 'left')}
              />
              <span className="audio-clip-label">
                {clip.sourcePath.split('/').pop()?.slice(0, 16) ?? 'audio'}
              </span>
              <div
                className="trim-handle right"
                onMouseDown={(e) => handleTrimStart(e, clip.id, 'right')}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
