//! Video editor backend.
//!
//! Provides ffprobe-based metadata extraction, thumbnail generation,
//! and multi-clip export with transitions and text overlays.

use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Mutex;

// ---------------------------------------------------------------------------
// FFprobe discovery
// ---------------------------------------------------------------------------

/// Locate the ffprobe binary by probing well-known paths.
fn find_ffprobe() -> Result<String, String> {
    const CANDIDATES: &[&str] = &[
        "/opt/homebrew/bin/ffprobe",
        "/usr/local/bin/ffprobe",
        "/usr/bin/ffprobe",
        "ffprobe",
    ];

    for &candidate in CANDIDATES {
        let ok = Command::new(candidate)
            .arg("-version")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);

        if ok {
            return Ok(candidate.to_string());
        }
    }

    Err(
        "ffprobe not found. Please install FFmpeg (e.g. `brew install ffmpeg` on macOS)."
            .to_string(),
    )
}

// ---------------------------------------------------------------------------
// Video metadata
// ---------------------------------------------------------------------------

/// Metadata extracted from a video file via ffprobe.
#[derive(Debug, Clone, serde::Serialize)]
pub struct VideoMetadata {
    pub duration_ms: u64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub codec: String,
}

/// Run ffprobe on `path` and return parsed [`VideoMetadata`].
pub fn editor_probe(path: String) -> Result<VideoMetadata, String> {
    let ffprobe_path = find_ffprobe()?;

    let output = Command::new(&ffprobe_path)
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            &path,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to execute ffprobe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe failed: {}", stderr));
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse ffprobe JSON: {}", e))?;

    parse_probe_json(&json)
}

