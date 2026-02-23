import { usePreviewStream } from '../hooks/usePreviewStream'
import { useSourcesStore } from '../store/sources'

const PREVIEW_WIDTH = 960
const PREVIEW_HEIGHT = 540

export function PreviewCanvas() {
  const activeSources = useSourcesStore((s) => s.activeSources)
  const hasActiveSources = activeSources.length > 0

  const { canvasRef } = usePreviewStream({
    maxWidth: PREVIEW_WIDTH,
    maxHeight: PREVIEW_HEIGHT,
    enabled: hasActiveSources,
  })

  return (
    <div className="preview-canvas-container">
      {hasActiveSources ? (
        <canvas
          ref={canvasRef}
          className="preview-canvas-element"
          style={{
            width: '100%',
            maxWidth: PREVIEW_WIDTH,
            aspectRatio: `${PREVIEW_WIDTH} / ${PREVIEW_HEIGHT}`,
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
