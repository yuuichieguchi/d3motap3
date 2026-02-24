import { useCallback } from 'react'
import { useEditorStore } from '../store/editor'

export function Timeline() {
  const store = useEditorStore()
  const clips = [...store.project.clips].sort((a, b) => a.order - b.order)
  const totalDuration = store.totalDuration()
  const overlays = store.project.textOverlays

  const handleClipClick = useCallback((clipId: string) => {
    store.selectClip(clipId)
  }, [store])

  const handleOverlayClick = useCallback((overlayId: string) => {
    store.selectOverlay(overlayId)
  }, [store])

  const handleRemoveClip = useCallback((e: React.MouseEvent, clipId: string) => {
    e.stopPropagation()
    store.removeClip(clipId)
  }, [store])

  const handleRemoveOverlay = useCallback((e: React.MouseEvent, overlayId: string) => {
    e.stopPropagation()
    store.removeTextOverlay(overlayId)
  }, [store])

  const handleTransitionClick = useCallback((e: React.MouseEvent, clipId: string) => {
    e.stopPropagation()
    const clip = store.project.clips.find((c) => c.id === clipId)
    if (!clip) return
    
    if (clip.transition) {
      // Cycle through transition types
      const types = ['fade', 'dissolve', 'wipe_left', 'wipe_right'] as const
      const currentIndex = types.indexOf(clip.transition.type)
      const nextIndex = (currentIndex + 1) % types.length
      store.setTransition(clipId, types[nextIndex], clip.transition.duration)
    } else {
      store.setTransition(clipId, 'fade', 500)
    }
  }, [store])

  if (clips.length === 0) {
    return (
      <div className="timeline">
        <div className="timeline-empty">
          No clips in timeline
        </div>
      </div>
    )
  }

  // Calculate clip widths proportional to duration
  const getClipWidth = (clip: typeof clips[0]) => {
    if (totalDuration <= 0) return 0
    const clipDuration = clip.originalDuration - clip.trimStart - clip.trimEnd
    return (clipDuration / totalDuration) * 100
  }

  // Playhead position
  const playheadPosition = totalDuration > 0 ? (store.currentTimeMs / totalDuration) * 100 : 0

  return (
    <div className="timeline">
      {/* Clip track */}
      <div className="timeline-track clip-track">
        {/* Playhead */}
        <div
          className="timeline-playhead"
          style={{ left: `${playheadPosition}%` }}
        />

        {clips.map((clip, index) => {
          const width = getClipWidth(clip)
          const isSelected = store.selectedClipId === clip.id
          const thumbnails = store.clipThumbnails.get(clip.id)
          const isLastClip = index === clips.length - 1

          return (
            <div key={clip.id} className="timeline-clip-wrapper" style={{ width: `${width}%` }}>
              <div
                className={`timeline-clip ${isSelected ? 'selected' : ''}`}
                onClick={() => handleClipClick(clip.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  handleRemoveClip(e, clip.id)
                }}
                title={`${clip.sourcePath.split('/').pop()} (${Math.round(clip.originalDuration - clip.trimStart - clip.trimEnd)}ms)`}
              >
                {/* Thumbnail strip */}
                {thumbnails && thumbnails.length > 0 && (
                  <div className="clip-thumbnails">
                    {thumbnails.slice(0, 5).map((url, i) => (
                      <img key={i} src={url} alt="" className="clip-thumb" />
                    ))}
                  </div>
                )}
                {!thumbnails && (
                  <div className="clip-label">
                    {clip.sourcePath.split('/').pop()?.slice(0, 12) ?? 'clip'}
                  </div>
                )}
              </div>

              {/* Transition indicator between clips */}
              {!isLastClip && (
                <div
                  className={`transition-indicator ${clip.transition ? 'has-transition' : ''}`}
                  onClick={(e) => handleTransitionClick(e, clip.id)}
                  title={clip.transition ? `${clip.transition.type} (${clip.transition.duration}ms) - click to change` : 'Click to add transition'}
                >
                  {clip.transition ? clip.transition.type[0].toUpperCase() : '+'}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Text overlay track */}
      {overlays.length > 0 && (
        <div className="timeline-track overlay-track">
          {overlays.map((overlay) => {
            const left = totalDuration > 0 ? (overlay.startTime / totalDuration) * 100 : 0
            const width = totalDuration > 0 ? ((overlay.endTime - overlay.startTime) / totalDuration) * 100 : 0
            const isSelected = store.selectedOverlayId === overlay.id

            return (
              <div
                key={overlay.id}
                className={`timeline-overlay ${isSelected ? 'selected' : ''}`}
                style={{ left: `${left}%`, width: `${width}%` }}
                onClick={() => handleOverlayClick(overlay.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  handleRemoveOverlay(e, overlay.id)
                }}
                title={`"${overlay.text}" (${Math.round(overlay.startTime)}ms - ${Math.round(overlay.endTime)}ms)`}
              >
                <span className="overlay-text-label">{overlay.text}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
