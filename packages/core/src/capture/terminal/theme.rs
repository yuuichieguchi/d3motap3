//! ANSI colour theme for terminal rendering.
//!
//! [`ColorTheme`] stores foreground, background, cursor, and the standard
//! 16-colour ANSI palette. All colours use **BGRA** byte order so they
//! can be blitted directly into the frame buffer produced by the capture
//! pipeline.

/// A colour theme for terminal rendering.
///
/// Colours are stored as `[u8; 4]` in **BGRA** order.
#[derive(Debug, Clone)]
pub struct ColorTheme {
    /// Foreground colour in BGRA order.
    pub foreground: [u8; 4],
    /// Background colour in BGRA order.
    pub background: [u8; 4],
    /// Cursor colour in BGRA order.
    pub cursor: [u8; 4],
    /// Standard 16-colour ANSI palette, each in BGRA order.
    pub palette: [[u8; 4]; 16],
}

impl Default for ColorTheme {
    fn default() -> Self {
        Self {
            foreground: [204, 204, 204, 255],
            background: [30, 30, 30, 255],
            cursor: [204, 204, 204, 255],
            palette: [
                [0, 0, 0, 255],         // 0  Black
                [0, 0, 205, 255],       // 1  Red       (B=0, G=0, R=205)
                [0, 205, 0, 255],       // 2  Green     (B=0, G=205, R=0)
                [0, 205, 205, 255],     // 3  Yellow    (B=0, G=205, R=205)
                [205, 0, 0, 255],       // 4  Blue      (B=205, G=0, R=0)
                [205, 0, 205, 255],     // 5  Magenta   (B=205, G=0, R=205)
                [205, 205, 0, 255],     // 6  Cyan      (B=205, G=205, R=0)
                [192, 192, 192, 255],   // 7  White
                [128, 128, 128, 255],   // 8  Bright Black
                [0, 0, 255, 255],       // 9  Bright Red
                [0, 255, 0, 255],       // 10 Bright Green
                [0, 255, 255, 255],     // 11 Bright Yellow
                [255, 0, 0, 255],       // 12 Bright Blue
                [255, 0, 255, 255],     // 13 Bright Magenta
                [255, 255, 0, 255],     // 14 Bright Cyan
                [255, 255, 255, 255],   // 15 Bright White
            ],
        }
    }
}

// ---------------------------------------------------------------------------
// Tests — TDD Red phase
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_color_theme_default() {
        let theme = ColorTheme::default();
        // Dark theme: light foreground, dark background
        // BGRA format
        assert_eq!(theme.foreground, [204, 204, 204, 255]); // light gray BGRA
        assert_eq!(theme.background, [30, 30, 30, 255]); // dark BGRA
        assert_eq!(theme.cursor, [204, 204, 204, 255]); // same as fg
        assert_eq!(theme.palette.len(), 16);
    }

    #[test]
    fn test_color_theme_palette_ansi_colors() {
        let theme = ColorTheme::default();
        // ANSI color 0 = Black
        assert_eq!(theme.palette[0], [0, 0, 0, 255]);
        // ANSI color 1 = Red → BGRA: [0, 0, 205, 255] (B=0, G=0, R=205)
        assert_eq!(theme.palette[1][2], 205); // R channel
        // ANSI color 2 = Green → BGRA: [0, 205, 0, 255]
        assert_eq!(theme.palette[2][1], 205); // G channel
        // All 16 colors have alpha = 255
        for color in &theme.palette {
            assert_eq!(color[3], 255);
        }
    }

    #[test]
    fn test_color_theme_custom() {
        let theme = ColorTheme {
            foreground: [255, 255, 255, 255],
            background: [0, 0, 0, 255],
            cursor: [0, 255, 0, 255],
            palette: [[128, 128, 128, 255]; 16],
        };
        assert_eq!(theme.foreground, [255, 255, 255, 255]);
        assert_eq!(theme.cursor, [0, 255, 0, 255]);
    }
}