/// Probe an audio file and return its duration in milliseconds.
pub fn editor_probe_audio(path: String) -> Result<u64, String> {
    let ffprobe_path = find_ffprobe()?;

    let output = Command::new(&ffprobe_path)
        .args([
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            &path,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Failed to execute ffprobe: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe failed: {}", stderr));
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse ffprobe JSON: {}", e))?;

    let duration_str = json["format"]["duration"]
        .as_str()
        .ok_or_else(|| "No duration found in audio file".to_string())?;

    let duration_secs: f64 = duration_str
        .parse()
        .map_err(|e| format!("Failed to parse duration '{}': {}", duration_str, e))?;

    Ok((duration_secs * 1000.0).round() as u64)
}

/// Read and return a `.d3m` project bundle manifest.
pub fn editor_probe_bundle(bundle_path: String) -> Result<String, String> {
    let project_path = std::path::Path::new(&bundle_path).join("project.json");
    let content = std::fs::read_to_string(&project_path)
        .map_err(|e| format!("Failed to read project.json: {}", e))?;

    // Validate it's valid JSON and a D3mProject
    let _project: D3mProject = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid project.json: {}", e))?;

    // Return the raw JSON string (already in camelCase from serialization)
    Ok(content)
}

/// Extract [`VideoMetadata`] from ffprobe JSON output.
fn parse_probe_json(json: &serde_json::Value) -> Result<VideoMetadata, String> {
    // Find the first video stream.
    let streams = json["streams"]
        .as_array()
        .ok_or_else(|| "ffprobe output missing 'streams' array".to_string())?;

    let video_stream = streams
        .iter()
        .find(|s| s["codec_type"].as_str() == Some("video"))
        .ok_or_else(|| "No video stream found".to_string())?;

    let width = video_stream["width"]
        .as_u64()
        .ok_or_else(|| "Missing 'width' in video stream".to_string())? as u32;

    let height = video_stream["height"]
        .as_u64()
        .ok_or_else(|| "Missing 'height' in video stream".to_string())? as u32;

    let codec = video_stream["codec_name"]
        .as_str()
        .unwrap_or("unknown")
        .to_string();

    // Parse fps from r_frame_rate (e.g. "30/1") or avg_frame_rate.
    let fps = parse_frame_rate(video_stream["r_frame_rate"].as_str())
        .or_else(|| parse_frame_rate(video_stream["avg_frame_rate"].as_str()))
        .unwrap_or(30.0);

    // Duration from format.duration (seconds as string).
    let duration_ms = json["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .map(|secs| (secs * 1000.0) as u64)
        .unwrap_or(0);

    Ok(VideoMetadata {
        duration_ms,
        width,
        height,
        fps,
        codec,
    })
}

/// Parse a frame rate string like "30/1" or "30000/1001" into an f64.
fn parse_frame_rate(rate_str: Option<&str>) -> Option<f64> {
    let s = rate_str?;
    if let Some((num_s, den_s)) = s.split_once('/') {
        let num: f64 = num_s.parse().ok()?;
        let den: f64 = den_s.parse().ok()?;
        if den == 0.0 {
            return None;
        }
        Some(num / den)
    } else {
        s.parse::<f64>().ok()
    }
}

// ---------------------------------------------------------------------------
// Thumbnail generation
// ---------------------------------------------------------------------------

/// Generate `count` JPEG thumbnails from the video at evenly spaced intervals.
///
/// Each thumbnail is scaled to `width` pixels wide (height preserves aspect ratio).
/// Returns a `Vec` of raw JPEG byte buffers.
pub fn editor_thumbnails(
    path: String,
    count: u32,
    width: u32,
) -> Result<Vec<Vec<u8>>, String> {
    let meta = editor_probe(path.clone())?;
    let duration_secs = meta.duration_ms as f64 / 1000.0;

    let ffmpeg_path = crate::encoder::find_ffmpeg()?;

    let mut thumbnails = Vec::with_capacity(count as usize);

    for i in 0..count {
        let timestamp = duration_secs * (i as f64) / (count as f64);
        let ts_str = format!("{:.3}", timestamp);
        let scale_filter = format!("scale={}:-1", width);

        let output = Command::new(&ffmpeg_path)
            .args([
                "-ss", &ts_str,
                "-i", &path,
                "-vframes", "1",
                "-vf", &scale_filter,
                "-pix_fmt", "yuvj420p",
                "-f", "image2pipe",
                "-vcodec", "mjpeg",
                "pipe:1",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| format!("Failed to generate thumbnail {}: {}", i, e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("FFmpeg thumbnail {} failed: {}", i, stderr));
        }

        thumbnails.push(output.stdout);
    }

    Ok(thumbnails)
}

// ---------------------------------------------------------------------------
// Export status tracking
// ---------------------------------------------------------------------------

/// Export status: 0 = idle, 1 = exporting, 2 = completed, 3 = failed.
static EXPORT_STATUS: AtomicU8 = AtomicU8::new(0);

/// Export progress percentage (0–100).
static EXPORT_PROGRESS: AtomicU8 = AtomicU8::new(0);

/// Last export error message (set when status == 3).
static EXPORT_ERROR: std::sync::LazyLock<Mutex<Option<String>>> =
    std::sync::LazyLock::new(|| Mutex::new(None));

fn status_label(code: u8) -> &'static str {
    match code {
        0 => "idle",
        1 => "exporting",
        2 => "completed",
        3 => "failed",
        _ => "unknown",
    }
}

/// Return the current export status as a JSON string.
pub fn editor_export_status() -> String {
    let status = EXPORT_STATUS.load(Ordering::Relaxed);
    let progress = EXPORT_PROGRESS.load(Ordering::Relaxed);
    let error = EXPORT_ERROR
        .lock()
        .ok()
        .and_then(|g| g.clone());

    format_export_status_json(status, progress, error.as_deref())
}

/// Pure helper for building the status JSON – easily testable without statics.
fn format_export_status_json(status: u8, progress: u8, error: Option<&str>) -> String {
    let label = status_label(status);
    match error {
        Some(msg) => {
            // Escape quotes in the error message for valid JSON.
            let escaped = msg.replace('\\', "\\\\").replace('"', "\\\"");
            format!(
                r#"{{"status":"{}","progress":{},"error":"{}"}}"#,
                label, progress, escaped
            )
        }
        None => {
            format!(
                r#"{{"status":"{}","progress":{},"error":null}}"#,
                label, progress
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Editor project types
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize)]
pub struct EditorProject {
    pub clips: Vec<EditorClip>,
    #[serde(default)]
    pub text_overlays: Vec<TextOverlay>,
    #[serde(default)]
    pub independent_audio_tracks: Vec<IndependentAudioTrackDef>,
    pub output_width: u32,
    pub output_height: u32,
}

#[derive(Debug, serde::Deserialize)]
pub struct EditorClip {
    pub id: String,
    pub source_path: String,
    pub original_duration: f64,
    pub trim_start: f64,
    pub trim_end: f64,
    pub order: u32,
    pub transition: Option<Transition>,
    #[serde(default)]
    pub bundle_path: Option<String>,
    #[serde(default)]
    pub audio_tracks: Option<Vec<AudioTrack>>,
    #[serde(default)]
    pub mixer_settings: Option<MixerSettings>,
}

#[derive(Debug, serde::Deserialize)]
pub struct Transition {
    #[serde(rename = "type")]
    pub transition_type: String,
    pub duration: f64,
}

#[derive(Debug, serde::Deserialize)]
pub struct TextOverlay {
    pub id: String,
    pub text: String,
    pub start_time: f64,
    pub end_time: f64,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub width: Option<f64>,
    pub font_size: u32,
    pub color: String,
    #[serde(default = "default_font_family")]
    pub font_family: String,
    #[serde(default = "default_normal")]
    pub font_weight: String,
    #[serde(default = "default_normal")]
    pub font_style: String,
    #[serde(default = "default_center")]
    pub text_align: String,
    #[serde(default)]
    pub background_color: Option<String>,
    #[serde(default)]
    pub border_color: Option<String>,
    #[serde(default)]
    pub border_width: f64,
    #[serde(default)]
    pub shadow_color: Option<String>,
    #[serde(default)]
    pub shadow_offset_x: f64,
    #[serde(default)]
    pub shadow_offset_y: f64,
    #[serde(default = "default_none")]
    pub animation: String,
    #[serde(default = "default_animation_duration")]
    pub animation_duration: f64,
}

fn default_font_family() -> String { "sans-serif".to_string() }
fn default_normal() -> String { "normal".to_string() }
fn default_center() -> String { "center".to_string() }
fn default_none() -> String { "none".to_string() }
fn default_animation_duration() -> f64 { 500.0 }

// ---------------------------------------------------------------------------
// Audio bundle data structures
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrack {
    pub id: String,
    #[serde(rename = "type")]
    pub track_type: String, // "system" | "mic"
    pub label: String,
    pub clips: Vec<AudioClip>,
    pub format: AudioFormat,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioClip {
    pub id: String,
    pub filename: String,
    pub start_ms: f64,
    pub end_ms: f64,
    pub offset_ms: f64,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioFormat {
    pub sample_rate: u32,
    pub channels: u32,
    pub encoding: String, // "f32le"
    pub bytes_per_sample: u32,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MixerSettings {
    pub tracks: Vec<TrackMixerSetting>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackMixerSetting {
    pub track_id: String,
    pub volume: f64, // 0.0 - 1.0
    pub muted: bool,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct D3mProject {
    pub version: u32,
    pub created_at: String,
    pub video: D3mVideo,
    pub audio_tracks: Vec<AudioTrack>,
    pub mixer: MixerSettings,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct D3mVideo {
    pub filename: String,
    pub duration_ms: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub codec: String,
}

// ---------------------------------------------------------------------------
// Independent audio tracks
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize)]
pub struct IndependentAudioTrackDef {
    pub id: String,
    pub label: String,
    pub clips: Vec<IndependentAudioClipDef>,
    pub volume: f64,
    pub muted: bool,
}

#[derive(Debug, serde::Deserialize)]
pub struct PcmFormatDef {
    pub sample_rate: u32,
    pub channels: u32,
    pub encoding: String,
    pub bytes_per_sample: u32,
}

#[derive(Debug, serde::Deserialize)]
pub struct IndependentAudioClipDef {
    pub id: String,
    pub source_path: String,
    pub original_duration: f64,
    pub trim_start: f64,
    pub trim_end: f64,
    pub timeline_start_ms: f64,
    #[serde(default)]
    pub pcm_format: Option<PcmFormatDef>,
}

// ---------------------------------------------------------------------------
// Filter-complex builder
// ---------------------------------------------------------------------------

/// Result of building the FFmpeg filter_complex and associated args.
#[derive(Debug, Clone, PartialEq)]
pub struct FilterComplexResult {
    /// The filter_complex string.
    pub filter_complex: String,
    /// The label of the final output pad (e.g. "[outv]").
    pub output_label: String,
    /// The label of the final audio output pad (e.g. "[a0]"), if any clip has audio.
    pub audio_output_label: Option<String>,
}

/// Check whether a media file contains an audio stream using ffprobe.
fn has_audio_stream(path: &str) -> bool {
    let ffprobe_path = match find_ffprobe() {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[editor] audio detection skipped (ffprobe not found): {}", e);
            return false;
        }
    };

    let output = Command::new(&ffprobe_path)
        .args([
            "-v", "quiet",
            "-select_streams", "a:0",
            "-show_entries", "stream=codec_type",
            "-of", "csv=p=0",
            path,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();

    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            stdout.trim() == "audio"
        }
        Err(e) => {
            eprintln!("[editor] audio detection failed for '{}': {}", path, e);
            false
        }
    }
}

/// Build an FFmpeg filter_complex string from the project definition.
///
/// This is a pure function that can be unit-tested without spawning processes.
pub fn build_filter_complex(project: &EditorProject, clip_has_audio: &[bool]) -> Result<FilterComplexResult, String> {
    if project.clips.is_empty() {
        return Err("No clips in project".to_string());
    }

    let mut clips = project.clips.iter().collect::<Vec<_>>();
    clips.sort_by_key(|c| c.order);

    if clip_has_audio.len() != clips.len() {
        return Err(format!(
            "clip_has_audio length ({}) does not match clips count ({})",
            clip_has_audio.len(),
            clips.len(),
        ));
    }

    let any_has_audio = clip_has_audio.iter().any(|&a| a);

    let mut filters: Vec<String> = Vec::new();
    // Will be set after the per-clip or concat/xfade section.
    let mut current_label;
    let mut audio_output_label: Option<String> = None;

    // Per-clip trim + scale filters.
    for (i, clip) in clips.iter().enumerate() {
        let start_s = clip.trim_start / 1000.0;
        let end_s = (clip.original_duration - clip.trim_end) / 1000.0;
        let label = format!("v{}", i);
        filters.push(format!(
            "[{}:v]trim=start={:.3}:end={:.3},setpts=PTS-STARTPTS,scale={}:{}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2[{}]",
            i, start_s, end_s,
            project.output_width, project.output_height,
            project.output_width, project.output_height,
            label,
        ));
    }

    // Per-clip audio filters (only when at least one clip has audio).
    if any_has_audio {
        for (i, clip) in clips.iter().enumerate() {
            let start_s = clip.trim_start / 1000.0;
            let end_s = (clip.original_duration - clip.trim_end) / 1000.0;
            let duration_s = end_s - start_s;
            let audio_label = format!("a{}", i);

            let has_audio = clip_has_audio[i];
            if has_audio {
                filters.push(format!(
                    "[{}:a]atrim=start={:.3}:end={:.3},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[{}]",
                    i, start_s, end_s, audio_label,
                ));
            } else {
                filters.push(format!(
                    "anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration={:.3}[{}]",
                    duration_s, audio_label,
                ));
            }
        }
    }

    // Determine whether to use xfade transitions or simple concat.
    let has_transitions = clips.len() > 1
        && clips.windows(2).any(|pair| pair[0].transition.is_some());

    if clips.len() == 1 {
        current_label = "v0".to_string();
        if any_has_audio {
            audio_output_label = Some("[a0]".to_string());
        }
    } else if has_transitions {
        // Chain xfade filters between consecutive clips.
        // We need to calculate the offset for each xfade, which is the cumulative
        // duration of all previous clips minus cumulative transition durations.
        let mut cumulative_duration = 0.0_f64; // seconds

        // Duration of each trimmed clip in seconds.
        let clip_durations: Vec<f64> = clips
            .iter()
            .map(|c| {
                let start_s = c.trim_start / 1000.0;
                let end_s = (c.original_duration - c.trim_end) / 1000.0;
                end_s - start_s
            })
            .collect();

        current_label = "v0".to_string();
        let mut cumulative_xfade = 0.0_f64;

        for i in 0..(clips.len() - 1) {
            let clip = clips[i];
            cumulative_duration += clip_durations[i];

            let transition = clip.transition.as_ref();
            let (xfade_type, xfade_duration_s) = match transition {
                Some(t) => (t.transition_type.as_str(), t.duration / 1000.0),
                None => ("fade", 0.5),
            };

            let offset = cumulative_duration - cumulative_xfade - xfade_duration_s;
            let out_label = format!("xf{}", i);

            filters.push(format!(
                "[{}][v{}]xfade=transition={}:duration={:.3}:offset={:.3}[{}]",
                current_label,
                i + 1,
                xfade_type,
                xfade_duration_s,
                offset,
                out_label,
            ));

            cumulative_xfade += xfade_duration_s;
            current_label = out_label;
        }

        // Audio crossfade chain (parallel to video xfade).
        if any_has_audio {
            let mut current_audio = "a0".to_string();
            for i in 0..(clips.len() - 1) {
                let transition = clips[i].transition.as_ref();
                let xfade_duration_s = match transition {
                    Some(t) => t.duration / 1000.0,
                    None => 0.5,
                };
                let out_audio = format!("axf{}", i);
                filters.push(format!(
                    "[{}][a{}]acrossfade=d={:.3}:c1=tri:c2=tri[{}]",
                    current_audio,
                    i + 1,
                    xfade_duration_s,
                    out_audio,
                ));
                current_audio = out_audio;
            }
            audio_output_label = Some(format!("[{}]", current_audio));
        }
    } else {
        // Simple concat.
        if any_has_audio {
            let inputs: String = (0..clips.len())
                .map(|i| format!("[v{}][a{}]", i, i))
                .collect();
            filters.push(format!(
                "{}concat=n={}:v=1:a=1[concatv][concata]",
                inputs,
                clips.len(),
            ));
            current_label = "concatv".to_string();
            audio_output_label = Some("[concata]".to_string());
        } else {
            let inputs: String = (0..clips.len()).map(|i| format!("[v{}]", i)).collect();
            filters.push(format!(
                "{}concat=n={}:v=1:a=0[concatv]",
                inputs,
                clips.len(),
            ));
            current_label = "concatv".to_string();
        }
    }

    // Text overlays via drawtext filters.
    for (i, overlay) in project.text_overlays.iter().enumerate() {
        let start_s = overlay.start_time / 1000.0;
        let end_s = overlay.end_time / 1000.0;
        let anim_dur_s = overlay.animation_duration / 1000.0;
        let out_label = format!("txt{}", i);

        // Escape text for FFmpeg drawtext: single quotes and backslashes.
        let escaped_text = overlay
            .text
            .replace('\\', "\\\\\\\\")
            .replace('\'', "'\\''")
            .replace(':', "\\:");

        // Map font family
        let font = match overlay.font_family.as_str() {
            "sans-serif" => "Arial",
            "serif" => "Georgia",
            "monospace" => "Courier New",
            other => other,
        };

        // Font name with style suffix for drawtext
        let font_with_style = match (overlay.font_weight.as_str(), overlay.font_style.as_str()) {
            ("bold", "italic") => format!("{} Bold Italic", font),
            ("bold", _) => format!("{} Bold", font),
            (_, "italic") => format!("{} Italic", font),
            _ => font.to_string(),
        };

        // X expression based on text alignment
        let x_expr = if let Some(box_width) = overlay.width {
            // New box model: x is box left edge, width is box width
            match overlay.text_align.as_str() {
                "right" => format!("(w*{:.4}+w*{:.4}-tw)", overlay.x, box_width),
                "center" => format!("(w*{:.4}+(w*{:.4}-tw)/2)", overlay.x, box_width),
                _ => format!("(w*{:.4})", overlay.x), // left
            }
        } else {
            // Legacy point-anchor model (backward compatibility)
            match overlay.text_align.as_str() {
                "left" => format!("(w*{:.4})", overlay.x),
                "right" => format!("(w*{:.4}-tw)", overlay.x),
                _ => format!("(w*{:.4}-tw/2)", overlay.x), // center
            }
        };

        let y_expr = format!("(h*{:.4})", overlay.y);

        // Alpha expression for fade animations
        let alpha_expr = match overlay.animation.as_str() {
            "fade-in" => format!(
                "if(lt(t-{:.3},{:.3}),(t-{:.3})/{:.3},1)",
                start_s, anim_dur_s, start_s, anim_dur_s
            ),
            "fade-out" => format!(
                "if(gt(t,{:.3}-{:.3}),({:.3}-t)/{:.3},1)",
                end_s, anim_dur_s, end_s, anim_dur_s
            ),
            "fade-in-out" => format!(
                "if(lt(t-{:.3},{:.3}),(t-{:.3})/{:.3},if(gt(t,{:.3}-{:.3}),({:.3}-t)/{:.3},1))",
                start_s, anim_dur_s, start_s, anim_dur_s,
                end_s, anim_dur_s, end_s, anim_dur_s
            ),
            _ => String::new(),
        };

        // Y expression with slide animation
        let final_y_expr = match overlay.animation.as_str() {
            "slide-up" => format!(
                "if(lt(t-{:.3},{:.3}),{}+50*(1-(t-{:.3})/{:.3}),{})",
                start_s, anim_dur_s, y_expr, start_s, anim_dur_s, y_expr
            ),
            "slide-down" => format!(
                "if(lt(t-{:.3},{:.3}),{}-50*(1-(t-{:.3})/{:.3}),{})",
                start_s, anim_dur_s, y_expr, start_s, anim_dur_s, y_expr
            ),
            _ => y_expr.clone(),
        };

        // Build the drawtext filter
        let mut params = vec![
            format!("text='{}'", escaped_text),
            format!("font='{}'", font_with_style),
            format!("fontsize={}", overlay.font_size),
            format!("fontcolor={}", overlay.color.replace(':', "\\:")),
            format!("x={}", x_expr),
            format!("y={}", final_y_expr),
            format!("enable='between(t,{:.3},{:.3})'", start_s, end_s),
        ];

        if !alpha_expr.is_empty() {
            params.push(format!("alpha='{}'", alpha_expr));
        }

        // Shadow
        if let Some(ref sc) = overlay.shadow_color {
            params.push(format!("shadowcolor={}", sc.replace(':', "\\:")));
            params.push(format!("shadowx={}", overlay.shadow_offset_x as i32));
            params.push(format!("shadowy={}", overlay.shadow_offset_y as i32));
        }

        // Border (text stroke)
        if let Some(ref bc) = overlay.border_color {
            params.push(format!("borderw={}", overlay.border_width as i32));
            params.push(format!("bordercolor={}", bc.replace(':', "\\:")));
        }

        // Background box
        if let Some(ref bg) = overlay.background_color {
            params.push("box=1".to_string());
            params.push(format!("boxcolor={}", bg.replace(':', "\\:")));
            params.push("boxborderw=4".to_string());
        }

        filters.push(format!(
            "[{}]drawtext={}[{}]",
            current_label,
            params.join(":"),
            out_label,
        ));
        current_label = out_label;
    }

    let output_label = format!("[{}]", current_label);

    Ok(FilterComplexResult {
        filter_complex: filters.join(";"),
        output_label,
        audio_output_label,
    })
}

// ---------------------------------------------------------------------------
// Bundle audio filter builder
// ---------------------------------------------------------------------------

/// Build FFmpeg audio filter for a bundle clip's audio tracks.
/// Returns `(filter_string, output_label, extra_inputs)` where `extra_inputs` are
/// the FFmpeg input arguments for the PCM files.
fn build_bundle_audio_filter(
    clip: &EditorClip,
    input_index_start: usize,
    trim_start_s: f64,
    trim_end_s: f64,
    _clip_duration_s: f64,
) -> Option<(String, String, Vec<String>)> {
    let bundle_path = clip.bundle_path.as_ref()?;
    let audio_tracks = clip.audio_tracks.as_ref()?;
    let mixer = clip.mixer_settings.as_ref()?;

    if audio_tracks.is_empty() {
        return None;
    }

    let mut inputs = Vec::new();
    let mut filters = Vec::new();
    let mut mix_labels = Vec::new();
    let mut current_input = input_index_start;

    for track in audio_tracks {
        if track.clips.is_empty() {
            continue;
        }

        let setting = mixer.tracks.iter().find(|t| t.track_id == track.id);
        let is_muted = setting.map_or(false, |s| s.muted);
        let volume = setting.map_or(1.0, |s| s.volume);

        if is_muted {
            continue;
        }

        // For each clip in the track (supports punch-in segments)
        for audio_clip in &track.clips {
            let pcm_path = format!("{}/tracks/{}", bundle_path, audio_clip.filename);
            inputs.extend_from_slice(&[
                "-f".to_string(),
                "f32le".to_string(),
                "-ar".to_string(),
                track.format.sample_rate.to_string(),
                "-ac".to_string(),
                track.format.channels.to_string(),
                "-i".to_string(),
                pcm_path,
            ]);

            let label = format!("ba{}", current_input);

            // Apply trim and volume.
            // The audio_clip.offset_ms is relative to the recording start,
            // so the trim point in the audio file is trim_start_s + offset.
            let audio_start = trim_start_s + (audio_clip.offset_ms / 1000.0);
            let audio_end = (clip.original_duration / 1000.0) - trim_end_s;

            let mut filter_parts = vec![format!(
                "[{}:a]atrim=start={:.3}:end={:.3}",
                current_input, audio_start, audio_end
            )];
            filter_parts.push("asetpts=PTS-STARTPTS".to_string());

            if (volume - 1.0).abs() > 0.001 {
                filter_parts.push(format!("volume={:.3}", volume));
            }

            // Convert mono to stereo if needed.
            if track.format.channels == 1 {
                filter_parts.push("pan=stereo|c0=c0|c1=c0".to_string());
            }

            filters.push(format!("{}[{}]", filter_parts.join(","), label));
            mix_labels.push(format!("[{}]", label));
            current_input += 1;
        }
    }

    if mix_labels.is_empty() {
        return None;
    }

    let output_label = format!("ba_mix{}", input_index_start);

    if mix_labels.len() == 1 {
        // Single track – just rename the label.
        let last_filter = filters.last_mut().expect("filters should not be empty");
        let old_label = mix_labels[0].trim_matches(|c| c == '[' || c == ']');
        *last_filter = last_filter.replace(
            &format!("[{}]", old_label),
            &format!("[{}]", output_label),
        );
    } else {
        // Multiple tracks – mix them together.
        filters.push(format!(
            "{}amix=inputs={}:duration=longest[{}]",
            mix_labels.join(""),
            mix_labels.len(),
            output_label,
        ));
    }

    Some((filters.join(";"), output_label, inputs))
}

// ---------------------------------------------------------------------------
// Independent audio filter builder
// ---------------------------------------------------------------------------

/// Build FFmpeg audio filters for independent audio tracks.
/// Returns `(filter_string, output_label, extra_inputs)` or None if no active clips.
fn build_independent_audio_filters(
    project: &EditorProject,
    input_index_start: usize,
) -> Option<(String, String, Vec<String>)> {
    let mut inputs = Vec::new();
    let mut filters = Vec::new();
    let mut mix_labels = Vec::new();
    let mut current_input = input_index_start;

    for track in &project.independent_audio_tracks {
        if track.muted || track.clips.is_empty() {
            continue;
        }

        for clip in &track.clips {
            // Add audio file as input (with PCM format flags if needed)
            if let Some(ref fmt) = clip.pcm_format {
                inputs.extend_from_slice(&[
                    "-f".to_string(),
                    fmt.encoding.clone(),
                    "-ar".to_string(),
                    fmt.sample_rate.to_string(),
                    "-ac".to_string(),
                    fmt.channels.to_string(),
                    "-i".to_string(),
                    clip.source_path.clone(),
                ]);
            } else {
                inputs.extend_from_slice(&["-i".to_string(), clip.source_path.clone()]);
            }

            let label = format!("ia{}", current_input);
            let trim_start_s = clip.trim_start / 1000.0;
            let trim_end_s = clip.trim_end / 1000.0;
            let original_duration_s = clip.original_duration / 1000.0;
            let effective_end_s = original_duration_s - trim_end_s;
            let delay_ms = clip.timeline_start_ms as i64;

            let mut filter_parts = vec![format!(
                "[{}:a]atrim=start={:.3}:end={:.3}",
                current_input, trim_start_s, effective_end_s
            )];
            filter_parts.push("asetpts=PTS-STARTPTS".to_string());
            filter_parts.push("aresample=48000".to_string());
            filter_parts.push("aformat=channel_layouts=stereo".to_string());

            if delay_ms > 0 {
                filter_parts.push(format!("adelay={}|{}", delay_ms, delay_ms));
            }

            if (track.volume - 1.0).abs() > 0.001 {
                filter_parts.push(format!("volume={:.3}", track.volume));
            }

            filters.push(format!("{}[{}]", filter_parts.join(","), label));
            mix_labels.push(format!("[{}]", label));
            current_input += 1;
        }
    }

    if mix_labels.is_empty() {
        return None;
    }

    let output_label = "ia_mix".to_string();

    if mix_labels.len() == 1 {
        // Single clip - rename the label
        let last_filter = filters.last_mut().expect("filters should not be empty");
        let old_label = mix_labels[0].trim_matches(|c| c == '[' || c == ']');
        *last_filter = last_filter.replace(
            &format!("[{}]", old_label),
            &format!("[{}]", output_label),
        );
    } else {
        // Multiple clips - mix them
        filters.push(format!(
            "{}amix=inputs={}:duration=longest[{}]",
            mix_labels.join(""),
            mix_labels.len(),
            output_label,
        ));
    }

    Some((filters.join(";"), output_label, inputs))
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/// Export a video project to a file.
///
/// `project_json` is a JSON string conforming to [`EditorProject`].
/// The export runs in a background thread; poll [`editor_export_status`] for progress.
pub fn editor_export(project_json: String, output_path: String) -> Result<(), String> {
    // Prevent concurrent exports.
    let current = EXPORT_STATUS.load(Ordering::SeqCst);
    if current == 1 {
        return Err("An export is already in progress".to_string());
    }

    let project: EditorProject = serde_json::from_str(&project_json)
        .map_err(|e| format!("Invalid project JSON: {}", e))?;

    // Reset state.
    EXPORT_STATUS.store(1, Ordering::SeqCst);
    EXPORT_PROGRESS.store(0, Ordering::SeqCst);
    if let Ok(mut guard) = EXPORT_ERROR.lock() {
        *guard = None;
    }

    let ffmpeg_path = crate::encoder::find_ffmpeg()?;

    std::thread::spawn(move || {
        let result = run_export(&ffmpeg_path, &project, &output_path);
        match result {
            Ok(()) => {
                EXPORT_PROGRESS.store(100, Ordering::SeqCst);
                EXPORT_STATUS.store(2, Ordering::SeqCst);
            }
            Err(e) => {
                if let Ok(mut guard) = EXPORT_ERROR.lock() {
                    *guard = Some(e);
                }
                EXPORT_STATUS.store(3, Ordering::SeqCst);
            }
        }
    });

    Ok(())
}

/// Internal: run the actual FFmpeg export command (blocking).
fn run_export(
    ffmpeg_path: &str,
    project: &EditorProject,
    output_path: &str,
) -> Result<(), String> {
    let mut clips = project.clips.iter().collect::<Vec<_>>();
    clips.sort_by_key(|c| c.order);

    // Determine which clips have embedded audio.
    // For bundle clips, the video.mp4 is video-only; audio comes from
    // separate PCM files, so mark them as having no embedded audio.
    let clip_has_audio: Vec<bool> = clips
        .iter()
        .map(|c| {
            if c.bundle_path.is_some() {
                // Bundle video.mp4 is video-only; audio is in separate PCM files.
                false
            } else {
                has_audio_stream(&c.source_path)
            }
        })
        .collect();

    let fc = build_filter_complex(project, &clip_has_audio)?;

    // Build bundle audio filters for clips that have separate audio tracks.
    let base_input_count = clips.len();
    let mut bundle_audio_inputs: Vec<String> = Vec::new();
    let mut bundle_audio_filters: Vec<String> = Vec::new();
    let mut bundle_audio_labels: Vec<String> = Vec::new();

    for clip in &clips {
        if clip.bundle_path.is_some() && clip.audio_tracks.is_some() {
            let trim_start_s = clip.trim_start / 1000.0;
            let trim_end_s = clip.trim_end / 1000.0;
            let clip_duration_s =
                (clip.original_duration - clip.trim_start - clip.trim_end) / 1000.0;

            // Calculate the input index start: base inputs + how many PCM
            // inputs we have already added (each PCM input has 8 args).
            let pcm_input_index = base_input_count + bundle_audio_inputs.len() / 8;

            if let Some((filter, label, inputs)) = build_bundle_audio_filter(
                clip,
                pcm_input_index,
                trim_start_s,
                trim_end_s,
                clip_duration_s,
            ) {
                bundle_audio_inputs.extend(inputs);
                bundle_audio_filters.push(filter);
                bundle_audio_labels.push(label);
            }
        }
    }

    // Build independent audio track filters.
    let ind_audio_input_count = base_input_count + bundle_audio_inputs.len() / 8;
    let ind_audio_result = build_independent_audio_filters(&project, ind_audio_input_count);
    let mut ind_audio_inputs: Vec<String> = Vec::new();
    let mut ind_audio_filter: Option<String> = None;
    let mut ind_audio_label: Option<String> = None;

    if let Some((filter, label, inputs)) = ind_audio_result {
        ind_audio_inputs = inputs;
        ind_audio_filter = Some(filter);
        ind_audio_label = Some(label);
    }

    // Compose the final filter_complex, appending bundle audio if present.
    let mut final_filter = if !bundle_audio_filters.is_empty() {
        format!("{};{}", fc.filter_complex, bundle_audio_filters.join(";"))
    } else {
        fc.filter_complex.clone()
    };

    // Append independent audio filters.
    if let Some(ref iaf) = ind_audio_filter {
        final_filter = format!("{};{}", final_filter, iaf);
    }

    // Collect all audio output labels.
    let mut all_audio_labels: Vec<String> = Vec::new();

    // Bundle audio labels.
    for l in &bundle_audio_labels {
        all_audio_labels.push(format!("[{}]", l));
    }

    // Embedded audio label from filter complex.
    if let Some(ref embedded) = fc.audio_output_label {
        all_audio_labels.push(embedded.clone());
    }

    // Independent audio label.
    if let Some(ref ial) = ind_audio_label {
        all_audio_labels.push(format!("[{}]", ial));
    }

    let audio_map_label: Option<String> = if all_audio_labels.len() > 1 {
        // Mix all audio sources together.
        let mix_inputs: String = all_audio_labels.join("");
        final_filter = format!(
            "{};{}amix=inputs={}:duration=longest[final_audio]",
            final_filter,
            mix_inputs,
            all_audio_labels.len()
        );
        Some("[final_audio]".to_string())
    } else if all_audio_labels.len() == 1 {
        Some(all_audio_labels[0].clone())
    } else {
        None
    };

    let mut args: Vec<String> = Vec::new();
    args.extend(["-y".to_string(), "-hide_banner".to_string()]);

    // Add video inputs (one per clip).
    for clip in &clips {
        args.extend(["-i".to_string(), clip.source_path.clone()]);
    }

    // Add bundle audio PCM inputs.
    args.extend(bundle_audio_inputs);

    // Add independent audio file inputs.
    args.extend(ind_audio_inputs);

    // filter_complex.
    args.extend(["-filter_complex".to_string(), final_filter]);

    // Map the final video output.
    args.extend(["-map".to_string(), fc.output_label]);

    // Map audio output if present.
    if let Some(ref label) = audio_map_label {
        args.extend(["-map".to_string(), label.clone()]);
    }

    // Output codecs.
    args.extend([
        "-c:v".to_string(), "libx264".to_string(),
        "-pix_fmt".to_string(), "yuv420p".to_string(),
    ]);

    // Audio codec (only when audio is present).
    if audio_map_label.is_some() {
        args.extend([
            "-c:a".to_string(), "aac".to_string(),
            "-b:a".to_string(), "192k".to_string(),
        ]);
    }

    args.extend(["-movflags".to_string(), "+faststart".to_string()]);

    args.push(output_path.to_string());

    // Estimate total duration for progress tracking.
    let total_duration_ms: f64 = clips
        .iter()
        .map(|c| c.original_duration - c.trim_start - c.trim_end)
        .sum();

    let mut child = Command::new(ffmpeg_path)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn FFmpeg: {}", e))?;

    // Read stderr for progress parsing.
    if let Some(stderr) = child.stderr.take() {
        let reader = std::io::BufReader::new(stderr);
        parse_ffmpeg_progress(reader, total_duration_ms);
    }

    let status = child
        .wait()
        .map_err(|e| format!("Failed to wait for FFmpeg: {}", e))?;

    if !status.success() {
        return Err(format!("FFmpeg exited with status {}", status));
    }

    Ok(())
}

/// Parse FFmpeg stderr output for `time=` lines to update progress.
fn parse_ffmpeg_progress<R: std::io::Read>(reader: std::io::BufReader<R>, total_duration_ms: f64) {
    use std::io::BufRead;

    if total_duration_ms <= 0.0 {
        return;
    }

    let mut buf = String::new();
    let mut reader = reader;
    // FFmpeg stderr is not strictly line-buffered; read character by character
    // is too slow. Instead, read in chunks and scan for "time=" patterns.
    loop {
        buf.clear();
        match reader.read_line(&mut buf) {
            Ok(0) => break,
            Ok(_) => {
                if let Some(time_ms) = parse_time_from_line(&buf) {
                    let pct = ((time_ms / total_duration_ms) * 100.0).min(99.0) as u8;
                    EXPORT_PROGRESS.store(pct, Ordering::Relaxed);
                }
            }
            Err(_) => break,
        }
    }
}

/// Extract the `time=HH:MM:SS.ms` value from an FFmpeg stderr line
/// and return it as milliseconds.
fn parse_time_from_line(line: &str) -> Option<f64> {
    let idx = line.find("time=")?;
    let after = &line[idx + 5..];
    // Format: HH:MM:SS.xx or HH:MM:SS.xxx
    let time_str = after.split_whitespace().next()?;
    // Can also be "N/A" at the start.
    if time_str.starts_with('N') {
        return None;
    }
    parse_timecode(time_str)
}

/// Parse `HH:MM:SS.ms` into total milliseconds.
fn parse_timecode(tc: &str) -> Option<f64> {
    let parts: Vec<&str> = tc.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let hours: f64 = parts[0].parse().ok()?;
    let minutes: f64 = parts[1].parse().ok()?;
    let seconds: f64 = parts[2].parse().ok()?;
    Some((hours * 3_600_000.0) + (minutes * 60_000.0) + (seconds * 1000.0))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn video_metadata_serialization() {
        let meta = VideoMetadata {
            duration_ms: 5000,
            width: 1920,
            height: 1080,
            fps: 29.97,
            codec: "h264".to_string(),
        };
        let json = serde_json::to_value(&meta).expect("serialize VideoMetadata");
        assert_eq!(json["duration_ms"], 5000);
        assert_eq!(json["width"], 1920);
        assert_eq!(json["height"], 1080);
        assert_eq!(json["codec"], "h264");
        // fps is f64 so compare with tolerance.
        let fps_val = json["fps"].as_f64().expect("fps should be f64");
        assert!((fps_val - 29.97).abs() < 0.001);
    }

    #[test]
    fn project_json_deserialization_minimal() {
        let json = r#"{
            "clips": [
                {
                    "id": "clip1",
                    "source_path": "/tmp/test.mp4",
                    "original_duration": 10000,
                    "trim_start": 0,
                    "trim_end": 0,
                    "order": 0
                }
            ],
            "output_width": 1920,
            "output_height": 1080
        }"#;

        let project: EditorProject =
            serde_json::from_str(json).expect("deserialize EditorProject");
        assert_eq!(project.clips.len(), 1);
        assert_eq!(project.clips[0].id, "clip1");
        assert_eq!(project.clips[0].source_path, "/tmp/test.mp4");
        assert_eq!(project.clips[0].original_duration, 10000.0);
        assert!(project.clips[0].transition.is_none());
        assert!(project.text_overlays.is_empty());
        assert_eq!(project.output_width, 1920);
        assert_eq!(project.output_height, 1080);
    }

    #[test]
    fn project_json_deserialization_full() {
        let json = r##"{
            "clips": [
                {
                    "id": "c1",
                    "source_path": "/a.mp4",
                    "original_duration": 5000,
                    "trim_start": 500,
                    "trim_end": 500,
                    "order": 0,
                    "transition": { "type": "fade", "duration": 300 }
                },
                {
                    "id": "c2",
                    "source_path": "/b.mp4",
                    "original_duration": 8000,
                    "trim_start": 0,
                    "trim_end": 1000,
                    "order": 1
                }
            ],
            "text_overlays": [
                {
                    "id": "t1",
                    "text": "Hello World",
                    "start_time": 1000,
                    "end_time": 3000,
                    "x": 0.5,
                    "y": 0.9,
                    "font_size": 48,
                    "color": "#ffffff"
                }
            ],
            "output_width": 1280,
            "output_height": 720
        }"##;

        let project: EditorProject =
            serde_json::from_str(json).expect("deserialize full project");
        assert_eq!(project.clips.len(), 2);
        assert_eq!(project.clips[0].transition.as_ref().unwrap().transition_type, "fade");
        assert_eq!(project.clips[0].transition.as_ref().unwrap().duration, 300.0);
        assert_eq!(project.text_overlays.len(), 1);
        assert_eq!(project.text_overlays[0].text, "Hello World");
        assert_eq!(project.text_overlays[0].font_size, 48);
        assert_eq!(project.text_overlays[0].color, "#ffffff");
    }

    #[test]
    fn filter_complex_single_clip() {
        let project = EditorProject {
            clips: vec![EditorClip {
                id: "c1".to_string(),
                source_path: "/test.mp4".to_string(),
                original_duration: 10000.0,
                trim_start: 1000.0,
                trim_end: 2000.0,
                order: 0,
                transition: None,
                bundle_path: None,
                audio_tracks: None,
                mixer_settings: None,
            }],
            text_overlays: vec![],
            independent_audio_tracks: vec![],
            output_width: 1920,
            output_height: 1080,
        };

        let clip_has_audio = [false];
        let result = build_filter_complex(&project, &clip_has_audio).expect("build single clip");
        assert!(result.filter_complex.contains("[0:v]trim=start=1.000:end=8.000"));
        assert!(result.filter_complex.contains("setpts=PTS-STARTPTS"));
        assert!(result.filter_complex.contains("scale=1920:1080"));
        assert_eq!(result.output_label, "[v0]");
    }

    #[test]
    fn filter_complex_concat_no_transitions() {
        let project = EditorProject {
            clips: vec![
                EditorClip {
                    id: "c1".to_string(),
                    source_path: "/a.mp4".to_string(),
                    original_duration: 5000.0,
                    trim_start: 0.0,
                    trim_end: 0.0,
                    order: 0,
                    transition: None,
                    bundle_path: None,
                    audio_tracks: None,
                    mixer_settings: None,
                },
                EditorClip {
                    id: "c2".to_string(),
                    source_path: "/b.mp4".to_string(),
                    original_duration: 3000.0,
                    trim_start: 0.0,
                    trim_end: 0.0,
                    order: 1,
                    transition: None,
                    bundle_path: None,
                    audio_tracks: None,
                    mixer_settings: None,
                },
            ],
            text_overlays: vec![],
            independent_audio_tracks: vec![],
            output_width: 1280,
            output_height: 720,
        };

        let clip_has_audio = [false, false];
        let result = build_filter_complex(&project, &clip_has_audio).expect("build concat");
        assert!(result.filter_complex.contains("concat=n=2:v=1:a=0"));
        assert_eq!(result.output_label, "[concatv]");
    }

    #[test]
    fn filter_complex_with_xfade() {
        let project = EditorProject {
            clips: vec![
                EditorClip {
                    id: "c1".to_string(),
                    source_path: "/a.mp4".to_string(),
                    original_duration: 5000.0,
                    trim_start: 0.0,
                    trim_end: 0.0,
                    order: 0,
                    transition: Some(Transition {
                        transition_type: "fade".to_string(),
                        duration: 500.0,
                    }),
                    bundle_path: None,
                    audio_tracks: None,
                    mixer_settings: None,
                },
                EditorClip {
                    id: "c2".to_string(),
                    source_path: "/b.mp4".to_string(),
                    original_duration: 3000.0,
                    trim_start: 0.0,
                    trim_end: 0.0,
                    order: 1,
                    transition: None,
                    bundle_path: None,
                    audio_tracks: None,
                    mixer_settings: None,
                },
            ],
            text_overlays: vec![],
            independent_audio_tracks: vec![],
            output_width: 1920,
            output_height: 1080,
        };

        let clip_has_audio = [false, false];
        let result = build_filter_complex(&project, &clip_has_audio).expect("build xfade");
        assert!(result.filter_complex.contains("xfade=transition=fade:duration=0.500"));
        // offset = clip0 duration (5s) - xfade duration (0.5s) = 4.5s
        assert!(result.filter_complex.contains("offset=4.500"));
        assert_eq!(result.output_label, "[xf0]");
    }

    #[test]
    fn filter_complex_with_text_overlays() {
        let project = EditorProject {
            clips: vec![EditorClip {
                id: "c1".to_string(),
                source_path: "/test.mp4".to_string(),
                original_duration: 10000.0,
                trim_start: 0.0,
                trim_end: 0.0,
                order: 0,
                transition: None,
                bundle_path: None,
                audio_tracks: None,
                mixer_settings: None,
            }],
            text_overlays: vec![TextOverlay {
                id: "t1".to_string(),
                text: "Hello".to_string(),
                start_time: 1000.0,
                end_time: 3000.0,
                x: 0.5,
                y: 0.9,
                width: None,
                font_size: 48,
                color: "#ffffff".to_string(),
                font_family: default_font_family(),
                font_weight: default_normal(),
                font_style: default_normal(),
                text_align: default_center(),
                background_color: None,
                border_color: None,
                border_width: 0.0,
                shadow_color: None,
                shadow_offset_x: 0.0,
                shadow_offset_y: 0.0,
                animation: default_none(),
                animation_duration: default_animation_duration(),
            }],
            independent_audio_tracks: vec![],
            output_width: 1920,
            output_height: 1080,
        };

        let clip_has_audio = [false];
        let result = build_filter_complex(&project, &clip_has_audio).expect("build with text");
        assert!(result.filter_complex.contains("drawtext=text='Hello'"), "filter_complex: {}", result.filter_complex);
        assert!(result.filter_complex.contains("fontsize=48"), "filter_complex: {}", result.filter_complex);
        assert!(result.filter_complex.contains("fontcolor=#ffffff"), "filter_complex: {}", result.filter_complex);
        assert!(result.filter_complex.contains("enable='between(t,1.000,3.000)'"), "filter_complex: {}", result.filter_complex);
        assert!(result.filter_complex.contains("font='Arial'"), "filter_complex: {}", result.filter_complex);
        assert!(result.filter_complex.contains("x=(w*0.5000-tw/2)"), "filter_complex: {}", result.filter_complex);
        assert_eq!(result.output_label, "[txt0]");
    }

    #[test]
    fn filter_complex_empty_clips_error() {
        let project = EditorProject {
            clips: vec![],
            text_overlays: vec![],
            independent_audio_tracks: vec![],
            output_width: 1920,
            output_height: 1080,
        };

        let clip_has_audio: [bool; 0] = [];
        let result = build_filter_complex(&project, &clip_has_audio);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No clips"));
    }

    #[test]
    fn filter_complex_clips_sorted_by_order() {
        let project = EditorProject {
            clips: vec![
                EditorClip {
                    id: "c2".to_string(),
                    source_path: "/b.mp4".to_string(),
                    original_duration: 3000.0,
                    trim_start: 0.0,
                    trim_end: 0.0,
                    order: 1,
                    transition: None,
                    bundle_path: None,
                    audio_tracks: None,
                    mixer_settings: None,
                },
                EditorClip {
                    id: "c1".to_string(),
                    source_path: "/a.mp4".to_string(),
                    original_duration: 5000.0,
                    trim_start: 0.0,
                    trim_end: 0.0,
                    order: 0,
                    transition: None,
                    bundle_path: None,
                    audio_tracks: None,
                    mixer_settings: None,
                },
            ],
            text_overlays: vec![],
            independent_audio_tracks: vec![],
            output_width: 1280,
            output_height: 720,
        };

        let clip_has_audio = [false, false];
        let result = build_filter_complex(&project, &clip_has_audio).expect("build sorted");
        // Even though c2 is first in the vec, order=0 clip should be [0:v].
        assert!(result.filter_complex.contains("[0:v]trim"));
        assert!(result.filter_complex.contains("[1:v]trim"));
    }

    #[test]
    fn export_status_json_idle() {
        let json = format_export_status_json(0, 0, None);
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("valid JSON");
        assert_eq!(parsed["status"], "idle");
        assert_eq!(parsed["progress"], 0);
        assert!(parsed["error"].is_null());
    }

    #[test]
    fn export_status_json_exporting() {
        let json = format_export_status_json(1, 42, None);
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("valid JSON");
        assert_eq!(parsed["status"], "exporting");
        assert_eq!(parsed["progress"], 42);
        assert!(parsed["error"].is_null());
    }

    #[test]
    fn export_status_json_completed() {
        let json = format_export_status_json(2, 100, None);
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("valid JSON");
        assert_eq!(parsed["status"], "completed");
        assert_eq!(parsed["progress"], 100);
    }

    #[test]
    fn export_status_json_failed() {
        let json = format_export_status_json(3, 50, Some("ffmpeg crashed"));
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("valid JSON");
        assert_eq!(parsed["status"], "failed");
        assert_eq!(parsed["progress"], 50);
        assert_eq!(parsed["error"], "ffmpeg crashed");
    }

    #[test]
    fn export_status_json_error_with_quotes() {
        let json = format_export_status_json(3, 0, Some(r#"error "bad""#));
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("valid JSON");
        assert_eq!(parsed["error"], r#"error "bad""#);
    }

    #[test]
    fn parse_frame_rate_fraction() {
        assert_eq!(parse_frame_rate(Some("30/1")), Some(30.0));
    }

    #[test]
    fn parse_frame_rate_ntsc() {
        let fps = parse_frame_rate(Some("30000/1001")).unwrap();
        assert!((fps - 29.97).abs() < 0.01);
    }

    #[test]
    fn parse_frame_rate_zero_denominator() {
        assert_eq!(parse_frame_rate(Some("30/0")), None);
    }

    #[test]
    fn parse_frame_rate_plain_number() {
        assert_eq!(parse_frame_rate(Some("25")), Some(25.0));
    }

    #[test]
    fn parse_frame_rate_none() {
        assert_eq!(parse_frame_rate(None), None);
    }

    #[test]
    fn parse_probe_json_valid() {
        let json: serde_json::Value = serde_json::from_str(r#"{
            "streams": [
                {
                    "codec_type": "video",
                    "codec_name": "h264",
                    "width": 1920,
                    "height": 1080,
                    "r_frame_rate": "30/1",
                    "avg_frame_rate": "30/1"
                }
            ],
            "format": {
                "duration": "10.500"
            }
        }"#).unwrap();

        let meta = parse_probe_json(&json).expect("parse probe JSON");
        assert_eq!(meta.width, 1920);
        assert_eq!(meta.height, 1080);
        assert_eq!(meta.codec, "h264");
        assert!((meta.fps - 30.0).abs() < 0.001);
        assert_eq!(meta.duration_ms, 10500);
    }

    #[test]
    fn parse_probe_json_no_video_stream() {
        let json: serde_json::Value = serde_json::from_str(r#"{
            "streams": [
                { "codec_type": "audio", "codec_name": "aac" }
            ],
            "format": { "duration": "5.0" }
        }"#).unwrap();

        let result = parse_probe_json(&json);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No video stream"));
    }

    #[test]
    fn parse_timecode_valid() {
        let ms = parse_timecode("01:23:45.678").unwrap();
        // 1*3600000 + 23*60000 + 45.678*1000 = 3600000 + 1380000 + 45678
        let expected = 3_600_000.0 + 1_380_000.0 + 45_678.0;
        assert!((ms - expected).abs() < 1.0);
    }

    #[test]
    fn parse_timecode_zero() {
        let ms = parse_timecode("00:00:00.000").unwrap();
        assert!((ms - 0.0).abs() < 0.001);
    }

    #[test]
    fn parse_timecode_invalid() {
        assert!(parse_timecode("invalid").is_none());
    }

    #[test]
    fn parse_time_from_line_present() {
        let line = "frame=  120 fps= 30 q=28.0 size=    256kB time=00:00:04.000 bitrate= 524.3kbits/s";
        let ms = parse_time_from_line(line).unwrap();
        assert!((ms - 4000.0).abs() < 1.0);
    }

    #[test]
    fn parse_time_from_line_absent() {
        let line = "frame=  120 fps= 30 q=28.0 size=    256kB";
        assert!(parse_time_from_line(line).is_none());
    }

    #[test]
    fn parse_time_from_line_na() {
        let line = "time=N/A bitrate=N/A";
        assert!(parse_time_from_line(line).is_none());
    }

    // ==================== Audio filter_complex tests (TDD Red phase) ====================

    #[test]
    fn filter_complex_single_clip_with_audio() {
        let project = EditorProject {
            clips: vec![EditorClip {
                id: "c1".to_string(),
                source_path: "/test.mp4".to_string(),
                original_duration: 10000.0,
                trim_start: 1000.0,
                trim_end: 2000.0,
                order: 0,
                transition: None,
                bundle_path: None,
                audio_tracks: None,
                mixer_settings: None,
            }],
            text_overlays: vec![],
            independent_audio_tracks: vec![],
            output_width: 1920,
            output_height: 1080,
        };

        let clip_has_audio = [true];
        let result = build_filter_complex(&project, &clip_has_audio).expect("build single clip with audio");
        assert!(
            result.filter_complex.contains("[0:a]atrim=start=1.000:end=8.000"),
            "Expected audio atrim filter, got: {}",
            result.filter_complex
        );
        assert!(
            result.filter_complex.contains("asetpts=PTS-STARTPTS"),
            "Expected asetpts filter, got: {}",
            result.filter_complex
        );
        assert!(
            result.filter_complex.contains("aresample=48000"),
            "Expected aresample filter, got: {}",
            result.filter_complex
        );
        assert_eq!(
            result.audio_output_label,
            Some("[a0]".to_string()),
            "Expected audio_output_label to be Some(\"[a0]\"), got: {:?}",
            result.audio_output_label
        );
    }

    #[test]
    fn filter_complex_concat_with_audio() {
        let project = EditorProject {
            clips: vec![
                EditorClip {
                    id: "c1".to_string(),
                    source_path: "/a.mp4".to_string(),
                    original_duration: 5000.0,
                    trim_start: 0.0,
                    trim_end: 0.0,
                    order: 0,
                    transition: None,
                    bundle_path: None,
                    audio_tracks: None,
                    mixer_settings: None,
                },
                EditorClip {
                    id: "c2".to_string(),
                    source_path: "/b.mp4".to_string(),
                    original_duration: 3000.0,
                    trim_start: 0.0,
                    trim_end: 0.0,
                    order: 1,
                    transition: None,
                    bundle_path: None,
                    audio_tracks: None,
                    mixer_settings: None,
                },
            ],
            text_overlays: vec![],
            independent_audio_tracks: vec![],
            output_width: 1280,
            output_height: 720,
        };

        let clip_has_audio = [true, true];
        let result = build_filter_complex(&project, &clip_has_audio).expect("build concat with audio");
        assert!(
            result.filter_complex.contains("[0:a]atrim"),
            "Expected [0:a]atrim in filter_complex, got: {}",
            result.filter_complex
        );
        assert!(
            result.filter_complex.contains("[1:a]atrim"),
            "Expected [1:a]atrim in filter_complex, got: {}",
            result.filter_complex
        );
        assert!(
            result.filter_complex.contains("concat=n=2:v=1:a=1"),
            "Expected concat with a=1 for audio, got: {}",
            result.filter_complex
        );
        assert!(
            result.filter_complex.contains("[concata]"),
            "Expected [concata] label in filter_complex, got: {}",
            result.filter_complex
        );
        assert_eq!(
            result.audio_output_label,
            Some("[concata]".to_string()),
            "Expected audio_output_label to be Some(\"[concata]\"), got: {:?}",
            result.audio_output_label
        );
    }

    #[test]
    fn filter_complex_concat_mixed_audio() {
        let project = EditorProject {
            clips: vec![
                EditorClip {
                    id: "c1".to_string(),
                    source_path: "/a.mp4".to_string(),
                    original_duration: 5000.0,
                    trim_start: 0.0,
                    trim_end: 0.0,
                    order: 0,
                    transition: None,
                    bundle_path: None,
                    audio_tracks: None,
                    mixer_settings: None,
                },
                EditorClip {
                    id: "c2".to_string(),
                    source_path: "/b.mp4".to_string(),
                    original_duration: 3000.0,
                    trim_start: 0.0,
                    trim_end: 0.0,
                    order: 1,
                    transition: None,
                    bundle_path: None,
                    audio_tracks: None,
                    mixer_settings: None,
                },
            ],
            text_overlays: vec![],
            independent_audio_tracks: vec![],
            output_width: 1280,
            output_height: 720,
        };

        let clip_has_audio = [true, false];
        let result = build_filter_complex(&project, &clip_has_audio).expect("build concat mixed audio");
        assert!(
            result.filter_complex.contains("[0:a]atrim"),
            "Expected [0:a]atrim for clip with audio, got: {}",
            result.filter_complex
        );
        assert!(
            result.filter_complex.contains("anullsrc=channel_layout=stereo:sample_rate=48000"),
            "Expected anullsrc for silent clip, got: {}",
            result.filter_complex
        );
        assert!(
            result.filter_complex.contains("concat=n=2:v=1:a=1"),
            "Expected concat with a=1, got: {}",
            result.filter_complex
        );
        assert_eq!(
            result.audio_output_label,
            Some("[concata]".to_string()),
            "Expected audio_output_label to be Some(\"[concata]\"), got: {:?}",
            result.audio_output_label
        );
    }

    #[test]
    fn filter_complex_xfade_with_audio() {
        let project = EditorProject {
            clips: vec![
                EditorClip {
                    id: "c1".to_string(),
                    source_path: "/a.mp4".to_string(),
                    original_duration: 5000.0,
                    trim_start: 0.0,
                    trim_end: 0.0,
                    order: 0,
                    transition: Some(Transition {
                        transition_type: "fade".to_string(),
                        duration: 500.0,
                    }),
                    bundle_path: None,
                    audio_tracks: None,
                    mixer_settings: None,
                },
                EditorClip {
                    id: "c2".to_string(),
                    source_path: "/b.mp4".to_string(),
                    original_duration: 3000.0,
                    trim_start: 0.0,
                    trim_end: 0.0,
                    order: 1,
                    transition: None,
                    bundle_path: None,
                    audio_tracks: None,
                    mixer_settings: None,
                },
            ],
            text_overlays: vec![],
            independent_audio_tracks: vec![],
            output_width: 1920,
            output_height: 1080,
        };

        let clip_has_audio = [true, true];
        let result = build_filter_complex(&project, &clip_has_audio).expect("build xfade with audio");
        assert!(
            result.filter_complex.contains("acrossfade=d=0.500"),
            "Expected acrossfade filter, got: {}",
            result.filter_complex
        );
        assert!(
            result.audio_output_label.is_some(),
            "Expected audio_output_label to be Some(...), got: {:?}",
            result.audio_output_label
        );
    }

    #[test]
    fn filter_complex_all_silent() {
        let project = EditorProject {
            clips: vec![
                EditorClip {
                    id: "c1".to_string(),
                    source_path: "/a.mp4".to_string(),
                    original_duration: 5000.0,
                    trim_start: 0.0,
                    trim_end: 0.0,
                    order: 0,
                    transition: None,
                    bundle_path: None,
                    audio_tracks: None,
                    mixer_settings: None,
                },
                EditorClip {
                    id: "c2".to_string(),
                    source_path: "/b.mp4".to_string(),
                    original_duration: 3000.0,
                    trim_start: 0.0,
                    trim_end: 0.0,
                    order: 1,
                    transition: None,
                    bundle_path: None,
                    audio_tracks: None,
                    mixer_settings: None,
                },
            ],
            text_overlays: vec![],
            independent_audio_tracks: vec![],
            output_width: 1280,
            output_height: 720,
        };

        let clip_has_audio = [false, false];
        let result = build_filter_complex(&project, &clip_has_audio).expect("build all silent");
        assert_eq!(
            result.audio_output_label, None,
            "Expected audio_output_label to be None for all-silent clips, got: {:?}",
            result.audio_output_label
        );
        assert!(
            result.filter_complex.contains("concat=n=2:v=1:a=0"),
            "Expected concat with a=0 (no audio), got: {}",
            result.filter_complex
        );
    }

    #[test]
    fn filter_complex_xfade_mixed_audio() {
        let project = EditorProject {
            clips: vec![
                EditorClip {
                    id: "c1".to_string(),
                    source_path: "/a.mp4".to_string(),
                    original_duration: 5000.0,
                    trim_start: 0.0,
                    trim_end: 0.0,
                    order: 0,
                    transition: Some(Transition {
                        transition_type: "fade".to_string(),
                        duration: 500.0,
                    }),
                    bundle_path: None,
                    audio_tracks: None,
                    mixer_settings: None,
                },
                EditorClip {
                    id: "c2".to_string(),
                    source_path: "/b.mp4".to_string(),
                    original_duration: 3000.0,
                    trim_start: 0.0,
                    trim_end: 0.0,
                    order: 1,
                    transition: None,
                    bundle_path: None,
                    audio_tracks: None,
                    mixer_settings: None,
                },
            ],
            text_overlays: vec![],
            independent_audio_tracks: vec![],
            output_width: 1920,
            output_height: 1080,
        };

        let clip_has_audio = [true, false];
        let result = build_filter_complex(&project, &clip_has_audio).expect("build xfade mixed audio");

        // First clip has audio, second uses anullsrc
        assert!(result.filter_complex.contains("[0:a]atrim"), "should have audio trim for clip 0");
        assert!(result.filter_complex.contains("anullsrc=channel_layout=stereo:sample_rate=48000"), "should have anullsrc for silent clip");
        // Audio crossfade should still be applied
        assert!(result.filter_complex.contains("acrossfade=d=0.500"), "should have audio crossfade");
        assert!(result.audio_output_label.is_some(), "should have audio output");
    }
}
