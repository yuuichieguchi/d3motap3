import { useRef, useEffect } from 'react'

interface WaveformCanvasProps {
  peaks: Float32Array | null
  color: string
  trimStartRatio?: number
  trimEndRatio?: number
}

export function WaveformCanvas({ peaks, color, trimStartRatio = 0, trimEndRatio = 1 }: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peaksRef = useRef(peaks)
  peaksRef.current = peaks

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const draw = () => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      const w = rect.width
      const h = rect.height

      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.scale(dpr, dpr)

      ctx.clearRect(0, 0, w, h)

      const p = peaksRef.current
      if (!p || p.length === 0) return

      const startIdx = Math.floor(trimStartRatio * p.length)
      const endIdx = Math.ceil(trimEndRatio * p.length)
      const visibleCount = endIdx - startIdx
      if (visibleCount <= 0) return

      ctx.fillStyle = color
      const centerY = h / 2
      const barWidth = w / visibleCount
      const maxBarHeight = h * 0.9  // leave small margin

      for (let i = 0; i < visibleCount; i++) {
        const peakVal = p[startIdx + i]
        const barHeight = peakVal * maxBarHeight
        const halfBar = barHeight / 2
        const x = i * barWidth

        // Draw mirrored bar from center
        ctx.fillRect(x, centerY - halfBar, Math.max(barWidth - 0.5, 0.5), barHeight || 0.5)
      }
    }

    draw()

    const observer = new ResizeObserver(() => {
      draw()
    })
    observer.observe(canvas)

    return () => observer.disconnect()
  }, [peaks, color, trimStartRatio, trimEndRatio])

  return (
    <canvas
      ref={canvasRef}
      className="waveform-canvas"
    />
  )
}
