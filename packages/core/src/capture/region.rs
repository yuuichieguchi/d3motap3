//! Region capture — crops a rectangular area from a display.
//!
//! Captures the full display via ScreenCaptureKit and extracts
//! the specified sub-rectangle in the frame handler callback.

use super::source::CaptureSource;
use super::CapturedFrame;
use screencapturekit::cv::CVPixelBufferLockFlags;
use screencapturekit::prelude::*;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

pub struct RegionCaptureSource {
    display_id: u32,
    x: u32,
    y: u32,
    region_width: u32,
    region_height: u32,
    source_name: String,
    latest_frame: Arc<Mutex<Option<Arc<CapturedFrame>>>>,
    is_active: Arc<AtomicBool>,
    frame_count: Arc<AtomicU64>,
    stream: Option<SCStream>,
}

unsafe impl Send for RegionCaptureSource {}

impl RegionCaptureSource {
    pub fn new(
        display_index: u32,
        x: u32,
        y: u32,
        region_width: u32,
        region_height: u32,
    ) -> Result<Self, String> {
        if region_width == 0 || region_height == 0 {
            return Err("Region width and height must be greater than 0".to_string());
        }

        let content = SCShareableContent::get()
            .map_err(|e| format!("Failed to get shareable content: {}", e))?;
        let displays = content.displays();
        let display = displays.get(display_index as usize).ok_or_else(|| {
            format!(
                "Display index {} out of range (have {})",
                display_index,
                displays.len()
            )
        })?;

        let display_w = display.width();
        let display_h = display.height();

        let x_end = x.checked_add(region_width).ok_or_else(|| {
            "Region x + width overflows u32".to_string()
        })?;
        let y_end = y.checked_add(region_height).ok_or_else(|| {
            "Region y + height overflows u32".to_string()
        })?;
        if x_end > display_w || y_end > display_h {
            return Err(format!(
                "Region ({},{} {}x{}) exceeds display bounds ({}x{})",
                x, y, region_width, region_height, display_w, display_h
            ));
        }

        let source_name = format!(
            "Region ({},{} {}x{}) on Display {}",
            x, y, region_width, region_height, display_index + 1
        );

        Ok(Self {
            display_id: display.display_id(),
            x,
            y,
            region_width,
            region_height,
            source_name,
            latest_frame: Arc::new(Mutex::new(None)),
            is_active: Arc::new(AtomicBool::new(false)),
            frame_count: Arc::new(AtomicU64::new(0)),
            stream: None,
        })
    }
}

impl CaptureSource for RegionCaptureSource {
    fn start(&mut self) -> Result<(), String> {
        if self.is_active.load(Ordering::Relaxed) {
            return Err("Already capturing".to_string());
        }

        let content = SCShareableContent::get()
            .map_err(|e| format!("Failed to get shareable content: {}", e))?;
        let displays = content.displays();
        let display = displays
            .iter()
            .find(|d| d.display_id() == self.display_id)
            .ok_or_else(|| {
                format!("Display with ID {} no longer available", self.display_id)
            })?;

        let filter = SCContentFilter::create()
            .with_display(display)
            .with_excluding_windows(&[])
            .build();

        // Capture at full display resolution so pixel coordinates match
        let config = SCStreamConfiguration::new()
            .with_width(display.width())
            .with_height(display.height())
            .with_pixel_format(PixelFormat::BGRA)
            .with_shows_cursor(true);

        let handler = RegionFrameHandler {
            x: self.x as usize,
            y: self.y as usize,
            region_width: self.region_width as usize,
            region_height: self.region_height as usize,
            latest_frame: Arc::clone(&self.latest_frame),
            is_active: Arc::clone(&self.is_active),
            frame_count: Arc::clone(&self.frame_count),
        };

        let mut stream = SCStream::new(&filter, &config);
        stream.add_output_handler(handler, SCStreamOutputType::Screen);
        stream
            .start_capture()
            .map_err(|e| format!("Failed to start capture: {}", e))?;

        self.frame_count.store(0, Ordering::Relaxed);
        self.is_active.store(true, Ordering::Relaxed);
        self.stream = Some(stream);

        Ok(())
    }

    fn stop(&mut self) -> Result<(), String> {
        if !self.is_active.load(Ordering::Relaxed) {
            return Err("Not capturing".to_string());
        }

        self.is_active.store(false, Ordering::Relaxed);

        if let Some(stream) = self.stream.take() {
            stream
                .stop_capture()
                .map_err(|e| format!("Failed to stop capture: {}", e))?;
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
        (self.region_width, self.region_height)
    }

    fn is_active(&self) -> bool {
        self.is_active.load(Ordering::Relaxed)
    }

    fn name(&self) -> &str {
        &self.source_name
    }
}

impl Drop for RegionCaptureSource {
    fn drop(&mut self) {
        if self.is_active.load(Ordering::Relaxed) {
            let _ = self.stop();
        }
    }
}

struct RegionFrameHandler {
    x: usize,
    y: usize,
    region_width: usize,
    region_height: usize,
    latest_frame: Arc<Mutex<Option<Arc<CapturedFrame>>>>,
    is_active: Arc<AtomicBool>,
    frame_count: Arc<AtomicU64>,
}

impl SCStreamOutputTrait for RegionFrameHandler {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        if !matches!(of_type, SCStreamOutputType::Screen) {
            return;
        }
        if !self.is_active.load(Ordering::Relaxed) {
            return;
        }

        if let Some(pixel_buffer) = sample.image_buffer() {
            if let Ok(guard) = pixel_buffer.lock(CVPixelBufferLockFlags::READ_ONLY) {
                let src_data = guard.as_slice();
                let src_bytes_per_row = guard.bytes_per_row();
                let src_height = guard.height();

                // Validate crop region fits within the captured frame
                if self.y + self.region_height > src_height
                    || (self.x + self.region_width) * 4 > src_bytes_per_row
                {
                    return;
                }

                let dst_bytes_per_row = self.region_width * 4;
                let mut cropped = Vec::with_capacity(dst_bytes_per_row * self.region_height);

                for row in self.y..(self.y + self.region_height) {
                    let row_start = row * src_bytes_per_row + self.x * 4;
                    let row_end = row_start + dst_bytes_per_row;
                    if row_end > src_data.len() {
                        // Frame data doesn't contain the full region; discard this frame
                        return;
                    }
                    cropped.extend_from_slice(&src_data[row_start..row_end]);
                }

                let timestamp_ms = sample
                    .presentation_timestamp()
                    .as_seconds()
                    .map(|s| s * 1000.0)
                    .unwrap_or(0.0);

                let frame = Arc::new(CapturedFrame {
                    data: cropped,
                    width: self.region_width,
                    height: self.region_height,
                    bytes_per_row: dst_bytes_per_row,
                    timestamp_ms,
                });

                if let Ok(mut latest) = self.latest_frame.lock() {
                    *latest = Some(frame);
                }
                self.frame_count.fetch_add(1, Ordering::Relaxed);
            }
        }
    }
}
