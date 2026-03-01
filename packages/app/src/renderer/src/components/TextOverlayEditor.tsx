import { useCallback } from 'react'
import { useEditorStore } from '../store/editor'

const POSITION_PRESETS = [
  { label: 'Title', x: 0, y: 0.45, width: 1, textAlign: 'center' as const },
  { label: 'Lower 3rd', x: 0.03, y: 0.82, width: 0.5, textAlign: 'left' as const },
  { label: 'Subtitle', x: 0, y: 0.9, width: 1, textAlign: 'center' as const },
  { label: 'Top', x: 0, y: 0.08, width: 1, textAlign: 'center' as const },
]

export function TextOverlayEditor() {
  const store = useEditorStore()
  const overlay = store.project.textOverlays.find((o) => o.id === store.selectedOverlayId)

  const handleUpdate = useCallback(
    (updates: Record<string, unknown>) => {
      if (!store.selectedOverlayId) return
      store.updateTextOverlay(store.selectedOverlayId, updates)
    },
    [store]
  )

  const handleRemove = useCallback(() => {
    if (!store.selectedOverlayId) return
    store.removeTextOverlay(store.selectedOverlayId)
  }, [store])

  if (!overlay) return null

  return (
    <div className="text-overlay-editor">
      {/* Preset quick buttons */}
      <div className="toe-preset-row">
        {POSITION_PRESETS.map((p) => (
          <button
            key={p.label}
            className="toe-preset-btn"
            onClick={() => handleUpdate({ x: p.x, y: p.y, width: p.width, textAlign: p.textAlign })}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Text */}
      <textarea
        className="toe-textarea"
        rows={2}
        value={overlay.text}
        onChange={(e) => handleUpdate({ text: e.target.value })}
        placeholder="Enter text..."
      />

      {/* Font + Size row */}
      <div className="toe-row">
        <select
          className="toe-select"
          value={overlay.fontFamily}
          onChange={(e) => handleUpdate({ fontFamily: e.target.value })}
        >
          <option value="sans-serif">Sans-serif</option>
          <option value="serif">Serif</option>
          <option value="monospace">Monospace</option>
          <option value="Arial">Arial</option>
          <option value="Helvetica">Helvetica</option>
          <option value="Georgia">Georgia</option>
          <option value="Courier New">Courier New</option>
          <option value="Impact">Impact</option>
          <option value="Futura">Futura</option>
        </select>
        <input
          className="toe-size-input"
          type="number"
          min={12}
          max={128}
          value={overlay.fontSize}
          onChange={(e) => handleUpdate({ fontSize: Number(e.target.value) })}
        />
      </div>

      {/* Style row: B I | L C R | color */}
      <div className="toe-row">
        <button
          className={`style-toggle-btn${overlay.fontWeight === 'bold' ? ' active' : ''}`}
          onClick={() => handleUpdate({ fontWeight: overlay.fontWeight === 'bold' ? 'normal' : 'bold' })}
        >
          B
        </button>
        <button
          className={`style-toggle-btn${overlay.fontStyle === 'italic' ? ' active' : ''}`}
          onClick={() => handleUpdate({ fontStyle: overlay.fontStyle === 'italic' ? 'normal' : 'italic' })}
        >
          I
        </button>
        <span className="toe-separator" />
        <button
          className={`align-btn${overlay.textAlign === 'left' ? ' active' : ''}`}
          onClick={() => handleUpdate({ textAlign: 'left' })}
        >
          L
        </button>
        <button
          className={`align-btn${overlay.textAlign === 'center' ? ' active' : ''}`}
          onClick={() => handleUpdate({ textAlign: 'center' })}
        >
          C
        </button>
        <button
          className={`align-btn${overlay.textAlign === 'right' ? ' active' : ''}`}
          onClick={() => handleUpdate({ textAlign: 'right' })}
        >
          R
        </button>
        <span className="toe-separator" />
        <input
          type="color"
          className="toe-color-swatch"
          value={overlay.color}
          onChange={(e) => handleUpdate({ color: e.target.value })}
        />
      </div>

      {/* Decoration toggles */}
      <div className="toe-toggle-row">
        <label className="toe-toggle-label">
          <input
            type="checkbox"
            checked={overlay.backgroundColor !== null}
            onChange={(e) =>
              handleUpdate(e.target.checked ? { backgroundColor: '#000000' } : { backgroundColor: null })
            }
          />
          BG
        </label>
        {overlay.backgroundColor !== null && (
          <input
            type="color"
            className="toe-color-swatch"
            value={overlay.backgroundColor}
            onChange={(e) => handleUpdate({ backgroundColor: e.target.value })}
          />
        )}
        <label className="toe-toggle-label">
          <input
            type="checkbox"
            checked={overlay.borderColor !== null}
            onChange={(e) =>
              handleUpdate(e.target.checked ? { borderColor: '#000000', borderWidth: 2 } : { borderColor: null, borderWidth: 0 })
            }
          />
          Outline
        </label>
        {overlay.borderColor !== null && (
          <input
            type="color"
            className="toe-color-swatch"
            value={overlay.borderColor}
            onChange={(e) => handleUpdate({ borderColor: e.target.value })}
          />
        )}
        <label className="toe-toggle-label">
          <input
            type="checkbox"
            checked={overlay.shadowColor !== null}
            onChange={(e) =>
              handleUpdate(e.target.checked ? { shadowColor: '#000000', shadowOffsetX: 2, shadowOffsetY: 2 } : { shadowColor: null, shadowOffsetX: 0, shadowOffsetY: 0 })
            }
          />
          Shadow
        </label>
        {overlay.shadowColor !== null && (
          <input
            type="color"
            className="toe-color-swatch"
            value={overlay.shadowColor}
            onChange={(e) => handleUpdate({ shadowColor: e.target.value })}
          />
        )}
      </div>

      {/* Animation row */}
      <div className="toe-row">
        <select
          className="toe-select"
          value={overlay.animation}
          onChange={(e) => handleUpdate({ animation: e.target.value })}
        >
          <option value="none">No Animation</option>
          <option value="fade-in">Fade In</option>
          <option value="fade-out">Fade Out</option>
          <option value="fade-in-out">Fade In/Out</option>
          <option value="slide-up">Slide Up</option>
          <option value="slide-down">Slide Down</option>
        </select>
        {overlay.animation !== 'none' && (
          <input
            className="toe-size-input"
            type="number"
            min={100}
            max={2000}
            step={50}
            value={overlay.animationDuration}
            onChange={(e) => handleUpdate({ animationDuration: Number(e.target.value) })}
          />
        )}
      </div>

      {/* Position row */}
      <div className="toe-row toe-range-row">
        <label className="toe-range-label">Left</label>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(overlay.x * 100)}
          onChange={(e) => {
            const newX = Number(e.target.value) / 100
            const maxX = 1 - (overlay.width ?? 1)
            handleUpdate({ x: Math.min(newX, maxX) })
          }}
        />
        <span className="toe-range-value">{Math.round(overlay.x * 100)}%</span>
      </div>
      <div className="toe-row toe-range-row">
        <label className="toe-range-label">Y</label>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(overlay.y * 100)}
          onChange={(e) => handleUpdate({ y: Number(e.target.value) / 100 })}
        />
        <span className="toe-range-value">{Math.round(overlay.y * 100)}%</span>
      </div>
      <div className="toe-row toe-range-row">
        <label className="toe-range-label">Width</label>
        <input
          type="range"
          min={5}
          max={100}
          value={Math.round((overlay.width ?? 1) * 100)}
          onChange={(e) => {
            const w = Number(e.target.value) / 100
            const maxW = 1 - overlay.x
            handleUpdate({ width: Math.min(w, maxW) })
          }}
        />
        <span className="toe-range-value">{Math.round((overlay.width ?? 1) * 100)}%</span>
      </div>

      {/* Timing row */}
      <div className="toe-row">
        <label className="toe-range-label">Start</label>
        <input
          className="toe-time-input"
          type="number"
          min={0}
          value={Math.round(overlay.startTime)}
          onChange={(e) => handleUpdate({ startTime: Number(e.target.value) })}
        />
        <label className="toe-range-label">End</label>
        <input
          className="toe-time-input"
          type="number"
          min={0}
          value={Math.round(overlay.endTime)}
          onChange={(e) => handleUpdate({ endTime: Number(e.target.value) })}
        />
      </div>

      {/* Remove button */}
      <button className="toe-remove-btn" onClick={handleRemove}>
        Remove Overlay
      </button>
    </div>
  )
}
