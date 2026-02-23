//! Multi-source capture abstraction.
//!
//! Defines the `CaptureSource` trait that all capture backends implement,
//! and `SourceRegistry` for managing active sources.

use super::CapturedFrame;
use std::sync::LazyLock;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Unique identifier for a capture source.
pub type SourceId = u32;

/// Configuration for creating a capture source.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type")]
pub enum SourceConfig {
    Display {
        display_index: u32,
        width: u32,
        height: u32,
    },
    Window {
        window_id: u32,
        width: u32,
        height: u32,
    },
    Webcam {
        device_index: u32,
        width: u32,
        height: u32,
    },
    Android {
        device_serial: String,
        width: u32,
        height: u32,
    },
    Ios {
        device_id: String,
        width: u32,
        height: u32,
    },
    Terminal {
        shell: String,
        rows: u16,
        cols: u16,
        width: u32,
        height: u32,
    },
}

/// Info about an active source (returned to JS).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SourceInfo {
    pub id: SourceId,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub is_active: bool,
}

/// Trait that all capture backends implement.
pub trait CaptureSource: Send {
    fn start(&mut self) -> Result<(), String>;
    fn stop(&mut self) -> Result<(), String>;
    /// Returns the most recent frame captured by this source.
    ///
    /// For the recording pipeline, frames are polled from sources and pushed
    /// into `SourceBufferManager` ring buffers. The compositor then reads
    /// from those buffers. This method provides direct access for simple
    /// single-source use cases.
    fn latest_frame(&self) -> Option<Arc<CapturedFrame>>;
    fn frame_count(&self) -> u64;
    fn dimensions(&self) -> (u32, u32);
    fn is_active(&self) -> bool;
    fn name(&self) -> &str;
}

/// Registry managing all active capture sources.
pub struct SourceRegistry {
    sources: HashMap<SourceId, Box<dyn CaptureSource>>,
    next_id: SourceId,
}

impl SourceRegistry {
    pub fn new() -> Self {
        Self {
            sources: HashMap::new(),
            next_id: 1,
        }
    }

    pub fn add(&mut self, source: Box<dyn CaptureSource>) -> SourceId {
        let id = self.next_id;
        self.next_id = self.next_id.checked_add(1)
            .expect("SourceId overflow: too many sources created");
        self.sources.insert(id, source);
        id
    }

    pub fn remove(&mut self, id: SourceId) -> Result<(), String> {
        let mut source = self
            .sources
            .remove(&id)
            .ok_or_else(|| format!("Source {} not found", id))?;
        if source.is_active() {
            source.stop()?;
        }
        Ok(())
    }

    pub fn get(&self, id: SourceId) -> Option<&(dyn CaptureSource + '_)> {
        self.sources.get(&id).map(|s| s.as_ref())
    }

    pub fn get_mut(&mut self, id: SourceId) -> Option<&mut Box<dyn CaptureSource>> {
        self.sources.get_mut(&id)
    }

    pub fn list(&self) -> Vec<SourceInfo> {
        self.sources
            .iter()
            .map(|(&id, source)| {
                let (width, height) = source.dimensions();
                SourceInfo {
                    id,
                    name: source.name().to_string(),
                    width,
                    height,
                    is_active: source.is_active(),
                }
            })
            .collect()
    }

    pub fn active_sources(&self) -> Vec<(SourceId, &dyn CaptureSource)> {
        self.sources
            .iter()
            .filter(|(_, s)| s.is_active())
            .map(|(&id, s)| (id, s.as_ref()))
            .collect()
    }

    pub fn len(&self) -> usize {
        self.sources.len()
    }

    pub fn is_empty(&self) -> bool {
        self.sources.is_empty()
    }
}

impl Default for SourceRegistry {
    fn default() -> Self {
        Self::new()
    }
}

static GLOBAL_REGISTRY: LazyLock<Mutex<SourceRegistry>> = LazyLock::new(|| Mutex::new(SourceRegistry::new()));

