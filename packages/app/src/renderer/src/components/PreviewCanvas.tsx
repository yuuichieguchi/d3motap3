import { useMemo } from 'react'
import { usePreviewStream } from '../hooks/usePreviewStream'
import { useSourcesStore } from '../store/sources'

const MAX_PREVIEW_DIM = 960

export function PreviewCanvas() {
  const activeSources = useSourcesStore((s) => s.activeSources)
  const hasActiveSources = activeSources.length > 0

  const { maxWidth, maxHeight } = useMemo(() => {
    if (activeSources.length === 0) {
      return { maxWidth: MAX_PREVIEW_DIM, maxHeight: 540 }
    }

    // Use the first source's aspect ratio to determine preview dimensions.
    // For multi-source layouts the compositor handles compositing,
    // but we size the canvas to the primary source's aspect ratio.
    const primary = activeSources[0]
    const srcW = primary.width || 1920
    const srcH = primary.height || 1080
    const aspect = srcW / srcH

    if (aspect >= 1) {
      // Landscape or square
      return { maxWidth: MAX_PREVIEW_DIM, maxHeight: Math.round(MAX_PREVIEW_DIM / aspect) }
    } else {
      // Portrait
      return { maxWidth: Math.round(MAX_PREVIEW_DIM * aspect), maxHeight: MAX_PREVIEW_DIM }
    }
  }, [activeSources])

  const { canvasRef } = usePreviewStream({
    maxWidth,
    maxHeight,
    enabled: hasActiveSources,
  })

  return (
    <div className="preview-canvas-container">
      {hasActiveSources ? (
        <canvas
          ref={canvasRef}
          className="preview-canvas-element"
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            aspectRatio: `${maxWidth} / ${maxHeight}`,
          }}
        />
      ) : (
        <div className="preview-placeholder">
          <p>Add a source to see preview</p>
        </div>
      )}
    </div>
  )
}
