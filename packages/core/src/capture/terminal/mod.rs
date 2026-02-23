//! Terminal PTY capture source.
//!
//! Emulates a terminal session — spawns a shell via PTY, pipes output
//! through alacritty_terminal for VT processing, renders the grid to
//! BGRA pixel buffers via cosmic-text, and exposes it as a CaptureSource.

pub mod config;
pub mod grid;
pub mod pty_manager;
pub mod renderer;
pub mod theme;

pub use config::TerminalConfig;
pub use theme::ColorTheme;

use crate::capture::source::{CaptureSource, SourceId};
use crate::capture::CapturedFrame;

use grid::TerminalGrid;
use pty_manager::PtyManager;
use renderer::TerminalRenderer;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex, mpsc};
use std::thread::{self, JoinHandle};
use std::time::Instant;

// ---------------------------------------------------------------------------
// TERMINAL_HANDLES — static map for terminal-specific operations
// ---------------------------------------------------------------------------

pub struct TerminalHandle {
    writer: mpsc::Sender<Vec<u8>>,
    resize_tx: mpsc::Sender<(u16, u16)>,
    output_tap: Arc<Mutex<Option<mpsc::Sender<Vec<u8>>>>>,
}

static TERMINAL_HANDLES: LazyLock<Mutex<HashMap<SourceId, TerminalHandle>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn terminal_write_input(source_id: SourceId, data: &[u8]) -> Result<(), String> {
    let handles = TERMINAL_HANDLES
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    let handle = handles
        .get(&source_id)
        .ok_or_else(|| format!("Terminal {} not found", source_id))?;
    handle
        .writer
        .send(data.to_vec())
        .map_err(|e| format!("Send error: {}", e))
}

pub fn terminal_resize(source_id: SourceId, rows: u16, cols: u16) -> Result<(), String> {
    let handles = TERMINAL_HANDLES
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    let handle = handles
        .get(&source_id)
        .ok_or_else(|| format!("Terminal {} not found", source_id))?;
    handle
        .resize_tx
        .send((rows, cols))
        .map_err(|e| format!("Send error: {}", e))
}

/// Remove a terminal handle (called when source is stopped/removed).
pub fn remove_terminal_handle(source_id: SourceId) {
    if let Ok(mut handles) = TERMINAL_HANDLES.lock() {
        handles.remove(&source_id);
    }
}

/// Subscribe to terminal output for the given source.
/// Returns a receiver that will get copies of all PTY output bytes.
pub fn subscribe_output(source_id: SourceId) -> Result<mpsc::Receiver<Vec<u8>>, String> {
    let handles = TERMINAL_HANDLES
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    let handle = handles
        .get(&source_id)
        .ok_or_else(|| format!("Terminal {} not found", source_id))?;
    let (tx, rx) = mpsc::channel();
    let mut tap = handle
        .output_tap
        .lock()
        .map_err(|e| format!("Tap lock error: {}", e))?;
    *tap = Some(tx);
    Ok(rx)
}

/// Unsubscribe from terminal output.
pub fn unsubscribe_output(source_id: SourceId) -> Result<(), String> {
    let handles = TERMINAL_HANDLES
        .lock()
        .map_err(|e| format!("Lock error: {}", e))?;
    let handle = handles
        .get(&source_id)
        .ok_or_else(|| format!("Terminal {} not found", source_id))?;
    let mut tap = handle
        .output_tap
        .lock()
        .map_err(|e| format!("Tap lock error: {}", e))?;
    *tap = None;
    Ok(())
}

/// Register a terminal handle for the given source ID.
pub fn register_terminal_handle(source_id: SourceId, handle: TerminalHandle) {
    if let Ok(mut handles) = TERMINAL_HANDLES.lock() {
        handles.insert(source_id, handle);
    }
}

// ---------------------------------------------------------------------------
// TerminalCaptureSource
// ---------------------------------------------------------------------------

