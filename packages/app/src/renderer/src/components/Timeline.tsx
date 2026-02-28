import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditorStore } from "../store/editor";
import { AudioTrackRow } from './AudioTrackRow'

export function Timeline() {
  const store = useEditorStore();
  const clips = [...store.project.clips].sort((a, b) => a.order - b.order);
  const totalDuration = store.totalDuration();
  const overlays = store.project.textOverlays;

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "clip" | "overlay" | "audio-clip";
    id: string;
    trackId?: string;
    splitEnabled: boolean;
  } | null>(null);

  // Track ref and drag state for click/drag seek
  const trackRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef<boolean>(false);
  const cleanupDragRef = useRef<(() => void) | null>(null);

  // Clean up drag listeners on unmount
  useEffect(() => {
    return () => {
      if (cleanupDragRef.current) {
        cleanupDragRef.current();
        cleanupDragRef.current = null;
      }
    };
  }, []);

  // Close context menu on click-away or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleMouseDown = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const handleClipClick = useCallback(
    (e: React.MouseEvent, clipId: string) => {
      if (e.metaKey || e.ctrlKey) {
        store.selectClip(clipId, "toggle");
      } else if (e.shiftKey) {
        store.selectClip(clipId, "range");
      } else {
        store.selectClip(clipId, "single");
      }
    },
    [store],
  );

  const handleOverlayClick = useCallback(
    (overlayId: string) => {
      store.selectOverlay(overlayId);
    },
    [store],
  );

  const handleTransitionClick = useCallback(
    (e: React.MouseEvent, clipId: string) => {
      e.stopPropagation();
      const clip = store.project.clips.find((c) => c.id === clipId);
      if (!clip) return;

      if (clip.transition) {
        // Cycle through transition types
        const types = ["fade", "dissolve", "wipe_left", "wipe_right"] as const;
        const currentIndex = types.indexOf(clip.transition.type);
        const nextIndex = (currentIndex + 1) % types.length;
        store.setTransition(clipId, types[nextIndex], clip.transition.duration);
      } else {
        store.setTransition(clipId, "fade", 500);
      }
    },
    [store],
  );

  const handleAudioContextMenu = useCallback(
    (e: React.MouseEvent, clipId: string, trackId: string) => {
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        type: 'audio-clip',
        id: clipId,
        trackId,
        splitEnabled: (() => {
          const s = useEditorStore.getState()
          for (const t of s.project.independentAudioTracks) {
            const clip = t.clips.find((c) => c.id === clipId)
            if (clip) {
              const dur = clip.originalDuration - clip.trimStart - clip.trimEnd
              return s.currentTimeMs > clip.timelineStartMs && s.currentTimeMs < clip.timelineStartMs + dur
            }
          }
          return false
        })(),
      })
    },
    [],
  )

  // Seek to position based on clientX relative to track
  const handleTrackSeek = useCallback((clientX: number) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const duration = useEditorStore.getState().totalDuration();
    const timeMs = ratio * duration;
    useEditorStore.getState().seekTo(timeMs);
  }, []);

  const handlePlayheadMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      isDraggingRef.current = true;
      setContextMenu(null);
      handleTrackSeek(e.clientX);
      document.body.style.cursor = "col-resize";

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (isDraggingRef.current) {
          handleTrackSeek(moveEvent.clientX);
        }
      };
      const handleMouseUp = () => {
        isDraggingRef.current = false;
        document.body.style.cursor = "";
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        cleanupDragRef.current = null;
      };
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);

      cleanupDragRef.current = () => {
        isDraggingRef.current = false;
        document.body.style.cursor = "";
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    },
    [handleTrackSeek],
  );

  if (clips.length === 0) {
    return (
      <div className="timeline">
        <div className="timeline-empty">No clips in timeline</div>
      </div>
    );
  }

  // Calculate clip widths proportional to duration
  const getClipWidth = (clip: (typeof clips)[0]) => {
    if (totalDuration <= 0) return 0;
    const clipDuration = clip.originalDuration - clip.trimStart - clip.trimEnd;
    return (clipDuration / totalDuration) * 100;
  };

  // Playhead position
  const playheadPosition =
    totalDuration > 0 ? (store.currentTimeMs / totalDuration) * 100 : 0;

  return (
    <div className="timeline">
      {/* Clip track */}
      <div className="timeline-track clip-track" ref={trackRef}>
        {/* Playhead */}
        <div
          className="timeline-playhead"
          style={{ left: `${playheadPosition}%` }}
          onMouseDown={handlePlayheadMouseDown}
        />

        {clips.map((clip, index) => {
          const width = getClipWidth(clip);
          const isSelected = store.selectedClipIds.includes(clip.id);
          const thumbnails = store.clipThumbnails.get(clip.id);
          const isLastClip = index === clips.length - 1;

          return (
            <div
              key={clip.id}
              className="timeline-clip-wrapper"
              style={{ width: `${width}%` }}
            >
              <div
                className={`timeline-clip ${isSelected ? "selected" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleClipClick(e, clip.id);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!store.selectedClipIds.includes(clip.id)) {
                    store.selectClip(clip.id, "single");
                  }
                  setContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    type: "clip",
                    id: clip.id,
                    splitEnabled: store.canSplit(),
                  });
                }}
                title={`${clip.sourcePath.split("/").pop()} (${Math.round(clip.originalDuration - clip.trimStart - clip.trimEnd)}ms)`}
              >
                {/* Thumbnail strip */}
                {thumbnails && thumbnails.length > 0 && (
                  <div className="clip-thumbnails">
                    {thumbnails.slice(0, 5).map((url, i) => (
                      <img key={i} src={url} alt="" className="clip-thumb" />
                    ))}
                  </div>
                )}
                {!thumbnails && (
                  <div className="clip-label">
                    {clip.sourcePath.split("/").pop()?.slice(0, 12) ?? "clip"}
                  </div>
                )}
              </div>

              {/* Transition indicator between clips */}
              {!isLastClip && (
                <div
                  className={`transition-indicator ${clip.transition ? "has-transition" : ""}`}
                  onClick={(e) => handleTransitionClick(e, clip.id)}
                  title={
                    clip.transition
                      ? `${clip.transition.type} (${clip.transition.duration}ms) - click to change`
                      : "Click to add transition"
                  }
                >
                  {clip.transition
                    ? clip.transition.type[0].toUpperCase()
                    : "+"}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Audio tracks from bundle clips */}
      {(() => {
        const audioTrackMap = new Map<string, { id: string; type: string; label: string }>()
        for (const c of clips) {
          for (const t of c.audioTracks ?? []) {
            if (!audioTrackMap.has(t.id)) audioTrackMap.set(t.id, { id: t.id, type: t.type, label: t.label })
          }
        }
        if (audioTrackMap.size === 0) return null
        return [...audioTrackMap.values()].map((track) => {
          // Show muted icon only when ALL clips with this track have it muted
          const clipsWithTrack = clips.filter((c) => c.audioTracks?.some((t) => t.id === track.id))
          const isMuted = clipsWithTrack.length > 0 && clipsWithTrack.every(
            (c) => c.mixerSettings?.tracks.find((s) => s.trackId === track.id)?.muted
          )
          return (
            <div key={track.id} className="timeline-row audio-track-row">
              <div className="timeline-row-label">
                <span className="audio-track-icon">{isMuted ? '🔇' : '🔊'}</span>
                <span>{track.label}</span>
              </div>
              <div className="timeline-row-content" style={{ display: 'flex' }}>
                {clips.map((c) => {
                  const width = getClipWidth(c)
                  const hasTrack = c.audioTracks?.some((t) => t.id === track.id)
                  if (!hasTrack) return <div key={c.id} style={{ width: `${width}%` }} />
                  const trackMuted = c.mixerSettings?.tracks.find((s) => s.trackId === track.id)?.muted
                  return (
                    <div key={c.id} style={{ width: `${width}%` }}>
                      <div
                        className={`audio-track-bar ${track.type} ${trackMuted ? 'muted' : ''}`}
                        style={{ width: '100%', height: '100%' }}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })
      })()}

      {/* Independent audio tracks */}
      {store.project.independentAudioTracks.map((track) => (
        <AudioTrackRow
          key={track.id}
          track={track}
          totalDuration={totalDuration}
          onContextMenu={handleAudioContextMenu}
        />
      ))}

      {/* Add Audio Track button */}
      <div className="timeline-add-audio-track">
        <button
          className="add-audio-track-btn"
          onClick={() => store.addAudioTrack(`Audio ${store.project.independentAudioTracks.length + 1}`)}
        >
          + Audio Track
        </button>
      </div>

      {/* Text overlay track */}
      {overlays.length > 0 && (
        <div className="timeline-track overlay-track">
          {overlays.map((overlay) => {
            const left =
              totalDuration > 0 ? (overlay.startTime / totalDuration) * 100 : 0;
            const width =
              totalDuration > 0
                ? ((overlay.endTime - overlay.startTime) / totalDuration) * 100
                : 0;
            const isSelected = store.selectedOverlayId === overlay.id;

            return (
              <div
                key={overlay.id}
                className={`timeline-overlay ${isSelected ? "selected" : ""}`}
                style={{ left: `${left}%`, width: `${width}%` }}
                onClick={() => handleOverlayClick(overlay.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    type: "overlay",
                    id: overlay.id,
                    splitEnabled: false,
                  });
                }}
                title={`"${overlay.text}" (${Math.round(overlay.startTime)}ms - ${Math.round(overlay.endTime)}ms)`}
              >
                <span className="overlay-text-label">{overlay.text}</span>
              </div>
            );
          })}
        </div>
      )}
      {/* Context menu */}
      {contextMenu &&
        createPortal(
          <div
            className="timeline-context-menu"
            style={{
              left: Math.min(contextMenu.x, window.innerWidth - 200),
              top: Math.min(contextMenu.y, window.innerHeight - (
                contextMenu.type === "audio-clip" ? 300 :
                contextMenu.type === "clip" ? 230 : 50
              )),
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {contextMenu.type === "clip" ? (
              <>
                {/* Copy */}
                <button
                  className="timeline-context-menu-item"
                  onClick={() => {
                    store.copySelectedClips();
                    setContextMenu(null);
                  }}
                >
                  <span>Copy</span>
                  <span className="context-menu-shortcut">⌘C</span>
                </button>
                {/* Cut */}
                <button
                  className="timeline-context-menu-item"
                  onClick={() => {
                    store.cutSelectedClips();
                    setContextMenu(null);
                  }}
                >
                  <span>Cut</span>
                  <span className="context-menu-shortcut">⌘X</span>
                </button>
                {/* Paste */}
                <button
                  className="timeline-context-menu-item"
                  disabled={!store.clipboardClips}
                  onClick={() => {
                    store.pasteClips();
                    setContextMenu(null);
                  }}
                >
                  <span>Paste</span>
                  <span className="context-menu-shortcut">⌘V</span>
                </button>
                {/* Separator */}
                <div className="context-menu-separator" />
                {/* Split at Playhead */}
                <button
                  className="timeline-context-menu-item"
                  disabled={!contextMenu.splitEnabled}
                  onClick={() => {
                    store.splitAtPlayhead();
                    setContextMenu(null);
                  }}
                >
                  <span>Split at Playhead</span>
                  <span className="context-menu-shortcut">⌘B</span>
                </button>
                {/* Separator */}
                <div className="context-menu-separator" />
                {/* Delete */}
                <button
                  className="timeline-context-menu-item danger"
                  onClick={() => {
                    if (store.selectedClipIds.length > 1 && store.selectedClipIds.includes(contextMenu.id)) {
                      store.removeSelectedClips();
                    } else {
                      store.removeClip(contextMenu.id);
                    }
                    setContextMenu(null);
                  }}
                >
                  <span>
                    {store.selectedClipIds.length > 1 && store.selectedClipIds.includes(contextMenu.id)
                      ? `Delete (${store.selectedClipIds.length} selected)`
                      : "Delete"}
                  </span>
                  <span className="context-menu-shortcut">⌫</span>
                </button>
              </>
            ) : contextMenu.type === "audio-clip" ? (
              <>
                {/* Copy */}
                <button
                  className="timeline-context-menu-item"
                  onClick={() => {
                    store.copySelectedAudioClips();
                    setContextMenu(null);
                  }}
                >
                  <span>Copy</span>
                  <span className="context-menu-shortcut">⌘C</span>
                </button>
                {/* Cut */}
                <button
                  className="timeline-context-menu-item"
                  onClick={() => {
                    store.cutSelectedAudioClips();
                    setContextMenu(null);
                  }}
                >
                  <span>Cut</span>
                  <span className="context-menu-shortcut">⌘X</span>
                </button>
                {/* Paste */}
                <button
                  className="timeline-context-menu-item"
                  disabled={!store.clipboardAudioClips}
                  onClick={() => {
                    store.pasteAudioClips();
                    setContextMenu(null);
                  }}
                >
                  <span>Paste</span>
                  <span className="context-menu-shortcut">⌘V</span>
                </button>
                {/* Separator */}
                <div className="context-menu-separator" />
                {/* Split at Playhead */}
                <button
                  className="timeline-context-menu-item"
                  disabled={!contextMenu.splitEnabled}
                  onClick={() => {
                    store.splitAtPlayhead();
                    setContextMenu(null);
                  }}
                >
                  <span>Split at Playhead</span>
                  <span className="context-menu-shortcut">⌘B</span>
                </button>
                {/* Separator */}
                <div className="context-menu-separator" />
                {/* Replace Audio */}
                <button
                  className="timeline-context-menu-item"
                  onClick={async () => {
                    setContextMenu(null);
                    const newPath = await window.api.invoke('dialog:open-file', {
                      filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] }],
                    }) as string | null;
                    if (newPath && contextMenu.trackId) {
                      store.replaceAudioClipSource(contextMenu.trackId, contextMenu.id, newPath);
                    }
                  }}
                >
                  <span>Replace Audio...</span>
                </button>
                {/* Separator */}
                <div className="context-menu-separator" />
                {/* Delete */}
                <button
                  className="timeline-context-menu-item danger"
                  onClick={() => {
                    store.removeSelectedAudioClips();
                    setContextMenu(null);
                  }}
                >
                  <span>
                    {store.selectedAudioClipIds.length > 1
                      ? `Delete (${store.selectedAudioClipIds.length} selected)`
                      : "Delete"}
                  </span>
                  <span className="context-menu-shortcut">⌫</span>
                </button>
              </>
            ) : (
              <button
                className="timeline-context-menu-item danger"
                onClick={() => {
                  store.removeTextOverlay(contextMenu.id);
                  setContextMenu(null);
                }}
              >
                <span>Delete</span>
                <span className="context-menu-shortcut">⌫</span>
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
