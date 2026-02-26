//! Audio-only recording via ScreenCaptureKit.
//!
//! Creates an `SCStream` configured for audio capture (system audio and/or
//! microphone) and writes raw PCM f32le data to regular files.  This avoids
//! the broken-pipe and deadlock problems of a FIFO-based approach.

use screencapturekit::prelude::*;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

// ---------------------------------------------------------------------------
// AudioTempFiles — locations of raw PCM output files
// ---------------------------------------------------------------------------

/// Paths to the temporary raw PCM files written during a recording session.
pub struct AudioTempFiles {
    pub system_audio_path: Option<PathBuf>,
    pub mic_audio_path: Option<PathBuf>,
    /// Sample rate detected from CMFormatDescription of the first audio buffer.
    pub system_sample_rate: Option<u32>,
    /// Sample rate detected from CMFormatDescription of the first audio buffer.
    pub mic_sample_rate: Option<u32>,
    /// Actual channel count detected from the first system audio buffer.
    pub system_channel_count: Option<u32>,
    /// Actual channel count detected from the first mic audio buffer.
    pub mic_channel_count: Option<u32>,
}

impl AudioTempFiles {
    /// Returns `true` if at least one audio file has actual data.
    pub fn has_audio(&self) -> bool {
        let has_system = self.system_audio_path.as_ref().map_or(false, |p| {
            std::fs::metadata(p).map_or(false, |m| m.len() > 0)
        });
        let has_mic = self.mic_audio_path.as_ref().map_or(false, |p| {
            std::fs::metadata(p).map_or(false, |m| m.len() > 0)
        });
        has_system || has_mic
    }

    /// Get the system audio path only if the file has actual data.
    pub fn system_audio_path_if_nonempty(&self) -> Option<&PathBuf> {
        self.system_audio_path.as_ref().filter(|p| {
            std::fs::metadata(p).map_or(false, |m| m.len() > 0)
        })
    }

    /// Get the mic audio path only if the file has actual data.
    pub fn mic_audio_path_if_nonempty(&self) -> Option<&PathBuf> {
        self.mic_audio_path.as_ref().filter(|p| {
            std::fs::metadata(p).map_or(false, |m| m.len() > 0)
        })
    }

    /// Delete the temporary PCM files (best-effort).
    pub fn cleanup(&self) {
        if let Some(ref p) = self.system_audio_path {
            let _ = std::fs::remove_file(p);
        }
        if let Some(ref p) = self.mic_audio_path {
            let _ = std::fs::remove_file(p);
        }
    }
}

// ---------------------------------------------------------------------------
// AudioFileHandler — SCStreamOutputTrait implementation
// ---------------------------------------------------------------------------

/// Receives audio sample buffers from ScreenCaptureKit and writes
/// normalized f32le PCM data to a file via a buffered writer.
struct AudioFileHandler {
    writer: Arc<Mutex<BufWriter<File>>>,
    write_error: Arc<AtomicBool>,
    detected_sample_rate: Arc<Mutex<Option<f64>>>,
    detected_channel_count: Arc<Mutex<Option<u32>>>,
    /// Whether the one-time format diagnostic has been logged.
    format_logged: Arc<AtomicBool>,
    /// The output type this handler is registered for.
    /// Used to filter out callbacks dispatched for a different output type.
    expected_type: SCStreamOutputType,
}

impl SCStreamOutputTrait for AudioFileHandler {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        // Only process callbacks matching this handler's registered output type.
        // SCK dispatches ALL sample buffers to ALL handlers regardless of their
        // registered type, so we must filter here to avoid writing duplicate data.
        if of_type != self.expected_type {
            return;
        }

        // Detect audio format from the sample buffer
        let (is_float, bits) = sample
            .format_description()
            .map(|fd| (fd.audio_is_float(), fd.audio_bits_per_channel().unwrap_or(32)))
            .unwrap_or((true, 32));

        // Detect actual sample rate and channel count from the first sample buffer
        {
            let mut rate = self.detected_sample_rate.lock().unwrap_or_else(|e| e.into_inner());
            let mut channels = self.detected_channel_count.lock().unwrap_or_else(|e| e.into_inner());
            if rate.is_none() || channels.is_none() {
                if let Some(fd) = sample.format_description() {
                    if rate.is_none() {
                        if let Some(sr) = fd.audio_sample_rate() {
                            *rate = Some(sr);
                        }
                    }
                    if channels.is_none() {
                        if let Some(ch) = fd.audio_channel_count() {
                            *channels = Some(ch);
                        }
                    }
                }
                // Log once when both are detected
                if rate.is_some() && channels.is_some() {
                    eprintln!(
                        "[audio] {:?} detected: sample_rate={} Hz, channels={}, is_float={}, bits={}",
                        of_type,
                        rate.map_or("unknown".to_string(), |r| format!("{}", r)),
                        channels.map_or("unknown".to_string(), |c| format!("{}", c)),
                        is_float,
                        bits,
                    );
                }
            }
        }