pub struct TerminalCaptureSource {
    config: TerminalConfig,
    source_name: String,
    latest_frame: Arc<Mutex<Option<Arc<CapturedFrame>>>>,
    is_active: Arc<AtomicBool>,
    frame_count: Arc<AtomicU64>,
    render_thread: Option<JoinHandle<()>>,
    input_tx: Option<mpsc::Sender<Vec<u8>>>,
    resize_tx: Option<mpsc::Sender<(u16, u16)>>,
    output_tap: Arc<Mutex<Option<mpsc::Sender<Vec<u8>>>>>,
}

impl TerminalCaptureSource {
    pub fn new(config: TerminalConfig) -> Self {
        let name = format!(
            "terminal-{}",
            config.shell.split('/').last().unwrap_or("shell")
        );
        Self {
            config,
            source_name: name,
            latest_frame: Arc::new(Mutex::new(None)),
            is_active: Arc::new(AtomicBool::new(false)),
            frame_count: Arc::new(AtomicU64::new(0)),
            render_thread: None,
            input_tx: None,
            resize_tx: None,
            output_tap: Arc::new(Mutex::new(None)),
        }
    }

    /// Extract the terminal handle channels for external registration.
    /// Returns `None` if `start()` has not been called yet.
    pub fn take_handle(&self) -> Option<TerminalHandle> {
        match (&self.input_tx, &self.resize_tx) {
            (Some(input), Some(resize)) => Some(TerminalHandle {
                writer: input.clone(),
                resize_tx: resize.clone(),
                output_tap: self.output_tap.clone(),
            }),
            _ => None,
        }
    }
}

impl CaptureSource for TerminalCaptureSource {
    fn start(&mut self) -> Result<(), String> {
        if self.is_active.load(Ordering::Relaxed) {
            return Err("Already active".to_string());
        }

        // M-1: Validate dimensions before spawning any resources.
        if self.config.rows == 0 || self.config.cols == 0 {
            return Err("rows and cols must be > 0".to_string());
        }
        if self.config.width == 0 || self.config.height == 0 {
            return Err("width and height must be > 0".to_string());
        }
        if self.config.width > 7680 || self.config.height > 4320 {
            return Err("Dimensions too large (max 7680x4320)".to_string());
        }

        let config = self.config.clone();
        let is_active = self.is_active.clone();
        let frame_count = self.frame_count.clone();
        let latest_frame = self.latest_frame.clone();

        let (input_tx, input_rx) = mpsc::channel::<Vec<u8>>();
        let (resize_tx, resize_rx) = mpsc::channel::<(u16, u16)>();

        self.input_tx = Some(input_tx.clone());
        self.resize_tx = Some(resize_tx.clone());

        is_active.store(true, Ordering::Relaxed);

        let output_tap = self.output_tap.clone();

        let render_thread = thread::spawn(move || {
            // Spawn PTY
            let mut pty = match PtyManager::new(&config.shell, config.rows, config.cols) {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("Failed to spawn PTY: {}", e);
                    is_active.store(false, Ordering::Relaxed);
                    return;
                }
            };

            let mut grid = TerminalGrid::new(config.rows, config.cols, config.scrollback_lines);
            let mut renderer = TerminalRenderer::new(
                config.width,
                config.height,
                config.font_size,
                &config.font_family,
                ColorTheme::default(),
            );

            let frame_interval = std::time::Duration::from_millis(16); // ~60fps cap
            let mut last_render = Instant::now();

            while is_active.load(Ordering::Relaxed) {
                // Handle input from channels
                while let Ok(data) = input_rx.try_recv() {
                    let _ = pty.write_input(&data);
                }

                // Handle resize
                while let Ok((rows, cols)) = resize_rx.try_recv() {
                    let _ = pty.resize(rows, cols);
                    grid.resize(rows, cols);
                }

                // Read PTY output
                let mut had_output = false;
                if let Some(data) = pty.try_read() {
                    grid.process_bytes(&data);
                    had_output = true;
                    // Broadcast to output tap if subscribed
                    if let Ok(tap) = output_tap.lock() {
                        if let Some(ref tx) = *tap {
                            let _ = tx.send(data);
                        }
                    }
                }

                // Render at capped framerate
                let now = Instant::now();
                if had_output || now.duration_since(last_render) >= frame_interval {
                    let frame = renderer.render(&grid);
                    let frame = Arc::new(frame);
                    if let Ok(mut lock) = latest_frame.lock() {
                        *lock = Some(frame);
                    }
                    frame_count.fetch_add(1, Ordering::Relaxed);
                    last_render = now;
                }

                // Don't busy-spin
                if !had_output {
                    thread::sleep(std::time::Duration::from_millis(5));
                }

                // Check if PTY is still alive
                if !pty.is_alive() {
                    break;
                }
            }

            is_active.store(false, Ordering::Relaxed);
            let _ = pty.stop();
        });

