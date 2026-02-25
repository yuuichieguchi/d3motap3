//! macOS ScreenCaptureKit implementation.
//!
//! Provides two APIs:
//!
//! 1. **Instance-based** — `DisplayCaptureSource` implements the `CaptureSource`
//!    trait for use in the multi-source recording pipeline.
//!
//! 2. **Legacy global** — `start_capture_impl`, `stop_capture_impl`, etc. use
//!    module-level statics and are consumed by `recording.rs` / `lib.rs`.

use super::source::{CaptureSource, with_registry};
use super::{CapturedFrame, DisplayInfoData};
use std::sync::LazyLock;
use screencapturekit::cv::CVPixelBufferLockFlags;
use screencapturekit::prelude::*;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

// ===========================================================================
// Instance-based DisplayCaptureSource
// ===========================================================================

/// Per-instance capture source backed by ScreenCaptureKit's `SCStream`.
pub struct DisplayCaptureSource {
    display_id: u32,
    width: u32,
    height: u32,
    source_name: String,
    latest_frame: Arc<Mutex<Option<Arc<CapturedFrame>>>>,
    is_active: Arc<AtomicBool>,
    frame_count: Arc<AtomicU64>,
    stream: Option<SCStream>,
}

// SCStream is not marked Send/Sync by the crate.
// We guard stream access through &mut self methods (start/stop), so
// concurrent mutation is impossible.
unsafe impl Send for DisplayCaptureSource {}

impl DisplayCaptureSource {
    /// Create a new display capture source targeting `display_index`.
    ///
    /// Validates that the display index exists but does **not** start
    /// capturing — call `start()` for that.
    pub fn new(display_index: u32, width: u32, height: u32) -> Result<Self, String> {
        let content = SCShareableContent::get()
            .map_err(|e| format!("Failed to get shareable content: {}", e))?;
        let displays = content.displays();
        let display = displays.get(display_index as usize).ok_or_else(|| {
            format!(
                "Display index {} out of range (have {})",
                display_index,
                displays.len()
            )
        })?;

        // Offset width by +2 when another active source already uses the same
        // dimensions, so the dimension-based frame filter can distinguish them.
        let adjusted_width = with_registry(|reg| {
            let has_conflict = reg.active_sources().iter().any(|(_, s)| {
                let (w, h) = s.dimensions();
                w == width && h == height
            });
            if has_conflict { width.saturating_add(2) } else { width }
        }).unwrap_or(width);

        let source_name = format!(
            "Display {} ({}x{})",
            display_index + 1,
            display.width(),
            display.height()
        );

        Ok(Self {
            display_id: display.display_id(),
            width: adjusted_width,
            height,
            source_name,
            latest_frame: Arc::new(Mutex::new(None)),
            is_active: Arc::new(AtomicBool::new(false)),
            frame_count: Arc::new(AtomicU64::new(0)),
            stream: None,
        })
    }

    /// Create a new display capture source targeting a specific `display_id`.
    ///
    /// Unlike `new()` which uses a positional index, this constructor uses the
    /// CGDirectDisplayID directly. This is required for iOS devices which are
    /// identified by their display ID rather than position.
    pub fn from_display_id(display_id: u32, width: u32, height: u32, name: String) -> Result<Self, String> {
        let content = SCShareableContent::get()
            .map_err(|e| format!("Failed to get shareable content: {}", e))?;
        let displays = content.displays();

        // Verify the display_id exists
        if !displays.iter().any(|d| d.display_id() == display_id) {
            return Err(format!(
                "Display with ID {} not found (have {} displays)",
                display_id,
                displays.len()
            ));
        }

        // Offset width by +2 when another active source already uses the same
        // dimensions, so the dimension-based frame filter can distinguish them.
        let adjusted_width = with_registry(|reg| {
            let has_conflict = reg.active_sources().iter().any(|(_, s)| {
                let (w, h) = s.dimensions();
                w == width && h == height
            });
            if has_conflict { width.saturating_add(2) } else { width }
        }).unwrap_or(width);

        Ok(Self {
            display_id,
            width: adjusted_width,
            height,
            source_name: name,
            latest_frame: Arc::new(Mutex::new(None)),
            is_active: Arc::new(AtomicBool::new(false)),
            frame_count: Arc::new(AtomicU64::new(0)),
            stream: None,
        })
    }
}

