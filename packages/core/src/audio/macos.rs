//! macOS audio capture via ScreenCaptureKit.
//!
//! Captures system audio and/or microphone audio using `SCStream`, writing raw
//! PCM f32le data to a named FIFO pipe for FFmpeg to consume.

use screencapturekit::prelude::*;
use screencapturekit::stream::configuration::PixelFormat;

use std::collections::VecDeque;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use nix::fcntl::{fcntl, open, FcntlArg, OFlag};
use nix::sys::stat::Mode;
use nix::unistd::{mkfifo, write};

/// Maximum number of audio chunks held in the in-memory ring buffer.
/// When the buffer exceeds this limit the oldest chunks are discarded to
/// prevent unbounded memory growth.
const MAX_BUFFER_CHUNKS: usize = 1000;

/// Interval between FIFO open retry attempts (milliseconds).
const FIFO_OPEN_POLL_MS: u64 = 50;

/// Sleep duration when the audio buffer is empty and we are waiting for new
/// samples from ScreenCaptureKit.
const WRITER_IDLE_SLEEP_MS: u64 = 5;

// ---------------------------------------------------------------------------
// AudioCaptureStream — public API
// ---------------------------------------------------------------------------

/// A running audio capture session.
///
/// Audio samples received from ScreenCaptureKit are buffered in memory and
/// drained into a named FIFO pipe by a dedicated writer thread.  FFmpeg reads
/// the other end of the pipe.
pub struct AudioCaptureStream {
    stream: Option<SCStream>,
    writer_thread: Option<thread::JoinHandle<()>>,
    is_active: Arc<AtomicBool>,
    fifo_path: Option<PathBuf>,
}

// `SCStream` is not marked `Send` by the crate, but we only access it through
// `&mut self` in `stop()` / `Drop`, so concurrent mutation is impossible.
unsafe impl Send for AudioCaptureStream {}

impl AudioCaptureStream {
    /// Start capturing audio according to `config` and begin writing PCM data
    /// to the FIFO at `fifo_path`.
    ///
    /// The FIFO is created by this function and will be removed when the stream
    /// is stopped (or dropped).
    pub fn start(config: &super::AudioConfig, fifo_path: &Path) -> Result<Self, String> {
        // 1. Create the named FIFO
        mkfifo(fifo_path, Mode::from_bits_truncate(0o600))
            .map_err(|e| format!("Failed to create FIFO at {}: {}", fifo_path.display(), e))?;

        // 2. Obtain a display for the content filter (required by SCStream even
        //    when we only want audio).
        let content = SCShareableContent::get()
            .map_err(|e| format!("Failed to get shareable content: {}", e))?;
        let displays = content.displays();
        let display = displays
            .first()
            .ok_or_else(|| "No displays available for audio capture filter".to_string())?;

        // 3. Build SCStreamConfiguration
        let mut sc_config = SCStreamConfiguration::new()
            // Minimum video surface — we do not need video frames but a display
            // filter requires *some* pixel dimensions.
            .with_width(2)
            .with_height(2)
            .with_pixel_format(PixelFormat::BGRA)
            .with_captures_audio(config.capture_system_audio)
            .with_sample_rate(config.sample_rate as i32)
            .with_channel_count(config.channel_count as i32)
            .with_excludes_current_process_audio(true);

        if config.capture_microphone {
            sc_config = sc_config.with_captures_microphone(true);
        }

        if let Some(ref device_id) = config.microphone_device_id {
            sc_config = sc_config.with_microphone_capture_device_id(device_id);
        }

        // 4. Build content filter
        let filter = SCContentFilter::create()
            .with_display(display)
            .with_excluding_windows(&[])
            .build();

        // 5. Create the stream
        let mut stream = SCStream::new(&filter, &sc_config);

        // 6. Shared ring buffer for PCM data
        let buffer: Arc<Mutex<VecDeque<Vec<u8>>>> =
            Arc::new(Mutex::new(VecDeque::with_capacity(256)));

        // 7. Active flag
        let is_active = Arc::new(AtomicBool::new(true));

        // 8–10. Register output handlers
        if config.capture_system_audio {
            let handler = AudioSampleHandler {
                buffer: Arc::clone(&buffer),
            };
            stream.add_output_handler(handler, SCStreamOutputType::Audio);
        }

        if config.capture_microphone {
            let handler = AudioSampleHandler {
                buffer: Arc::clone(&buffer),
            };
            stream.add_output_handler(handler, SCStreamOutputType::Microphone);
        }

        // 11. Start capture
        stream
            .start_capture()
            .map_err(|e| format!("Failed to start audio capture: {}", e))?;

        // 12. Spawn the FIFO writer thread
        let writer_thread = spawn_fifo_writer(
            fifo_path.to_path_buf(),
            Arc::clone(&buffer),
            Arc::clone(&is_active),
        );

        Ok(Self {
            stream: Some(stream),
            writer_thread: Some(writer_thread),
            is_active,
            fifo_path: Some(fifo_path.to_path_buf()),
        })
    }