        self.render_thread = Some(render_thread);
        Ok(())
    }

    fn stop(&mut self) -> Result<(), String> {
        self.is_active.store(false, Ordering::Relaxed);
        if let Some(thread) = self.render_thread.take() {
            let _ = thread.join();
        }
        self.input_tx = None;
        self.resize_tx = None;
        // Handle cleanup is done by remove_terminal_handle() in remove_source().
        Ok(())
    }

    fn latest_frame(&self) -> Option<Arc<CapturedFrame>> {
        self.latest_frame.lock().ok()?.clone()
    }

    fn frame_count(&self) -> u64 {
        self.frame_count.load(Ordering::Relaxed)
    }

    fn dimensions(&self) -> (u32, u32) {
        (self.config.width, self.config.height)
    }

    fn is_active(&self) -> bool {
        self.is_active.load(Ordering::Relaxed)
    }

    fn name(&self) -> &str {
        &self.source_name
    }
}

impl Drop for TerminalCaptureSource {
    fn drop(&mut self) {
        if self.is_active.load(Ordering::Relaxed) {
            let _ = self.stop();
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn test_terminal_source_new() {
        let config = TerminalConfig::default();
        let source = TerminalCaptureSource::new(config);
        assert_eq!(source.name(), "terminal-zsh");
        assert_eq!(source.dimensions(), (960, 540));
        assert!(!source.is_active());
        assert_eq!(source.frame_count(), 0);
    }

    #[test]
    fn test_terminal_source_lifecycle() {
        let config = TerminalConfig {
            shell: "/bin/cat".to_string(), // cat is safe — just echoes
            ..TerminalConfig::default()
        };
        let mut source = TerminalCaptureSource::new(config);

        // Start
        source.start().expect("start failed");
        assert!(source.is_active());

        // Wait for at least one frame to be rendered
        thread::sleep(Duration::from_millis(500));
        assert!(source.frame_count() > 0, "Expected at least one frame");

        // Should have a frame
        let frame = source.latest_frame();
        assert!(frame.is_some(), "Expected a frame");
        let frame = frame.unwrap();
        assert_eq!(frame.width, 960);
        assert_eq!(frame.height, 540);

        // Stop
        source.stop().expect("stop failed");
        assert!(!source.is_active());
    }

    #[test]
    fn test_terminal_source_double_start_error() {
        let config = TerminalConfig {
            shell: "/bin/cat".to_string(),
            ..TerminalConfig::default()
        };
        let mut source = TerminalCaptureSource::new(config);
        source.start().expect("first start failed");

        let result = source.start();
        assert!(result.is_err(), "Second start should fail");

        source.stop().ok();
    }

    #[test]
    fn test_terminal_source_stop_idempotent() {
        let config = TerminalConfig {
            shell: "/bin/cat".to_string(),
            ..TerminalConfig::default()
        };
        let mut source = TerminalCaptureSource::new(config);
        source.start().expect("start failed");
        source.stop().expect("first stop failed");
        source.stop().expect("second stop should also succeed");
    }
}