impl CaptureSource for DisplayCaptureSource {
    fn start(&mut self) -> Result<(), String> {
        if self.is_active.load(Ordering::Relaxed) {
            return Err("Already capturing".to_string());
        }

        let content = SCShareableContent::get()
            .map_err(|e| format!("Failed to get shareable content: {}", e))?;
        let displays = content.displays();
        let display = displays
            .iter()
            .find(|d| d.display_id() == self.display_id)
            .ok_or_else(|| {
                format!(
                    "Display with ID {} no longer available",
                    self.display_id
                )
            })?;

        let filter = SCContentFilter::create()
            .with_display(display)
            .with_excluding_windows(&[])
            .build();

        let config = SCStreamConfiguration::new()
            .with_width(self.width)
            .with_height(self.height)
            .with_pixel_format(PixelFormat::BGRA)
            .with_shows_cursor(true);

        let handler = InstanceFrameHandler {
            latest_frame: Arc::clone(&self.latest_frame),
            is_active: Arc::clone(&self.is_active),
            frame_count: Arc::clone(&self.frame_count),
            expected_width: self.width as usize,
            expected_height: self.height as usize,
        };

        let mut stream = SCStream::new(&filter, &config);
        stream.add_output_handler(handler, SCStreamOutputType::Screen);
        stream
            .start_capture()
            .map_err(|e| format!("Failed to start capture: {}", e))?;

        self.frame_count.store(0, Ordering::Relaxed);
        self.is_active.store(true, Ordering::Relaxed);
        self.stream = Some(stream);

        Ok(())
    }

    fn stop(&mut self) -> Result<(), String> {
        if !self.is_active.load(Ordering::Relaxed) {
            return Err("Not capturing".to_string());
        }

        self.is_active.store(false, Ordering::Relaxed);

        if let Some(stream) = self.stream.take() {
            stream
                .stop_capture()
                .map_err(|e| format!("Failed to stop capture: {}", e))?;
        }

        Ok(())
    }

    fn latest_frame(&self) -> Option<Arc<CapturedFrame>> {
        self.latest_frame.lock().ok()?.clone()
    }

    fn frame_count(&self) -> u64 {
        self.frame_count.load(Ordering::Relaxed)
    }

    fn dimensions(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    fn is_active(&self) -> bool {
        self.is_active.load(Ordering::Relaxed)
    }

    fn name(&self) -> &str {
        &self.source_name
    }
}

// ---------------------------------------------------------------------------
// Instance frame handler (used by DisplayCaptureSource)
// ---------------------------------------------------------------------------

struct InstanceFrameHandler {
    latest_frame: Arc<Mutex<Option<Arc<CapturedFrame>>>>,
    is_active: Arc<AtomicBool>,
    frame_count: Arc<AtomicU64>,
    expected_width: usize,
    expected_height: usize,
}

impl SCStreamOutputTrait for InstanceFrameHandler {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        if !matches!(of_type, SCStreamOutputType::Screen) {
            return;
        }
        if !self.is_active.load(Ordering::Relaxed) {
            return;
        }

        if let Some(pixel_buffer) = sample.image_buffer() {
            if let Ok(guard) = pixel_buffer.lock(CVPixelBufferLockFlags::READ_ONLY) {
                // Filter frames by expected dimensions to avoid cross-stream
                // contamination — the screencapturekit crate broadcasts all
                // frames to all registered handlers.
                if guard.width() != self.expected_width || guard.height() != self.expected_height {
                    return;
                }

                let timestamp_ms = sample
                    .presentation_timestamp()
                    .as_seconds()
                    .map(|s| s * 1000.0)
                    .unwrap_or(0.0);

                let frame = Arc::new(CapturedFrame {
                    data: guard.as_slice().to_vec(),
                    width: guard.width(),
                    height: guard.height(),
                    bytes_per_row: guard.bytes_per_row(),
                    timestamp_ms,
                });

                if let Ok(mut latest) = self.latest_frame.lock() {
                    *latest = Some(frame);
                }
                self.frame_count.fetch_add(1, Ordering::Relaxed);
            }
        }
    }
}

// ===========================================================================
// Legacy global capture state (used by recording.rs / lib.rs)
// ===========================================================================

