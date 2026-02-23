//! Terminal session configuration.
//!
//! [`TerminalConfig`] holds every setting needed to spawn and render a
//! pseudo-terminal: shell path, grid dimensions, font metrics, pixel
//! size, and scrollback depth.

use serde::{Deserialize, Serialize};

/// Configuration for a terminal capture session.
///
/// All fields will be populated with sensible defaults via the [`Default`]
/// implementation once the struct is fully defined.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalConfig {
    /// Path to the shell executable.
    pub shell: String,
    /// Number of rows in the terminal grid.
    pub rows: u16,
    /// Number of columns in the terminal grid.
    pub cols: u16,
    /// Font size in points.
    pub font_size: f32,
    /// Font family name.
    pub font_family: String,
    /// Pixel width of the terminal viewport.
    pub width: u32,
    /// Pixel height of the terminal viewport.
    pub height: u32,
    /// Maximum number of scrollback lines.
    pub scrollback_lines: usize,
}

impl Default for TerminalConfig {
    fn default() -> Self {
        Self {
            shell: "/bin/zsh".to_string(),
            rows: 24,
            cols: 80,
            font_size: 14.0,
            font_family: "monospace".to_string(),
            width: 960,
            height: 540,
            scrollback_lines: 1000,
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
    fn test_terminal_config_defaults() {
        let config = TerminalConfig::default();
        assert_eq!(config.shell, "/bin/zsh");
        assert_eq!(config.rows, 24);
        assert_eq!(config.cols, 80);
        assert_eq!(config.font_size, 14.0);
        assert_eq!(config.font_family, "monospace");
        assert_eq!(config.width, 960);
        assert_eq!(config.height, 540);
        assert_eq!(config.scrollback_lines, 1000);
    }

    #[test]
    fn test_terminal_config_serde_roundtrip() {
        let config = TerminalConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: TerminalConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.shell, config.shell);
        assert_eq!(deserialized.rows, config.rows);
        assert_eq!(deserialized.cols, config.cols);
        assert_eq!(deserialized.font_size, config.font_size);
        assert_eq!(deserialized.width, config.width);
        assert_eq!(deserialized.height, config.height);
    }

    #[test]
    fn test_terminal_config_custom() {
        let config = TerminalConfig {
            shell: "/bin/bash".to_string(),
            rows: 40,
            cols: 120,
            font_size: 16.0,
            font_family: "Menlo".to_string(),
            width: 1920,
            height: 1080,
            scrollback_lines: 5000,
        };
        assert_eq!(config.shell, "/bin/bash");
        assert_eq!(config.rows, 40);
        assert_eq!(config.cols, 120);
    }
}
