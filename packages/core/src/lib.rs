#[macro_use]
extern crate napi_derive;

mod capture;
mod compositor;
mod encoder;
mod recording;
mod script;
mod sync;
mod mobile;
mod ai;

use capture::CaptureSource;

#[napi]
pub fn hello() -> String {
    "Hello from d3motap3 Rust core!".to_string()
}

#[napi]
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

// -------------------------------------------------------------------------
// Screen Capture
// -------------------------------------------------------------------------

#[napi(object)]
pub struct DisplayInfo {
    pub id: u32,
    pub width: u32,
    pub height: u32,
}

#[napi]
pub fn list_displays() -> napi::Result<Vec<DisplayInfo>> {
    capture::list_displays_impl()
        .map(|displays| {
            displays
                .into_iter()
                .map(|d| DisplayInfo {
                    id: d.id,
                    width: d.width,
                    height: d.height,
                })
                .collect()
        })
        .map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub fn start_capture(display_index: u32, width: u32, height: u32) -> napi::Result<()> {
    capture::start_capture_impl(display_index, width, height)
        .map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub fn stop_capture() -> napi::Result<()> {
    capture::stop_capture_impl().map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub fn get_latest_frame() -> Option<napi::bindgen_prelude::Buffer> {
    capture::get_latest_frame_impl().map(|f| f.data.into())
}

#[napi]
pub fn get_frame_count() -> i64 {
    capture::get_frame_count_impl() as i64
}

#[napi]
pub fn is_capturing() -> bool {
    capture::is_capturing_impl()
}

// -------------------------------------------------------------------------
// FFmpeg Encoder
// -------------------------------------------------------------------------

#[napi]
pub fn ffmpeg_version() -> napi::Result<String> {
    encoder::get_ffmpeg_version().map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub fn is_ffmpeg_available() -> bool {
    encoder::is_ffmpeg_available()
}

// -------------------------------------------------------------------------
// Recording Pipeline
// -------------------------------------------------------------------------

#[napi(object)]
pub struct RecordingResultInfo {
    pub output_path: String,
    pub frame_count: i64,
    pub duration_ms: i64,
    pub format: String,
}

#[napi]
pub fn start_recording(
    display_index: u32,
    width: u32,
    height: u32,
    fps: u32,
    output_path: String,
    format: String,
    quality: String,
) -> napi::Result<()> {
    recording::start_recording_impl(recording::RecordingConfig {
        display_index,
        width,
        height,
        fps,
        output_path,
        format,
        quality,
    })
    .map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub fn stop_recording() -> napi::Result<RecordingResultInfo> {
    recording::stop_recording_impl()
        .map(|r| RecordingResultInfo {
            output_path: r.output_path,
            frame_count: r.frame_count as i64,
            duration_ms: r.duration_ms as i64,
            format: r.format,
        })
        .map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub fn get_recording_elapsed_ms() -> i64 {
    recording::get_recording_elapsed_ms() as i64
}

#[napi]
pub fn is_recording() -> bool {
    recording::is_recording()
}

// -------------------------------------------------------------------------
// Multi-Source Management
// -------------------------------------------------------------------------

#[napi(object)]
pub struct SourceInfoJs {
    pub id: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub is_active: bool,
}

/// Add a capture source. `source_type` is "display", "window", or "webcam".
/// `config_json` is a JSON string with source-specific config.
#[napi]
pub fn add_source(source_type: String, config_json: String) -> napi::Result<u32> {
    let config: capture::SourceConfig = serde_json::from_str(&config_json)
        .map_err(|e| napi::Error::from_reason(format!("Invalid config JSON: {}", e)))?;

    let source: Box<dyn capture::CaptureSource> = match config {
        capture::SourceConfig::Display {
            display_index,
            width,
            height,
        } => {
            let mut src = capture::DisplayCaptureSource::new(display_index, width, height)
                .map_err(|e| napi::Error::from_reason(e))?;
            src.start().map_err(|e| napi::Error::from_reason(e))?;
            Box::new(src)
        }
        capture::SourceConfig::Window {
            window_id,
            width,
            height,
        } => {
            let mut src = capture::window::WindowCaptureSource::new(window_id, width, height)
                .map_err(|e| napi::Error::from_reason(e))?;
            src.start().map_err(|e| napi::Error::from_reason(e))?;
            Box::new(src)
        }
        capture::SourceConfig::Webcam {
            device_index,
            width,
            height,
        } => {
            let mut src = capture::webcam::WebcamCaptureSource::new(device_index, width, height)
                .map_err(|e| napi::Error::from_reason(e))?;
            src.start().map_err(|e| napi::Error::from_reason(e))?;
            Box::new(src)
        }
        capture::SourceConfig::Android {
            device_serial,
            width,
            height,
        } => {
            let mut src = mobile::android::AndroidCaptureSource::new(device_serial, width, height);
            src.start().map_err(|e| napi::Error::from_reason(e))?;
            Box::new(src)
        }
        capture::SourceConfig::Ios {
            device_id,
            width,
            height,
        } => {
            let mut src = mobile::ios::IosCaptureSource::new(device_id, width, height);
            src.start().map_err(|e| napi::Error::from_reason(e))?;
            Box::new(src)
        }
        capture::SourceConfig::Terminal {
            shell,
            rows,
            cols,
            width,
            height,
        } => {
            let config = capture::terminal::TerminalConfig {
                shell,
                rows,
                cols,
                width,
                height,
                ..capture::terminal::TerminalConfig::default()
            };
            let mut src = capture::terminal::TerminalCaptureSource::new(config);
            src.start().map_err(|e| napi::Error::from_reason(e))?;
            // Extract the handle channels before moving src into the registry.
            let handle = src.take_handle();
            let source: Box<dyn capture::CaptureSource> = Box::new(src);
            let id = capture::with_registry(|reg| reg.add(source))
                .map_err(|e| napi::Error::from_reason(e))?;
            // Register the terminal handle so terminal_write_input / terminal_resize work.
            if let Some(h) = handle {
                capture::terminal::register_terminal_handle(id, h);
            }
            return Ok(id);
        }
    };

    capture::with_registry(|reg| reg.add(source))
        .map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub fn remove_source(source_id: u32) -> napi::Result<()> {
    // Clean up terminal handle (no-op if this source is not a terminal).
    capture::terminal::remove_terminal_handle(source_id);
    capture::with_registry(|reg| reg.remove(source_id))
        .map_err(|e| napi::Error::from_reason(e))?
        .map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub fn list_sources() -> napi::Result<Vec<SourceInfoJs>> {
    capture::with_registry(|reg| {
        reg.list()
            .into_iter()
            .map(|s| SourceInfoJs {
                id: s.id,
                name: s.name,
                width: s.width,
                height: s.height,
                is_active: s.is_active,
            })
            .collect()
    })
    .map_err(|e| napi::Error::from_reason(e))
}

// -------------------------------------------------------------------------
// Window Listing
// -------------------------------------------------------------------------

#[napi(object)]
pub struct WindowInfoJs {
    pub window_id: u32,
    pub title: String,
    pub app_name: String,
    pub is_on_screen: bool,
}

#[napi]
pub fn list_windows() -> napi::Result<Vec<WindowInfoJs>> {
    capture::window::list_windows_impl()
        .map(|windows| {
            windows
                .into_iter()
                .map(|w| WindowInfoJs {
                    window_id: w.window_id,
                    title: w.title,
                    app_name: w.app_name,
                    is_on_screen: w.is_on_screen,
                })
                .collect()
        })
        .map_err(|e| napi::Error::from_reason(e))
}

// -------------------------------------------------------------------------
// Webcam Listing
// -------------------------------------------------------------------------

#[napi(object)]
pub struct WebcamInfoJs {
    pub device_index: u32,
    pub name: String,
    pub description: String,
}

#[napi]
pub fn list_webcams() -> napi::Result<Vec<WebcamInfoJs>> {
    capture::webcam::list_webcams_impl()
        .map(|cams| {
            cams.into_iter()
                .map(|c| WebcamInfoJs {
                    device_index: c.device_index,
                    name: c.name,
                    description: c.description,
                })
                .collect()
        })
        .map_err(|e| napi::Error::from_reason(e))
}

// -------------------------------------------------------------------------
// Layout
// -------------------------------------------------------------------------

#[napi]
pub fn set_layout(layout_json: String) -> napi::Result<()> {
    let layout: compositor::Layout = serde_json::from_str(&layout_json)
        .map_err(|e| napi::Error::from_reason(format!("Invalid layout JSON: {}", e)))?;
    recording::set_layout_impl(layout);
    Ok(())
}

// -------------------------------------------------------------------------
// Preview
// -------------------------------------------------------------------------

#[napi]
pub fn get_preview_frame(max_width: u32, max_height: u32) -> Option<napi::bindgen_prelude::Buffer> {
    recording::get_preview_frame_impl(max_width, max_height).map(|data| data.into())
}

// -------------------------------------------------------------------------
// Recording Pipeline V2 (multi-source)
// -------------------------------------------------------------------------

#[napi]
pub fn start_recording_v2(
    output_width: u32,
    output_height: u32,
    fps: u32,
    output_path: String,
    format: String,
    quality: String,
) -> napi::Result<()> {
    recording::start_recording_v2_impl(recording::RecordingConfigV2 {
        output_width,
        output_height,
        fps,
        output_path,
        format,
        quality,
    })
    .map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub fn stop_recording_v2() -> napi::Result<RecordingResultInfo> {
    recording::stop_recording_v2_impl()
        .map(|r| RecordingResultInfo {
            output_path: r.output_path,
            frame_count: r.frame_count as i64,
            duration_ms: r.duration_ms as i64,
            format: r.format,
        })
        .map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub fn get_recording_v2_elapsed_ms() -> i64 {
    recording::get_recording_v2_elapsed_ms() as i64
}

#[napi]
pub fn is_recording_v2() -> bool {
    recording::is_recording_v2()
}

// -------------------------------------------------------------------------
// Mobile Device Listing
// -------------------------------------------------------------------------

#[napi(object)]
pub struct AdbDeviceJs {
    pub serial: String,
    pub model: String,
    pub state: String,
}

#[napi]
pub fn list_android_devices() -> napi::Result<Vec<AdbDeviceJs>> {
    mobile::adb::list_devices()
        .map(|devices| {
            devices.into_iter()
                .map(|d| AdbDeviceJs {
                    serial: d.serial,
                    model: d.model,
                    state: d.state,
                })
                .collect()
        })
        .map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub fn is_adb_available() -> bool {
    mobile::adb::is_adb_available()
}

#[napi(object)]
pub struct IosDeviceJs {
    pub device_id: String,
    pub name: String,
    pub model: String,
}

#[napi]
pub fn list_ios_devices() -> napi::Result<Vec<IosDeviceJs>> {
    mobile::ios::list_ios_devices()
        .map(|devices| {
            devices.into_iter()
                .map(|d| IosDeviceJs {
                    device_id: d.device_id,
                    name: d.name,
                    model: d.model,
                })
                .collect()
        })
        .map_err(|e| napi::Error::from_reason(e))
}

// -------------------------------------------------------------------------
// Terminal PTY
// -------------------------------------------------------------------------

#[napi]
pub fn terminal_write_input(source_id: u32, data: napi::bindgen_prelude::Buffer) -> napi::Result<()> {
    capture::terminal::terminal_write_input(source_id, &data)
        .map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub fn terminal_resize(source_id: u32, rows: u16, cols: u16) -> napi::Result<()> {
    capture::terminal::terminal_resize(source_id, rows, cols)
        .map_err(|e| napi::Error::from_reason(e))
}
