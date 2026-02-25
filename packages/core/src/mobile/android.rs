use crate::capture::source::CaptureSource;
use crate::capture::CapturedFrame;
use crate::mobile::adb;
use crate::mobile::decode::H264Decoder;

use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

/// Find scrcpy binary on the system.
pub fn find_scrcpy() -> Result<String, String> {
    const CANDIDATES: &[&str] = &[
        "/opt/homebrew/bin/scrcpy",
        "/usr/local/bin/scrcpy",
        "/usr/bin/scrcpy",
        "scrcpy",
    ];
    for &candidate in CANDIDATES {
        let ok = Command::new(candidate)
            .arg("--version")
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
    Err("scrcpy not found".to_string())
}

pub struct AndroidCaptureSource {
    device_serial: String,
    width: u32,
    height: u32,
    source_name: String,
    scrcpy_process: Option<Child>,
    latest_frame: Arc<Mutex<Option<Arc<CapturedFrame>>>>,
    is_active: Arc<AtomicBool>,
    frame_count: Arc<AtomicU64>,
    decode_thread: Option<JoinHandle<()>>,
}

impl AndroidCaptureSource {
    pub fn new(device_serial: String, width: u32, height: u32) -> Self {
        let name = format!("android-{}", device_serial);
        Self {
            device_serial,
            width,
            height,
            source_name: name,
            scrcpy_process: None,
            latest_frame: Arc::new(Mutex::new(None)),
            is_active: Arc::new(AtomicBool::new(false)),
            frame_count: Arc::new(AtomicU64::new(0)),
            decode_thread: None,
        }
    }
}

impl CaptureSource for AndroidCaptureSource {
    fn start(&mut self) -> Result<(), String> {
        if self.is_active.load(Ordering::Relaxed) {
            return Err("Already active".to_string());
        }

        // Wake the device screen (best-effort, applies to both scrcpy and adb paths)
        adb::wake_screen(&self.device_serial);

        // Try scrcpy first, fall back to adb screenrecord
        let mut process = if let Ok(scrcpy) = find_scrcpy() {
            Command::new(&scrcpy)
                .args([
                    &format!("--serial={}", self.device_serial),
                    "--no-display",
                    "--video-codec=h264",
                    "--video-codec-options=repeat-previous-frame-after=100000",
                    "--turn-screen-on",
                    "--stay-awake",
                    "--raw-video=-",
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("Failed to start scrcpy: {}", e))?
        } else {
            let adb_path = adb::find_adb()?;
            Command::new(adb_path.as_os_str())
                .args([
                    "-s", &self.device_serial,
                    "exec-out", "screenrecord", "--output-format=h264", "-",
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("Failed to start adb screenrecord: {}", e))?
        };

        let mut process_stdout = process.stdout.take()
            .ok_or_else(|| "Failed to capture process stdout".to_string())?;

        let mut decoder = H264Decoder::new(self.width, self.height)?;

        let is_active = self.is_active.clone();
        let frame_count = self.frame_count.clone();
        let latest_frame = self.latest_frame.clone();
        let width = self.width as usize;
        let height = self.height as usize;

        is_active.store(true, Ordering::Relaxed);

        let decode_thread = thread::spawn(move || {
            let mut buf = [0u8; 8192];
            while is_active.load(Ordering::Relaxed) {
                // Read H.264 from scrcpy/adb stdout
                match process_stdout.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let _ = decoder.write_h264(&buf[..n]);
                    }
                    Err(_) => break,
                }

                // Check for decoded frames
                while let Some(frame_data) = decoder.try_read_frame() {
                    let frame = CapturedFrame {
                        data: frame_data,
                        width,
                        height,
                        bytes_per_row: width * 4,
                        timestamp_ms: std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.as_millis() as f64)
                            .unwrap_or(0.0),
                    };
                    if let Ok(mut lock) = latest_frame.lock() {
                        *lock = Some(Arc::new(frame));
                    }
                    frame_count.fetch_add(1, Ordering::Relaxed);
                }
            }
            is_active.store(false, Ordering::Relaxed);
            decoder.stop();
        });

        self.scrcpy_process = Some(process);
        self.decode_thread = Some(decode_thread);
        Ok(())
    }

    fn stop(&mut self) -> Result<(), String> {
        self.is_active.store(false, Ordering::Relaxed);
        if let Some(mut process) = self.scrcpy_process.take() {
            let _ = process.kill();
            let _ = process.wait();
        }
        if let Some(handle) = self.decode_thread.take() {
            let _ = handle.join();
        }
        Ok(())
    }

    fn latest_frame(&self) -> Option<Arc<CapturedFrame>> {
        self.latest_frame.lock().ok()?.clone()
    }

    fn frame_count(&self) -> u64 {
        self.frame_count.load(Ordering::Relaxed)
    }

    fn dimensions(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    fn is_active(&self) -> bool {
        self.is_active.load(Ordering::Relaxed)
    }

    fn name(&self) -> &str {
        &self.source_name
    }
}

impl Drop for AndroidCaptureSource {
    fn drop(&mut self) {
        if self.is_active.load(Ordering::Relaxed) {
            let _ = self.stop();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_android_source_new() {
        let source = AndroidCaptureSource::new("emulator-5554".to_string(), 1080, 1920);
        assert_eq!(source.name(), "android-emulator-5554");
        assert_eq!(source.dimensions(), (1080, 1920));
        assert!(!source.is_active());
        assert_eq!(source.frame_count(), 0);
    }

    #[test]
    fn test_android_source_no_frame_before_start() {
        let source = AndroidCaptureSource::new("test-device".to_string(), 720, 1280);
        assert!(source.latest_frame().is_none());
    }

    #[test]
    fn test_android_source_stop_idempotent() {
        let mut source = AndroidCaptureSource::new("test-device".to_string(), 720, 1280);
        // Stop without start should be fine
        assert!(source.stop().is_ok());
        assert!(source.stop().is_ok());
    }

    #[test]
    #[ignore] // Requires actual Android device
    fn test_android_source_with_device() {
        let devices = adb::list_devices().unwrap_or_default();
        if devices.is_empty() {
            return;
        }
        let serial = devices[0].serial.clone();
        let (w, h) = adb::get_device_resolution(&serial).unwrap_or((1080, 1920));
        let mut source = AndroidCaptureSource::new(serial, w, h);
        source.start().expect("start failed");
        std::thread::sleep(std::time::Duration::from_secs(2));
        assert!(source.frame_count() > 0);
        source.stop().expect("stop failed");
    }
}
