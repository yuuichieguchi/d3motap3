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

/// Receives audio sample buffers from ScreenCaptureKit and writes the raw
/// PCM f32le data to a file via a buffered writer.
struct AudioFileHandler {
    writer: Arc<Mutex<BufWriter<File>>>,
    write_error: Arc<AtomicBool>,
}

impl SCStreamOutputTrait for AudioFileHandler {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        // Only process audio output types
        if !matches!(of_type, SCStreamOutputType::Audio | SCStreamOutputType::Microphone) {
            return;
        }
        if let Some(audio_buffers) = sample.audio_buffer_list() {
            for buffer in &audio_buffers {
                let raw = buffer.data();
                if raw.is_empty() {
                    continue;
                }
                let sanitized = sanitize_f32_audio(raw);
                if let Ok(mut writer) = self.writer.lock() {
                    if writer.write_all(&sanitized).is_err() {
                        self.write_error.store(true, Ordering::Relaxed);
                        return;
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// sanitize_f32_audio
// ---------------------------------------------------------------------------

/// Sanitize f32 PCM audio data — replace NaN/Inf with 0.0.
///
/// Input is raw bytes, 4 bytes per f32 sample, little-endian.
fn sanitize_f32_audio(raw: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(raw.len());
    for chunk in raw.chunks_exact(4) {
        let sample = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        let clean = if sample.is_finite() { sample } else { 0.0f32 };
        result.extend_from_slice(&clean.to_le_bytes());
    }
    // Remainder bytes (incomplete samples) are silently dropped — this should
    // not happen with correctly-formatted audio, but we handle it gracefully.
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
        let mut sc_config = SCStreamConfiguration::new()
            .with_width(2)
            .with_height(2)
            .with_captures_audio(config.capture_system_audio)
            .with_captures_microphone(config.capture_microphone)
            .with_sample_rate(config.sample_rate as i32)
            .with_channel_count(config.channel_count as i32)
            .with_excludes_current_process_audio(true);

        if let Some(ref id) = config.microphone_device_id {
            sc_config = sc_config.with_microphone_capture_device_id(id);
        }

        let mut stream = SCStream::new(&filter, &sc_config);

        let system_write_error = Arc::new(AtomicBool::new(false));
        let mic_write_error = Arc::new(AtomicBool::new(false));

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
        };
        assert!(!no_audio.has_audio());

        // Paths to non-existent files (metadata check fails → no audio)
        let nonexistent = AudioTempFiles {
            system_audio_path: Some(PathBuf::from("/tmp/nonexistent_sys.pcm")),
            mic_audio_path: None,
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
        };
        assert!(system_only.has_audio());

        let mic_only = AudioTempFiles {
            system_audio_path: None,
            mic_audio_path: Some(mic_path.clone()),
        };
        assert!(mic_only.has_audio());

        let both = AudioTempFiles {
            system_audio_path: Some(sys_path.clone()),
            mic_audio_path: Some(mic_path.clone()),
        };
        assert!(both.has_audio());

        // Empty file should report no audio
        std::fs::write(&sys_path, b"").unwrap();
        let empty_file = AudioTempFiles {
            system_audio_path: Some(sys_path.clone()),
            mic_audio_path: None,
        };
        assert!(!empty_file.has_audio());

        // Cleanup
        let _ = std::fs::remove_file(&sys_path);
        let _ = std::fs::remove_file(&mic_path);
    }
}
