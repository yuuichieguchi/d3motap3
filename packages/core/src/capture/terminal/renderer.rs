//! Terminal grid renderer using cosmic-text.
//!
//! [`TerminalRenderer`] takes a [`TerminalGrid`] and renders it to a BGRA pixel
//! buffer packaged as a [`CapturedFrame`].

use cosmic_text::{
    Attrs, Buffer, Color as CosmicColor, Family, FontSystem, Metrics, Shaping, SwashCache,
};

use super::grid::TerminalGrid;
use super::theme::ColorTheme;
use crate::capture::CapturedFrame;

use alacritty_terminal::vte::ansi::Color;

/// Renders a [`TerminalGrid`] to BGRA pixel buffers.
pub struct TerminalRenderer {
    font_system: FontSystem,
    swash_cache: SwashCache,
    width: u32,
    height: u32,
    cell_width: f32,
    cell_height: f32,
    theme: ColorTheme,
}

impl TerminalRenderer {
    /// Create a new renderer with the given output dimensions, font
    /// configuration, and colour theme.
    pub fn new(
        width: u32,
        height: u32,
        font_size: f32,
        font_family: &str,
        theme: ColorTheme,
    ) -> Self {
        let mut font_system = FontSystem::new();
        let swash_cache = SwashCache::new();

        // Calculate cell dimensions using a reference 'M' character.
        let metrics = Metrics::new(font_size, font_size * 1.2);
        let mut measure_buf = Buffer::new(&mut font_system, metrics);
        let attrs = Attrs::new().family(Family::Name(font_family));
        measure_buf.set_text(&mut font_system, "M", &attrs, Shaping::Advanced, None);
        measure_buf.shape_until_scroll(&mut font_system, false);

        let cell_width = measure_buf
            .layout_runs()
            .next()
            .and_then(|run| run.glyphs.first())
            .map(|g| g.w)
            .unwrap_or(font_size * 0.6);
        let cell_height = font_size * 1.2;

        Self {
            font_system,
            swash_cache,
            width,
            height,
            cell_width,
            cell_height,
            theme,
        }
    }

