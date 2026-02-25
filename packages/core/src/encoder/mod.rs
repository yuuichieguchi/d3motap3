//! FFmpeg subprocess pipe encoder.
//!
//! Spawns FFmpeg as a child process and pipes raw BGRA frames via stdin
//! to produce MP4, GIF, or WebM output files.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

/// Supported output container/codec formats.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputFormat {
    Mp4,
    Gif,
    WebM,
}

impl OutputFormat {
    /// File extension (without leading dot).
    pub fn extension(self) -> &'static str {
        match self {
            Self::Mp4 => "mp4",
            Self::Gif => "gif",
            Self::WebM => "webm",
        }
    }
}

/// Quality presets that map to codec-specific parameters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncoderQuality {
    /// CRF 28 / ultrafast (MP4), CRF 35 (WebM), fps=10 (GIF)
    Low,
    /// CRF 23 / medium (MP4), CRF 30 (WebM), fps=15 (GIF)
    Medium,
    /// CRF 18 / slow (MP4), CRF 25 (WebM), fps=fps (GIF)
    High,
}

/// Configuration passed to [`FfmpegEncoder::new`].
#[derive(Debug, Clone)]
pub struct EncoderConfig {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub output_path: PathBuf,
    pub format: OutputFormat,
    pub quality: EncoderQuality,
    /// Source row stride in bytes. When the source buffer has padding beyond
    /// `width * 4` (common with OS screen-capture APIs), set this to the
    /// actual bytes-per-row so that padding is stripped before writing.
    /// If `None`, the stride is assumed to be `width * 4` (tightly packed).
    pub bytes_per_row: Option<usize>,
}

// ---------------------------------------------------------------------------
// Result returned after encoding finishes
// ---------------------------------------------------------------------------

/// Summary returned by [`FfmpegEncoder::finish`].
#[derive(Debug, Clone)]
pub struct EncoderResult {
    pub output_path: String,
    pub frame_count: u64,
    pub format: String,
}

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

/// Streams raw BGRA frames to an FFmpeg subprocess via stdin.
///
/// # Usage
///
/// ```ignore
/// let cfg = EncoderConfig { /* ... */ };
/// let mut enc = FfmpegEncoder::new(cfg)?;
/// for frame in frames {
///     enc.write_frame(&frame)?;
/// }
/// let result = enc.finish()?;
/// ```
pub struct FfmpegEncoder {
    process: Child,
    width: u32,
    height: u32,
    /// Pre-computed tight row size: `width * 4`.
    row_bytes: usize,
    /// Actual source stride (may include padding).
    src_stride: usize,
    output_path: PathBuf,
    format: OutputFormat,
    frame_count: u64,
}

