import { useState } from 'react'

interface TextPresetDialogProps {
  open: boolean
  onClose: () => void
  onAdd: (presets: {
    x: number
    y: number
    textAlign: 'left' | 'center' | 'right'
    fontSize: number
    fontWeight: 'normal' | 'bold'
  }) => void
}

const POSITION_PRESETS = [
  { label: 'Title (Center)', x: 0.5, y: 0.45, textAlign: 'center' as const },
  { label: 'Lower Third', x: 0.05, y: 0.82, textAlign: 'left' as const },
  { label: 'Subtitle', x: 0.5, y: 0.9, textAlign: 'center' as const },
  { label: 'Top Banner', x: 0.5, y: 0.08, textAlign: 'center' as const },
] as const

const SIZE_PRESETS = [
  { label: 'Small (24px)', fontSize: 24, fontWeight: 'normal' as const },
  { label: 'Medium (48px)', fontSize: 48, fontWeight: 'normal' as const },
  { label: 'Large (72px)', fontSize: 72, fontWeight: 'bold' as const },
  { label: 'Extra Large (96px)', fontSize: 96, fontWeight: 'bold' as const },
] as const

export function TextPresetDialog({ open, onClose, onAdd }: TextPresetDialogProps) {
  const [selectedPosition, setSelectedPosition] = useState(2) // default: Subtitle
  const [selectedSize, setSelectedSize] = useState(1) // default: Medium (48px)

  if (!open) return null

  const handleAdd = (): void => {
    const position = POSITION_PRESETS[selectedPosition]
    const size = SIZE_PRESETS[selectedSize]
    onAdd({
      x: position.x,
      y: position.y,
      textAlign: position.textAlign,
      fontSize: size.fontSize,
      fontWeight: size.fontWeight,
    })
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog text-preset-dialog" onClick={(e) => e.stopPropagation()}>
        <button className="dialog-close-btn" onClick={onClose}>×</button>
        <h2>Add Text</h2>

        <div className="preset-section">
          <h3>Position</h3>
          <div className="preset-options">
            {POSITION_PRESETS.map((preset, i) => (
              <button
                key={preset.label}
                className={`preset-option${selectedPosition === i ? ' selected' : ''}`}
                onClick={() => setSelectedPosition(i)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="preset-section">
          <h3>Size</h3>
          <div className="preset-options">
            {SIZE_PRESETS.map((preset, i) => (
              <button
                key={preset.label}
                className={`preset-option${selectedSize === i ? ' selected' : ''}`}
                onClick={() => setSelectedSize(i)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <button className="preset-add-btn" onClick={handleAdd}>Add</button>
      </div>
    </div>
  )
}
