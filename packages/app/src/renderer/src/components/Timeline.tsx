import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditorStore } from "../store/editor";

export function Timeline() {
  const store = useEditorStore();
  const clips = [...store.project.clips].sort((a, b) => a.order - b.order);
  const totalDuration = store.totalDuration();
  const overlays = store.project.textOverlays;

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: "clip" | "overlay";
    id: string;
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
    (clipId: string) => {
      store.selectClip(clipId);
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

  // Seek to position based on clientX relative to track
  const handleTrackSeek = useCallback((clientX: number) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const duration = useEditorStore.getState().totalDuration();
    const timeMs = ratio * duration;
    useEditorStore.getState().setCurrentTime(timeMs);
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
          const isSelected = store.selectedClipId === clip.id;
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
                  handleClipClick(clip.id);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({
                    x: e.clientX,
                    y: e.clientY,
                    type: "clip",
                    id: clip.id,
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
              left: Math.min(contextMenu.x, window.innerWidth - 140),
              top: Math.min(contextMenu.y, window.innerHeight - 40),
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              className="timeline-context-menu-item"
              onClick={() => {
                if (contextMenu.type === "clip") {
                  store.removeClip(contextMenu.id);
                } else {
                  store.removeTextOverlay(contextMenu.id);
                }
                setContextMenu(null);
              }}
            >
              Delete
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
