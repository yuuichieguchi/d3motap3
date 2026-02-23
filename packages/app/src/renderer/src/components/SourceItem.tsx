import { useSourcesStore } from '../store/sources'

interface SourceItemProps {
  id: number
  name: string
  width: number
  height: number
  isActive: boolean
}

export function SourceItem({ id, name, width, height, isActive }: SourceItemProps) {
  const removeSource = useSourcesStore((s) => s.removeSource)

  return (
    <div className="source-item">
      <div className="source-info">
        <span className={`source-status ${isActive ? 'active' : 'inactive'}`} />
        <span className="source-name">{name}</span>
        <span className="source-dims">{width}x{height}</span>
      </div>
      <button className="source-remove-btn" onClick={() => removeSource(id)} title="Remove source">
        x
      </button>
    </div>
  )
}
