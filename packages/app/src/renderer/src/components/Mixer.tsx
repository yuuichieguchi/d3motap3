import { useEditorStore } from '../store/editor'

export function Mixer() {
  const store = useEditorStore()
  
  // Get the first clip with mixer settings
  const bundleClip = store.project.clips.find((c) => c.bundlePath && c.mixerSettings)
  
  if (!bundleClip || !bundleClip.mixerSettings) {
    return null
  }

  return (
    <div className="mixer-panel">
      <div className="mixer-header">Mixer</div>
      <div className="mixer-tracks">
        {bundleClip.mixerSettings.tracks.map((setting) => {
          const track = bundleClip.audioTracks?.find((t) => t.id === setting.trackId)
          if (!track) return null
          
          return (
            <div key={setting.trackId} className="mixer-track">
              <span className="mixer-track-label">{track.label}</span>
              <button
                className={`mixer-mute-btn ${setting.muted ? 'muted' : ''}`}
                onClick={() => store.setTrackMuted(bundleClip.id, setting.trackId, !setting.muted)}
                title={setting.muted ? 'Unmute' : 'Mute'}
              >
                {setting.muted ? '🔇' : '🔊'}
              </button>
              <input
                type="range"
                className="mixer-volume-slider"
                min={0}
                max={100}
                value={Math.round(setting.volume * 100)}
                onChange={(e) => store.setTrackVolume(bundleClip.id, setting.trackId, Number(e.target.value) / 100)}
                disabled={setting.muted}
              />
              <span className="mixer-volume-value">{Math.round(setting.volume * 100)}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