impl FfmpegEncoder {
    /// Spawn FFmpeg and prepare to receive frames.
    pub fn new(config: EncoderConfig) -> Result<Self, String> {
        let ffmpeg_path = find_ffmpeg()?;

        let row_bytes = (config.width as usize) * 4;
        let src_stride = config.bytes_per_row.unwrap_or(row_bytes);
        if src_stride < row_bytes {
            return Err(format!(
                "bytes_per_row ({}) is smaller than width*4 ({})",
                src_stride, row_bytes
            ));
        }

        let video_size = format!("{}x{}", config.width, config.height);
        let fps_str = config.fps.to_string();

        // Build the argument list. We collect into Vec<String> so that
        // every element is owned and we avoid lifetime issues.
        let mut args: Vec<String> = Vec::new();

        // -- Global flags --
        push_args(&mut args, &["-y", "-hide_banner", "-loglevel", "error"]);

        // -- Input specification --
        push_args(&mut args, &[
            "-f", "rawvideo",
            "-pixel_format", "bgra",
            "-video_size", &video_size,
            "-framerate", &fps_str,
            "-i", "pipe:0",
        ]);

        // -- Output codec/format-specific flags --
        match config.format {
            OutputFormat::Mp4 => {
                let (crf, preset) = match config.quality {
                    EncoderQuality::Low => ("28", "ultrafast"),
                    EncoderQuality::Medium => ("23", "medium"),
                    EncoderQuality::High => ("18", "slow"),
                };
                push_args(&mut args, &[
                    "-c:v", "libx264",
                    "-pix_fmt", "yuv420p",
                    "-crf", crf,
                    "-preset", preset,
                    "-movflags", "+faststart",
                ]);
            }
            OutputFormat::Gif => {
                // Two-pass palettegen does not work with pipe input, so we
                // use a simple single-pass filter instead.
                let gif_fps = match config.quality {
                    EncoderQuality::Low => "10",
                    EncoderQuality::Medium => "15",
                    // High = use the source fps as-is (no fps filter)
                    EncoderQuality::High => &fps_str,
                };
                let vf = format!("fps={},scale={}:-1:flags=lanczos", gif_fps, config.width);
                push_args(&mut args, &["-vf", &vf]);
            }
            OutputFormat::WebM => {
                let crf = match config.quality {
                    EncoderQuality::Low => "35",
                    EncoderQuality::Medium => "30",
                    EncoderQuality::High => "25",
                };
                push_args(&mut args, &[
                    "-c:v", "libvpx-vp9",
                    "-pix_fmt", "yuv420p",
                    "-crf", crf,
                    "-b:v", "0",
                ]);
            }
        }

        // -- Output path --
        let output_str = config
            .output_path
            .to_str()
            .ok_or_else(|| "Output path contains invalid UTF-8".to_string())?;
        args.push(output_str.to_string());

        let process = Command::new(&ffmpeg_path)
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn FFmpeg: {}", e))?;

        Ok(Self {
            process,
            width: config.width,
            height: config.height,
            row_bytes,
            src_stride,
            output_path: config.output_path,
            format: config.format,
            frame_count: 0,
        })
    }

    /// Write a single raw BGRA frame to the encoder.
    ///
    /// `frame_data` must contain at least `height * src_stride` bytes (or
    /// `height * width * 4` when no padding is present).
    pub fn write_frame(&mut self, frame_data: &[u8]) -> Result<(), String> {
        let expected_size = self.height as usize * self.src_stride;
        if frame_data.len() < expected_size {
            return Err(format!(
                "Frame buffer too small: got {} bytes, expected at least {} \
                 ({}x{}, stride={})",
                frame_data.len(),
                expected_size,
                self.width,
                self.height,
                self.src_stride,
            ));
        }

        let stdin = self
            .process
            .stdin
            .as_mut()
            .ok_or_else(|| "FFmpeg stdin is not available (process may have exited)".to_string())?;

        if self.src_stride == self.row_bytes {
            // Tightly packed -- single write for the whole frame.
            let tight_size = self.height as usize * self.row_bytes;
            stdin
                .write_all(&frame_data[..tight_size])
                .map_err(|e| format!("Failed to write frame to FFmpeg: {}", e))?;
        } else {
            // Source has row padding -- strip it by writing row-by-row.
            for y in 0..self.height as usize {
                let start = y * self.src_stride;
                let end = start + self.row_bytes;
                stdin
                    .write_all(&frame_data[start..end])
                    .map_err(|e| format!("Failed to write frame row {} to FFmpeg: {}", y, e))?;
            }
        }

        self.frame_count += 1;
        Ok(())
    }

