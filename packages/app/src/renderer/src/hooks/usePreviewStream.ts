import { useEffect, useRef, useCallback, useState } from 'react'

interface PreviewStreamOptions {
  maxWidth: number
  maxHeight: number
  enabled: boolean
}

export function usePreviewStream({ maxWidth, maxHeight, enabled }: PreviewStreamOptions) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })

  const renderFrame = useCallback(async () => {
    if (!enabled || !canvasRef.current) return

    try {
      const frameBuffer = await window.api.invoke('preview:frame', maxWidth, maxHeight) as ArrayBuffer | null

      if (frameBuffer && canvasRef.current) {
        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        // Set canvas dimensions to match preview
        if (canvas.width !== maxWidth || canvas.height !== maxHeight) {
          canvas.width = maxWidth
          canvas.height = maxHeight
          setDimensions({ width: maxWidth, height: maxHeight })
        }

        // Convert BGRA buffer to RGBA for Canvas ImageData
        const data = new Uint8ClampedArray(frameBuffer)
        for (let i = 0; i < data.length; i += 4) {
          const b = data[i]
          data[i] = data[i + 2]     // R = B
          data[i + 2] = b           // B = R
          // G and A stay the same
        }

        const imageData = new ImageData(data, maxWidth, maxHeight)
        ctx.putImageData(imageData, 0, 0)
      }
    } catch {
      // Ignore frame fetch errors
    }
  }, [enabled, maxWidth, maxHeight])

  useEffect(() => {
    if (!enabled) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      return
    }

    // Poll at ~15fps using setTimeout + requestAnimationFrame
    let running = true
    const FRAME_INTERVAL = 1000 / 15

    const loop = () => {
      if (!running) return
      renderFrame()
      setTimeout(() => {
        if (running) {
          rafRef.current = requestAnimationFrame(loop)
        }
      }, FRAME_INTERVAL)
    }

    rafRef.current = requestAnimationFrame(loop)

    return () => {
      running = false
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [enabled, renderFrame])

  return { canvasRef, dimensions }
}