    /// Stop capturing and clean up all resources.
    pub fn stop(&mut self) -> Result<(), String> {
        // Signal the writer thread to exit.
        self.is_active.store(false, Ordering::SeqCst);

        // Stop the SCStream.
        if let Some(stream) = self.stream.take() {
            stream
                .stop_capture()
                .map_err(|e| format!("Failed to stop audio capture: {}", e))?;
        }

        // Wait for the writer thread to finish.
        if let Some(handle) = self.writer_thread.take() {
            let _ = handle.join();
        }

        // Remove the FIFO from disk.
        if let Some(ref path) = self.fifo_path.take() {
            let _ = std::fs::remove_file(path);
        }

        Ok(())
    }
}

impl Drop for AudioCaptureStream {
    fn drop(&mut self) {
        self.is_active.store(false, Ordering::SeqCst);

        // Best-effort cleanup — errors are intentionally ignored during drop.
        if let Some(stream) = self.stream.take() {
            let _ = stream.stop_capture();
        }
        if let Some(handle) = self.writer_thread.take() {
            let _ = handle.join();
        }
        if let Some(ref path) = self.fifo_path {
            let _ = std::fs::remove_file(path);
        }
    }
}

// ---------------------------------------------------------------------------
// AudioSampleHandler — SCStreamOutputTrait implementation
// ---------------------------------------------------------------------------

struct AudioSampleHandler {
    buffer: Arc<Mutex<VecDeque<Vec<u8>>>>,
}