    /// Close the stdin pipe and wait for FFmpeg to finish encoding.
    ///
    /// This **consumes** the encoder. On success it returns an
    /// [`EncoderResult`] with metadata about the produced file.
    pub fn finish(mut self) -> Result<EncoderResult, String> {
        // Drop stdin to send EOF, signalling FFmpeg to flush and finalize.
        drop(self.process.stdin.take());

        // Read stderr before waiting so we can report errors.
        // We cannot call `wait_with_output()` because `Self` implements `Drop`
        // and the compiler disallows moving `self.process` out.
        let stderr_content = self
            .process
            .stderr
            .take()
            .and_then(|mut err| {
                let mut buf = String::new();
                std::io::Read::read_to_string(&mut err, &mut buf).ok()?;
                Some(buf)
            })
            .unwrap_or_default();

        let status = self
            .process
            .wait()
            .map_err(|e| format!("Failed to wait for FFmpeg process: {}", e))?;

        if !status.success() {
            return Err(format!(
                "FFmpeg exited with status {}: {}",
                status, stderr_content
            ));
        }

        Ok(EncoderResult {
            output_path: self.output_path.to_string_lossy().into_owned(),
            frame_count: self.frame_count,
            format: self.format.extension().to_string(),
        })
    }

}

/// If the FFmpeg process is still running when the encoder is dropped
/// without calling `finish()`, we make a best-effort attempt to close stdin
/// and reap the child so we don't leave zombie processes.
impl Drop for FfmpegEncoder {
    fn drop(&mut self) {
        // Close stdin (idempotent if already taken by `finish`).
        drop(self.process.stdin.take());
        // Best-effort wait -- ignore errors.
        let _ = self.process.wait();
    }
}

// ---------------------------------------------------------------------------
// FFmpeg discovery helpers
// ---------------------------------------------------------------------------

/// Locate the FFmpeg binary by probing well-known paths.
pub fn find_ffmpeg() -> Result<String, String> {
    // Candidates ordered from most specific to most generic.
    const CANDIDATES: &[&str] = &[
        "/opt/homebrew/bin/ffmpeg", // macOS ARM (Apple Silicon) Homebrew
        "/usr/local/bin/ffmpeg",    // macOS Intel Homebrew / Linux manual install
        "/usr/bin/ffmpeg",          // Linux distro package
        "ffmpeg",                   // Fall back to $PATH lookup
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
        "FFmpeg not found. Please install FFmpeg (e.g. `brew install ffmpeg` on macOS)."
            .to_string(),
    )
}

/// Returns `true` if FFmpeg can be found on this system.
pub fn is_ffmpeg_available() -> bool {
    find_ffmpeg().is_ok()
}

