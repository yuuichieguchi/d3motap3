use std::sync::mpsc;
use std::time::{Duration, Instant};

#[derive(Debug, PartialEq)]
pub enum WaitResult {
    Matched,
    Timeout,
    Disconnected,
}

/// Wait for a text pattern to appear in the terminal output stream.
///
/// `rx` is the receiver from `subscribe_output()`.
/// `pattern` is a plain text substring to search for (not regex).
/// `timeout` is the maximum time to wait.
pub fn wait_for_text(
    rx: &mpsc::Receiver<Vec<u8>>,
    pattern: &str,
    timeout: Duration,
) -> WaitResult {
    let start = Instant::now();
    let mut buffer = String::new();

    while start.elapsed() < timeout {
        let remaining = timeout.saturating_sub(start.elapsed());
        match rx.recv_timeout(remaining.min(Duration::from_millis(100))) {
            Ok(data) => {
                if let Ok(text) = std::str::from_utf8(&data) {
                    buffer.push_str(text);
                } else {
                    buffer.push_str(&String::from_utf8_lossy(&data));
                }
                if buffer.contains(pattern) {
                    return WaitResult::Matched;
                }
                // Keep buffer bounded — retain last 64 KB.
                // Keep at least pattern.len() bytes to avoid splitting a match.
                if buffer.len() > 65536 {
                    let keep = 32768usize.max(pattern.len());
                    let trim_to = buffer.len() - keep;
                    buffer = buffer[trim_to..].to_string();
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => return WaitResult::Disconnected,
        }
    }

    WaitResult::Timeout
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn test_wait_immediate_match() {
        let (tx, rx) = mpsc::channel();
        tx.send(b"Hello World".to_vec()).unwrap();

        let result = wait_for_text(&rx, "Hello", Duration::from_secs(1));
        assert_eq!(result, WaitResult::Matched);
    }

    #[test]
    fn test_wait_timeout() {
        let (_tx, rx) = mpsc::channel::<Vec<u8>>();

        let result = wait_for_text(&rx, "never", Duration::from_millis(200));
        assert_eq!(result, WaitResult::Timeout);
    }

    #[test]
    fn test_wait_delayed_match() {
        let (tx, rx) = mpsc::channel();

        thread::spawn(move || {
            tx.send(b"irrelevant data".to_vec()).unwrap();
            thread::sleep(Duration::from_millis(50));
            tx.send(b"more stuff".to_vec()).unwrap();
            thread::sleep(Duration::from_millis(50));
            tx.send(b"the expected pattern here".to_vec()).unwrap();
        });

        let result = wait_for_text(&rx, "expected pattern", Duration::from_secs(2));
        assert_eq!(result, WaitResult::Matched);
    }

    #[test]
    fn test_wait_pattern_across_chunks() {
        let (tx, rx) = mpsc::channel();

        thread::spawn(move || {
            tx.send(b"Hel".to_vec()).unwrap();
            thread::sleep(Duration::from_millis(30));
            tx.send(b"lo World".to_vec()).unwrap();
        });

        let result = wait_for_text(&rx, "Hello", Duration::from_secs(2));
        assert_eq!(result, WaitResult::Matched);
    }

    #[test]
    fn test_wait_disconnected() {
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        drop(tx);

        let result = wait_for_text(&rx, "anything", Duration::from_secs(2));
        assert_eq!(result, WaitResult::Disconnected);
    }
}
