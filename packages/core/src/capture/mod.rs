//! Screen capture module using macOS ScreenCaptureKit.
//!
//! Provides display enumeration and real-time screen frame capture.
//! Only supported on macOS; other platforms return stub errors.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub mod window;
#[cfg(target_os = "macos")]
pub mod webcam;

#[cfg(target_os = "macos")]
pub use macos::*;

pub mod terminal;

pub mod source;
pub use source::{CaptureSource, SourceConfig, SourceId, SourceInfo, SourceRegistry, with_registry};

// -------------------------------------------------------------------------
// Shared data types (used by both macOS impl and napi exports)
// -------------------------------------------------------------------------

/// Metadata about a single display.
pub struct DisplayInfoData {
    pub id: u32,
    pub width: u32,
    pub height: u32,
}

/// A single captured video frame with raw BGRA pixel data.
pub struct CapturedFrame {
    pub data: Vec<u8>,
    pub width: usize,
    pub height: usize,
    pub bytes_per_row: usize,
    pub timestamp_ms: f64,
}

impl std::fmt::Debug for CapturedFrame {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CapturedFrame")
            .field("width", &self.width)
            .field("height", &self.height)
            .field("bytes_per_row", &self.bytes_per_row)
            .field("timestamp_ms", &self.timestamp_ms)
            .field("data_len", &self.data.len())
            .finish()
    }
}

// -------------------------------------------------------------------------
// Stub implementations for non-macOS platforms
// -------------------------------------------------------------------------

#[cfg(not(target_os = "macos"))]
pub fn list_displays_impl() -> Result<Vec<DisplayInfoData>, String> {
    Err("Screen capture is only supported on macOS".to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn start_capture_impl(_display_index: u32, _width: u32, _height: u32) -> Result<(), String> {
    Err("Screen capture is only supported on macOS".to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn stop_capture_impl() -> Result<(), String> {
    Err("Screen capture is only supported on macOS".to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn get_latest_frame_impl() -> Option<CapturedFrame> {
    None
}

#[cfg(not(target_os = "macos"))]
pub fn get_frame_count_impl() -> u64 {
    0
}

#[cfg(not(target_os = "macos"))]
pub fn is_capturing_impl() -> bool {
    false
}