/// Returns the first line of `ffmpeg -version` output (e.g.
/// `"ffmpeg version 6.1 Copyright ..."`).
pub fn get_ffmpeg_version() -> Result<String, String> {
    let ffmpeg_path = find_ffmpeg()?;
    let output = Command::new(&ffmpeg_path)
        .arg("-version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map_err(|e| format!("Failed to execute FFmpeg: {}", e))?;

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(|s| s.to_string())
        .ok_or_else(|| "FFmpeg produced no version output".to_string())
}

// ---------------------------------------------------------------------------
// Audio/video muxing
// ---------------------------------------------------------------------------

/// Mux video and audio files into a single output file.
///
/// Called after recording stops to combine the video-only temp file with
/// PCM audio temp file(s). Uses `ffmpeg` with `-c:v copy` (no re-encode)
/// and AAC/Opus encoding for audio.
pub fn mux_audio_video(
    video_path: &std::path::Path,
    system_audio_path: Option<&std::path::Path>,
    mic_audio_path: Option<&std::path::Path>,
    system_sample_rate: u32,
    mic_sample_rate: u32,
    system_channel_count: u32,
    mic_channel_count: u32,
    format: OutputFormat,
    output_path: &std::path::Path,
) -> Result<(), String> {
    if format == OutputFormat::Gif {
        return Err("Audio muxing is not supported for GIF format".to_string());
    }
    if system_audio_path.is_some() && system_channel_count == 0 {
        return Err("system_channel_count must be > 0 when system audio is provided".to_string());
    }
    if mic_audio_path.is_some() && mic_channel_count == 0 {
        return Err("mic_channel_count must be > 0 when mic audio is provided".to_string());
    }
    if system_audio_path.is_some() && system_sample_rate == 0 {
        return Err("system_sample_rate must be > 0 when system audio is provided".to_string());
    }
    if mic_audio_path.is_some() && mic_sample_rate == 0 {
        return Err("mic_sample_rate must be > 0 when mic audio is provided".to_string());
    }

    let ffmpeg_path = find_ffmpeg()?;

    let video_str = video_path
        .to_str()
        .ok_or_else(|| "path contains invalid UTF-8".to_string())?;
    let output_str = output_path
        .to_str()
        .ok_or_else(|| "path contains invalid UTF-8".to_string())?;

    let system_sample_rate_str = system_sample_rate.to_string();
    let mic_sample_rate_str = mic_sample_rate.to_string();
    let system_channel_count_str = system_channel_count.to_string();
    let mic_channel_count_str = mic_channel_count.to_string();

    let mut args: Vec<String> = Vec::new();

    // -- Global flags --
    push_args(&mut args, &["-y", "-hide_banner", "-loglevel", "error"]);

    // -- Input 0: video --
    push_args(&mut args, &["-i", video_str]);

    // -- Input 1: system audio (raw PCM f32le) --
    let has_system = system_audio_path.is_some();
    if let Some(path) = system_audio_path {
        let path_str = path
            .to_str()
            .ok_or_else(|| "path contains invalid UTF-8".to_string())?;
        push_args(&mut args, &[
            "-f", "f32le",
            "-ar", &system_sample_rate_str,
            "-ac", &system_channel_count_str,
            "-i", path_str,
        ]);
    }

    // -- Input 2 (or 1): mic audio (raw PCM f32le) --
    let has_mic = mic_audio_path.is_some();
    if let Some(path) = mic_audio_path {
        let path_str = path
            .to_str()
            .ok_or_else(|| "path contains invalid UTF-8".to_string())?;
        push_args(&mut args, &[
            "-f", "f32le",
            "-ar", &mic_sample_rate_str,
            "-ac", &mic_channel_count_str,
            "-i", path_str,
        ]);
    }

    // -- Video codec: copy (no re-encode) --
    push_args(&mut args, &["-c:v", "copy"]);

    // -- Stream mapping and audio merge --
    match (has_system, has_mic) {
        (true, true) => {
            // After amerge, channels are laid out sequentially:
            // system channels (0..system_channel_count), then mic channels.
            // For stereo system (2ch) + mono mic (1ch): c0=sysL, c1=sysR, c2=mic
            // For stereo system (2ch) + stereo mic (2ch): c0=sysL, c1=sysR, c2=micL, c3=micR
            let mic_start = system_channel_count;
            let filter = format!(
                "[1:a][2:a]amerge=inputs=2,pan=stereo|c0<c0+c{}|c1<c{}+c{}[aout]",
                mic_start,
                system_channel_count - 1,
                mic_start + mic_channel_count - 1,
            );
            args.push("-filter_complex".to_string());
            args.push(filter);
            push_args(&mut args, &["-map", "0:v", "-map", "[aout]"]);
        }
        (true, false) | (false, true) => {
            push_args(&mut args, &["-map", "0:v", "-map", "1:a"]);
        }
        (false, false) => {
            push_args(&mut args, &["-map", "0:v"]);
        }
    }

    // -- Audio codec --
    if has_system || has_mic {
        match format {
            OutputFormat::Mp4 => {
                push_args(&mut args, &["-c:a", "aac", "-b:a", "192k"]);
            }
            OutputFormat::WebM => {
                push_args(&mut args, &["-c:a", "libopus", "-b:a", "128k"]);
            }
            OutputFormat::Gif => unreachable!(),
        }
    }

    // -- Output path --
    args.push(output_str.to_string());

    let output = Command::new(&ffmpeg_path)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to execute FFmpeg for muxing: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "FFmpeg muxing failed with status {}: {}",
            output.status, stderr
        ));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Push a slice of `&str` into a `Vec<String>`.
fn push_args(dest: &mut Vec<String>, args: &[&str]) {
    dest.extend(args.iter().map(|s| (*s).to_string()));
}
