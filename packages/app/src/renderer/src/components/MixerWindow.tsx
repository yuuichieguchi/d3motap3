import { useState, useEffect } from 'react'

interface TrackSetting {
  trackId: string
  volume: number
  muted: boolean
}

interface TrackInfo {
  id: string
  label: string
}

interface MixerState {
  clipId: string
  tracks: TrackInfo[]
  settings: TrackSetting[]
}

export function MixerWindow() {
  const [state, setState] = useState<MixerState | null>(null)

  useEffect(() => {
    const unsub = window.api.on('mixer:state-update', (...args: unknown[]) => {
      setState(args[0] as MixerState)
    })
    // Request initial state
    window.api.invoke('mixer:request-state').catch(() => {})
    return unsub
  }, [])

  if (!state || state.tracks.length === 0) {
    return <div className="mixer-window-empty">No audio tracks</div>
  }

  return (
    <div className="mixer-window">
      <div className="mixer-window-header">Mixer</div>
      <div className="mixer-window-tracks">
        {state.settings.map((setting) => {
          const track = state.tracks.find((t) => t.id === setting.trackId)
          if (!track) return null

          return (
            <div key={setting.trackId} className="mixer-window-track">
              <span className="mixer-window-track-label">{track.label}</span>
              <button
                className={`mixer-window-mute-btn ${setting.muted ? 'muted' : ''}`}
                onClick={() => {
                  window.api.invoke('mixer:set-muted', state.clipId, setting.trackId, !setting.muted).catch(() => {})
                }}
              >
                {setting.muted ? '🔇' : '🔊'}
              </button>
              <input
                type="range"
                className="mixer-window-volume"
                min={0}
                max={100}
                value={Math.round(setting.volume * 100)}
                onChange={(e) => {
                  window.api.invoke('mixer:set-volume', state.clipId, setting.trackId, Number(e.target.value) / 100).catch(() => {})
                }}
                disabled={setting.muted}
              />
              <span className="mixer-window-volume-value">{Math.round(setting.volume * 100)}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
