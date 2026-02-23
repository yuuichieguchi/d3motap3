use std::io::Write;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread::JoinHandle;

/// Decodes H.264 byte stream to raw BGRA frames using FFmpeg subprocess.
pub struct H264Decoder {
    process: Option<Child>,
    reader_thread: Option<JoinHandle<()>>,
    frame_rx: mpsc::Receiver<Vec<u8>>,
    frame_size: usize,
    width: u32,
    height: u32,
}

impl H264Decoder {
    pub fn new(width: u32, height: u32) -> Result<Self, String> {
        let ffmpeg_path = crate::encoder::find_ffmpeg()?;
        let frame_size = (width as usize) * (height as usize) * 4; // BGRA

        let mut process = Command::new(&ffmpeg_path)
            .args([
                "-f", "h264",
                "-i", "pipe:0",
                "-f", "rawvideo",
                "-pix_fmt", "bgra",
                "-flags", "low_delay",
                "-fflags", "nobuffer",
                "pipe:1",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to spawn FFmpeg decoder: {}", e))?;

        let stdout = process
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture FFmpeg stdout".to_string())?;

        let (tx, rx) = mpsc::channel();

        let reader_thread = {
            let frame_size = frame_size;
            std::thread::spawn(move || {
                use std::io::Read;
                let mut reader = stdout;
                let mut buf = vec![0u8; frame_size];
                loop {
                    match reader.read_exact(&mut buf) {
                        Ok(()) => {
                            if tx.send(buf.clone()).is_err() {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
            })
        };

        Ok(Self {
            process: Some(process),
            reader_thread: Some(reader_thread),
            frame_rx: rx,
            frame_size,
            width,
            height,
        })
    }

    /// Write H.264 data to the decoder's stdin.
    pub fn write_h264(&mut self, data: &[u8]) -> Result<(), String> {
        let stdin = self
            .process
            .as_mut()
            .and_then(|p| p.stdin.as_mut())
            .ok_or_else(|| "Decoder process not running".to_string())?;
        stdin
            .write_all(data)
            .map_err(|e| format!("Write error: {}", e))?;
        stdin.flush().map_err(|e| format!("Flush error: {}", e))?;
        Ok(())
    }

    /// Try to read a decoded BGRA frame. Returns None if no frame ready.
    pub fn try_read_frame(&self) -> Option<Vec<u8>> {
        self.frame_rx.try_recv().ok()
    }

    pub fn frame_size(&self) -> usize {
        self.frame_size
    }

    pub fn dimensions(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    pub fn stop(&mut self) {
        // Drop stdin to signal EOF to FFmpeg
        if let Some(ref mut process) = self.process {
            drop(process.stdin.take());
        }
        // Wait for reader thread
        if let Some(thread) = self.reader_thread.take() {
            let _ = thread.join();
        }
        // Kill process if still running
        if let Some(mut process) = self.process.take() {
            let _ = process.kill();
            let _ = process.wait();
        }
    }
}

impl Drop for H264Decoder {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decoder_dimensions() {
        // Skip if FFmpeg not available
        if crate::encoder::find_ffmpeg().is_err() {
            eprintln!("Skipping: FFmpeg not found");
            return;
        }
        let decoder = H264Decoder::new(320, 240).expect("Failed to create decoder");
        assert_eq!(decoder.dimensions(), (320, 240));
        assert_eq!(decoder.frame_size(), 320 * 240 * 4);
    }

    #[test]
    fn test_decoder_lifecycle() {
        if crate::encoder::find_ffmpeg().is_err() {
            eprintln!("Skipping: FFmpeg not found");
            return;
        }
        let mut decoder = H264Decoder::new(320, 240).expect("Failed to create decoder");
        // No frames available without actual H.264 input
        assert!(decoder.try_read_frame().is_none());
        decoder.stop();
        // Stop should be idempotent
        decoder.stop();
    }

    #[test]
    fn test_decoder_stop_idempotent() {
        if crate::encoder::find_ffmpeg().is_err() {
            eprintln!("Skipping: FFmpeg not found");
            return;
        }
        let mut decoder = H264Decoder::new(640, 480).expect("Failed to create decoder");
        decoder.stop();
        decoder.stop(); // should not panic
    }
}