pub fn with_registry<F, R>(f: F) -> Result<R, String>
where
    F: FnOnce(&mut SourceRegistry) -> R,
{
    let mut reg = GLOBAL_REGISTRY.lock().map_err(|e| format!("Registry lock error: {}", e))?;
    Ok(f(&mut reg))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::CapturedFrame;
    use std::sync::Arc;

    // ==================== Mock Implementation ====================

    struct MockCaptureSource {
        active: bool,
        frame_count: u64,
        width: u32,
        height: u32,
        source_name: String,
        frame: Option<Arc<CapturedFrame>>,
    }

    impl MockCaptureSource {
        fn new(name: &str, width: u32, height: u32) -> Self {
            Self {
                active: false,
                frame_count: 0,
                width,
                height,
                source_name: name.to_string(),
                frame: None,
            }
        }
    }

    impl CaptureSource for MockCaptureSource {
        fn start(&mut self) -> Result<(), String> {
            self.active = true;
            Ok(())
        }

        fn stop(&mut self) -> Result<(), String> {
            self.active = false;
            Ok(())
        }

        fn latest_frame(&self) -> Option<Arc<CapturedFrame>> {
            self.frame.clone()
        }

        fn frame_count(&self) -> u64 {
            self.frame_count
        }

        fn dimensions(&self) -> (u32, u32) {
            (self.width, self.height)
        }

        fn is_active(&self) -> bool {
            self.active
        }

        fn name(&self) -> &str {
            &self.source_name
        }
    }

    // ==================== SourceRegistry Tests ====================

    #[test]
    fn test_registry_add_and_list() {
        let mut registry = SourceRegistry::new();
        let source = MockCaptureSource::new("display-0", 1920, 1080);
        let id = registry.add(Box::new(source));

        let list = registry.list();
        assert_eq!(list.len(), 1);

        let info = &list[0];
        assert_eq!(info.id, id);
        assert_eq!(info.name, "display-0");
        assert_eq!(info.width, 1920);
        assert_eq!(info.height, 1080);
        assert!(!info.is_active);
    }

    #[test]
    fn test_registry_add_multiple() {
        let mut registry = SourceRegistry::new();
        let id1 = registry.add(Box::new(MockCaptureSource::new("source-a", 800, 600)));
        let id2 = registry.add(Box::new(MockCaptureSource::new("source-b", 1280, 720)));

        assert_eq!(registry.len(), 2);
        assert_ne!(id1, id2);
        assert_eq!(id2, id1 + 1);
    }

    #[test]
    fn test_registry_remove_existing() {
        let mut registry = SourceRegistry::new();
        let id = registry.add(Box::new(MockCaptureSource::new("temp", 640, 480)));
        assert_eq!(registry.len(), 1);

        let result = registry.remove(id);
        assert!(result.is_ok());
        assert_eq!(registry.len(), 0);
        assert!(registry.get(id).is_none());
    }

    #[test]
    fn test_registry_remove_stops_active() {
        let mut registry = SourceRegistry::new();
        let source = MockCaptureSource::new("active-src", 1920, 1080);
        let id = registry.add(Box::new(source));

        // Start the source so it becomes active.
        registry.get_mut(id).unwrap().start().unwrap();
        assert!(registry.get(id).unwrap().is_active());

        // Remove should call stop() internally because the source is active.
        let result = registry.remove(id);
        assert!(result.is_ok());
        // The source has been removed from the registry, so we cannot query it
        // directly. The test verifies that remove() did not return an error,
        // which means stop() succeeded without panicking.
        assert!(registry.get(id).is_none());
    }

    #[test]
    fn test_registry_remove_nonexistent() {
        let mut registry = SourceRegistry::new();
        let result = registry.remove(999);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("999"));
    }

    #[test]
    fn test_registry_get() {
        let mut registry = SourceRegistry::new();
        let id = registry.add(Box::new(MockCaptureSource::new("webcam-0", 640, 480)));

        let source = registry.get(id).unwrap();
        assert_eq!(source.dimensions(), (640, 480));
        assert_eq!(source.name(), "webcam-0");
    }

    #[test]
    fn test_registry_active_sources() {
        let mut registry = SourceRegistry::new();
        let id1 = registry.add(Box::new(MockCaptureSource::new("inactive", 800, 600)));
        let id2 = registry.add(Box::new(MockCaptureSource::new("active", 1920, 1080)));

        // Start only the second source.
        registry.get_mut(id2).unwrap().start().unwrap();

        let active = registry.active_sources();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].0, id2);
        assert!(active[0].1.is_active());

        // Verify the first source is not in the active list.
        assert!(!registry.get(id1).unwrap().is_active());
    }

    #[test]
    fn test_registry_is_empty() {
        let mut registry = SourceRegistry::new();
        assert!(registry.is_empty());

        registry.add(Box::new(MockCaptureSource::new("src", 100, 100)));
        assert!(!registry.is_empty());
    }

    // ==================== SourceConfig Serde Tests ====================

    #[test]
    fn test_source_config_serde() {
        let config = SourceConfig::Display {
            display_index: 0,
            width: 2560,
            height: 1440,
        };

        let json = serde_json::to_string(&config).unwrap();
        let deserialized: SourceConfig = serde_json::from_str(&json).unwrap();

        match deserialized {
            SourceConfig::Display {
                display_index,
                width,
                height,
            } => {
                assert_eq!(display_index, 0);
                assert_eq!(width, 2560);
                assert_eq!(height, 1440);
            }
            _ => panic!("Expected SourceConfig::Display after round-trip"),
        }
    }

    #[test]
    fn test_source_config_serde_window() {
        let config = SourceConfig::Window {
            window_id: 42,
            width: 1024,
            height: 768,
        };

        let json = serde_json::to_string(&config).unwrap();
        let deserialized: SourceConfig = serde_json::from_str(&json).unwrap();

        match deserialized {
            SourceConfig::Window {
                window_id,
                width,
                height,
            } => {
                assert_eq!(window_id, 42);
                assert_eq!(width, 1024);
                assert_eq!(height, 768);
            }
            _ => panic!("Expected SourceConfig::Window after round-trip"),
        }
    }

    #[test]
    fn test_source_config_serde_android() {
        let config = SourceConfig::Android {
            device_serial: "emulator-5554".to_string(),
            width: 1080,
            height: 1920,
        };
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: SourceConfig = serde_json::from_str(&json).unwrap();
        match deserialized {
            SourceConfig::Android { device_serial, width, height } => {
                assert_eq!(device_serial, "emulator-5554");
                assert_eq!(width, 1080);
                assert_eq!(height, 1920);
            }
            _ => panic!("Expected SourceConfig::Android"),
        }
    }

    #[test]
    fn test_source_config_serde_ios() {
        let config = SourceConfig::Ios {
            device_id: "device-1".to_string(),
            width: 1170,
            height: 2532,
        };
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: SourceConfig = serde_json::from_str(&json).unwrap();
        match deserialized {
            SourceConfig::Ios { device_id, width, height } => {
                assert_eq!(device_id, "device-1");
                assert_eq!(width, 1170);
                assert_eq!(height, 2532);
            }
            _ => panic!("Expected SourceConfig::Ios"),
        }
    }

    #[test]
    fn test_source_config_serde_terminal() {
        let config = SourceConfig::Terminal {
            shell: "/bin/zsh".to_string(),
            rows: 24,
            cols: 80,
            width: 960,
            height: 540,
        };
        let json = serde_json::to_string(&config).unwrap();
        let deserialized: SourceConfig = serde_json::from_str(&json).unwrap();
        match deserialized {
            SourceConfig::Terminal { shell, rows, cols, width, height } => {
                assert_eq!(shell, "/bin/zsh");
                assert_eq!(rows, 24);
                assert_eq!(cols, 80);
                assert_eq!(width, 960);
                assert_eq!(height, 540);
            }
            _ => panic!("Expected SourceConfig::Terminal after round-trip"),
        }
    }
}
