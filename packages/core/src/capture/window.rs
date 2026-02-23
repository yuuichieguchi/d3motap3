//! Window capture using macOS ScreenCaptureKit.
//!
//! Provides window enumeration and per-window real-time frame capture via
//! the `CaptureSource` trait.

use super::{source::CaptureSource, CapturedFrame};
use screencapturekit::cv::CVPixelBufferLockFlags;
use screencapturekit::prelude::*;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

// ---------------------------------------------------------------------------
// Window info
// ---------------------------------------------------------------------------

/// Metadata about a single on-screen window.
#[derive(Debug, Clone)]
pub struct WindowInfo {
    pub window_id: u32,
    pub title: String,
    pub app_name: String,
    pub is_on_screen: bool,
}

/// Enumerate all on-screen windows visible to ScreenCaptureKit.
pub fn list_windows_impl() -> Result<Vec<WindowInfo>, String> {
    let content = SCShareableContent::get()
        .map_err(|e| format!("Failed to get shareable content: {}", e))?;
    let windows = content.windows();
    Ok(windows
        .iter()
        .filter(|w| w.is_on_screen())
        .map(|w| {
            let app_name = w
                .owning_application()
                .map(|app| app.application_name())
                .unwrap_or_default();
            WindowInfo {
                window_id: w.window_id(),
                title: w.title().unwrap_or_default(),
                app_name,
                is_on_screen: w.is_on_screen(),
            }
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Frame handler
// ---------------------------------------------------------------------------

struct WindowFrameHandler {
    latest_frame: Arc<Mutex<Option<Arc<CapturedFrame>>>>,
    is_active: Arc<AtomicBool>,
    frame_count: Arc<AtomicU64>,
}

impl SCStreamOutputTrait for WindowFrameHandler {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        if !matches!(of_type, SCStreamOutputType::Screen) {
            return;
        }
        if !self.is_active.load(Ordering::Relaxed) {
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

                if let Ok(mut latest) = self.latest_frame.lock() {
                    *latest = Some(Arc::new(frame));
                }
                self.frame_count.fetch_add(1, Ordering::Relaxed);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// WindowCaptureSource
// ---------------------------------------------------------------------------

/// Capture source backed by a single macOS window.
pub struct WindowCaptureSource {
    window_id: u32,
    width: u32,
    height: u32,
    source_name: String,
    latest_frame: Arc<Mutex<Option<Arc<CapturedFrame>>>>,
    is_active: Arc<AtomicBool>,
    frame_count: Arc<AtomicU64>,
    stream: Option<SCStream>,
}

// SCStream is Send but not necessarily Sync in the crate.
// We guard all access through a Mutex, so this is safe.
unsafe impl Send for WindowCaptureSource {}

impl WindowCaptureSource {
    /// Create a new window capture source.
    ///
    /// Looks up the window by `window_id` to populate the human-readable
    /// source name. Capture dimensions are set to `width x height`.
    pub fn new(window_id: u32, width: u32, height: u32) -> Result<Self, String> {
        let content = SCShareableContent::get()
            .map_err(|e| format!("Failed to get shareable content: {}", e))?;
        let windows = content.windows();
        let window = windows
            .iter()
            .find(|w| w.window_id() == window_id)
            .ok_or_else(|| format!("Window with id {} not found", window_id))?;

        let title = window.title().unwrap_or_default();
        let app_name = window
            .owning_application()
            .map(|a| a.application_name())
            .unwrap_or_default();
        let source_name = format!("{} - {}", app_name, title);

        Ok(Self {
            window_id,
            width,
            height,
            source_name,
            latest_frame: Arc::new(Mutex::new(None)),
            is_active: Arc::new(AtomicBool::new(false)),
            frame_count: Arc::new(AtomicU64::new(0)),
            stream: None,
        })
    }
}

impl CaptureSource for WindowCaptureSource {
    fn start(&mut self) -> Result<(), String> {
        if self.is_active.load(Ordering::Relaxed) {
            return Err("Already capturing".to_string());
        }

        // Look up window again (it might have changed since construction).
        let content = SCShareableContent::get()
            .map_err(|e| format!("Failed to get shareable content: {}", e))?;
        let windows = content.windows();
        let window = windows
            .iter()
            .find(|w| w.window_id() == self.window_id)
            .ok_or_else(|| format!("Window with id {} not found", self.window_id))?;

        let filter = SCContentFilter::create().with_window(window).build();

        let config = SCStreamConfiguration::new()
            .with_width(self.width)
            .with_height(self.height)
            .with_pixel_format(PixelFormat::BGRA)
            .with_shows_cursor(true);

        let handler = WindowFrameHandler {
            latest_frame: Arc::clone(&self.latest_frame),
            is_active: Arc::clone(&self.is_active),
            frame_count: Arc::clone(&self.frame_count),
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