        // Extract format metadata for data validation and non-interleaved detection
        let format_flags = sample
            .format_description()
            .and_then(|fd| fd.audio_format_flags())
            .unwrap_or(0);
        let is_non_interleaved = format_flags & 32 != 0;
        let num_frames = sample.num_samples();
        let bytes_per_frame = sample
            .format_description()
            .and_then(|fd| fd.audio_bytes_per_frame())
            .unwrap_or(0);

        if let Some(audio_buffers) = sample.audio_buffer_list() {
            // One-time format diagnostic (logged on first callback with detected rate/channels)
            if !self.format_logged.load(Ordering::Relaxed) {
                if let Some(fd) = sample.format_description() {
                    let flags = fd.audio_format_flags().unwrap_or(0);
                    let bpf = fd.audio_bytes_per_frame().unwrap_or(0);

                    let mut buf_info = String::new();
                    for (i, buf) in audio_buffers.iter().enumerate() {
                        if !buf_info.is_empty() { buf_info.push_str(", "); }
                        buf_info.push_str(&format!(
                            "buf[{}](ch={}, bytes={})",
                            i, buf.number_channels, buf.data_bytes_size
                        ));
                    }
                    let expected_bytes = num_frames * bpf as usize;
                    eprintln!(
                        "[audio] {:?} FORMAT: flags=0x{:02x} bytes_per_frame={} num_samples={} non_interleaved={} {} expected_bytes={}",
                        of_type, flags, bpf, num_frames, is_non_interleaved, buf_info, expected_bytes
                    );
                    self.format_logged.store(true, Ordering::Relaxed);
                }
            }

            if is_non_interleaved && audio_buffers.num_buffers() > 1 {
                // Non-interleaved: collect per-channel buffers and interleave.
                // In non-interleaved CoreAudio, bytes_per_frame is per-frame-per-channel
                // (i.e., the size of one sample), NOT the total for all channels.
                let channel_bufs: Vec<&[u8]> = audio_buffers
                    .iter()
                    .map(|b| {
                        let raw = b.data();
                        // Truncate to expected size if buffer has padding
                        let expected = if bytes_per_frame > 0 && num_frames > 0 {
                            num_frames * bytes_per_frame as usize
                        } else {
                            raw.len()
                        };
                        if raw.len() > expected && expected > 0 {
                            &raw[..expected]
                        } else {
                            raw
                        }
                    })
                    .filter(|d| !d.is_empty())
                    .collect();
                let bytes_per_sample = (bits / 8) as usize;
                let interleaved = interleave_audio_buffers(&channel_bufs, bytes_per_sample);
                let f32_data = match (is_float, bits) {
                    (true, 32) => sanitize_f32_audio(&interleaved),
                    (true, 64) => convert_f64le_to_f32le(&interleaved),
                    (false, 16) => convert_s16le_to_f32le(&interleaved),
                    (false, 32) => convert_s32le_to_f32le(&interleaved),
                    _ => sanitize_f32_audio(&interleaved),
                };
                if let Ok(mut writer) = self.writer.lock() {
                    if writer.write_all(&f32_data).is_err() {
                        self.write_error.store(true, Ordering::Relaxed);
                        return;
                    }
                }
            } else {
                // Interleaved (normal path): iterate buffers and write each
                for buffer in &audio_buffers {
                    let raw = buffer.data();
                    if raw.is_empty() {
                        continue;
                    }
                    // Truncate to expected size if buffer has padding
                    let expected_per_buffer = if bytes_per_frame > 0 && num_frames > 0 {
                        num_frames * bytes_per_frame as usize
                    } else {
                        raw.len()
                    };
                    let valid_raw = if raw.len() > expected_per_buffer && expected_per_buffer > 0 {
                        &raw[..expected_per_buffer]
                    } else {
                        raw
                    };
                    let f32_data = match (is_float, bits) {
                        (true, 32) => sanitize_f32_audio(valid_raw),
                        (true, 64) => convert_f64le_to_f32le(valid_raw),
                        (false, 16) => convert_s16le_to_f32le(valid_raw),
                        (false, 32) => convert_s32le_to_f32le(valid_raw),
                        _ => sanitize_f32_audio(valid_raw),
                    };
                    if let Ok(mut writer) = self.writer.lock() {
                        if writer.write_all(&f32_data).is_err() {
                            self.write_error.store(true, Ordering::Relaxed);
                            return;
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// sanitize_f32_audio
// ---------------------------------------------------------------------------

/// Sanitize f32 PCM audio data — replace NaN/Inf/subnormals with 0.0.
///
/// Input is raw bytes, 4 bytes per f32 sample, little-endian.
fn sanitize_f32_audio(raw: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(raw.len());
    for chunk in raw.chunks_exact(4) {
        let sample = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        let clean = if sample.is_normal() || sample == 0.0 { sample } else { 0.0f32 };
        result.extend_from_slice(&clean.to_le_bytes());
    }
    result
}

/// Convert 64-bit float little-endian PCM to f32le.
fn convert_f64le_to_f32le(raw: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(raw.len() / 2);
    for chunk in raw.chunks_exact(8) {
        let sample = f64::from_le_bytes([
            chunk[0], chunk[1], chunk[2], chunk[3],
            chunk[4], chunk[5], chunk[6], chunk[7],
        ]);
        let f32_sample = if sample.is_finite() { sample as f32 } else { 0.0f32 };
        let clean = if f32_sample.is_normal() || f32_sample == 0.0 { f32_sample } else { 0.0f32 };
        result.extend_from_slice(&clean.to_le_bytes());
    }
    result
}

/// Convert signed 16-bit little-endian PCM to f32le.
fn convert_s16le_to_f32le(raw: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(raw.len() * 2);
    for chunk in raw.chunks_exact(2) {
        let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
        let f32_sample = sample as f32 / 32768.0;
        result.extend_from_slice(&f32_sample.to_le_bytes());
    }
    result
}

/// Convert signed 32-bit little-endian PCM to f32le.
fn convert_s32le_to_f32le(raw: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(raw.len());
    for chunk in raw.chunks_exact(4) {
        let sample = i32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        let f32_sample = sample as f32 / 2_147_483_648.0;
        result.extend_from_slice(&f32_sample.to_le_bytes());
    }
    result
}

// ---------------------------------------------------------------------------
// interleave_audio_buffers
// ---------------------------------------------------------------------------

/// Interleave planar audio buffers into interleaved format.
///
/// Works with any sample size (f32=4, f64=8, s16=2, s32=4 bytes per sample).
/// Input: slice of per-channel byte slices (each `&[u8]` is samples for one channel)
/// and the number of bytes per sample.
/// Output: interleaved bytes `[L0,R0,L1,R1,...]`.
fn interleave_audio_buffers(channel_buffers: &[&[u8]], bytes_per_sample: usize) -> Vec<u8> {
    if channel_buffers.is_empty() || bytes_per_sample == 0 {
        return Vec::new();
    }
    let num_channels = channel_buffers.len();
    let samples_per_channel = channel_buffers[0].len() / bytes_per_sample;
    let mut result = Vec::with_capacity(samples_per_channel * num_channels * bytes_per_sample);

    for sample_idx in 0..samples_per_channel {
        for ch_buf in channel_buffers {
            let offset = sample_idx * bytes_per_sample;
            if offset + bytes_per_sample <= ch_buf.len() {
                result.extend_from_slice(&ch_buf[offset..offset + bytes_per_sample]);
            } else {
                // Zero-pad if the channel buffer is shorter than expected
                result.resize(result.len() + bytes_per_sample, 0);
            }
        }
    }
    result
}

// ---------------------------------------------------------------------------
// AudioRecorder
// ---------------------------------------------------------------------------

/// Manages a ScreenCaptureKit stream configured for audio-only capture.
///
/// Call [`start`](Self::start) to begin recording and [`stop`](Self::stop)
/// to finalise the files.  The returned [`AudioTempFiles`] contains the
/// paths to the raw PCM output.
pub struct AudioRecorder {
    stream: SCStream,
    system_writer: Option<Arc<Mutex<BufWriter<File>>>>,
    mic_writer: Option<Arc<Mutex<BufWriter<File>>>>,
    system_audio_path: Option<PathBuf>,
    mic_audio_path: Option<PathBuf>,
    system_write_error: Arc<AtomicBool>,
    mic_write_error: Arc<AtomicBool>,
    system_detected_sample_rate: Arc<Mutex<Option<f64>>>,
    mic_detected_sample_rate: Arc<Mutex<Option<f64>>>,
    system_detected_channel_count: Arc<Mutex<Option<u32>>>,
    mic_detected_channel_count: Arc<Mutex<Option<u32>>>,
    system_format_logged: Arc<AtomicBool>,
    mic_format_logged: Arc<AtomicBool>,
}

// SCStream is not marked Send/Sync by the crate.  We guard access through
// &mut self methods (start/stop), so concurrent mutation is impossible.
unsafe impl Send for AudioRecorder {}

impl AudioRecorder {
    /// Start an audio-only capture stream.
    ///
    /// `base_path` is used to derive the output filenames — system audio is
    /// written to `<base_path>.system_audio.pcm` and microphone audio to
    /// `<base_path>.mic_audio.pcm`.
    pub fn start(config: &super::AudioConfig, base_path: &Path) -> Result<Self, String> {
        let content = SCShareableContent::get()
            .map_err(|e| format!("Failed to get shareable content: {}", e))?;
        let displays = content.displays();
        let display = displays
            .first()
            .ok_or_else(|| "No displays available for audio capture".to_string())?;

        let filter = SCContentFilter::create()
            .with_display(display)
            .with_excluding_windows(&[])
            .build();

        // Minimal video dimensions — SCStream requires a video surface even
        // when we only care about audio.
        // channelCount applies to the entire SCK stream.
        // When system audio is captured, use stereo (2).
        // When only microphone is captured, use mono (1) to match most mic devices.
        let stream_channel_count = if config.capture_system_audio {
            config.channel_count as i32
        } else {
            config.mic_channel_count as i32
        };

        let mut sc_config = SCStreamConfiguration::new()
            .with_width(16)
            .with_height(16)
            .with_captures_audio(config.capture_system_audio)
            .with_captures_microphone(config.capture_microphone)
            .with_sample_rate(config.sample_rate as i32)
            .with_channel_count(stream_channel_count)
            .with_excludes_current_process_audio(true);

        if let Some(ref id) = config.microphone_device_id {
            sc_config = sc_config.with_microphone_capture_device_id(id);
        }

        let mut stream = SCStream::new(&filter, &sc_config);

        let system_write_error = Arc::new(AtomicBool::new(false));
        let mic_write_error = Arc::new(AtomicBool::new(false));
        let system_detected_sample_rate = Arc::new(Mutex::new(None));
        let mic_detected_sample_rate = Arc::new(Mutex::new(None));
        let system_detected_channel_count: Arc<Mutex<Option<u32>>> = Arc::new(Mutex::new(None));
        let mic_detected_channel_count: Arc<Mutex<Option<u32>>> = Arc::new(Mutex::new(None));
        let system_format_logged = Arc::new(AtomicBool::new(false));
        let mic_format_logged = Arc::new(AtomicBool::new(false));

        // -- system audio output handler --
        let mut system_writer: Option<Arc<Mutex<BufWriter<File>>>> = None;
        let mut system_audio_path: Option<PathBuf> = None;

        if config.capture_system_audio {
            let path = derive_audio_path(base_path, "system_audio.pcm");
            let file = File::create(&path)
                .map_err(|e| format!("Failed to create system audio file: {}", e))?;
            let writer = Arc::new(Mutex::new(BufWriter::new(file)));
            let handler = AudioFileHandler {
                writer: Arc::clone(&writer),
                write_error: Arc::clone(&system_write_error),
                detected_sample_rate: Arc::clone(&system_detected_sample_rate),
                detected_channel_count: Arc::clone(&system_detected_channel_count),
                format_logged: Arc::clone(&system_format_logged),
                expected_type: SCStreamOutputType::Audio,
            };
            stream.add_output_handler(handler, SCStreamOutputType::Audio);
            system_writer = Some(writer);
            system_audio_path = Some(path);
        }

        // -- microphone output handler --
        let mut mic_writer: Option<Arc<Mutex<BufWriter<File>>>> = None;
        let mut mic_audio_path: Option<PathBuf> = None;

        if config.capture_microphone {
            let path = derive_audio_path(base_path, "mic_audio.pcm");
            let file = File::create(&path)
                .map_err(|e| format!("Failed to create mic audio file: {}", e))?;
            let writer = Arc::new(Mutex::new(BufWriter::new(file)));
            let handler = AudioFileHandler {
                writer: Arc::clone(&writer),
                write_error: Arc::clone(&mic_write_error),
                detected_sample_rate: Arc::clone(&mic_detected_sample_rate),
                detected_channel_count: Arc::clone(&mic_detected_channel_count),
                format_logged: Arc::clone(&mic_format_logged),
                expected_type: SCStreamOutputType::Microphone,
            };
            stream.add_output_handler(handler, SCStreamOutputType::Microphone);
            mic_writer = Some(writer);
            mic_audio_path = Some(path);
        }

        stream
            .start_capture()
            .map_err(|e| format!("Failed to start audio capture: {}", e))?;

        Ok(Self {
            stream,
            system_writer,
            mic_writer,
            system_audio_path,
            mic_audio_path,
            system_write_error,
            mic_write_error,
            system_detected_sample_rate,
            mic_detected_sample_rate,
            system_detected_channel_count,
            mic_detected_channel_count,
            system_format_logged,
            mic_format_logged,
        })
    }

    /// Stop the audio capture stream and flush all buffered data.
    ///
    /// Returns the [`AudioTempFiles`] describing where the raw PCM data was
    /// written.
    pub fn stop(self) -> Result<AudioTempFiles, String> {
        self.stream
            .stop_capture()
            .map_err(|e| format!("Failed to stop audio capture: {}", e))?;

        // Flush buffered writers to ensure all data is on disk.
        if let Some(ref writer) = self.system_writer {
            if let Ok(mut w) = writer.lock() {
                if let Err(e) = w.flush() {
                    eprintln!("[audio] Warning: failed to flush system audio: {}", e);
                }
            }
        }
        if let Some(ref writer) = self.mic_writer {
            if let Ok(mut w) = writer.lock() {
                if let Err(e) = w.flush() {
                    eprintln!("[audio] Warning: failed to flush mic audio: {}", e);
                }
            }
        }

        // Check for write errors during recording
        if self.system_write_error.load(Ordering::Relaxed) {
            eprintln!("[audio] Warning: write errors occurred during system audio recording");
        }
        if self.mic_write_error.load(Ordering::Relaxed) {
            eprintln!("[audio] Warning: write errors occurred during mic audio recording");
        }

        Ok(AudioTempFiles {
            system_audio_path: self.system_audio_path,
            mic_audio_path: self.mic_audio_path,
            system_sample_rate: self
                .system_detected_sample_rate
                .lock()
                .ok()
                .and_then(|r| *r)
                .map(|r| r.round() as u32),
            mic_sample_rate: self
                .mic_detected_sample_rate
                .lock()
                .ok()
                .and_then(|r| *r)
                .map(|r| r.round() as u32),
            system_channel_count: self
                .system_detected_channel_count
                .lock()
                .ok()
                .and_then(|c| *c),
            mic_channel_count: self
                .mic_detected_channel_count
                .lock()
                .ok()
                .and_then(|c| *c),
        })
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Derive an audio output path from a base path.
///
/// Places the audio file alongside the base path using the provided suffix,
/// e.g. `base_path = /tmp/rec` + `suffix = system_audio.pcm` produces
/// `/tmp/rec.system_audio.pcm`.
fn derive_audio_path(base_path: &Path, suffix: &str) -> PathBuf {
    let mut name = base_path
        .file_name()
        .unwrap_or_default()
        .to_os_string();
    name.push(".");
    name.push(suffix);
    base_path.with_file_name(name)
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_f32_audio_passes_normal() {
        let sample = 0.5f32;
        let input = sample.to_le_bytes().to_vec();
        let output = sanitize_f32_audio(&input);
        let result = f32::from_le_bytes([output[0], output[1], output[2], output[3]]);
        assert!((result - 0.5).abs() < f32::EPSILON);
    }

    #[test]
    fn test_sanitize_f32_audio_replaces_nan() {
        let input = f32::NAN.to_le_bytes().to_vec();
        let output = sanitize_f32_audio(&input);
        let result = f32::from_le_bytes([output[0], output[1], output[2], output[3]]);
        assert_eq!(result, 0.0);
    }

    #[test]
    fn test_sanitize_f32_audio_replaces_inf() {
        let input = f32::INFINITY.to_le_bytes().to_vec();
        let output = sanitize_f32_audio(&input);
        let result = f32::from_le_bytes([output[0], output[1], output[2], output[3]]);
        assert_eq!(result, 0.0);
    }

    #[test]
    fn test_sanitize_f32_audio_replaces_neg_inf() {
        let input = f32::NEG_INFINITY.to_le_bytes().to_vec();
        let output = sanitize_f32_audio(&input);
        let result = f32::from_le_bytes([output[0], output[1], output[2], output[3]]);
        assert_eq!(result, 0.0);
    }

    #[test]
    fn test_sanitize_f32_audio_multiple_samples() {
        let mut input = Vec::new();
        input.extend_from_slice(&0.1f32.to_le_bytes());
        input.extend_from_slice(&f32::NAN.to_le_bytes());
        input.extend_from_slice(&(-0.5f32).to_le_bytes());
        input.extend_from_slice(&f32::INFINITY.to_le_bytes());

        let output = sanitize_f32_audio(&input);
        assert_eq!(output.len(), 16);

        let s0 = f32::from_le_bytes([output[0], output[1], output[2], output[3]]);
        let s1 = f32::from_le_bytes([output[4], output[5], output[6], output[7]]);
        let s2 = f32::from_le_bytes([output[8], output[9], output[10], output[11]]);
        let s3 = f32::from_le_bytes([output[12], output[13], output[14], output[15]]);

        assert!((s0 - 0.1).abs() < f32::EPSILON);
        assert_eq!(s1, 0.0);
        assert!((s2 - (-0.5)).abs() < f32::EPSILON);
        assert_eq!(s3, 0.0);
    }

    #[test]
    fn test_derive_audio_path() {
        let base = Path::new("/tmp/recording");
        assert_eq!(
            derive_audio_path(base, "system_audio.pcm"),
            PathBuf::from("/tmp/recording.system_audio.pcm")
        );
        assert_eq!(
            derive_audio_path(base, "mic_audio.pcm"),
            PathBuf::from("/tmp/recording.mic_audio.pcm")
        );
    }

    #[test]
    fn test_audio_temp_files_has_audio() {
        // No paths at all
        let no_audio = AudioTempFiles {
            system_audio_path: None,
            mic_audio_path: None,
            system_sample_rate: None,
            mic_sample_rate: None,
            system_channel_count: None,
            mic_channel_count: None,
        };
        assert!(!no_audio.has_audio());

        // Paths to non-existent files (metadata check fails → no audio)
        let nonexistent = AudioTempFiles {
            system_audio_path: Some(PathBuf::from("/tmp/nonexistent_sys.pcm")),
            mic_audio_path: None,
            system_sample_rate: None,
            mic_sample_rate: None,
            system_channel_count: None,
            mic_channel_count: None,
        };
        assert!(!nonexistent.has_audio());

        // Create real files with data to test positive cases
        let dir = std::env::temp_dir();
        let sys_path = dir.join("test_has_audio_sys.pcm");
        let mic_path = dir.join("test_has_audio_mic.pcm");

        // Write some data so the files are non-empty
        std::fs::write(&sys_path, b"data").unwrap();
        std::fs::write(&mic_path, b"data").unwrap();

        let system_only = AudioTempFiles {
            system_audio_path: Some(sys_path.clone()),
            mic_audio_path: None,
            system_sample_rate: None,
            mic_sample_rate: None,
            system_channel_count: None,
            mic_channel_count: None,
        };
        assert!(system_only.has_audio());

        let mic_only = AudioTempFiles {
            system_audio_path: None,
            mic_audio_path: Some(mic_path.clone()),
            system_sample_rate: None,
            mic_sample_rate: None,
            system_channel_count: None,
            mic_channel_count: None,
        };
        assert!(mic_only.has_audio());

        let both = AudioTempFiles {
            system_audio_path: Some(sys_path.clone()),
            mic_audio_path: Some(mic_path.clone()),
            system_sample_rate: None,
            mic_sample_rate: None,
            system_channel_count: None,
            mic_channel_count: None,
        };
        assert!(both.has_audio());

        // Empty file should report no audio
        std::fs::write(&sys_path, b"").unwrap();
        let empty_file = AudioTempFiles {
            system_audio_path: Some(sys_path.clone()),
            mic_audio_path: None,
            system_sample_rate: None,
            mic_sample_rate: None,
            system_channel_count: None,
            mic_channel_count: None,
        };
        assert!(!empty_file.has_audio());

        // Cleanup
        let _ = std::fs::remove_file(&sys_path);
        let _ = std::fs::remove_file(&mic_path);
    }

    // -----------------------------------------------------------------------
    // convert_s16le_to_f32le
    // -----------------------------------------------------------------------

    #[test]
    fn test_convert_s16le_to_f32le_normal() {
        let input = 16384i16.to_le_bytes().to_vec();
        let output = convert_s16le_to_f32le(&input);
        let result = f32::from_le_bytes([output[0], output[1], output[2], output[3]]);
        assert!((result - 0.5).abs() < f32::EPSILON);
    }

    #[test]
    fn test_convert_s16le_to_f32le_max() {
        let input = i16::MAX.to_le_bytes().to_vec();
        let output = convert_s16le_to_f32le(&input);
        let result = f32::from_le_bytes([output[0], output[1], output[2], output[3]]);
        assert!(result > 0.99 && result < 1.0);
    }

    #[test]
    fn test_convert_s16le_to_f32le_min() {
        let input = i16::MIN.to_le_bytes().to_vec();
        let output = convert_s16le_to_f32le(&input);
        let result = f32::from_le_bytes([output[0], output[1], output[2], output[3]]);
        assert!((result - (-1.0)).abs() < f32::EPSILON);
    }

    #[test]
    fn test_convert_s16le_to_f32le_zero() {
        let input = 0i16.to_le_bytes().to_vec();
        let output = convert_s16le_to_f32le(&input);
        let result = f32::from_le_bytes([output[0], output[1], output[2], output[3]]);
        assert_eq!(result, 0.0);
    }

    #[test]
    fn test_convert_s16le_to_f32le_odd_bytes_truncated() {
        let mut input = 16384i16.to_le_bytes().to_vec();
        input.push(0xFF);
        let output = convert_s16le_to_f32le(&input);
        assert_eq!(output.len(), 4);
        let result = f32::from_le_bytes([output[0], output[1], output[2], output[3]]);
        assert!((result - 0.5).abs() < f32::EPSILON);
    }

    // -----------------------------------------------------------------------
    // convert_s32le_to_f32le
    // -----------------------------------------------------------------------

    #[test]
    fn test_convert_s32le_to_f32le_normal() {
        let input = 1_073_741_824i32.to_le_bytes().to_vec();
        let output = convert_s32le_to_f32le(&input);
        let result = f32::from_le_bytes([output[0], output[1], output[2], output[3]]);
        assert!((result - 0.5).abs() < 1e-6);
    }

    #[test]
    fn test_convert_s32le_to_f32le_max() {
        let input = i32::MAX.to_le_bytes().to_vec();
        let output = convert_s32le_to_f32le(&input);
        let result = f32::from_le_bytes([output[0], output[1], output[2], output[3]]);
        assert!(result > 0.99 && result <= 1.0);
    }

    #[test]
    fn test_convert_s32le_to_f32le_min() {
        let input = i32::MIN.to_le_bytes().to_vec();
        let output = convert_s32le_to_f32le(&input);
        let result = f32::from_le_bytes([output[0], output[1], output[2], output[3]]);
        assert!((result - (-1.0)).abs() < f32::EPSILON);
    }

    #[test]
    fn test_convert_s32le_to_f32le_zero() {
        let input = 0i32.to_le_bytes().to_vec();
        let output = convert_s32le_to_f32le(&input);
        let result = f32::from_le_bytes([output[0], output[1], output[2], output[3]]);
        assert_eq!(result, 0.0);
    }

    // -----------------------------------------------------------------------
    // sanitize_f32_audio — subnormal handling
    // -----------------------------------------------------------------------

    #[test]
    fn test_sanitize_f32_audio_replaces_subnormal() {
        let subnormal = f32::from_bits(1u32);
        assert!(subnormal.is_subnormal(), "test precondition: value must be subnormal");
        let input = subnormal.to_le_bytes().to_vec();
        let output = sanitize_f32_audio(&input);
        let result = f32::from_le_bytes([output[0], output[1], output[2], output[3]]);
        assert_eq!(result, 0.0, "subnormal should be replaced with 0.0");
    }

    #[test]
    fn test_sanitize_f32_audio_preserves_zero() {
        let input = 0.0f32.to_le_bytes().to_vec();
        let output = sanitize_f32_audio(&input);
        let result = f32::from_le_bytes([output[0], output[1], output[2], output[3]]);
        assert_eq!(result, 0.0);
    }

    #[test]
    fn test_sanitize_f32_audio_preserves_neg_zero() {
        let input = (-0.0f32).to_le_bytes().to_vec();
        let output = sanitize_f32_audio(&input);
        let result = f32::from_le_bytes([output[0], output[1], output[2], output[3]]);
        assert_eq!(result, 0.0);
    }

    // -----------------------------------------------------------------------
    // interleave_audio_buffers
    // -----------------------------------------------------------------------

    #[test]
    fn test_interleave_audio_buffers_f32_two_channels() {
        // 2 channels, 3 samples each: L=[1.0,2.0,3.0] R=[4.0,5.0,6.0]
        let ch_l: Vec<u8> = [1.0f32, 2.0, 3.0]
            .iter()
            .flat_map(|s| s.to_le_bytes())
            .collect();
        let ch_r: Vec<u8> = [4.0f32, 5.0, 6.0]
            .iter()
            .flat_map(|s| s.to_le_bytes())
            .collect();

        let result = interleave_audio_buffers(&[&ch_l, &ch_r], 4);

        // Expected interleaved: [1.0,4.0,2.0,5.0,3.0,6.0]
        assert_eq!(result.len(), 6 * 4);
        let samples: Vec<f32> = result
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect();
        assert_eq!(samples, vec![1.0, 4.0, 2.0, 5.0, 3.0, 6.0]);
    }

    #[test]
    fn test_interleave_audio_buffers_s16_two_channels() {
        // 2 channels, 3 s16le samples each (2 bytes per sample)
        let ch_l: Vec<u8> = [100i16, 200, 300]
            .iter()
            .flat_map(|s| s.to_le_bytes())
            .collect();
        let ch_r: Vec<u8> = [400i16, 500, 600]
            .iter()
            .flat_map(|s| s.to_le_bytes())
            .collect();

        let result = interleave_audio_buffers(&[&ch_l, &ch_r], 2);

        assert_eq!(result.len(), 6 * 2);
        let samples: Vec<i16> = result
            .chunks_exact(2)
            .map(|c| i16::from_le_bytes([c[0], c[1]]))
            .collect();
        assert_eq!(samples, vec![100, 400, 200, 500, 300, 600]);
    }

    #[test]
    fn test_interleave_audio_buffers_empty() {
        let result = interleave_audio_buffers(&[], 4);
        assert!(result.is_empty());
    }

    #[test]
    fn test_interleave_audio_buffers_zero_bytes_per_sample() {
        let ch: Vec<u8> = vec![1, 2, 3, 4];
        let result = interleave_audio_buffers(&[&ch], 0);
        assert!(result.is_empty());
    }

    #[test]
    fn audio_handler_should_filter_by_expected_type() {
        // Verify that SCStreamOutputType enum comparison works correctly
        // for the handler dispatch filter: `of_type != self.expected_type`
        let audio = SCStreamOutputType::Audio;
        let mic = SCStreamOutputType::Microphone;
        let screen = SCStreamOutputType::Screen;

        // System audio handler (expected_type = Audio) should only accept Audio
        assert_eq!(audio, SCStreamOutputType::Audio);
        assert_ne!(audio, mic, "Audio handler must reject Microphone callbacks");
        assert_ne!(audio, screen, "Audio handler must reject Screen callbacks");

        // Mic handler (expected_type = Microphone) should only accept Microphone
        assert_eq!(mic, SCStreamOutputType::Microphone);
        assert_ne!(mic, audio, "Mic handler must reject Audio callbacks");
        assert_ne!(mic, screen, "Mic handler must reject Screen callbacks");
    }

    #[test]
    fn test_interleave_audio_buffers_different_lengths() {
        // Channel 0 has 3 samples, channel 1 has only 2 samples (shorter)
        let ch0: Vec<u8> = [1.0f32, 2.0, 3.0]
            .iter()
            .flat_map(|s| s.to_le_bytes())
            .collect();
        let ch1: Vec<u8> = [4.0f32, 5.0]
            .iter()
            .flat_map(|s| s.to_le_bytes())
            .collect();

        let result = interleave_audio_buffers(&[&ch0, &ch1], 4);

        // samples_per_channel = ch0.len()/4 = 3 (based on first channel)
        // Sample 0: 1.0, 4.0
        // Sample 1: 2.0, 5.0
        // Sample 2: 3.0, 0.0 (ch1 too short, zero-padded)
        assert_eq!(result.len(), 6 * 4);
        let samples: Vec<f32> = result
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect();
        assert_eq!(samples, vec![1.0, 4.0, 2.0, 5.0, 3.0, 0.0]);
    }
}
