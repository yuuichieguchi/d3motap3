#[macro_use]
extern crate napi_derive;

mod audio;
mod capture;
mod compositor;
mod encoder;
mod recording;
mod script;
mod sync;
mod mobile;
mod ai;
mod editor;

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
pub fn add_source(_source_type: String, config_json: String) -> napi::Result<u32> {
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
            let (w, h) = mobile::adb::get_device_resolution(&device_serial)
                .unwrap_or((width, height));
            let mut src = mobile::android::AndroidCaptureSource::new(device_serial, w, h);
            src.start().map_err(|e| napi::Error::from_reason(e))?;
            Box::new(src)
        }
        capture::SourceConfig::Ios {
            device_id,
            width,
            height,
        } => {
            let mut src = mobile::ios::IosCaptureSource::new(device_id, width, height)
                .map_err(|e| napi::Error::from_reason(e))?;
            src.start().map_err(|e| napi::Error::from_reason(e))?;
            Box::new(src)
        }
        capture::SourceConfig::Region {
            display_index,
            x,
            y,
            region_width,
            region_height,
        } => {
            let mut src = capture::region::RegionCaptureSource::new(
                display_index, x, y, region_width, region_height,
            )
            .map_err(|e| napi::Error::from_reason(e))?;
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
            let id = capture::try_with_registry(|reg| reg.add(source))
                .map_err(|e| napi::Error::from_reason(e))?;
            // Register the terminal handle so terminal_write_input / terminal_resize work.
            if let Some(h) = handle {
                capture::terminal::register_terminal_handle(id, h);
            }
            return Ok(id);
        }
    };

    capture::try_with_registry(|reg| reg.add(source))
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
// Audio Devices
// -------------------------------------------------------------------------

#[napi(object)]
pub struct AudioDeviceInfoJs {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[napi]
pub fn list_audio_input_devices() -> Vec<AudioDeviceInfoJs> {
    audio::list_audio_input_devices()
        .into_iter()
        .map(|d| AudioDeviceInfoJs {
            id: d.id,
            name: d.name,
            is_default: d.is_default,
        })
        .collect()
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
    capture_system_audio: bool,
    capture_microphone: bool,
    microphone_device_id: Option<String>,
) -> napi::Result<()> {
    recording::start_recording_v2_impl(recording::RecordingConfigV2 {
        output_width,
        output_height,
        fps,
        output_path,
        format,
        quality,
        capture_system_audio,
        capture_microphone,
        microphone_device_id,
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

// -------------------------------------------------------------------------
// Script Engine
// -------------------------------------------------------------------------

#[napi]
pub fn script_run(yaml_path: String, output_path: String) -> napi::Result<()> {
    script::engine::run_script(yaml_path, output_path)
        .map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub fn script_cancel() -> napi::Result<()> {
    script::engine::cancel_script()
        .map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub fn script_status() -> String {
    script::engine::get_script_status_json()
}

// -------------------------------------------------------------------------
// AI Integration
// -------------------------------------------------------------------------

#[napi]
pub fn ai_start_narration(description: String, api_key: String) -> napi::Result<()> {
    ai::start_narration(description, api_key)
        .map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub fn ai_start_script_gen(description: String, api_key: String) -> napi::Result<()> {
    ai::start_script_gen(description, api_key)
        .map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub fn ai_status() -> String {
    ai::get_ai_status_json()
}

#[napi]
pub fn ai_cancel() -> napi::Result<()> {
    ai::cancel_ai()
        .map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub fn ai_reset() -> napi::Result<()> {
    ai::reset_ai_status()
        .map_err(|e| napi::Error::from_reason(e))
}

// -------------------------------------------------------------------------
// Caption Overlay
// -------------------------------------------------------------------------

#[napi]
pub fn set_caption(text: String, position: String) -> napi::Result<()> {
    let pos = match position.as_str() {
        "top" => script::types::CaptionPosition::Top,
        "center" => script::types::CaptionPosition::Center,
        _ => script::types::CaptionPosition::Bottom,
    };
    let mut guard = recording::ACTIVE_CAPTION.lock()
        .map_err(|e| napi::Error::from_reason(format!("Caption lock error: {}", e)))?;
    *guard = Some(recording::ActiveCaption {
        text,
        position: pos,
        font_size: 48.0,
    });
    Ok(())
}

#[napi]
pub fn clear_caption() -> napi::Result<()> {
    let mut guard = recording::ACTIVE_CAPTION.lock()
        .map_err(|e| napi::Error::from_reason(format!("Caption lock error: {}", e)))?;
    *guard = None;
    Ok(())
}

// -------------------------------------------------------------------------
// Video Editor
// -------------------------------------------------------------------------

#[napi(object)]
pub struct VideoMetadataJs {
    pub duration_ms: i64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub codec: String,
}

#[napi]
pub fn editor_probe(path: String) -> napi::Result<VideoMetadataJs> {
    editor::editor_probe(path)
        .map(|m| VideoMetadataJs {
            duration_ms: m.duration_ms as i64,
            width: m.width,
            height: m.height,
            fps: m.fps,
            codec: m.codec,
        })
        .map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub fn editor_thumbnails(path: String, count: u32, width: u32) -> napi::Result<Vec<napi::bindgen_prelude::Buffer>> {
    editor::editor_thumbnails(path, count, width)
        .map(|thumbs| thumbs.into_iter().map(|t| t.into()).collect())
        .map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub fn editor_export(project_json: String, output_path: String) -> napi::Result<()> {
    editor::editor_export(project_json, output_path)
        .map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub fn editor_export_status() -> String {
    editor::editor_export_status()
}

#[napi]
pub fn editor_probe_bundle(bundle_path: String) -> napi::Result<String> {
    editor::editor_probe_bundle(bundle_path)
        .map_err(|e| napi::Error::from_reason(e))
}

// -------------------------------------------------------------------------
// Punch-in Recording
// -------------------------------------------------------------------------

#[napi]
pub fn punch_in_start(output_path: String, microphone_device_id: Option<String>) -> napi::Result<()> {
    let path = std::path::Path::new(&output_path);
    audio::system::punch_in_start(path, microphone_device_id)
        .map_err(|e| napi::Error::from_reason(e))
}

#[napi]
pub fn punch_in_stop() -> napi::Result<String> {
    let temp = audio::system::punch_in_stop()
        .map_err(|e| napi::Error::from_reason(e))?;

    // Return the mic audio path and format info as JSON
    let result = serde_json::json!({
        "micPath": temp.mic_audio_path.map(|p| p.to_string_lossy().into_owned()),
        "sampleRate": temp.mic_sample_rate.unwrap_or(48000),
        "channels": temp.mic_channel_count.unwrap_or(1),
    });

    Ok(result.to_string())
}

#[napi]
pub fn is_punch_in_active() -> bool {
    audio::system::is_punch_in_active()
}
