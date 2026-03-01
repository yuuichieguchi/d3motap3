import { useCallback } from 'react'
import { useEditorStore } from '../store/editor'

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
      {/* ── Text Section ── */}
      <h3>Text</h3>

      <div className="control-group">
        <label>Content</label>
        <textarea
          rows={2}
          value={overlay.text}
          onChange={(e) => handleUpdate({ text: e.target.value })}
        />
      </div>

      <div className="control-group">
        <label>Font</label>
        <select
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
      </div>

      <div className="control-group">
        <label>Font Size</label>
        <input
          type="range"
          min={12}
          max={128}
          value={overlay.fontSize}
          onChange={(e) => handleUpdate({ fontSize: Number(e.target.value) })}
        />
        <span>{overlay.fontSize}px</span>
      </div>

      <div className="control-group">
        <label>Style</label>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className={`style-toggle-btn${overlay.fontWeight === 'bold' ? ' active' : ''}`}
            onClick={() =>
              handleUpdate({ fontWeight: overlay.fontWeight === 'bold' ? 'normal' : 'bold' })
            }
          >
            B
          </button>
          <button
            className={`style-toggle-btn${overlay.fontStyle === 'italic' ? ' active' : ''}`}
            onClick={() =>
              handleUpdate({ fontStyle: overlay.fontStyle === 'italic' ? 'normal' : 'italic' })
            }
          >
            I
          </button>
        </div>
      </div>

      <div className="control-group">
        <label>Align</label>
        <div style={{ display: 'flex', gap: 4 }}>
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
        </div>
      </div>

      {/* ── Appearance Section ── */}
      <h3>Appearance</h3>

      <div className="control-group">
        <label>Color</label>
        <input
          type="color"
          value={overlay.color}
          onChange={(e) => handleUpdate({ color: e.target.value })}
        />
      </div>

      <div className="control-group">
        <label>
          <input
            type="checkbox"
            checked={overlay.backgroundColor !== null}
            onChange={(e) =>
              handleUpdate(
                e.target.checked
                  ? { backgroundColor: '#000000' }
                  : { backgroundColor: null }
              )
            }
          />
          Background
        </label>
        {overlay.backgroundColor !== null && (
          <input
            type="color"
            value={overlay.backgroundColor}
            onChange={(e) => handleUpdate({ backgroundColor: e.target.value })}
          />
        )}
      </div>

      <div className="control-group">
        <label>
          <input
            type="checkbox"
            checked={overlay.borderColor !== null}
            onChange={(e) =>
              handleUpdate(
                e.target.checked
                  ? { borderColor: '#000000', borderWidth: 2 }
                  : { borderColor: null, borderWidth: 0 }
              )
            }
          />
          Outline
        </label>
        {overlay.borderColor !== null && (
          <>
            <input
              type="color"
              value={overlay.borderColor}
              onChange={(e) => handleUpdate({ borderColor: e.target.value })}
            />
            <input
              type="range"
              min={1}
              max={10}
              value={overlay.borderWidth}
              onChange={(e) => handleUpdate({ borderWidth: Number(e.target.value) })}
            />
            <span>{overlay.borderWidth}px</span>
          </>
        )}
      </div>

      <div className="control-group">
        <label>
          <input
            type="checkbox"
            checked={overlay.shadowColor !== null}
            onChange={(e) =>
              handleUpdate(
                e.target.checked
                  ? { shadowColor: '#000000', shadowOffsetX: 2, shadowOffsetY: 2 }
                  : { shadowColor: null, shadowOffsetX: 0, shadowOffsetY: 0 }
              )
            }
          />
          Shadow
        </label>
        {overlay.shadowColor !== null && (
          <>
            <input
              type="color"
              value={overlay.shadowColor}
              onChange={(e) => handleUpdate({ shadowColor: e.target.value })}
            />
            <label>X</label>
            <input
              type="range"
              min={-20}
              max={20}
              value={overlay.shadowOffsetX}
              onChange={(e) => handleUpdate({ shadowOffsetX: Number(e.target.value) })}
            />
            <span>{overlay.shadowOffsetX}px</span>
            <label>Y</label>
            <input
              type="range"
              min={-20}
              max={20}
              value={overlay.shadowOffsetY}
              onChange={(e) => handleUpdate({ shadowOffsetY: Number(e.target.value) })}
            />
            <span>{overlay.shadowOffsetY}px</span>
          </>
        )}
      </div>

      {/* ── Animation Section ── */}
      <h3>Animation</h3>

      <div className="control-group">
        <label>Type</label>
        <select
          value={overlay.animation}
          onChange={(e) => handleUpdate({ animation: e.target.value })}
        >
          <option value="none">None</option>
          <option value="fade-in">Fade In</option>
          <option value="fade-out">Fade Out</option>
          <option value="fade-in-out">Fade In/Out</option>
          <option value="slide-up">Slide Up</option>
          <option value="slide-down">Slide Down</option>
        </select>
      </div>

      {overlay.animation !== 'none' && (
        <div className="control-group">
          <label>Duration</label>
          <input
            type="range"
            min={100}
            max={2000}
            step={50}
            value={overlay.animationDuration}
            onChange={(e) => handleUpdate({ animationDuration: Number(e.target.value) })}
          />
          <span>{overlay.animationDuration}ms</span>
        </div>
      )}

      {/* ── Position Section ── */}
      <h3>Position</h3>

      <div className="control-group">
        <label>X</label>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(overlay.x * 100)}
          onChange={(e) => handleUpdate({ x: Number(e.target.value) / 100 })}
        />
        <span>{Math.round(overlay.x * 100)}%</span>
      </div>

      <div className="control-group">
        <label>Y</label>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(overlay.y * 100)}
          onChange={(e) => handleUpdate({ y: Number(e.target.value) / 100 })}
        />
        <span>{Math.round(overlay.y * 100)}%</span>
      </div>

      {/* ── Timing Section ── */}
      <h3>Timing</h3>

      <div className="control-group">
        <label>Start (ms)</label>
        <input
          type="number"
          min={0}
          value={Math.round(overlay.startTime)}
          onChange={(e) => handleUpdate({ startTime: Number(e.target.value) })}
        />
      </div>

      <div className="control-group">
        <label>End (ms)</label>
        <input
          type="number"
          min={0}
          value={Math.round(overlay.endTime)}
          onChange={(e) => handleUpdate({ endTime: Number(e.target.value) })}
        />
      </div>

      {/* ── Actions Section ── */}
      <h3>Actions</h3>

      <div className="record-controls">
        <button className="record-btn stop" onClick={handleRemove}>
          Remove Overlay
        </button>
      </div>
    </div>
  )
}
