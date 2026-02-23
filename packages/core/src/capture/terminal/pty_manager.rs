//! PTY (pseudo-terminal) lifecycle management.
//!
//! [`PtyManager`] wraps `portable-pty` to spawn a shell process, pipe
//! input/output through a background reader thread, and support resize
//! and graceful shutdown.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread::JoinHandle;

/// Manages a single PTY session: spawn, I/O, resize, and shutdown.
pub struct PtyManager {
    master: Option<Box<dyn MasterPty + Send>>,
    writer: Option<Box<dyn Write + Send>>,
    child: Option<Box<dyn Child + Send + Sync>>,
    reader_thread: Option<JoinHandle<()>>,
    output_rx: mpsc::Receiver<Vec<u8>>,
    is_running: Arc<AtomicBool>,
    stopped: bool,
}

impl PtyManager {
    /// Return the list of allowed shell paths.
    fn allowed_shells() -> &'static [&'static str] {
        #[cfg(test)]
        {
            &[
                "/bin/sh",
                "/bin/bash",
                "/bin/zsh",
                "/bin/fish",
                "/usr/bin/bash",
                "/usr/bin/zsh",
                "/usr/bin/fish",
                "/usr/local/bin/bash",
                "/usr/local/bin/zsh",
                "/usr/local/bin/fish",
                "/opt/homebrew/bin/bash",
                "/opt/homebrew/bin/zsh",
                "/opt/homebrew/bin/fish",
                "/bin/cat",
                "/bin/echo",
            ]
        }
        #[cfg(not(test))]
        {
            &[
                "/bin/sh",
                "/bin/bash",
                "/bin/zsh",
                "/bin/fish",
                "/usr/bin/bash",
                "/usr/bin/zsh",
                "/usr/bin/fish",
                "/usr/local/bin/bash",
                "/usr/local/bin/zsh",
                "/usr/local/bin/fish",
                "/opt/homebrew/bin/bash",
                "/opt/homebrew/bin/zsh",
                "/opt/homebrew/bin/fish",
            ]
        }
    }

    /// Spawn a new PTY running `shell` with the given grid dimensions.
    pub fn new(shell: &str, rows: u16, cols: u16) -> Result<Self, String> {
        if !Self::allowed_shells().contains(&shell) {
            return Err(format!("Shell '{}' is not in the allowed list", shell));
        }

        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pty_system = native_pty_system();
        let pair = pty_system.openpty(size).map_err(|e| e.to_string())?;

        let cmd = CommandBuilder::new(shell);
        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

        // Drop slave to avoid blocking reads on the master side.
        drop(pair.slave);

        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

        let is_running = Arc::new(AtomicBool::new(true));
        let is_running_clone = Arc::clone(&is_running);

        let (tx, rx) = mpsc::channel::<Vec<u8>>();

        let reader_thread = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                if !is_running_clone.load(Ordering::Relaxed) {
                    break;
                }
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            is_running_clone.store(false, Ordering::Relaxed);
        });

        Ok(Self {
            master: Some(pair.master),
            writer: Some(writer),
            child: Some(child),
            reader_thread: Some(reader_thread),
            output_rx: rx,
            is_running,
            stopped: false,
        })
    }

    /// Send raw bytes to the PTY's standard input.
    pub fn write_input(&mut self, data: &[u8]) -> Result<(), String> {
        let writer = self
            .writer
            .as_mut()
            .ok_or_else(|| "PTY already stopped".to_string())?;
        writer.write_all(data).map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Resize the PTY grid to new dimensions.
    pub fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        self.master
            .as_ref()
            .ok_or_else(|| "PTY already stopped".to_string())?
            .resize(size)
            .map_err(|e| e.to_string())
    }

    /// Non-blocking read of any pending output from the PTY.
    pub fn try_read(&self) -> Option<Vec<u8>> {
        let mut collected = Vec::new();
        while let Ok(chunk) = self.output_rx.try_recv() {
            collected.extend(chunk);
        }
        if collected.is_empty() {
            None
        } else {
            Some(collected)
        }
    }

    /// Terminate the child process and clean up resources.
    pub fn stop(&mut self) -> Result<(), String> {
        if self.stopped {
            return Ok(());
        }

        self.is_running.store(false, Ordering::Relaxed);

        // Kill the child process to ensure it terminates.
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
        }

        // Drop the writer and master PTY handles to close file descriptors.
        // This unblocks the reader thread's blocking read() call.
        drop(self.writer.take());
        drop(self.master.take());

        if let Some(thread) = self.reader_thread.take() {
            let _ = thread.join();
        }

        self.stopped = true;
        Ok(())
    }

    /// Check whether the child process is still running.
    pub fn is_alive(&self) -> bool {
        !self.stopped && self.is_running.load(Ordering::Relaxed)
    }
}

impl Drop for PtyManager {
    fn drop(&mut self) {
        if !self.stopped {
            let _ = self.stop();
        }
    }
}

// ---------------------------------------------------------------------------
// Tests — TDD Red phase
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn test_pty_spawn_echo() {
        // Spawn /bin/echo which prints and exits
        let mut pty = PtyManager::new("/bin/echo", 24, 80).expect("Failed to spawn PTY");

        // Give the process time to produce output
        thread::sleep(Duration::from_millis(200));

        // Should have received some output
        let output = pty.try_read();
        assert!(output.is_some(), "Expected output from /bin/echo");

        pty.stop().ok();
    }

    #[test]
    fn test_pty_write_input() {
        // Spawn cat which echoes input
        let mut pty = PtyManager::new("/bin/cat", 24, 80).expect("Failed to spawn PTY");

        // Write some input
        pty.write_input(b"hello\n").expect("Failed to write input");

        // Give time for echo
        thread::sleep(Duration::from_millis(200));

        // Should have received the echoed input
        let output = pty.try_read();
        assert!(output.is_some(), "Expected echoed output from cat");
        let data = output.unwrap();
        let text = String::from_utf8_lossy(&data);
        assert!(
            text.contains("hello"),
            "Expected 'hello' in output, got: {}",
            text
        );

        pty.stop().ok();
    }

    #[test]
    fn test_pty_resize_no_error() {
        let pty = PtyManager::new("/bin/cat", 24, 80).expect("Failed to spawn PTY");

        // Resize should succeed without error
        let result = pty.resize(40, 120);
        assert!(result.is_ok(), "Resize should not return error");

        // Can stop without issues
        let mut pty = pty;
        pty.stop().ok();
    }

    #[test]
    fn test_pty_stop_idempotent() {
        let mut pty = PtyManager::new("/bin/cat", 24, 80).expect("Failed to spawn PTY");

        // First stop should succeed
        let result1 = pty.stop();
        assert!(result1.is_ok(), "First stop should succeed");

        // Second stop should also succeed (idempotent)
        let result2 = pty.stop();
        assert!(result2.is_ok(), "Second stop should also succeed (idempotent)");
    }

    #[test]
    fn test_pty_reject_disallowed_shell() {
        let result = PtyManager::new("/usr/bin/curl", 24, 80);
        assert!(result.is_err());
        let err = result.err().expect("expected Err variant");
        assert!(
            err.contains("not in the allowed list"),
            "Expected 'not in the allowed list' in error, got: {}",
            err
        );
    }

    #[test]
    fn test_pty_is_alive() {
        let mut pty = PtyManager::new("/bin/cat", 24, 80).expect("Failed to spawn PTY");

        // Should be alive after spawn
        assert!(pty.is_alive(), "PTY should be alive after spawn");

        // Should not be alive after stop
        pty.stop().ok();
        assert!(!pty.is_alive(), "PTY should not be alive after stop");
    }
}
