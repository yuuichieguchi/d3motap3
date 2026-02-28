import { useState, useCallback } from 'react'
import { useSourcesStore } from '../store/sources'

interface SourceItemProps {
  id: number
  name: string
  width: number
  height: number
  isActive: boolean
  sourceType?: string
  index: number
  isDragging: boolean
  isDragOver: boolean
  showDragHandle: boolean
  onDragStart: (e: React.DragEvent, index: number) => void
  onDragOver: (e: React.DragEvent, index: number) => void
  onDrop: (e: React.DragEvent, index: number) => void
  onDragEnd: () => void
  onDragLeave: (e: React.DragEvent) => void
}

/** Encode a string into a Uint8Array of UTF-8 bytes */
function encodeBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

/** Map of special keys to their terminal escape sequences */
const SPECIAL_KEY_MAP: Record<string, string> = {
  Enter: '\r',
  Backspace: '\x7f',
  Tab: '\t',
  Escape: '\x1b',
  ArrowUp: '\x1b[A',
  ArrowDown: '\x1b[B',
  ArrowRight: '\x1b[C',
  ArrowLeft: '\x1b[D',
}

export function SourceItem({ id, name, width, height, isActive, sourceType, index, isDragging, isDragOver, showDragHandle, onDragStart, onDragOver, onDrop, onDragEnd, onDragLeave }: SourceItemProps) {
  const removeSource = useSourcesStore((s) => s.removeSource)
  const isTerminal = sourceType === 'terminal' || name.toLowerCase().includes('terminal')
  const [terminalFocused, setTerminalFocused] = useState(false)

  const handleTerminalKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      e.preventDefault()

      if (e.key === 'Escape') {
        setTerminalFocused(false)
        ;(e.currentTarget as HTMLElement).blur()
        return
      }

      const specialSequence = SPECIAL_KEY_MAP[e.key]
      if (specialSequence) {
        window.api.invoke('terminal:write-input', id, encodeBytes(specialSequence))
        return
      }

      // Single printable character
      if (e.key.length === 1) {
        window.api.invoke('terminal:write-input', id, encodeBytes(e.key))
      }
    },
    [id],
  )

  return (
    <div
      className={`source-item${isDragging ? ' source-item--dragging' : ''}${isDragOver ? ' source-item--drag-over' : ''}`}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={(e) => onDrop(e, index)}
      onDragLeave={onDragLeave}
    >
      {showDragHandle && (
        <span
          className="source-drag-handle"
          draggable
          onDragStart={(e) => onDragStart(e, index)}
          onDragEnd={onDragEnd}
        >
          ⠿
        </span>
      )}
      <div className="source-info">
        <span className={`source-status ${isActive ? 'active' : 'inactive'}`} />
        <span className="source-name">{name}</span>
        <span className="source-dims">{width}x{height}</span>
      </div>
      <button className="source-remove-btn" onClick={() => removeSource(id)} title="Remove source">
        x
      </button>

      {isTerminal && (
        <div
          className={`terminal-input-area${terminalFocused ? ' terminal-focused' : ''}`}
          tabIndex={0}
          onKeyDown={handleTerminalKeyDown}
          onFocus={() => setTerminalFocused(true)}
          onBlur={() => setTerminalFocused(false)}
        >
          {terminalFocused ? 'Typing... (Esc to unfocus)' : 'Click to type...'}
        </div>
      )}
    </div>
  )
}
