//! Frame compositor for combining multiple capture sources into a
//! single output frame.
//!
//! Supports layouts: Single, SideBySide, and Picture-in-Picture.

use crate::capture::CapturedFrame;
use crate::capture::source::SourceId;
use std::collections::HashMap;
use std::sync::Arc;

/// Position for the PiP overlay.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum PipPosition {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

/// Layout configuration for frame composition.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type")]
pub enum Layout {
    Single {
        source: SourceId,
    },
    SideBySide {
        left: SourceId,
        right: SourceId,
        /// Ratio of left panel width (0.0-1.0). Default 0.5.
        ratio: f32,
    },
    Pip {
        primary: SourceId,
        pip: SourceId,
        pip_position: PipPosition,
        /// Scale of the PiP window relative to output (0.0-1.0). Default 0.25.
        pip_scale: f32,
    },
}

/// Rectangle in pixel coordinates.
#[derive(Debug, Clone, Copy)]
struct Rect {
    x: usize,
    y: usize,
    width: usize,
    height: usize,
}

/// Compositor that combines multiple source frames into a single output.
pub struct Compositor {
    output_width: usize,
    output_height: usize,
    output_buffer: Vec<u8>,
}

impl Compositor {
    pub fn new(output_width: usize, output_height: usize) -> Self {
        let buffer_size = output_width * output_height * 4;
        Self {
            output_width,
            output_height,
            output_buffer: vec![0u8; buffer_size],
        }
    }

    pub fn output_width(&self) -> usize {
        self.output_width
    }

    pub fn output_height(&self) -> usize {
        self.output_height
    }

    /// Compose frames according to the layout, returning the output BGRA buffer.
    pub fn compose(
        &mut self,
        layout: &Layout,
        frames: &HashMap<SourceId, Arc<CapturedFrame>>,
    ) -> &[u8] {
        // Clear to black with full alpha in a single pass
        for chunk in self.output_buffer.chunks_exact_mut(4) {
            chunk[0] = 0;
            chunk[1] = 0;
            chunk[2] = 0;
            chunk[3] = 255;
        }

        match layout {
            Layout::Single { source } => {
                if let Some(frame) = frames.get(source) {
                    let rect = Rect {
                        x: 0,
                        y: 0,
                        width: self.output_width,
                        height: self.output_height,
                    };
                    self.blit_scaled(frame, &rect);
                }
            }
            Layout::SideBySide { left, right, ratio } => {
                let left_width = ((self.output_width as f32) * ratio.clamp(0.1, 0.9)) as usize;
                let right_width = self.output_width - left_width;

                if let Some(frame) = frames.get(left) {
                    let rect = Rect {
                        x: 0,
                        y: 0,
                        width: left_width,
                        height: self.output_height,
                    };
                    self.blit_scaled(frame, &rect);
                }
                if let Some(frame) = frames.get(right) {
                    let rect = Rect {
                        x: left_width,
                        y: 0,
                        width: right_width,
                        height: self.output_height,
                    };
                    self.blit_scaled(frame, &rect);
                }
            }
            Layout::Pip {
                primary,
                pip,
                pip_position,
                pip_scale,
            } => {
                // Primary fills the whole output
                if let Some(frame) = frames.get(primary) {
                    let rect = Rect {
                        x: 0,
                        y: 0,
                        width: self.output_width,
                        height: self.output_height,
                    };
                    self.blit_scaled(frame, &rect);
                }
                // PiP overlay
                if let Some(frame) = frames.get(pip) {
                    let scale = pip_scale.clamp(0.1, 0.5);
                    let pip_w = ((self.output_width as f32) * scale) as usize;
                    let pip_h = ((self.output_height as f32) * scale) as usize;
                    let margin = 16usize;

                    let (px, py) = match pip_position {
                        PipPosition::TopLeft => (margin, margin),
                        PipPosition::TopRight => (self.output_width.saturating_sub(pip_w + margin), margin),
                        PipPosition::BottomLeft => (margin, self.output_height.saturating_sub(pip_h + margin)),
                        PipPosition::BottomRight => (
                            self.output_width.saturating_sub(pip_w + margin),
                            self.output_height.saturating_sub(pip_h + margin),
                        ),
                    };

                    let rect = Rect {
                        x: px,
                        y: py,
                        width: pip_w,
                        height: pip_h,
                    };
                    self.blit_scaled(frame, &rect);
                }
            }
        }

        &self.output_buffer
    }

