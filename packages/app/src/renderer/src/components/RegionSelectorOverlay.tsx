import { useState, useEffect, useCallback, useRef } from 'react'

interface SelectionState {
  startX: number
  startY: number
  endX: number
  endY: number
  isDragging: boolean
}

function normalizeRect(sel: SelectionState): { x: number; y: number; width: number; height: number } {
  const x = Math.min(sel.startX, sel.endX)
  const y = Math.min(sel.startY, sel.endY)
  const width = Math.abs(sel.endX - sel.startX)
  const height = Math.abs(sel.endY - sel.startY)
  return { x, y, width, height }
}

export function RegionSelectorOverlay() {
  const [selection, setSelection] = useState<SelectionState>({
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    isDragging: false,
  })
  const dragStartRef = useRef({ x: 0, y: 0 })

  const cancelSelection = useCallback(() => {
    window.api?.invoke('region:cancel')
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelSelection()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [cancelSelection])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) {
      cancelSelection()
      return
    }
    if (e.button !== 0) return
    setSelection({
      startX: e.clientX,
      startY: e.clientY,
      endX: e.clientX,
      endY: e.clientY,
      isDragging: true,
    })
    dragStartRef.current = { x: e.clientX, y: e.clientY }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!selection.isDragging) return
    setSelection((prev) => ({
      ...prev,
      endX: e.clientX,
      endY: e.clientY,
    }))
  }

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!selection.isDragging) return
    if (e.button !== 0) return
    const startX = dragStartRef.current.x
    const startY = dragStartRef.current.y
    const endX = e.clientX
    const endY = e.clientY
    const width = Math.abs(endX - startX)
    const height = Math.abs(endY - startY)
    if (width < 2 || height < 2) {
      setSelection((prev) => ({ ...prev, isDragging: false }))
      return
    }
    const x = Math.min(startX, endX)
    const y = Math.min(startY, endY)
    setSelection((prev) => ({ ...prev, isDragging: false }))
    window.api?.invoke('region:confirm', { x, y, width, height })
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    cancelSelection()
  }

  const rect = normalizeRect(selection)
  const showSelection = selection.isDragging

  const clipPath = showSelection
    ? `polygon(
        0% 0%, 0% 100%, 100% 100%, 100% 0%, 0% 0%,
        ${rect.x}px ${rect.y}px,
        ${rect.x}px ${rect.y + rect.height}px,
        ${rect.x + rect.width}px ${rect.y + rect.height}px,
        ${rect.x + rect.width}px ${rect.y}px,
        ${rect.x}px ${rect.y}px
      )`
    : undefined

  const labelX = rect.x + rect.width
  const labelY = rect.y + rect.height

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        cursor: 'crosshair',
        zIndex: 9999,
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={handleContextMenu}
    >
      {/* Dark overlay with clip-path cutout */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
          clipPath,
          pointerEvents: 'none',
        }}
      />

      {/* Hint text */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          color: '#fff',
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          fontSize: 13,
          padding: '6px 12px',
          borderRadius: 6,
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        Drag to select region. Esc to cancel.
      </div>

      {/* Selection border */}
      {showSelection && (
        <div
          style={{
            position: 'absolute',
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            border: '2px solid #007AFF',
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Dimension label */}
      {showSelection && rect.width > 0 && rect.height > 0 && (
        <div
          style={{
            position: 'absolute',
            left: labelX + 8,
            top: labelY + 8,
            color: '#fff',
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            fontSize: 13,
            padding: '4px 8px',
            borderRadius: 4,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {rect.width} &times; {rect.height}
        </div>
      )}
    </div>
  )
}
