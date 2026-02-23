//! Recording orchestrator that wires screen capture to FFmpeg encoding
//! in a background thread.
//!
//! The capture module produces raw BGRA frames via ScreenCaptureKit,
//! and this module polls those frames at the configured fps and pipes
//! them into an `FfmpegEncoder` running on a dedicated thread.

use crate::capture;
use crate::capture::source::{with_registry, SourceId};
use crate::compositor::{Compositor, Layout};
use crate::encoder::{EncoderConfig, EncoderQuality, FfmpegEncoder, OutputFormat};
use crate::sync::SourceBufferManager;
use std::sync::LazyLock;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------

static RECORDING_STATE: LazyLock<Mutex<Option<RecordingHandle>>> = LazyLock::new(|| Mutex::new(None));
static RECORDING_ACTIVE: AtomicBool = AtomicBool::new(false);
static CURRENT_LAYOUT: LazyLock<Mutex<Option<Layout>>> = LazyLock::new(|| Mutex::new(None));

struct RecordingHandle {
    encode_thread: Option<thread::JoinHandle<Result<RecordingResult, String>>>,
    start_time: Instant,
}

// ---------------------------------------------------------------------------
// Public data types
// ---------------------------------------------------------------------------

pub struct RecordingConfig {
    pub display_index: u32,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub output_path: String,
    pub format: String,
    pub quality: String,
}