    /// Nearest-neighbor scale blit from source frame to destination rectangle.
    fn blit_scaled(&mut self, frame: &CapturedFrame, dest: &Rect) {
        if dest.width == 0 || dest.height == 0 || frame.width == 0 || frame.height == 0 {
            return;
        }

        let src_w = frame.width;
        let src_h = frame.height;
        let src_stride = frame.bytes_per_row;
        let dst_stride = self.output_width * 4;

        for dy in 0..dest.height {
            let out_y = dest.y + dy;
            if out_y >= self.output_height {
                break;
            }

            let sy = (dy * src_h) / dest.height;
            if sy >= src_h {
                continue;
            }

            let src_row_start = sy * src_stride;
            let dst_row_start = out_y * dst_stride;

            for dx in 0..dest.width {
                let out_x = dest.x + dx;
                if out_x >= self.output_width {
                    break;
                }

                let sx = (dx * src_w) / dest.width;
                if sx >= src_w {
                    continue;
                }

                let src_offset = src_row_start + sx * 4;
                let dst_offset = dst_row_start + out_x * 4;

                if src_offset + 4 <= frame.data.len() && dst_offset + 4 <= self.output_buffer.len() {
                    self.output_buffer[dst_offset..dst_offset + 4]
                        .copy_from_slice(&frame.data[src_offset..src_offset + 4]);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::CapturedFrame;
    use std::collections::HashMap;
    use std::sync::Arc;

    // ==================== Helper ====================

    fn make_solid_frame(
        width: usize,
        height: usize,
        b: u8,
        g: u8,
        r: u8,
        a: u8,
    ) -> Arc<CapturedFrame> {
        let mut data = vec![0u8; width * height * 4];
        for i in 0..width * height {
            data[i * 4] = b;
            data[i * 4 + 1] = g;
            data[i * 4 + 2] = r;
            data[i * 4 + 3] = a;
        }
        Arc::new(CapturedFrame {
            data,
            width,
            height,
            bytes_per_row: width * 4,
            timestamp_ms: 0.0,
        })
    }

    // ==================== Compositor Construction ====================

    #[test]
    fn test_compositor_new() {
        let comp = Compositor::new(1920, 1080);
        assert_eq!(comp.output_width(), 1920);
        assert_eq!(comp.output_height(), 1080);
        // BGRA buffer: 4 bytes per pixel
        assert_eq!(comp.output_buffer.len(), 1920 * 1080 * 4);
    }

    // ==================== Single Layout ====================

    #[test]
    fn test_compose_single_layout() {
        // Solid red frame in BGRA: B=0, G=0, R=255, A=255
        let frame = make_solid_frame(100, 100, 0, 0, 255, 255);
        let mut comp = Compositor::new(100, 100);
        let mut frames: HashMap<u32, Arc<CapturedFrame>> = HashMap::new();
        frames.insert(1, frame);

        let layout = Layout::Single { source: 1 };
        let output = comp.compose(&layout, &frames);

        // Every pixel should be red (BGRA: 0, 0, 255, 255)
        for i in 0..(100 * 100) {
            let off = i * 4;
            assert_eq!(output[off], 0, "pixel {} B", i);
            assert_eq!(output[off + 1], 0, "pixel {} G", i);
            assert_eq!(output[off + 2], 255, "pixel {} R", i);
            assert_eq!(output[off + 3], 255, "pixel {} A", i);
        }
    }

    #[test]
    fn test_compose_single_scales() {
        // 50x50 red frame scaled to 100x100 output
        let frame = make_solid_frame(50, 50, 0, 0, 255, 255);
        let mut comp = Compositor::new(100, 100);
        let mut frames: HashMap<u32, Arc<CapturedFrame>> = HashMap::new();
        frames.insert(1, frame);

        let layout = Layout::Single { source: 1 };
        let output = comp.compose(&layout, &frames);

        // All pixels should be red after nearest-neighbor upscale
        for i in 0..(100 * 100) {
            let off = i * 4;
            assert_eq!(output[off], 0, "pixel {} B", i);
            assert_eq!(output[off + 1], 0, "pixel {} G", i);
            assert_eq!(output[off + 2], 255, "pixel {} R", i);
            assert_eq!(output[off + 3], 255, "pixel {} A", i);
        }
    }

    // ==================== Empty Frames ====================

    #[test]
    fn test_compose_empty_frames() {
        let mut comp = Compositor::new(100, 100);
        let frames: HashMap<u32, Arc<CapturedFrame>> = HashMap::new();

        let layout = Layout::Single { source: 1 };
        let output = comp.compose(&layout, &frames);

        // No frame available -> output should be black (B=0, G=0, R=0, A=255)
        for i in 0..(100 * 100) {
            let off = i * 4;
            assert_eq!(output[off], 0, "pixel {} B", i);
            assert_eq!(output[off + 1], 0, "pixel {} G", i);
            assert_eq!(output[off + 2], 0, "pixel {} R", i);
            assert_eq!(output[off + 3], 255, "pixel {} A", i);
        }
    }

    // ==================== SideBySide Layout ====================

    #[test]
    fn test_compose_side_by_side() {
        // Red (BGRA: 0,0,255,255) on the left, Blue (BGRA: 255,0,0,255) on the right
        let red_frame = make_solid_frame(100, 100, 0, 0, 255, 255);
        let blue_frame = make_solid_frame(100, 100, 255, 0, 0, 255);

        let mut comp = Compositor::new(200, 100);
        let mut frames: HashMap<u32, Arc<CapturedFrame>> = HashMap::new();
        frames.insert(1, red_frame);
        frames.insert(2, blue_frame);

        let layout = Layout::SideBySide {
            left: 1,
            right: 2,
            ratio: 0.5,
        };
        let output = comp.compose(&layout, &frames);

        // Left half (x=0..99) should be red
        for y in 0..100 {
            for x in 0..100 {
                let off = (y * 200 + x) * 4;
                assert_eq!(output[off], 0, "left pixel ({},{}) B", x, y);
                assert_eq!(output[off + 1], 0, "left pixel ({},{}) G", x, y);
                assert_eq!(output[off + 2], 255, "left pixel ({},{}) R", x, y);
                assert_eq!(output[off + 3], 255, "left pixel ({},{}) A", x, y);
            }
        }

        // Right half (x=100..199) should be blue
        for y in 0..100 {
            for x in 100..200 {
                let off = (y * 200 + x) * 4;
                assert_eq!(output[off], 255, "right pixel ({},{}) B", x, y);
                assert_eq!(output[off + 1], 0, "right pixel ({},{}) G", x, y);
                assert_eq!(output[off + 2], 0, "right pixel ({},{}) R", x, y);
                assert_eq!(output[off + 3], 255, "right pixel ({},{}) A", x, y);
            }
        }
    }

    // ==================== PiP Layout ====================

    #[test]
    fn test_compose_pip_bottom_right() {
        // Primary = red, PiP = green (BGRA: 0, 255, 0, 255)
        let red_frame = make_solid_frame(200, 200, 0, 0, 255, 255);
        let green_frame = make_solid_frame(200, 200, 0, 255, 0, 255);

        let mut comp = Compositor::new(200, 200);
        let mut frames: HashMap<u32, Arc<CapturedFrame>> = HashMap::new();
        frames.insert(1, red_frame);
        frames.insert(2, green_frame);

        let layout = Layout::Pip {
            primary: 1,
            pip: 2,
            pip_position: PipPosition::BottomRight,
            pip_scale: 0.25,
        };
        let output = comp.compose(&layout, &frames);

        // PiP region: scale=0.25, pip_w=50, pip_h=50, margin=16
        // px = 200 - 50 - 16 = 134, py = 200 - 50 - 16 = 134
        let pip_w = 50;
        let pip_h = 50;
        let margin = 16;
        let px = 200 - pip_w - margin; // 134
        let py = 200 - pip_h - margin; // 134

        // Check a pixel in the PiP region is green
        let pip_cx = px + pip_w / 2;
        let pip_cy = py + pip_h / 2;
        let off = (pip_cy * 200 + pip_cx) * 4;
        assert_eq!(output[off], 0, "pip center B");
        assert_eq!(output[off + 1], 255, "pip center G");
        assert_eq!(output[off + 2], 0, "pip center R");
        assert_eq!(output[off + 3], 255, "pip center A");

        // Check a pixel outside the PiP region is red (top-left corner)
        let off_tl = 0;
        assert_eq!(output[off_tl], 0, "primary (0,0) B");
        assert_eq!(output[off_tl + 1], 0, "primary (0,0) G");
        assert_eq!(output[off_tl + 2], 255, "primary (0,0) R");
        assert_eq!(output[off_tl + 3], 255, "primary (0,0) A");

        // Check that the region just before the PiP area is still red
        let before_pip_off = (py * 200 + (px - 1)) * 4;
        assert_eq!(output[before_pip_off], 0, "before pip B");
        assert_eq!(output[before_pip_off + 1], 0, "before pip G");
        assert_eq!(output[before_pip_off + 2], 255, "before pip R");
        assert_eq!(output[before_pip_off + 3], 255, "before pip A");
    }

    // ==================== Serde Roundtrip ====================

    #[test]
    fn test_layout_serde_roundtrip() {
        let layout = Layout::SideBySide {
            left: 1,
            right: 2,
            ratio: 0.6,
        };

        let json = serde_json::to_string(&layout).unwrap();
        let deserialized: Layout = serde_json::from_str(&json).unwrap();

        match deserialized {
            Layout::SideBySide { left, right, ratio } => {
                assert_eq!(left, 1);
                assert_eq!(right, 2);
                assert!((ratio - 0.6).abs() < f32::EPSILON);
            }
            _ => panic!("Expected Layout::SideBySide after round-trip"),
        }
    }

    // ==================== Black Background ====================

    #[test]
    fn test_compositor_black_background() {
        // Compose with a source id that does not exist in the frames map
        let mut comp = Compositor::new(64, 64);
        let mut frames: HashMap<u32, Arc<CapturedFrame>> = HashMap::new();
        // Insert a frame under source id 99, but layout references source id 1
        let frame = make_solid_frame(64, 64, 255, 255, 255, 255);
        frames.insert(99, frame);

        let layout = Layout::Single { source: 1 };
        let output = comp.compose(&layout, &frames);

        // No matching source -> all pixels should be black with full alpha
        for i in 0..(64 * 64) {
            let off = i * 4;
            assert_eq!(output[off], 0, "pixel {} B", i);
            assert_eq!(output[off + 1], 0, "pixel {} G", i);
            assert_eq!(output[off + 2], 0, "pixel {} R", i);
            assert_eq!(output[off + 3], 255, "pixel {} A", i);
        }
    }

    // ==================== PiP Position Variants ====================

    #[test]
    fn test_compose_pip_top_left() {
        let mut compositor = Compositor::new(200, 200);
        let primary = make_solid_frame(200, 200, 0, 0, 255, 255); // red
        let pip_frame = make_solid_frame(200, 200, 0, 255, 0, 255); // green
        let mut frames = HashMap::new();
        frames.insert(1u32, primary);
        frames.insert(2u32, pip_frame);

        let layout = Layout::Pip {
            primary: 1,
            pip: 2,
            pip_position: PipPosition::TopLeft,
            pip_scale: 0.25,
        };
        let output = compositor.compose(&layout, &frames);
        // PiP at top-left with margin=16, so pixel at (20, 20) should be green
        let pip_pixel_offset = (20 * 200 + 20) * 4;
        assert_eq!(output[pip_pixel_offset], 0);     // B
        assert_eq!(output[pip_pixel_offset + 1], 255); // G
        assert_eq!(output[pip_pixel_offset + 2], 0);   // R
    }

    #[test]
    fn test_compose_pip_top_right() {
        let mut compositor = Compositor::new(200, 200);
        let primary = make_solid_frame(200, 200, 0, 0, 255, 255); // red
        let pip_frame = make_solid_frame(200, 200, 0, 255, 0, 255); // green
        let mut frames = HashMap::new();
        frames.insert(1u32, primary);
        frames.insert(2u32, pip_frame);

        let layout = Layout::Pip {
            primary: 1,
            pip: 2,
            pip_position: PipPosition::TopRight,
            pip_scale: 0.25,
        };
        let output = compositor.compose(&layout, &frames);
        // pip_w = 50, margin = 16, x = 200 - 50 - 16 = 134
        // Pixel at (140, 20) should be green
        let pip_pixel_offset = (20 * 200 + 140) * 4;
        assert_eq!(output[pip_pixel_offset], 0);     // B
        assert_eq!(output[pip_pixel_offset + 1], 255); // G
        assert_eq!(output[pip_pixel_offset + 2], 0);   // R
    }

    // ==================== PiP Serde Roundtrip ====================

    #[test]
    fn test_layout_pip_serde_roundtrip() {
        let layout = Layout::Pip {
            primary: 1,
            pip: 2,
            pip_position: PipPosition::BottomRight,
            pip_scale: 0.25,
        };
        let json = serde_json::to_string(&layout).unwrap();
        let parsed: Layout = serde_json::from_str(&json).unwrap();
        match parsed {
            Layout::Pip { primary, pip, pip_position, pip_scale } => {
                assert_eq!(primary, 1);
                assert_eq!(pip, 2);
                assert_eq!(pip_position, PipPosition::BottomRight);
                assert!((pip_scale - 0.25).abs() < f32::EPSILON);
            }
            _ => panic!("Expected Pip layout"),
        }
    }

    // ==================== Downscale ====================

    #[test]
    fn test_compose_downscale() {
        // Source is larger than output - verify downscaling works
        let mut compositor = Compositor::new(50, 50);
        let large_frame = make_solid_frame(200, 200, 255, 0, 0, 255); // blue
        let mut frames = HashMap::new();
        frames.insert(1u32, large_frame);

        let layout = Layout::Single { source: 1 };
        let output = compositor.compose(&layout, &frames);
        // Center pixel should be blue
        let center = (25 * 50 + 25) * 4;
        assert_eq!(output[center], 255);     // B
        assert_eq!(output[center + 1], 0);   // G
        assert_eq!(output[center + 2], 0);   // R
        assert_eq!(output[center + 3], 255); // A
    }
}
