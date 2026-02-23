//! Multi-source frame synchronization via ring buffers.
//!
//! Each capture source gets its own `RingBuffer` that stores the most
//! recent N frames. `SourceBufferManager` coordinates buffers for all
//! active sources.

use crate::capture::CapturedFrame;
use std::collections::HashMap;
use std::sync::Arc;

use crate::capture::source::SourceId;

/// Circular buffer storing the most recent frames from a single source.
pub struct RingBuffer {
    buffer: Vec<Option<Arc<CapturedFrame>>>,
    capacity: usize,
    write_pos: usize,
    count: u64,
}

impl RingBuffer {
    pub fn new(capacity: usize) -> Self {
        assert!(capacity > 0, "RingBuffer capacity must be greater than 0");
        let mut buffer = Vec::with_capacity(capacity);
        buffer.resize_with(capacity, || None);
        Self {
            buffer,
            capacity,
            write_pos: 0,
            count: 0,
        }
    }

    pub fn push_frame(&mut self, frame: Arc<CapturedFrame>) {
        self.buffer[self.write_pos] = Some(frame);
        self.write_pos = (self.write_pos + 1) % self.capacity;
        self.count += 1;
    }

    pub fn get_latest_frame(&self) -> Option<Arc<CapturedFrame>> {
        if self.count == 0 {
            return None;
        }
        let idx = if self.write_pos == 0 {
            self.capacity - 1
        } else {
            self.write_pos - 1
        };
        self.buffer[idx].clone()
    }

    pub fn get_frame_at_timestamp(&self, target_ms: f64) -> Option<Arc<CapturedFrame>> {
        let mut best: Option<&Arc<CapturedFrame>> = None;
        let mut best_diff = f64::MAX;

        for slot in &self.buffer {
            if let Some(frame) = slot {
                let diff = (frame.timestamp_ms - target_ms).abs();
                if diff < best_diff
                    || (diff == best_diff
                        && best
                            .map(|b| frame.timestamp_ms > b.timestamp_ms)
                            .unwrap_or(true))
                {
                    best_diff = diff;
                    best = Some(frame);
                }
            }
        }

        best.cloned()
    }

    pub fn count(&self) -> u64 {
        self.count
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }

    pub fn is_empty(&self) -> bool {
        self.count == 0
    }
}

/// Manages ring buffers for multiple sources.
pub struct SourceBufferManager {
    buffers: HashMap<SourceId, RingBuffer>,
    default_capacity: usize,
}

impl SourceBufferManager {
    pub fn new(fps: u32) -> Self {
        let default_capacity = ((fps as usize) * 2).max(1);
        Self {
            buffers: HashMap::new(),
            default_capacity,
        }
    }

    pub fn add_source(&mut self, id: SourceId) {
        self.buffers
            .entry(id)
            .or_insert_with(|| RingBuffer::new(self.default_capacity));
    }

    pub fn remove_source(&mut self, id: SourceId) {
        self.buffers.remove(&id);
    }

    pub fn push_frame(&mut self, id: SourceId, frame: Arc<CapturedFrame>) {
        if let Some(buf) = self.buffers.get_mut(&id) {
            buf.push_frame(frame);
        } else {
            debug_assert!(false, "push_frame called for unregistered source {}", id);
        }
    }

    pub fn get_latest_frame(&self, id: SourceId) -> Option<Arc<CapturedFrame>> {
        self.buffers.get(&id)?.get_latest_frame()
    }

    pub fn get_latest_frames(&self) -> HashMap<SourceId, Arc<CapturedFrame>> {
        let mut result = HashMap::new();
        for (&id, buf) in &self.buffers {
            if let Some(frame) = buf.get_latest_frame() {
                result.insert(id, frame);
            }
        }
        result
    }