impl SCStreamOutputTrait for AudioSampleHandler {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, _of_type: SCStreamOutputType) {
        if let Some(audio_buffers) = sample.audio_buffer_list() {
            for buf in audio_buffers.iter() {
                let data = buf.data();
                if data.is_empty() {
                    continue;
                }
                // Sanitize f32 samples: replace NaN/Inf with 0.0
                // to prevent FFmpeg AAC encoder from rejecting the input.
                let sanitized = sanitize_f32_samples(data);
                if let Ok(mut queue) = self.buffer.lock() {
                    queue.push_back(sanitized);
                    // Evict oldest chunks when the buffer is too large.
                    while queue.len() > MAX_BUFFER_CHUNKS {
                        queue.pop_front();
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// FIFO writer thread
// ---------------------------------------------------------------------------

/// Spawn a background thread that drains the shared audio buffer into the
/// named FIFO at `fifo_path`.
///
/// The thread will:
/// 1. Poll-open the FIFO with `O_NONBLOCK` until FFmpeg opens the read end.
/// 2. Switch to blocking I/O once the pipe is connected.
/// 3. Write PCM data until `is_active` becomes `false` or a write error
///    (broken pipe) occurs.
fn spawn_fifo_writer(
    fifo_path: PathBuf,
    buffer: Arc<Mutex<VecDeque<Vec<u8>>>>,
    is_active: Arc<AtomicBool>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        // --- Phase 1: open the FIFO (non-blocking poll) ---------------------
        let fd: OwnedFd = loop {
            if !is_active.load(Ordering::SeqCst) {
                return;
            }
            match open(
                &fifo_path,
                OFlag::O_WRONLY | OFlag::O_NONBLOCK,
                Mode::empty(),
            ) {
                Ok(raw_fd) => {
                    // SAFETY: `nix::fcntl::open` returns a valid, newly opened
                    // file descriptor that we now own exclusively.
                    break unsafe { OwnedFd::from_raw_fd(raw_fd) };
                }
                Err(nix::errno::Errno::ENXIO) => {
                    // No reader yet — wait and retry.
                    thread::sleep(Duration::from_millis(FIFO_OPEN_POLL_MS));
                }
                Err(e) => {
                    eprintln!("audio FIFO open error: {}", e);
                    return;
                }
            }
        };

        // --- Phase 2: switch to blocking mode -------------------------------
        // `nix::fcntl::fcntl` still takes `RawFd` in nix 0.29.
        if let Err(e) = fcntl(fd.as_raw_fd(), FcntlArg::F_SETFL(OFlag::empty())) {
            eprintln!("audio FIFO fcntl error: {}", e);
            return;
        }

        // --- Phase 3: drain buffer → FIFO -----------------------------------
        while is_active.load(Ordering::SeqCst) {
            let chunk = {
                if let Ok(mut queue) = buffer.lock() {
                    queue.pop_front()
                } else {
                    None
                }
            };

            match chunk {
                Some(data) => {
                    if write_all(&fd, &data).is_err() {
                        // Broken pipe or other fatal write error.
                        break;
                    }
                }
                None => {
                    thread::sleep(Duration::from_millis(WRITER_IDLE_SLEEP_MS));
                }
            }
        }

        // Drain any remaining buffered data before closing.
        if let Ok(mut queue) = buffer.lock() {
            while let Some(data) = queue.pop_front() {
                if write_all(&fd, &data).is_err() {
                    break;
                }
            }
        }

        // `fd` (OwnedFd) is automatically closed when dropped here.
    })
}

/// Write the entire `buf` to `fd`, retrying on partial writes.
///
/// Returns `Err(())` on any fatal error (e.g. broken pipe).
fn write_all(fd: &OwnedFd, buf: &[u8]) -> Result<(), ()> {
    let mut offset = 0;
    while offset < buf.len() {
        match write(fd, &buf[offset..]) {
            Ok(n) => offset += n,
            Err(nix::errno::Errno::EINTR) => continue,
            Err(_) => return Err(()),
        }
    }
    Ok(())
}

/// Replace NaN and Infinite f32 samples with silence (0.0).
///
/// Audio data from ScreenCaptureKit occasionally contains NaN or Infinity
/// values which cause FFmpeg's AAC encoder to reject the input with
/// "Input contains (near) NaN/+-Inf". This function sanitizes the raw PCM
/// byte buffer before it enters the ring buffer.
fn sanitize_f32_samples(raw: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(raw.len());
    let chunks = raw.chunks_exact(4);
    let remainder = chunks.remainder();
    for chunk in chunks {
        let bytes: [u8; 4] = chunk.try_into().unwrap();
        let sample = f32::from_le_bytes(bytes);
        let clean = if sample.is_finite() { sample } else { 0.0f32 };
        out.extend_from_slice(&clean.to_le_bytes());
    }
    if !remainder.is_empty() {
        out.extend_from_slice(remainder);
    }
    out
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: convert an f32 value to its little-endian byte representation.
    fn f32_to_bytes(value: f32) -> [u8; 4] {
        value.to_le_bytes()
    }

    /// Helper: read an f32 from little-endian bytes at a given offset.
    fn f32_from_bytes(bytes: &[u8], offset: usize) -> f32 {
        let chunk: [u8; 4] = bytes[offset..offset + 4].try_into().unwrap();
        f32::from_le_bytes(chunk)
    }

    // ==================== Happy Path ====================

    #[test]
    fn test_should_pass_through_normal_samples_unchanged() {
        // Given: A buffer of normal finite f32 samples
        let samples: Vec<f32> = vec![0.0, 0.5, -0.5, 1.0, -1.0, 0.123_456_78];
        let raw: Vec<u8> = samples.iter().flat_map(|s| f32_to_bytes(*s)).collect();

        // When: sanitize_f32_samples is called
        let result = sanitize_f32_samples(&raw);

        // Then: All samples are identical to the input
        assert_eq!(result.len(), raw.len());
        for (i, &expected) in samples.iter().enumerate() {
            let actual = f32_from_bytes(&result, i * 4);
            assert_eq!(
                actual, expected,
                "Sample at index {} should be {} but was {}",
                i, expected, actual
            );
        }
    }

    // ==================== NaN Replacement ====================

    #[test]
    fn test_should_replace_nan_with_silence() {
        // Given: A buffer containing a NaN sample
        let raw = f32_to_bytes(f32::NAN).to_vec();

        // When: sanitize_f32_samples is called
        let result = sanitize_f32_samples(&raw);

        // Then: NaN is replaced with 0.0 (silence)
        assert_eq!(result.len(), 4);
        let value = f32_from_bytes(&result, 0);
        assert_eq!(value, 0.0f32, "NaN should be replaced with 0.0");
        assert!(!value.is_nan(), "Result must not be NaN");
    }

    // ==================== Positive Infinity Replacement ====================

    #[test]
    fn test_should_replace_positive_infinity_with_silence() {
        // Given: A buffer containing positive infinity
        let raw = f32_to_bytes(f32::INFINITY).to_vec();

        // When: sanitize_f32_samples is called
        let result = sanitize_f32_samples(&raw);

        // Then: +Inf is replaced with 0.0 (silence)
        assert_eq!(result.len(), 4);
        let value = f32_from_bytes(&result, 0);
        assert_eq!(
            value, 0.0f32,
            "Positive infinity should be replaced with 0.0"
        );
    }

    // ==================== Negative Infinity Replacement ====================

    #[test]
    fn test_should_replace_negative_infinity_with_silence() {
        // Given: A buffer containing negative infinity
        let raw = f32_to_bytes(f32::NEG_INFINITY).to_vec();

        // When: sanitize_f32_samples is called
        let result = sanitize_f32_samples(&raw);

        // Then: -Inf is replaced with 0.0 (silence)
        assert_eq!(result.len(), 4);
        let value = f32_from_bytes(&result, 0);
        assert_eq!(
            value, 0.0f32,
            "Negative infinity should be replaced with 0.0"
        );
    }

    // ==================== Mixed Samples ====================

    #[test]
    fn test_should_replace_only_bad_samples_in_mixed_input() {
        // Given: A buffer with normal samples interleaved with NaN and Inf
        let input_values: Vec<f32> = vec![
            0.25,            // normal — keep
            f32::NAN,        // bad — replace
            -0.75,           // normal — keep
            f32::INFINITY,   // bad — replace
            0.0,             // normal — keep
            f32::NEG_INFINITY, // bad — replace
            0.99,            // normal — keep
        ];
        let raw: Vec<u8> = input_values.iter().flat_map(|s| f32_to_bytes(*s)).collect();

        // When: sanitize_f32_samples is called
        let result = sanitize_f32_samples(&raw);

        // Then: Only NaN/Inf samples are replaced with 0.0; normal samples unchanged
        assert_eq!(result.len(), raw.len());

        let expected: Vec<f32> = vec![0.25, 0.0, -0.75, 0.0, 0.0, 0.0, 0.99];
        for (i, &exp) in expected.iter().enumerate() {
            let actual = f32_from_bytes(&result, i * 4);
            assert_eq!(
                actual, exp,
                "Sample at index {}: expected {} but got {}",
                i, exp, actual
            );
        }
    }

    // ==================== Empty Input ====================

    #[test]
    fn test_should_return_empty_for_empty_input() {
        // Given: An empty byte slice
        let raw: &[u8] = &[];

        // When: sanitize_f32_samples is called
        let result = sanitize_f32_samples(raw);

        // Then: Result is also empty
        assert!(result.is_empty(), "Empty input should produce empty output");
    }

    // ==================== Trailing Bytes ====================

    #[test]
    fn test_should_preserve_trailing_bytes_when_not_aligned() {
        // Given: Two complete f32 samples followed by 2 trailing bytes
        let sample1 = 0.5f32;
        let sample2 = f32::NAN;
        let trailing: [u8; 2] = [0xAB, 0xCD];

        let mut raw: Vec<u8> = Vec::new();
        raw.extend_from_slice(&f32_to_bytes(sample1));
        raw.extend_from_slice(&f32_to_bytes(sample2));
        raw.extend_from_slice(&trailing);
        assert_eq!(raw.len(), 10); // 4 + 4 + 2

        // When: sanitize_f32_samples is called
        let result = sanitize_f32_samples(&raw);

        // Then: First sample is unchanged, NaN is replaced, trailing bytes preserved
        assert_eq!(result.len(), 10);

        // Check first sample (normal — unchanged)
        let val0 = f32_from_bytes(&result, 0);
        assert_eq!(val0, 0.5f32, "Normal sample should pass through unchanged");

        // Check second sample (NaN — replaced with 0.0)
        let val1 = f32_from_bytes(&result, 4);
        assert_eq!(val1, 0.0f32, "NaN sample should be replaced with 0.0");

        // Check trailing bytes are preserved exactly
        assert_eq!(
            &result[8..10],
            &trailing,
            "Trailing bytes should be copied as-is"
        );
    }

    // ==================== Subnormal Values ====================

    #[test]
    fn test_should_pass_through_subnormal_values() {
        // Given: A buffer of subnormal (denormalized) f32 values
        // These are tiny but finite values that is_normal() would reject
        let subnormals: Vec<f32> = vec![f32::MIN_POSITIVE / 2.0, -f32::MIN_POSITIVE / 2.0, 1.0e-40];
        let raw: Vec<u8> = subnormals.iter().flat_map(|s| s.to_le_bytes()).collect();

        // When: sanitize_f32_samples is called
        let result = sanitize_f32_samples(&raw);

        // Then: Subnormal values pass through unchanged (is_finite, not is_normal)
        assert_eq!(result.len(), raw.len());
        for (i, &expected) in subnormals.iter().enumerate() {
            let actual = f32_from_bytes(&result, i * 4);
            assert_eq!(
                actual, expected,
                "Subnormal at index {} should pass through unchanged",
                i
            );
        }
    }

    // ==================== FFmpeg Integration ====================

    #[test]
    fn test_ffmpeg_rejects_nan_but_accepts_sanitized() {
        use std::io::Write;
        use std::process::Command;

        // Generate 1 second of stereo 48kHz f32le audio with NaN/Inf scattered throughout
        let sample_rate = 48000u32;
        let channels = 2u32;
        let duration_secs = 1;
        let total_samples = (sample_rate * channels * duration_secs) as usize;

        let mut raw_with_nan: Vec<u8> = Vec::with_capacity(total_samples * 4);
        for i in 0..total_samples {
            let sample: f32 = match i % 100 {
                0 => f32::NAN,
                50 => f32::INFINITY,
                75 => f32::NEG_INFINITY,
                _ => (i as f32 / total_samples as f32 * 2.0 - 1.0) * 0.5, // normal audio-like signal
            };
            raw_with_nan.extend_from_slice(&sample.to_le_bytes());
        }

        // Verify FFmpeg is available
        let ffmpeg_check = Command::new("ffmpeg").arg("-version").output();
        if ffmpeg_check.is_err() {
            eprintln!("Skipping FFmpeg integration test: ffmpeg not found on PATH");
            return;
        }

        let unsanitized_path =
            format!("/tmp/d3motap3_test_nan_unsanitized_{}.raw", std::process::id());
        let sanitized_path =
            format!("/tmp/d3motap3_test_nan_sanitized_{}.raw", std::process::id());

        // Write unsanitized data (contains NaN/Inf)
        {
            let mut f = std::fs::File::create(&unsanitized_path).unwrap();
            f.write_all(&raw_with_nan).unwrap();
        }

        // Write sanitized data (NaN/Inf replaced with 0.0)
        let sanitized_data = sanitize_f32_samples(&raw_with_nan);
        {
            let mut f = std::fs::File::create(&sanitized_path).unwrap();
            f.write_all(&sanitized_data).unwrap();
        }

        // Run FFmpeg on UNSANITIZED data — should fail with NaN error
        let unsanitized_result = Command::new("ffmpeg")
            .args([
                "-y",
                "-f",
                "f32le",
                "-ar",
                "48000",
                "-ac",
                "2",
                "-i",
                &unsanitized_path,
                "-c:a",
                "aac",
                "-f",
                "null",
                "-",
            ])
            .output()
            .expect("failed to run ffmpeg");

        let unsanitized_stderr = String::from_utf8_lossy(&unsanitized_result.stderr);
        // FFmpeg should complain about NaN/Inf in the input
        assert!(
            !unsanitized_result.status.success()
                || unsanitized_stderr.contains("NaN")
                || unsanitized_stderr.contains("Inf"),
            "FFmpeg should reject or warn about NaN audio data. Exit code: {:?}, stderr: {}",
            unsanitized_result.status.code(),
            &unsanitized_stderr[..std::cmp::min(unsanitized_stderr.len(), 500)]
        );

        // Run FFmpeg on SANITIZED data — should succeed
        let sanitized_result = Command::new("ffmpeg")
            .args([
                "-y",
                "-f",
                "f32le",
                "-ar",
                "48000",
                "-ac",
                "2",
                "-i",
                &sanitized_path,
                "-c:a",
                "aac",
                "-f",
                "null",
                "-",
            ])
            .output()
            .expect("failed to run ffmpeg");

        let sanitized_stderr = String::from_utf8_lossy(&sanitized_result.stderr);
        assert!(
            sanitized_result.status.success(),
            "FFmpeg should successfully encode sanitized audio. Exit code: {:?}, stderr: {}",
            sanitized_result.status.code(),
            &sanitized_stderr[..std::cmp::min(sanitized_stderr.len(), 500)]
        );

        // Verify no NaN warnings in sanitized encoding
        assert!(
            !sanitized_stderr.contains("NaN")
                && !sanitized_stderr.contains("contains (near) NaN"),
            "Sanitized audio should not produce NaN warnings. stderr: {}",
            &sanitized_stderr[..std::cmp::min(sanitized_stderr.len(), 500)]
        );

        // Cleanup
        let _ = std::fs::remove_file(&unsanitized_path);
        let _ = std::fs::remove_file(&sanitized_path);
    }
}
