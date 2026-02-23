//! Simple caption renderer for overlaying text on BGRA frames.
//!
//! Uses a built-in 8x16 bitmap font — no external font dependencies.
//! Draws white text on a semi-transparent black background strip.

use crate::script::types::CaptionPosition;

/// Bitmap font renderer for caption overlays during recording.
pub struct CaptionRenderer {
    // Reserved for future state (e.g. font cache, glyph atlas).
}

impl CaptionRenderer {
    pub fn new() -> Self {
        Self {}
    }

    /// Render caption text onto a BGRA pixel buffer.
    ///
    /// - `buffer`: mutable BGRA pixel data (4 bytes per pixel, tightly packed).
    /// - `width` / `height`: frame dimensions in pixels.
    /// - `text`: the caption string to display.
    /// - `position`: where to place the caption strip (Top / Center / Bottom).
    /// - `font_size`: scaling hint (currently used to determine strip height).
    pub fn render_caption(
        &mut self,
        buffer: &mut [u8],
        width: u32,
        height: u32,
        text: &str,
        position: CaptionPosition,
        font_size: f32,
    ) {
        let w = width as usize;
        let h = height as usize;
        let expected_len = w * h * 4;
        if buffer.len() < expected_len || w == 0 || h == 0 || text.is_empty() {
            return;
        }

        // Glyph dimensions: 8x16 base, scaled by font_size / 16.0
        let scale = (font_size / 16.0).max(1.0);
        let glyph_w = (8.0 * scale) as usize;
        let glyph_h = (16.0 * scale) as usize;
        let padding = (4.0 * scale) as usize;
        let strip_height = glyph_h + padding * 2;

        if strip_height > h {
            return;
        }

        // Vertical position of the strip
        let strip_y = match position {
            CaptionPosition::Top => 0,
            CaptionPosition::Center => (h.saturating_sub(strip_height)) / 2,
            CaptionPosition::Bottom => h.saturating_sub(strip_height),
        };

        // Draw semi-transparent background strip (BGRA: 0, 0, 0, 180)
        for y in strip_y..(strip_y + strip_height).min(h) {
            let row_start = y * w * 4;
            for x in 0..w {
                let offset = row_start + x * 4;
                if offset + 3 < buffer.len() {
                    // Alpha-blend black overlay at ~70% opacity
                    let src_b = buffer[offset] as u16;
                    let src_g = buffer[offset + 1] as u16;
                    let src_r = buffer[offset + 2] as u16;
                    let alpha = 180u16;
                    let inv_alpha = 255 - alpha;
                    buffer[offset] = ((src_b * inv_alpha) / 255) as u8;
                    buffer[offset + 1] = ((src_g * inv_alpha) / 255) as u8;
                    buffer[offset + 2] = ((src_r * inv_alpha) / 255) as u8;
                    buffer[offset + 3] = 255;
                }
            }
        }

        // Compute text origin (horizontally centered)
        let text_pixel_width = text.len() * glyph_w;
        let text_x = if text_pixel_width < w {
            (w - text_pixel_width) / 2
        } else {
            0
        };
        let text_y = strip_y + padding;

        // Render each character glyph
        for (ci, ch) in text.chars().enumerate() {
            let glyph = get_glyph(ch);
            let char_x = text_x + ci * glyph_w;
            if char_x >= w {
                break;
            }

            for gy in 0..glyph_h.min(h.saturating_sub(text_y)) {
                let row_bits = glyph[(gy * 16) / glyph_h]; // Map scaled row back to 16-row glyph
                for gx in 0..glyph_w.min(w.saturating_sub(char_x)) {
                    let src_bit = (gx * 8) / glyph_w; // Map scaled col back to 8-col glyph
                    if row_bits & (0x80 >> src_bit) != 0 {
                        let px = char_x + gx;
                        let py = text_y + gy;
                        if px < w && py < h {
                            let offset = (py * w + px) * 4;
                            if offset + 3 < buffer.len() {
                                // White text (BGRA)
                                buffer[offset] = 255;
                                buffer[offset + 1] = 255;
                                buffer[offset + 2] = 255;
                                buffer[offset + 3] = 255;
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Return a 16-row bitmap for the given character.
/// Each row is a u8 where bits represent 8 horizontal pixels (MSB = leftmost).
fn get_glyph(ch: char) -> [u8; 16] {
    // Minimal ASCII bitmap font covering printable range (space through tilde).
    // Non-printable / unsupported chars fall back to a filled rectangle.
    match ch {
        ' ' => [0x00; 16],
        '!' => [
            0x00, 0x00, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18,
            0x18, 0x00, 0x18, 0x18, 0x00, 0x00, 0x00, 0x00,
        ],
        '"' => [
            0x00, 0x66, 0x66, 0x66, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        '#' => [
            0x00, 0x00, 0x36, 0x36, 0x7F, 0x36, 0x36, 0x36,
            0x7F, 0x36, 0x36, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        '.' => [
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x18, 0x18, 0x00, 0x00, 0x00, 0x00,
        ],
        ',' => [
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x18, 0x18, 0x08, 0x10, 0x00, 0x00,
        ],
        ':' => [
            0x00, 0x00, 0x00, 0x00, 0x18, 0x18, 0x00, 0x00,
            0x00, 0x18, 0x18, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        '-' => [
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x7E, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        '_' => [
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0xFF, 0x00, 0x00, 0x00,
        ],
        '(' => [
            0x00, 0x0C, 0x18, 0x30, 0x30, 0x30, 0x30, 0x30,
            0x30, 0x30, 0x18, 0x0C, 0x00, 0x00, 0x00, 0x00,
        ],
        ')' => [
            0x00, 0x30, 0x18, 0x0C, 0x0C, 0x0C, 0x0C, 0x0C,
            0x0C, 0x0C, 0x18, 0x30, 0x00, 0x00, 0x00, 0x00,
        ],
        '/' => [
            0x00, 0x00, 0x02, 0x04, 0x08, 0x08, 0x10, 0x10,
            0x20, 0x20, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        '0' => [
            0x00, 0x00, 0x3C, 0x66, 0x66, 0x6E, 0x76, 0x66,
            0x66, 0x66, 0x3C, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        '1' => [
            0x00, 0x00, 0x18, 0x38, 0x18, 0x18, 0x18, 0x18,
            0x18, 0x18, 0x7E, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        '2' => [
            0x00, 0x00, 0x3C, 0x66, 0x06, 0x0C, 0x18, 0x30,
            0x60, 0x66, 0x7E, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        '3' => [
            0x00, 0x00, 0x3C, 0x66, 0x06, 0x06, 0x1C, 0x06,
            0x06, 0x66, 0x3C, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        '4' => [
            0x00, 0x00, 0x0C, 0x1C, 0x3C, 0x6C, 0x6C, 0x7E,
            0x0C, 0x0C, 0x0C, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        '5' => [
            0x00, 0x00, 0x7E, 0x60, 0x60, 0x7C, 0x06, 0x06,
            0x06, 0x66, 0x3C, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        '6' => [
            0x00, 0x00, 0x1C, 0x30, 0x60, 0x7C, 0x66, 0x66,
            0x66, 0x66, 0x3C, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        '7' => [
            0x00, 0x00, 0x7E, 0x06, 0x06, 0x0C, 0x18, 0x18,
            0x18, 0x18, 0x18, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        '8' => [
            0x00, 0x00, 0x3C, 0x66, 0x66, 0x66, 0x3C, 0x66,
            0x66, 0x66, 0x3C, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        '9' => [
            0x00, 0x00, 0x3C, 0x66, 0x66, 0x66, 0x3E, 0x06,
            0x06, 0x0C, 0x38, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'A' | 'a' => [
            0x00, 0x00, 0x18, 0x3C, 0x66, 0x66, 0x66, 0x7E,
            0x66, 0x66, 0x66, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'B' | 'b' => [
            0x00, 0x00, 0x7C, 0x66, 0x66, 0x66, 0x7C, 0x66,
            0x66, 0x66, 0x7C, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'C' | 'c' => [
            0x00, 0x00, 0x3C, 0x66, 0x60, 0x60, 0x60, 0x60,
            0x60, 0x66, 0x3C, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'D' | 'd' => [
            0x00, 0x00, 0x78, 0x6C, 0x66, 0x66, 0x66, 0x66,
            0x66, 0x6C, 0x78, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'E' | 'e' => [
            0x00, 0x00, 0x7E, 0x60, 0x60, 0x60, 0x7C, 0x60,
            0x60, 0x60, 0x7E, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'F' | 'f' => [
            0x00, 0x00, 0x7E, 0x60, 0x60, 0x60, 0x7C, 0x60,
            0x60, 0x60, 0x60, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'G' | 'g' => [
            0x00, 0x00, 0x3C, 0x66, 0x60, 0x60, 0x6E, 0x66,
            0x66, 0x66, 0x3E, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'H' | 'h' => [
            0x00, 0x00, 0x66, 0x66, 0x66, 0x66, 0x7E, 0x66,
            0x66, 0x66, 0x66, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'I' | 'i' => [
            0x00, 0x00, 0x3C, 0x18, 0x18, 0x18, 0x18, 0x18,
            0x18, 0x18, 0x3C, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'J' | 'j' => [
            0x00, 0x00, 0x1E, 0x0C, 0x0C, 0x0C, 0x0C, 0x0C,
            0x6C, 0x6C, 0x38, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'K' | 'k' => [
            0x00, 0x00, 0x66, 0x6C, 0x78, 0x70, 0x70, 0x78,
            0x6C, 0x66, 0x66, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'L' | 'l' => [
            0x00, 0x00, 0x60, 0x60, 0x60, 0x60, 0x60, 0x60,
            0x60, 0x60, 0x7E, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'M' | 'm' => [
            0x00, 0x00, 0x63, 0x77, 0x7F, 0x6B, 0x63, 0x63,
            0x63, 0x63, 0x63, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'N' | 'n' => [
            0x00, 0x00, 0x66, 0x66, 0x76, 0x76, 0x7E, 0x6E,
            0x6E, 0x66, 0x66, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'O' | 'o' => [
            0x00, 0x00, 0x3C, 0x66, 0x66, 0x66, 0x66, 0x66,
            0x66, 0x66, 0x3C, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'P' | 'p' => [
            0x00, 0x00, 0x7C, 0x66, 0x66, 0x66, 0x7C, 0x60,
            0x60, 0x60, 0x60, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'Q' | 'q' => [
            0x00, 0x00, 0x3C, 0x66, 0x66, 0x66, 0x66, 0x66,
            0x66, 0x6E, 0x3C, 0x0E, 0x00, 0x00, 0x00, 0x00,
        ],
        'R' | 'r' => [
            0x00, 0x00, 0x7C, 0x66, 0x66, 0x66, 0x7C, 0x6C,
            0x66, 0x66, 0x66, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'S' | 's' => [
            0x00, 0x00, 0x3C, 0x66, 0x60, 0x30, 0x18, 0x0C,
            0x06, 0x66, 0x3C, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'T' | 't' => [
            0x00, 0x00, 0x7E, 0x18, 0x18, 0x18, 0x18, 0x18,
            0x18, 0x18, 0x18, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'U' | 'u' => [
            0x00, 0x00, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66,
            0x66, 0x66, 0x3C, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'V' | 'v' => [
            0x00, 0x00, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66,
            0x66, 0x3C, 0x18, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'W' | 'w' => [
            0x00, 0x00, 0x63, 0x63, 0x63, 0x63, 0x6B, 0x6B,
            0x7F, 0x77, 0x63, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'X' | 'x' => [
            0x00, 0x00, 0x66, 0x66, 0x66, 0x3C, 0x18, 0x3C,
            0x66, 0x66, 0x66, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'Y' | 'y' => [
            0x00, 0x00, 0x66, 0x66, 0x66, 0x66, 0x3C, 0x18,
            0x18, 0x18, 0x18, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        'Z' | 'z' => [
            0x00, 0x00, 0x7E, 0x06, 0x06, 0x0C, 0x18, 0x30,
            0x60, 0x60, 0x7E, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
        // Fallback: filled rectangle for unsupported characters
        _ => [
            0x00, 0x00, 0x7E, 0x7E, 0x7E, 0x7E, 0x7E, 0x7E,
            0x7E, 0x7E, 0x7E, 0x00, 0x00, 0x00, 0x00, 0x00,
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_caption_renderer_new() {
        let _renderer = CaptionRenderer::new();
        // Construction should not panic
    }

    #[test]
    fn test_render_caption_empty_text_noop() {
        let mut renderer = CaptionRenderer::new();
        let mut buffer = vec![0u8; 100 * 50 * 4];
        let original = buffer.clone();
        renderer.render_caption(&mut buffer, 100, 50, "", CaptionPosition::Bottom, 16.0);
        assert_eq!(buffer, original, "Empty text should not modify the buffer");
    }

    #[test]
    fn test_render_caption_zero_size_noop() {
        let mut renderer = CaptionRenderer::new();
        let mut buffer = vec![0u8; 0];
        renderer.render_caption(&mut buffer, 0, 0, "Hello", CaptionPosition::Top, 16.0);
        // Should not panic
    }

    #[test]
    fn test_render_caption_modifies_buffer() {
        let mut renderer = CaptionRenderer::new();
        let w = 200u32;
        let h = 100u32;
        let mut buffer = vec![128u8; (w * h * 4) as usize];
        let original = buffer.clone();
        renderer.render_caption(&mut buffer, w, h, "Test", CaptionPosition::Bottom, 16.0);
        assert_ne!(buffer, original, "Rendering caption should modify the buffer");
    }

    #[test]
    fn test_render_caption_positions() {
        let mut renderer = CaptionRenderer::new();
        let w = 200u32;
        let h = 100u32;

        // Render at top position
        let mut buf_top = vec![128u8; (w * h * 4) as usize];
        renderer.render_caption(&mut buf_top, w, h, "Top", CaptionPosition::Top, 16.0);

        // Render at bottom position
        let mut buf_bottom = vec![128u8; (w * h * 4) as usize];
        renderer.render_caption(&mut buf_bottom, w, h, "Bottom", CaptionPosition::Bottom, 16.0);

        // The two should differ since the strip is at different vertical positions
        assert_ne!(buf_top, buf_bottom, "Top and Bottom captions should produce different results");
    }

    #[test]
    fn test_render_caption_background_strip() {
        let mut renderer = CaptionRenderer::new();
        let w = 100u32;
        let h = 50u32;
        // Fill with white (BGRA: 255, 255, 255, 255)
        let mut buffer = vec![255u8; (w * h * 4) as usize];
        renderer.render_caption(&mut buffer, w, h, "Hi", CaptionPosition::Top, 16.0);

        // The top rows should have darkened pixels from the background strip
        // Check pixel (0, 4) which is inside the strip but outside text glyphs
        let offset = (4 * w as usize + 0) * 4;
        // The background blend should make it darker than pure white
        assert!(
            buffer[offset] < 255 || buffer[offset + 1] < 255 || buffer[offset + 2] < 255,
            "Background strip should darken pixels"
        );
    }

    #[test]
    fn test_get_glyph_space() {
        let glyph = get_glyph(' ');
        assert!(glyph.iter().all(|&b| b == 0), "Space glyph should be all zeros");
    }

    #[test]
    fn test_get_glyph_letter() {
        let glyph = get_glyph('A');
        // The glyph should have some non-zero rows
        assert!(glyph.iter().any(|&b| b != 0), "Letter glyph should have non-zero rows");
    }

    #[test]
    fn test_render_caption_font_size_scaling() {
        let mut renderer = CaptionRenderer::new();
        let w = 400u32;
        let h = 200u32;

        let mut buf_small = vec![128u8; (w * h * 4) as usize];
        renderer.render_caption(&mut buf_small, w, h, "X", CaptionPosition::Center, 16.0);

        let mut buf_large = vec![128u8; (w * h * 4) as usize];
        renderer.render_caption(&mut buf_large, w, h, "X", CaptionPosition::Center, 32.0);

        // Larger font size should modify more pixels
        let changed_small = buf_small.iter().zip(vec![128u8; (w * h * 4) as usize].iter())
            .filter(|(a, b)| a != b)
            .count();
        let changed_large = buf_large.iter().zip(vec![128u8; (w * h * 4) as usize].iter())
            .filter(|(a, b)| a != b)
            .count();
        assert!(
            changed_large > changed_small,
            "Larger font should modify more pixels: small={}, large={}",
            changed_small,
            changed_large
        );
    }
}