    pub fn source_count(&self) -> usize {
        self.buffers.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::CapturedFrame;

    fn make_frame(width: usize, height: usize, timestamp_ms: f64) -> Arc<CapturedFrame> {
        Arc::new(CapturedFrame {
            data: vec![0u8; width * height * 4],
            width,
            height,
            bytes_per_row: width * 4,
            timestamp_ms,
        })
    }

    // ==================== RingBuffer ====================

    #[test]
    fn test_ring_buffer_new() {
        let rb = RingBuffer::new(5);
        assert_eq!(rb.capacity(), 5);
        assert_eq!(rb.count(), 0);
        assert!(rb.is_empty());
    }

    #[test]
    fn test_ring_buffer_push_and_get_latest() {
        let mut rb = RingBuffer::new(5);
        let frame = make_frame(2, 2, 42.0);
        rb.push_frame(frame.clone());

        let latest = rb.get_latest_frame().expect("should return a frame");
        assert_eq!(latest.timestamp_ms, 42.0);
        assert_eq!(rb.count(), 1);
        assert!(!rb.is_empty());
    }

    #[test]
    fn test_ring_buffer_latest_after_multiple() {
        let mut rb = RingBuffer::new(5);
        rb.push_frame(make_frame(2, 2, 10.0));
        rb.push_frame(make_frame(2, 2, 20.0));
        rb.push_frame(make_frame(2, 2, 30.0));

        let latest = rb.get_latest_frame().expect("should return a frame");
        assert_eq!(latest.timestamp_ms, 30.0);
        assert_eq!(rb.count(), 3);
    }

    #[test]
    fn test_ring_buffer_wraps_around() {
        let mut rb = RingBuffer::new(3);
        for i in 1..=5 {
            rb.push_frame(make_frame(1, 1, i as f64 * 100.0));
        }

        let latest = rb.get_latest_frame().expect("should return a frame");
        assert_eq!(latest.timestamp_ms, 500.0);
        assert_eq!(rb.count(), 5);
    }

    #[test]
    fn test_ring_buffer_empty_returns_none() {
        let rb = RingBuffer::new(3);
        assert!(rb.get_latest_frame().is_none());
    }

    #[test]
    fn test_ring_buffer_get_frame_at_timestamp() {
        let mut rb = RingBuffer::new(5);
        rb.push_frame(make_frame(1, 1, 0.0));
        rb.push_frame(make_frame(1, 1, 100.0));
        rb.push_frame(make_frame(1, 1, 200.0));

        // 150.0 is equidistant from 100.0 and 200.0; on tie the more recent
        // frame (higher timestamp) is preferred, so 200.0 should be returned.
        let found = rb
            .get_frame_at_timestamp(150.0)
            .expect("should find closest frame");
        assert_eq!(found.timestamp_ms, 200.0);
    }

    #[test]
    fn test_ring_buffer_get_frame_at_exact_timestamp() {
        let mut rb = RingBuffer::new(5);
        rb.push_frame(make_frame(1, 1, 50.0));
        rb.push_frame(make_frame(1, 1, 100.0));
        rb.push_frame(make_frame(1, 1, 150.0));

        let found = rb
            .get_frame_at_timestamp(100.0)
            .expect("should find exact frame");
        assert_eq!(found.timestamp_ms, 100.0);
    }

    // ==================== SourceBufferManager ====================

    #[test]
    fn test_buffer_manager_add_source() {
        let mut mgr = SourceBufferManager::new(30);
        mgr.add_source(1);
        mgr.add_source(2);
        assert_eq!(mgr.source_count(), 2);
    }

    #[test]
    fn test_buffer_manager_push_and_get() {
        let mut mgr = SourceBufferManager::new(30);
        mgr.add_source(1);
        let frame = make_frame(4, 4, 99.0);
        mgr.push_frame(1, frame.clone());

        let latest = mgr
            .get_latest_frame(1)
            .expect("should return pushed frame");
        assert_eq!(latest.timestamp_ms, 99.0);
    }

    #[test]
    fn test_buffer_manager_remove_source() {
        let mut mgr = SourceBufferManager::new(30);
        mgr.add_source(1);
        assert_eq!(mgr.source_count(), 1);
        mgr.remove_source(1);
        assert_eq!(mgr.source_count(), 0);
    }

    #[test]
    fn test_buffer_manager_get_latest_frames() {
        let mut mgr = SourceBufferManager::new(30);
        mgr.add_source(1);
        mgr.add_source(2);
        mgr.push_frame(1, make_frame(1, 1, 10.0));
        mgr.push_frame(2, make_frame(1, 1, 20.0));

        let frames = mgr.get_latest_frames();
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[&1].timestamp_ms, 10.0);
        assert_eq!(frames[&2].timestamp_ms, 20.0);
    }

    #[test]
    #[should_panic(expected = "push_frame called for unregistered source")]
    fn test_buffer_manager_push_unknown_source() {
        let mut mgr = SourceBufferManager::new(30);
        // In debug builds, pushing to an unregistered source triggers debug_assert.
        mgr.push_frame(999, make_frame(1, 1, 50.0));
    }

    #[test]
    #[should_panic(expected = "RingBuffer capacity must be greater than 0")]
    fn test_ring_buffer_zero_capacity_panics() {
        RingBuffer::new(0);
    }

    #[test]
    fn test_buffer_manager_fps_zero() {
        let mgr = SourceBufferManager::new(0);
        assert_eq!(mgr.source_count(), 0);
        // Should not panic - capacity defaults to 1
    }
}