pub struct RecordingResult {
    pub output_path: String,
    pub frame_count: u64,
    pub duration_ms: u64,
    pub format: String,
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

pub fn start_recording_impl(config: RecordingConfig) -> Result<(), String> {
    if RECORDING_ACTIVE.load(Ordering::Relaxed) {
        return Err("Already recording".to_string());
    }

    let format = match config.format.as_str() {
        "mp4" => OutputFormat::Mp4,
        "gif" => OutputFormat::Gif,
        "webm" => OutputFormat::WebM,
        _ => return Err(format!("Unknown format: {}", config.format)),
    };

    let quality = match config.quality.as_str() {
        "low" => EncoderQuality::Low,
        "medium" => EncoderQuality::Medium,
        "high" => EncoderQuality::High,
        _ => EncoderQuality::Medium,
    };

    // Start screen capture
    capture::start_capture_impl(config.display_index, config.width, config.height)?;

    RECORDING_ACTIVE.store(true, Ordering::Relaxed);
    let start_time = Instant::now();

    let width = config.width;
    let height = config.height;
    let fps = config.fps;
    let output_path = config.output_path.clone();

    // Spawn encoding thread that polls frames from capture and feeds to FFmpeg
    let encode_thread = thread::spawn(move || {
        // Wait for first frame to determine bytes_per_row
        let mut first_frame = None;
        for _ in 0..100 {
            if let Some(frame) = capture::get_latest_frame_impl() {
                first_frame = Some(frame);
                break;
            }
            thread::sleep(Duration::from_millis(30));
        }

        let first_frame =
            first_frame.ok_or_else(|| "No frames received from capture".to_string())?;

        let encoder_config = EncoderConfig {
            width,
            height,
            fps,
            output_path: PathBuf::from(&output_path),
            format,
            quality,
            bytes_per_row: Some(first_frame.bytes_per_row),
        };

        let mut encoder = FfmpegEncoder::new(encoder_config)?;

        // Write first frame
        encoder.write_frame(&first_frame.data)?;

        let frame_interval = Duration::from_micros(1_000_000 / u64::from(fps));

        // Main encoding loop
        while RECORDING_ACTIVE.load(Ordering::Relaxed) {
            if let Some(frame) = capture::get_latest_frame_impl() {
                encoder.write_frame(&frame.data)?;
            }
            thread::sleep(frame_interval);
        }

        let result = encoder.finish()?;
        let duration_ms = start_time.elapsed().as_millis() as u64;

        Ok(RecordingResult {
            output_path: result.output_path,
            frame_count: result.frame_count,
            duration_ms,
            format: result.format,
        })
    });

    let mut state = RECORDING_STATE
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    *state = Some(RecordingHandle {
        encode_thread: Some(encode_thread),
        start_time,
    });

    Ok(())
}

pub fn stop_recording_impl() -> Result<RecordingResult, String> {
    if !RECORDING_ACTIVE.load(Ordering::Relaxed) {
        return Err("Not recording".to_string());
    }

    // Signal the encoding thread to stop
    RECORDING_ACTIVE.store(false, Ordering::Relaxed);

    // Stop capture
    let _ = capture::stop_capture_impl();

    // Wait for encoding thread to finish
    let mut state = RECORDING_STATE
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    let mut handle = state.take().ok_or_else(|| "No recording handle".to_string())?;

    let thread = handle
        .encode_thread
        .take()
        .ok_or_else(|| "No encoding thread".to_string())?;

    thread
        .join()
        .map_err(|_| "Encoding thread panicked".to_string())?
}

pub fn get_recording_elapsed_ms() -> u64 {
    if !RECORDING_ACTIVE.load(Ordering::Relaxed) {
        return 0;
    }
    RECORDING_STATE
        .lock()
        .ok()
        .and_then(|state| state.as_ref().map(|h| h.start_time.elapsed().as_millis() as u64))
        .unwrap_or(0)
}

pub fn is_recording() -> bool {
    RECORDING_ACTIVE.load(Ordering::Relaxed)
}

// ---------------------------------------------------------------------------
// Layout management
// ---------------------------------------------------------------------------

pub fn set_layout_impl(layout: Layout) {
    if let Ok(mut l) = CURRENT_LAYOUT.lock() {
        *l = Some(layout);
    }
}

pub fn get_layout_impl() -> Option<Layout> {
    CURRENT_LAYOUT.lock().ok()?.clone()
}

// ---------------------------------------------------------------------------
// Preview compositor
// ---------------------------------------------------------------------------

pub fn get_preview_frame_impl(max_width: u32, max_height: u32) -> Option<Vec<u8>> {
    let layout = CURRENT_LAYOUT.lock().ok()?.clone()?;

    // Collect latest frames from all active sources
    let frames = with_registry(|reg| {
        let mut frames = std::collections::HashMap::new();
        for (id, source) in reg.active_sources() {
            if let Some(frame) = source.latest_frame() {
                frames.insert(id, frame);
            }
        }
        frames
    })
    .ok()?;

    if frames.is_empty() {
        return None;
    }

    let mut compositor = Compositor::new(max_width as usize, max_height as usize);
    let composed = compositor.compose(&layout, &frames);
    Some(composed.to_vec())
}

// ---------------------------------------------------------------------------
// V2 recording pipeline (multi-source with compositor)
// ---------------------------------------------------------------------------

pub struct RecordingConfigV2 {
    pub output_width: u32,
    pub output_height: u32,
    pub fps: u32,
    pub output_path: String,
    pub format: String,
    pub quality: String,
}

static RECORDING_V2_STATE: LazyLock<Mutex<Option<RecordingHandleV2>>> =
    LazyLock::new(|| Mutex::new(None));
static RECORDING_V2_ACTIVE: AtomicBool = AtomicBool::new(false);

struct RecordingHandleV2 {
    collector_thread: Option<thread::JoinHandle<()>>,
    encoder_thread: Option<thread::JoinHandle<Result<RecordingResult, String>>>,
    start_time: Instant,
}

pub fn start_recording_v2_impl(config: RecordingConfigV2) -> Result<(), String> {
    if RECORDING_V2_ACTIVE.load(Ordering::Relaxed) {
        return Err("Already recording (v2)".to_string());
    }

    let format = match config.format.as_str() {
        "mp4" => OutputFormat::Mp4,
        "gif" => OutputFormat::Gif,
        "webm" => OutputFormat::WebM,
        _ => return Err(format!("Unknown format: {}", config.format)),
    };
    let quality = match config.quality.as_str() {
        "low" => EncoderQuality::Low,
        "medium" => EncoderQuality::Medium,
        "high" => EncoderQuality::High,
        _ => EncoderQuality::Medium,
    };

    // Get active source IDs
    let source_ids: Vec<SourceId> = with_registry(|reg| {
        reg.active_sources().iter().map(|(id, _)| *id).collect()
    })?;

    if source_ids.is_empty() {
        return Err("No active sources".to_string());
    }

    let layout = CURRENT_LAYOUT
        .lock()
        .map_err(|e| format!("Layout lock error: {}", e))?
        .clone()
        .ok_or_else(|| "No layout set".to_string())?;

    RECORDING_V2_ACTIVE.store(true, Ordering::Relaxed);
    let start_time = Instant::now();

    let width = config.output_width;
    let height = config.output_height;
    let fps = config.fps;
    let output_path = config.output_path.clone();

    // Shared buffer manager between collector and encoder threads
    let buffer_manager = Arc::new(Mutex::new(SourceBufferManager::new(fps)));
    {
        let mut bm = buffer_manager
            .lock()
            .map_err(|e| format!("BM lock: {}", e))?;
        for &id in &source_ids {
            bm.add_source(id);
        }
    }

    // Thread 1: Frame Collector -- polls sources every 5ms
    let bm_collector = Arc::clone(&buffer_manager);
    let collector_source_ids = source_ids.clone();
    let collector_thread = thread::spawn(move || {
        while RECORDING_V2_ACTIVE.load(Ordering::Relaxed) {
            let _ = with_registry(|reg| {
                for &id in &collector_source_ids {
                    if let Some(src) = reg.get(id) {
                        if let Some(frame) = src.latest_frame() {
                            if let Ok(mut bm) = bm_collector.lock() {
                                let _ = bm.push_frame(id, frame);
                            }
                        }
                    }
                }
            });
            thread::sleep(Duration::from_millis(5));
        }
    });

    // Thread 2: Encoder -- at FPS interval, compose + encode
    let bm_encoder = Arc::clone(&buffer_manager);
    let encoder_thread = thread::spawn(move || {
        // Wait for first frame from any source
        let mut first_frames = std::collections::HashMap::new();
        for _ in 0..200 {
            // Up to ~1 second
            if let Ok(bm) = bm_encoder.lock() {
                first_frames = bm.get_latest_frames();
            }
            if !first_frames.is_empty() {
                break;
            }
            thread::sleep(Duration::from_millis(5));
        }

        if first_frames.is_empty() {
            return Err("No frames received from any source".to_string());
        }

        let mut compositor = Compositor::new(width as usize, height as usize);

        let encoder_config = EncoderConfig {
            width,
            height,
            fps,
            output_path: PathBuf::from(&output_path),
            format,
            quality,
            bytes_per_row: None, // Compositor output is tightly packed
        };

        let mut encoder = FfmpegEncoder::new(encoder_config)?;

        // Write first composed frame
        let composed = compositor.compose(&layout, &first_frames);
        encoder.write_frame(composed)?;

        let frame_interval = Duration::from_micros(1_000_000 / u64::from(fps));

        // Main encoding loop
        while RECORDING_V2_ACTIVE.load(Ordering::Relaxed) {
            let frames = if let Ok(bm) = bm_encoder.lock() {
                bm.get_latest_frames()
            } else {
                std::collections::HashMap::new()
            };

            if !frames.is_empty() {
                let composed = compositor.compose(&layout, &frames);
                encoder.write_frame(composed)?;
            }

            thread::sleep(frame_interval);
        }

        let result = encoder.finish()?;
        let duration_ms = start_time.elapsed().as_millis() as u64;

        Ok(RecordingResult {
            output_path: result.output_path,
            frame_count: result.frame_count,
            duration_ms,
            format: result.format,
        })
    });

    let mut state = RECORDING_V2_STATE
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    *state = Some(RecordingHandleV2 {
        collector_thread: Some(collector_thread),
        encoder_thread: Some(encoder_thread),
        start_time,
    });

    Ok(())
}

pub fn stop_recording_v2_impl() -> Result<RecordingResult, String> {
    if !RECORDING_V2_ACTIVE.load(Ordering::Relaxed) {
        return Err("Not recording (v2)".to_string());
    }

    RECORDING_V2_ACTIVE.store(false, Ordering::Relaxed);

    let mut state = RECORDING_V2_STATE
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    let mut handle = state
        .take()
        .ok_or_else(|| "No v2 recording handle".to_string())?;

    // Wait for collector to finish
    if let Some(collector) = handle.collector_thread.take() {
        let _ = collector.join();
    }

    // Wait for encoder to finish
    let encoder = handle
        .encoder_thread
        .take()
        .ok_or_else(|| "No encoder thread".to_string())?;

    encoder
        .join()
        .map_err(|_| "Encoder thread panicked".to_string())?
}

pub fn get_recording_v2_elapsed_ms() -> u64 {
    if !RECORDING_V2_ACTIVE.load(Ordering::Relaxed) {
        return 0;
    }
    RECORDING_V2_STATE
        .lock()
        .ok()
        .and_then(|state| state.as_ref().map(|h| h.start_time.elapsed().as_millis() as u64))
        .unwrap_or(0)
}

pub fn is_recording_v2() -> bool {
    RECORDING_V2_ACTIVE.load(Ordering::Relaxed)
}
