//! In-memory terminal grid backed by `alacritty_terminal`.
//!
//! [`TerminalGrid`] wraps an alacritty [`Term`] and VTE [`Processor`] to
//! emulate a terminal: feed raw PTY bytes in, then read back the cell
//! contents, cursor position, and ANSI attributes.

use alacritty_terminal::event::VoidListener;
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::index::{Column, Line};
use alacritty_terminal::term::cell::Cell;
use alacritty_terminal::term::{Config, Term};
use alacritty_terminal::vte::ansi;

/// Helper type implementing [`Dimensions`] for [`Term`] creation and resize.
struct TermSize {
    cols: usize,
    lines: usize,
}

impl Dimensions for TermSize {
    fn total_lines(&self) -> usize {
        self.lines
    }

    fn screen_lines(&self) -> usize {
        self.lines
    }

    fn columns(&self) -> usize {
        self.cols
    }
}

/// An in-memory terminal emulator grid.
///
/// Wraps alacritty's [`Term`] with a VTE ANSI processor so that raw PTY
/// bytes can be fed in and the resulting grid state queried cell-by-cell.
pub struct TerminalGrid {
    term: Term<VoidListener>,
    processor: ansi::Processor,
}

impl TerminalGrid {
    /// Create a new terminal grid with the given dimensions and scrollback.
    pub fn new(rows: u16, cols: u16, scrollback: usize) -> Self {
        let config = Config {
            scrolling_history: scrollback,
            ..Config::default()
        };
        let size = TermSize {
            cols: cols as usize,
            lines: rows as usize,
        };
        Self {
            term: Term::new(config, &size, VoidListener),
            processor: ansi::Processor::new(),
        }
    }

    /// Feed raw bytes (including ANSI escape sequences) into the terminal.
    pub fn process_bytes(&mut self, data: &[u8]) {
        self.processor.advance(&mut self.term, data);
    }

    /// Access the cell at the given row and column.
    pub fn cell_at(&self, row: usize, col: usize) -> &Cell {
        &self.term.grid()[Line(row as i32)][Column(col)]
    }

    /// Return the current cursor position as `(row, column)`.
    pub fn cursor_position(&self) -> (usize, usize) {
        let point = self.term.grid().cursor.point;
        let row = point.line.0.max(0) as usize;
        (row, point.column.0)
    }

    /// Return the grid dimensions as `(rows, columns)`.
    pub fn dimensions(&self) -> (usize, usize) {
        (self.term.screen_lines(), self.term.columns())
    }

    /// Resize the terminal grid to new dimensions.
    pub fn resize(&mut self, rows: u16, cols: u16) {
        let size = TermSize {
            cols: cols as usize,
            lines: rows as usize,
        };
        self.term.resize(size);
    }
}

// ---------------------------------------------------------------------------
// Tests — TDD Red phase
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use alacritty_terminal::vte::ansi::Color;

    #[test]
    fn test_grid_new_dimensions() {
        let grid = TerminalGrid::new(24, 80, 1000);
        assert_eq!(grid.dimensions(), (24, 80));
    }

    #[test]
    fn test_grid_process_hello() {
        let mut grid = TerminalGrid::new(24, 80, 1000);
        grid.process_bytes(b"Hello");

        assert_eq!(grid.cell_at(0, 0).c, 'H');
        assert_eq!(grid.cell_at(0, 1).c, 'e');
        assert_eq!(grid.cell_at(0, 2).c, 'l');
        assert_eq!(grid.cell_at(0, 3).c, 'l');
        assert_eq!(grid.cell_at(0, 4).c, 'o');
    }

    #[test]
    fn test_grid_cursor_moves_after_input() {
        let mut grid = TerminalGrid::new(24, 80, 1000);
        grid.process_bytes(b"ABC");
        let (row, col) = grid.cursor_position();
        assert_eq!(row, 0);
        assert_eq!(col, 3);
    }

    #[test]
    fn test_grid_ansi_color() {
        let mut grid = TerminalGrid::new(24, 80, 1000);
        // ESC[31m = set foreground red, then 'X', then ESC[0m = reset
        grid.process_bytes(b"\x1b[31mX\x1b[0m");
        let cell = grid.cell_at(0, 0);
        assert_eq!(cell.c, 'X');
        // Foreground should be Named red (index 1) or similar.
        match cell.fg {
            Color::Named(n) => assert_eq!(n as u8, 1), // Red = index 1
            Color::Indexed(i) => assert_eq!(i, 1),
            _ => panic!("Expected named/indexed red color"),
        }
    }

    #[test]
    fn test_grid_newline() {
        let mut grid = TerminalGrid::new(24, 80, 1000);
        grid.process_bytes(b"Line1\r\nLine2");
        assert_eq!(grid.cell_at(0, 0).c, 'L');
        assert_eq!(grid.cell_at(1, 0).c, 'L');
        let (row, _) = grid.cursor_position();
        assert_eq!(row, 1);
    }

    #[test]
    fn test_grid_resize() {
        let mut grid = TerminalGrid::new(24, 80, 1000);
        grid.resize(40, 120);
        assert_eq!(grid.dimensions(), (40, 120));
    }
}