    /// Render the given terminal grid into a [`CapturedFrame`].
    pub fn render(&mut self, grid: &TerminalGrid) -> CapturedFrame {
        let w = self.width as usize;
        let h = self.height as usize;
        let buf_size = w * h * 4;
        let mut pixels = vec![0u8; buf_size];

        // 1. Fill entire buffer with theme background.
        let bg = self.theme.background;
        for pixel in pixels.chunks_exact_mut(4) {
            pixel.copy_from_slice(&bg);
        }

        let (rows, cols) = grid.dimensions();

        // 2. Per-cell background and character rendering.
        for row in 0..rows {
            for col in 0..cols {
                let cell = grid.cell_at(row, col);
                let x_start = (col as f32 * self.cell_width) as u32;
                let y_start = (row as f32 * self.cell_height) as u32;

                // Resolve cell background colour from theme.
                let cell_bg = self.resolve_color(&cell.bg, true);
                if cell_bg != bg {
                    self.fill_rect(
                        &mut pixels,
                        x_start,
                        y_start,
                        self.cell_width as u32,
                        self.cell_height as u32,
                        cell_bg,
                    );
                }

                // Render character if it is visible.
                let ch = cell.c;
                if ch != ' ' && ch != '\0' {
                    let cell_fg = self.resolve_color(&cell.fg, false);
                    self.render_char(&mut pixels, ch, x_start, y_start, cell_fg);
                }
            }
        }

        // 3. Draw block cursor.
        let (cursor_row, cursor_col) = grid.cursor_position();
        let cx = (cursor_col as f32 * self.cell_width) as u32;
        let cy = (cursor_row as f32 * self.cell_height) as u32;
        self.fill_rect(
            &mut pixels,
            cx,
            cy,
            self.cell_width as u32,
            self.cell_height as u32,
            self.theme.cursor,
        );

        CapturedFrame {
            data: pixels,
            width: w,
            height: h,
            bytes_per_row: w * 4,
            timestamp_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as f64)
                .unwrap_or(0.0),
        }
    }

    /// Map an alacritty `Color` to a BGRA `[u8; 4]`.
    fn resolve_color(&self, color: &Color, is_bg: bool) -> [u8; 4] {
        match color {
            Color::Named(named) => {
                let idx = *named as usize;
                if idx < 16 {
                    self.theme.palette[idx]
                } else if is_bg {
                    self.theme.background
                } else {
                    self.theme.foreground
                }
            }
            Color::Indexed(idx) => {
                if (*idx as usize) < 16 {
                    self.theme.palette[*idx as usize]
                } else if is_bg {
                    self.theme.background
                } else {
                    self.theme.foreground
                }
            }
            Color::Spec(rgb) => [rgb.b, rgb.g, rgb.r, 255], // RGB -> BGRA
        }
    }

    /// Fill a rectangle in the pixel buffer with a solid colour.
    fn fill_rect(&self, pixels: &mut [u8], x: u32, y: u32, w: u32, h: u32, color: [u8; 4]) {
        let stride = self.width * 4;
        for dy in 0..h {
            let py = y + dy;
            if py >= self.height {
                break;
            }
            for dx in 0..w {
                let px = x + dx;
                if px >= self.width {
                    continue;
                }
                let offset = ((py * stride) + (px * 4)) as usize;
                if offset + 4 <= pixels.len() {
                    pixels[offset..offset + 4].copy_from_slice(&color);
                }
            }
        }
    }

    /// Render a single character glyph into the pixel buffer via cosmic-text.
    fn render_char(&mut self, pixels: &mut [u8], ch: char, x: u32, y: u32, fg_color: [u8; 4]) {
        let font_size = self.cell_height / 1.2;
        let metrics = Metrics::new(font_size, self.cell_height);
        let mut buffer = Buffer::new(&mut self.font_system, metrics);
        buffer.set_size(
            &mut self.font_system,
            Some(self.cell_width * 2.0),
            Some(self.cell_height * 2.0),
        );

        // BGRA -> RGB for cosmic-text.
        let cosmic_color = CosmicColor::rgb(fg_color[2], fg_color[1], fg_color[0]);
        let attrs = Attrs::new()
            .family(Family::Monospace)
            .color(cosmic_color);
        let text = ch.to_string();
        buffer.set_text(
            &mut self.font_system,
            &text,
            &attrs,
            Shaping::Advanced,
            None,
        );
        buffer.shape_until_scroll(&mut self.font_system, false);

        let img_w = self.width as i32;
        let img_h = self.height as i32;
        buffer.draw(
            &mut self.font_system,
            &mut self.swash_cache,
            cosmic_color,
            |gx, gy, _w, _h, color| {
                let px = x as i32 + gx;
                let py = y as i32 + gy;
                if px >= 0 && px < img_w && py >= 0 && py < img_h {
                    let offset = ((py * img_w * 4) + (px * 4)) as usize;
                    if offset + 4 <= pixels.len() {
                        let a = color.a() as u32;
                        if a > 0 {
                            // Alpha blend: output is BGRA.
                            let src_b = color.b() as u32;
                            let src_g = color.g() as u32;
                            let src_r = color.r() as u32;
                            let dst_b = pixels[offset] as u32;
                            let dst_g = pixels[offset + 1] as u32;
                            let dst_r = pixels[offset + 2] as u32;
                            let inv_a = 255 - a;
                            pixels[offset] = ((src_b * a + dst_b * inv_a) / 255) as u8;
                            pixels[offset + 1] = ((src_g * a + dst_g * inv_a) / 255) as u8;
                            pixels[offset + 2] = ((src_r * a + dst_r * inv_a) / 255) as u8;
                            pixels[offset + 3] = 255;
                        }
                    }
                }
            },
        );
    }

    /// Return the computed cell dimensions as `(width, height)`.
    pub fn cell_dimensions(&self) -> (f32, f32) {
        (self.cell_width, self.cell_height)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::grid::TerminalGrid;
    use super::super::theme::ColorTheme;

    fn make_renderer(width: u32, height: u32) -> TerminalRenderer {
        TerminalRenderer::new(width, height, 14.0, "monospace", ColorTheme::default())
    }

    #[test]
    fn test_renderer_empty_grid_background_fill() {
        let mut renderer = make_renderer(160, 80);
        let grid = TerminalGrid::new(4, 10, 100);
        let frame = renderer.render(&grid);

        assert_eq!(frame.width, 160);
        assert_eq!(frame.height, 80);
        assert_eq!(frame.data.len(), (160 * 80 * 4) as usize);
        assert_eq!(frame.bytes_per_row, (160 * 4) as usize);

        // Background should be the theme background colour.
        // The cursor sits at (0,0) so check a pixel near the bottom-right
        // corner which is guaranteed to be outside the grid and cursor area.
        let bg = ColorTheme::default().background;
        let last_pixel_offset = (frame.data.len()) - 4;
        assert_eq!(&frame.data[last_pixel_offset..last_pixel_offset + 4], &bg);
    }

    #[test]
    fn test_renderer_text_produces_non_background_pixels() {
        let mut renderer = make_renderer(320, 160);
        let mut grid = TerminalGrid::new(8, 20, 100);
        grid.process_bytes(b"A");

        let frame = renderer.render(&grid);
        let bg = ColorTheme::default().background;

        // At least some pixels should differ from background (the 'A' glyph).
        let has_non_bg = frame.data.chunks_exact(4).any(|p| p != &bg);
        assert!(has_non_bg, "Expected some non-background pixels from rendered 'A'");
    }

    #[test]
    fn test_renderer_output_size_correct() {
        let mut renderer = make_renderer(640, 480);
        let grid = TerminalGrid::new(24, 80, 100);
        let frame = renderer.render(&grid);

        assert_eq!(frame.data.len(), 640 * 480 * 4);
        assert_eq!(frame.width, 640);
        assert_eq!(frame.height, 480);
    }

    #[test]
    fn test_renderer_cell_dimensions_positive() {
        let renderer = make_renderer(320, 160);
        let (cw, ch) = renderer.cell_dimensions();
        assert!(cw > 0.0, "cell_width should be positive");
        assert!(ch > 0.0, "cell_height should be positive");
    }
}