static CAPTURE_STATE: LazyLock<Mutex<Option<CaptureStateInner>>> = LazyLock::new(|| Mutex::new(None));
static LATEST_FRAME: LazyLock<Mutex<Option<CapturedFrame>>> = LazyLock::new(|| Mutex::new(None));
static FRAME_COUNT: AtomicU64 = AtomicU64::new(0);
static IS_CAPTURING: AtomicBool = AtomicBool::new(false);

struct CaptureStateInner {
    stream: SCStream,
}

// SCStream is Send but not necessarily Sync in the crate.
// We guard all access through a Mutex, so this is safe.
unsafe impl Send for CaptureStateInner {}

// ---------------------------------------------------------------------------
// Legacy frame handler (uses module-level statics)
// ---------------------------------------------------------------------------

struct FrameHandler;

impl SCStreamOutputTrait for FrameHandler {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        if !matches!(of_type, SCStreamOutputType::Screen) {
            return;
        }
        if !IS_CAPTURING.load(Ordering::Relaxed) {
            return;
        }

        if let Some(pixel_buffer) = sample.image_buffer() {
            if let Ok(guard) = pixel_buffer.lock(CVPixelBufferLockFlags::READ_ONLY) {
                let timestamp_ms = sample
                    .presentation_timestamp()
                    .as_seconds()
                    .map(|s| s * 1000.0)
                    .unwrap_or(0.0);

                let frame = CapturedFrame {
                    data: guard.as_slice().to_vec(),
                    width: guard.width(),
                    height: guard.height(),
                    bytes_per_row: guard.bytes_per_row(),
                    timestamp_ms,
                };

                if let Ok(mut latest) = LATEST_FRAME.lock() {
                    *latest = Some(frame);
                }
                FRAME_COUNT.fetch_add(1, Ordering::Relaxed);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Legacy public API
// ---------------------------------------------------------------------------

pub fn list_displays_impl() -> Result<Vec<DisplayInfoData>, String> {
    let content = SCShareableContent::get()
        .map_err(|e| format!("Failed to get shareable content: {}", e))?;
    let displays = content.displays();
    Ok(displays
        .iter()
        .map(|d| DisplayInfoData {
            id: d.display_id(),
            width: d.width(),
            height: d.height(),
        })
        .collect())
}

pub fn start_capture_impl(display_index: u32, width: u32, height: u32) -> Result<(), String> {
    if IS_CAPTURING.load(Ordering::Relaxed) {
        return Err("Already capturing".to_string());
    }

    let content = SCShareableContent::get()
        .map_err(|e| format!("Failed to get shareable content: {}", e))?;
    let displays = content.displays();
    let display = displays
        .get(display_index as usize)
        .ok_or_else(|| {
            format!(
                "Display index {} out of range (have {})",
                display_index,
                displays.len()
            )
        })?;

    let filter = SCContentFilter::create()
        .with_display(display)
        .with_excluding_windows(&[])
        .build();

    let config = SCStreamConfiguration::new()
        .with_width(width)
        .with_height(height)
        .with_pixel_format(PixelFormat::BGRA)
        .with_shows_cursor(true);

    let mut stream = SCStream::new(&filter, &config);
    stream.add_output_handler(FrameHandler, SCStreamOutputType::Screen);
    stream
        .start_capture()
        .map_err(|e| format!("Failed to start capture: {}", e))?;

    FRAME_COUNT.store(0, Ordering::Relaxed);
    IS_CAPTURING.store(true, Ordering::Relaxed);

    let mut state = CAPTURE_STATE
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    *state = Some(CaptureStateInner { stream });

    Ok(())
}

pub fn stop_capture_impl() -> Result<(), String> {
    if !IS_CAPTURING.load(Ordering::Relaxed) {
        return Err("Not capturing".to_string());
    }

    IS_CAPTURING.store(false, Ordering::Relaxed);

    let mut state = CAPTURE_STATE
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    if let Some(capture) = state.take() {
        capture
            .stream
            .stop_capture()
            .map_err(|e| format!("Failed to stop capture: {}", e))?;
    }

    Ok(())
}

pub fn get_latest_frame_impl() -> Option<CapturedFrame> {
    LATEST_FRAME.lock().ok()?.take()
}

pub fn get_frame_count_impl() -> u64 {
    FRAME_COUNT.load(Ordering::Relaxed)
}

pub fn is_capturing_impl() -> bool {
    IS_CAPTURING.load(Ordering::Relaxed)
}