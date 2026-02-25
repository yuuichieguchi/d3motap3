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
                if let Ok(mut queue) = self.buffer.lock() {
                    queue.push_back(data.to_vec());
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
