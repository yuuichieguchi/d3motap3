import { useEditorStore } from '../store/editor'

export function PunchInControls() {
  const store = useEditorStore()

  // Only show for bundle clips
  const bundleClip = store.project.clips.find((c) => c.bundlePath)
  if (!bundleClip) return null

  const hasMicTrack = bundleClip.audioTracks?.some((t) => t.type === 'mic')

  return (
    <div className="punch-in-controls">
      {store.isPunchingIn ? (
        <button
          className="punch-in-btn recording"
          onClick={() => store.stopPunchIn()}
        >
          Stop Punch-In
        </button>
      ) : (
        <button
          className="punch-in-btn"
          onClick={() => store.startPunchIn()}
          disabled={!hasMicTrack}
          title={hasMicTrack ? 'Re-record narration from current position' : 'No microphone track available'}
        >
          Punch In
        </button>
      )}
    </div>
  )
}
