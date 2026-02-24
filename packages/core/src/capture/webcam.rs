//! Webcam capture using nokhwa.
//!
//! Provides webcam enumeration and real-time frame capture via the
//! AVFoundation backend on macOS. Frames are delivered through a
//! `CallbackCamera` and stored as BGRA pixel data in `CapturedFrame`.

use super::source::CaptureSource;
use super::CapturedFrame;
use nokhwa::pixel_format::RgbAFormat;
use nokhwa::utils::{ApiBackend, CameraIndex, RequestedFormat, RequestedFormatType};
use nokhwa::CallbackCamera;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

/// Metadata about a detected webcam device.
#[derive(Debug, Clone)]
pub struct WebcamInfo {
    pub device_index: u32,
    pub name: String,
    pub description: String,
}

/// Enumerates all webcams available through the AVFoundation backend.
pub fn list_webcams_impl() -> Result<Vec<WebcamInfo>, String> {
    let cameras = nokhwa::query(ApiBackend::AVFoundation)
        .map_err(|e| format!("Failed to query webcams: {}", e))?;
    Ok(cameras
        .iter()
        .enumerate()
        .map(|(i, cam)| WebcamInfo {
            device_index: i as u32,
            name: cam.human_name(),
            description: cam.description().to_string(),
        })
        .collect())
}

/// A capture source backed by a webcam via nokhwa's `CallbackCamera`.
///
/// Frames are captured in RGBA format by nokhwa and converted to BGRA
/// (swapping R and B channels) to match the `CapturedFrame` convention
/// used by the rest of the capture pipeline.
pub struct WebcamCaptureSource {
    device_index: u32,
    width: u32,
    height: u32,
    source_name: String,
    latest_frame: Arc<Mutex<Option<Arc<CapturedFrame>>>>,
    is_active: Arc<AtomicBool>,
    frame_count: Arc<AtomicU64>,
    camera: Option<CallbackCamera>,
}

// SAFETY: `CallbackCamera` internally uses `Arc<FairMutex<Camera>>` for
// thread-safe access. The only non-Send field is the raw camera backend
// pointer, which is always accessed behind the mutex. We need Send for
// the `CaptureSource` trait bound.
unsafe impl Send for WebcamCaptureSource {}

impl WebcamCaptureSource {
    /// Creates a new webcam capture source for the given device index.
    ///
    /// Queries available cameras to validate the index and retrieve the
    /// device name. The camera stream is not opened until [`start`] is called.
    pub fn new(device_index: u32, width: u32, height: u32) -> Result<Self, String> {
        let cameras = nokhwa::query(ApiBackend::AVFoundation)
            .map_err(|e| format!("Failed to query webcams: {}", e))?;
        let cam = cameras
            .get(device_index as usize)
            .ok_or_else(|| format!("Webcam {} not found", device_index))?;
        let name = cam.human_name();

        Ok(Self {
            device_index,
            width,
            height,
            source_name: name,
            latest_frame: Arc::new(Mutex::new(None)),
            is_active: Arc::new(AtomicBool::new(false)),
            frame_count: Arc::new(AtomicU64::new(0)),
            camera: None,
        })
    }
}

impl CaptureSource for WebcamCaptureSource {
    fn start(&mut self) -> Result<(), String> {
        let index = CameraIndex::Index(self.device_index);
        let requested =
            RequestedFormat::new::<RgbAFormat>(RequestedFormatType::AbsoluteHighestFrameRate);

        let latest_frame = Arc::clone(&self.latest_frame);
        let is_active = Arc::clone(&self.is_active);
        let frame_count = Arc::clone(&self.frame_count);

        let mut camera = CallbackCamera::new(index, requested, move |buffer| {
            if !is_active.load(Ordering::Relaxed) {
                return;
            }

            let resolution = buffer.resolution();
            let actual_width = resolution.width() as usize;
            let actual_height = resolution.height() as usize;

            let rgba_data = match buffer.decode_image::<RgbAFormat>() {
                Ok(img) => img.into_raw(),
                Err(_) => return,
            };

            let mut bgra_data = rgba_data;
            for pixel in bgra_data.chunks_exact_mut(4) {
                pixel.swap(0, 2);
            }

            let frame = Arc::new(CapturedFrame {
                data: bgra_data,
                width: actual_width,
                height: actual_height,
                bytes_per_row: actual_width * 4,
                timestamp_ms: 0.0,
            });

            if let Ok(mut latest) = latest_frame.lock() {
                *latest = Some(frame);
            }
            frame_count.fetch_add(1, Ordering::Relaxed);
        })
        .map_err(|e| format!("Failed to create webcam: {}", e))?;

        camera
            .open_stream()
            .map_err(|e| format!("Failed to open webcam stream: {}", e))?;

        if let Ok(res) = camera.resolution() {
            self.width = res.width();
            self.height = res.height();
        }

        self.frame_count.store(0, Ordering::Relaxed);
        self.is_active.store(true, Ordering::Relaxed);
        self.camera = Some(camera);
        Ok(())
    }

    fn stop(&mut self) -> Result<(), String> {
        self.is_active.store(false, Ordering::Relaxed);
        if let Some(camera) = self.camera.take() {
            std::thread::spawn(move || drop(camera));
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
