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
    Zoomed {
        source: SourceId,
        zoom_level: f32,
        focus_x: f32,
        focus_y: f32,
        previous_layout: Box<Layout>,
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
                    if frame.width == 0 || frame.height == 0 {
                        return &self.output_buffer;
                    }
                    let scale = pip_scale.clamp(0.1, 0.5);
                    let max_pip_w = (self.output_width as f32) * scale;
                    let max_pip_h = (self.output_height as f32) * scale;
                    let src_aspect = frame.width as f32 / frame.height as f32;
                    let box_aspect = max_pip_w / max_pip_h;
                    let (pip_w, pip_h) = if src_aspect > box_aspect {
                        // Source is wider than box -> fit to width
                        (max_pip_w as usize, (max_pip_w / src_aspect) as usize)
                    } else {
                        // Source is taller than box -> fit to height
                        ((max_pip_h * src_aspect) as usize, max_pip_h as usize)
                    };
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
            Layout::Zoomed {
                source,
                zoom_level,
                focus_x,
                focus_y,
                ..
            } => {
                if let Some(frame) = frames.get(source) {
                    let zoom = zoom_level.clamp(1.0, 10.0);
                    let src_w = frame.width as f32;
                    let src_h = frame.height as f32;

                    // Calculate the visible region in source coordinates
                    let view_w = src_w / zoom;
                    let view_h = src_h / zoom;

                    // Center the view on the focus point, clamped to source bounds
                    let cx = (focus_x * src_w).clamp(view_w / 2.0, src_w - view_w / 2.0);
                    let cy = (focus_y * src_h).clamp(view_h / 2.0, src_h - view_h / 2.0);

                    let src_x = (cx - view_w / 2.0) as usize;
                    let src_y = (cy - view_h / 2.0) as usize;
                    let src_view_w = view_w as usize;
                    let src_view_h = view_h as usize;

                    let dst_stride = self.output_width * 4;
                    let src_stride = frame.bytes_per_row;

                    for dy in 0..self.output_height {
                        let sy = src_y + (dy * src_view_h) / self.output_height;
                        if sy >= frame.height {
                            continue;
                        }
                        for dx in 0..self.output_width {
                            let sx = src_x + (dx * src_view_w) / self.output_width;
                            if sx >= frame.width {
                                continue;
                            }
                            let src_off = sy * src_stride + sx * 4;
                            let dst_off = dy * dst_stride + dx * 4;
                            if src_off + 4 <= frame.data.len()
                                && dst_off + 4 <= self.output_buffer.len()
                            {
                                self.output_buffer[dst_off..dst_off + 4]
                                    .copy_from_slice(&frame.data[src_off..src_off + 4]);
                            }
                        }
                    }
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

    // ==================== Zoomed Layout ====================

    #[test]
    fn test_layout_zoomed_serde_roundtrip() {
        let layout = Layout::Zoomed {
            source: 1,
            zoom_level: 2.0,
            focus_x: 0.5,
            focus_y: 0.5,
            previous_layout: Box::new(Layout::Single { source: 1 }),
        };
        let json = serde_json::to_string(&layout).unwrap();
        let parsed: Layout = serde_json::from_str(&json).unwrap();
        match parsed {
            Layout::Zoomed { source, zoom_level, focus_x, focus_y, .. } => {
                assert_eq!(source, 1);
                assert!((zoom_level - 2.0).abs() < f32::EPSILON);
                assert!((focus_x - 0.5).abs() < f32::EPSILON);
                assert!((focus_y - 0.5).abs() < f32::EPSILON);
            }
            _ => panic!("Expected Layout::Zoomed"),
        }
    }

    // ==================== PiP Aspect Ratio ====================

    #[test]
    fn test_pip_preserves_source_aspect_ratio() {
        // Output is 16:9 (960x540), PiP source is 4:3 (640x480).
        // The PiP overlay should preserve the source's 4:3 aspect ratio,
        // NOT stretch it to 16:9.
        let mut comp = Compositor::new(960, 540);

        // Primary: solid red (BGRA)
        let primary_frame = make_solid_frame(960, 540, 0, 0, 255, 255);
        // PiP source: solid green (BGRA), 4:3 aspect ratio
        let pip_frame = make_solid_frame(640, 480, 0, 255, 0, 255);

        let mut frames: HashMap<u32, Arc<CapturedFrame>> = HashMap::new();
        frames.insert(1, primary_frame);
        frames.insert(2, pip_frame);

        let layout = Layout::Pip {
            primary: 1,
            pip: 2,
            pip_position: PipPosition::BottomRight,
            pip_scale: 0.25,
        };
        let output = comp.compose(&layout, &frames);

        // OLD (buggy) code produced:
        //   pip_w = 960 * 0.25 = 240,  pip_h = 540 * 0.25 = 135
        //   PiP region: x=[704, 944), y=[389, 524)
        //   => pixel (720, 420) was INSIDE the PiP => green (wrong)
        //
        // FIXED code (aspect-ratio preserved):
        //   max box = 240x135, source aspect = 4/3 ≈ 1.333 < box aspect 1.778
        //   => fit by height: pip_w = 135*(4/3) = 180, pip_h = 135
        //   PiP region: x=[764, 944), y=[389, 524)
        //   => pixel (720, 420) is OUTSIDE the PiP => red (primary)

        let probe_x: usize = 720;
        let probe_y: usize = 420;
        let off = (probe_y * 960 + probe_x) * 4;

        // This pixel should be red (primary background), NOT green (PiP).
        // If the PiP is incorrectly stretched to 16:9, this pixel will be green.
        assert_eq!(
            output[off + 1], 0,
            "pixel ({},{}) G channel should be 0 (red primary), got {} — PiP is stretched to output aspect ratio",
            probe_x, probe_y, output[off + 1]
        );
        assert_eq!(
            output[off + 2], 255,
            "pixel ({},{}) R channel should be 255 (red primary), got {}",
            probe_x, probe_y, output[off + 2]
        );

        // Also verify the CENTER of the correctly-sized PiP is green.
        // Correct PiP center: x = 764 + 180/2 = 854, y = 389 + 135/2 = 456
        // This pixel is inside the PiP in BOTH buggy and correct code.
        let center_x: usize = 854;
        let center_y: usize = 456;
        let center_off = (center_y * 960 + center_x) * 4;
        assert_eq!(
            output[center_off + 1], 255,
            "pixel ({},{}) G channel should be 255 (PiP green), got {}",
            center_x, center_y, output[center_off + 1]
        );
        assert_eq!(
            output[center_off + 2], 0,
            "pixel ({},{}) R channel should be 0 (PiP green), got {}",
            center_x, center_y, output[center_off + 2]
        );
    }

    #[test]
    fn test_compose_zoomed_layout() {
        let mut comp = Compositor::new(100, 100);
        // Create a 100x100 frame with a distinctive pattern:
        // top-left quadrant red, rest blue
        let mut data = vec![0u8; 100 * 100 * 4];
        for y in 0..100 {
            for x in 0..100 {
                let off = (y * 100 + x) * 4;
                if x < 50 && y < 50 {
                    // Red (BGRA: 0, 0, 255, 255)
                    data[off] = 0;
                    data[off + 1] = 0;
                    data[off + 2] = 255;
                    data[off + 3] = 255;
                } else {
                    // Blue (BGRA: 255, 0, 0, 255)
                    data[off] = 255;
                    data[off + 1] = 0;
                    data[off + 2] = 0;
                    data[off + 3] = 255;
                }
            }
        }
        let frame = Arc::new(CapturedFrame {
            data,
            width: 100,
            height: 100,
            bytes_per_row: 400,
            timestamp_ms: 0.0,
        });

        let mut frames = HashMap::new();
        frames.insert(1u32, frame);

        // Zoom 2x centered at top-left quadrant center (0.25, 0.25)
        let layout = Layout::Zoomed {
            source: 1,
            zoom_level: 2.0,
            focus_x: 0.25,
            focus_y: 0.25,
            previous_layout: Box::new(Layout::Single { source: 1 }),
        };
        let output = comp.compose(&layout, &frames);

        // At 2x zoom centered at (0.25, 0.25), the visible region is
        // x: 0.0-0.5, y: 0.0-0.5 of the source — which is entirely the red quadrant.
        // Center pixel should be red.
        let center = (50 * 100 + 50) * 4;
        assert_eq!(output[center + 2], 255, "center R should be 255 (red)");
        assert_eq!(output[center], 0, "center B should be 0");
    }

    // ==================== PiP Aspect Ratio: Wide Source ====================

    #[test]
    fn test_pip_preserves_wide_source_aspect_ratio() {
        // Ultra-wide source (21:9 ≈ 2.333) in a 4:3 output (≈ 1.333)
        // This tests the src_aspect > box_aspect branch (fit to width).
        let mut comp = Compositor::new(640, 480);
        let primary = make_solid_frame(640, 480, 0, 0, 255, 255); // red
        let pip_src = make_solid_frame(2520, 1080, 0, 255, 0, 255); // green, 21:9
        let mut frames = HashMap::new();
        frames.insert(1u32, primary);
        frames.insert(2u32, pip_src);

        let layout = Layout::Pip {
            primary: 1,
            pip: 2,
            pip_position: PipPosition::BottomRight,
            pip_scale: 0.25,
        };
        let output = comp.compose(&layout, &frames);

        // max box: 640*0.25=160, 480*0.25=120
        // src_aspect = 2520/1080 = 2.333, box_aspect = 160/120 = 1.333
        // src_aspect > box_aspect => fit to width: pip_w=160, pip_h=160/2.333=68
        // Position (BottomRight, margin=16): x=640-160-16=464, y=480-68-16=396
        let pip_w = 160;
        let pip_h = 68;
        let margin = 16;
        let px = 640 - pip_w - margin; // 464
        let py = 480 - pip_h - margin; // 396

        // Center of the PiP should be green
        let cx = px + pip_w / 2; // 544
        let cy = py + pip_h / 2; // 430
        let off = (cy * 640 + cx) * 4;
        assert_eq!(output[off + 1], 255, "PiP center G should be 255");
        assert_eq!(output[off + 2], 0, "PiP center R should be 0");

        // Pixel below the PiP but inside where a stretched version would be
        // If buggy (120 tall), y would extend to 396+120=516, but correct is 396+68=464
        // Probe at y=470 (inside buggy region, outside correct region)
        let probe_y = 470;
        let probe_off = (probe_y * 640 + cx) * 4;
        assert_eq!(
            output[probe_off + 1], 0,
            "pixel below PiP G should be 0 (primary red)"
        );
        assert_eq!(
            output[probe_off + 2], 255,
            "pixel below PiP R should be 255 (primary red)"
        );
    }

    // ==================== PiP Zero-Dimension Frame ====================

    #[test]
    fn test_pip_zero_dimension_frame_no_panic() {
        let mut comp = Compositor::new(200, 200);
        let primary = make_solid_frame(200, 200, 0, 0, 255, 255); // red
        // Zero-height frame
        let zero_frame = Arc::new(CapturedFrame {
            data: vec![],
            width: 100,
            height: 0,
            bytes_per_row: 400,
            timestamp_ms: 0.0,
        });
        let mut frames = HashMap::new();
        frames.insert(1u32, primary);
        frames.insert(2u32, zero_frame);

        let layout = Layout::Pip {
            primary: 1,
            pip: 2,
            pip_position: PipPosition::BottomRight,
            pip_scale: 0.25,
        };
        // Should not panic; primary should still be visible
        let output = comp.compose(&layout, &frames);
        // Top-left should be red (primary rendered successfully)
        assert_eq!(output[2], 255, "primary R");
        assert_eq!(output[1], 0, "primary G");
    }
}
