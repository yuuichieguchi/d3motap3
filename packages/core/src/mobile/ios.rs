//! iOS device capture via AVFoundation (macOS only).
//!
//! USB-connected iOS devices appear as AVFoundation capture devices.
//! This uses the same nokhwa library as `WebcamCaptureSource` but
//! filters for iOS devices by name (iPhone, iPad, iPod).

#[derive(Debug, Clone)]
pub struct IosDevice {
    pub device_id: String,
    pub name: String,
    pub model: String,
}

// ---- macOS implementation ----

#[cfg(target_os = "macos")]
mod platform {
    use super::IosDevice;
    use crate::capture::source::CaptureSource;
    use crate::capture::CapturedFrame;

    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};

    /// Keywords used to identify iOS devices among AVFoundation capture devices.
    const IOS_KEYWORDS: &[&str] = &["iPhone", "iPad", "iPod"];

    /// List iOS devices visible via AVFoundation.
    ///
    /// Queries all video capture devices through the AVFoundation backend
    /// and filters by device name to distinguish iOS devices from regular
    /// webcams.
    pub fn list_ios_devices() -> Result<Vec<IosDevice>, String> {
        use nokhwa::query;
        use nokhwa::utils::ApiBackend;

        let devices = query(ApiBackend::AVFoundation)
            .map_err(|e| format!("Failed to query devices: {}", e))?;

        Ok(devices
            .iter()
            .enumerate()
            .filter(|(_, d)| {
                let name = d.human_name();
                IOS_KEYWORDS.iter().any(|kw| name.contains(kw))
            })
            .map(|(i, d)| IosDevice {
                device_id: i.to_string(),
                name: d.human_name(),
                model: d.description().to_string(),
            })
            .collect())
    }

    /// A capture source for USB-connected iOS devices.
    ///
    /// Uses nokhwa's AVFoundation backend, similar to `WebcamCaptureSource`,
    /// but targets iOS devices specifically. Full frame streaming is deferred
    /// to a future phase; currently only device detection and pipeline
    /// integration are implemented.
    pub struct IosCaptureSource {
        device_id: String,
        width: u32,
        height: u32,
        source_name: String,
        latest_frame: Arc<Mutex<Option<Arc<CapturedFrame>>>>,
        is_active: Arc<AtomicBool>,
        frame_count: Arc<AtomicU64>,
    }

    impl IosCaptureSource {
        pub fn new(device_id: String, width: u32, height: u32) -> Self {
            let name = format!("ios-{}", device_id);
            Self {
                device_id,
                width,
                height,
                source_name: name,
                latest_frame: Arc::new(Mutex::new(None)),
                is_active: Arc::new(AtomicBool::new(false)),
                frame_count: Arc::new(AtomicU64::new(0)),
            }
        }

        /// Returns the device identifier this source was created with.
        pub fn device_id(&self) -> &str {
            &self.device_id
        }
    }

    impl CaptureSource for IosCaptureSource {
        fn start(&mut self) -> Result<(), String> {
            if self.is_active.load(Ordering::Relaxed) {
                return Err("Already active".to_string());
            }
            // Full camera streaming implementation deferred to next phase.
            // Device detection works but actual frame capture requires
            // wiring up nokhwa's CallbackCamera with iOS-specific handling.
            Err("iOS capture not yet fully implemented — device detection works".to_string())
        }

        fn stop(&mut self) -> Result<(), String> {
            self.is_active.store(false, Ordering::Relaxed);
            Ok(())
        }

        fn latest_frame(&self) -> Option<Arc<CapturedFrame>> {
            self.latest_frame.lock().ok()?.clone()
        }

        fn frame_count(&self) -> u64 {
            self.frame_count.load(Ordering::Relaxed)
        }

        fn dimensions(&self) -> (u32, u32) {
            (self.width, self.height)
        }

        fn is_active(&self) -> bool {
            self.is_active.load(Ordering::Relaxed)
        }

        fn name(&self) -> &str {
            &self.source_name
        }
    }

    impl Drop for IosCaptureSource {
        fn drop(&mut self) {
            if self.is_active.load(Ordering::Relaxed) {
                let _ = self.stop();
            }
        }
    }
}

// ---- Non-macOS stubs ----

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::IosDevice;
    use crate::capture::source::CaptureSource;
    use crate::capture::CapturedFrame;
    use std::sync::Arc;

    pub fn list_ios_devices() -> Result<Vec<IosDevice>, String> {
        Err("iOS capture is only supported on macOS".to_string())
    }

    pub struct IosCaptureSource {
        source_name: String,
        width: u32,
        height: u32,
    }

    impl IosCaptureSource {
        pub fn new(_device_id: String, width: u32, height: u32) -> Self {
            Self {
                source_name: "ios-stub".to_string(),
                width,
                height,
            }
        }
    }

    impl CaptureSource for IosCaptureSource {
        fn start(&mut self) -> Result<(), String> {
            Err("iOS capture is only supported on macOS".to_string())
        }

        fn stop(&mut self) -> Result<(), String> {
            Ok(())
        }

        fn latest_frame(&self) -> Option<Arc<CapturedFrame>> {
            None
        }

        fn frame_count(&self) -> u64 {
            0
        }

        fn dimensions(&self) -> (u32, u32) {
            (self.width, self.height)
        }

        fn is_active(&self) -> bool {
            false
        }

        fn name(&self) -> &str {
            &self.source_name
        }
    }
}

pub use platform::*;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::source::CaptureSource;

    #[test]
    fn test_ios_source_new_dimensions() {
        let source = IosCaptureSource::new("device-1".to_string(), 1170, 2532);
        assert_eq!(source.dimensions(), (1170, 2532));
    }

    #[test]
    fn test_ios_source_not_active_initially() {
        let source = IosCaptureSource::new("device-1".to_string(), 1170, 2532);
        assert!(!source.is_active());
    }

    #[test]
    fn test_ios_source_stop_ok() {
        let mut source = IosCaptureSource::new("device-1".to_string(), 1170, 2532);
        assert!(source.stop().is_ok());
    }

    #[test]
    fn test_ios_source_no_frame_before_start() {
        let source = IosCaptureSource::new("device-1".to_string(), 1170, 2532);
        assert!(source.latest_frame().is_none());
    }

    #[test]
    fn test_ios_source_frame_count_zero_initially() {
        let source = IosCaptureSource::new("device-1".to_string(), 1170, 2532);
        assert_eq!(source.frame_count(), 0);
    }

    #[test]
    fn test_ios_source_start_returns_err() {
        // On macOS: returns "not yet fully implemented" error.
        // On other platforms: returns "only supported on macOS" error.
        // Either way, start() should return Err.
        let mut source = IosCaptureSource::new("device-1".to_string(), 1170, 2532);
        let result = source.start();
        assert!(result.is_err());
    }

    #[test]
    fn test_ios_source_not_active_after_failed_start() {
        let mut source = IosCaptureSource::new("device-1".to_string(), 1170, 2532);
        let _ = source.start();
        assert!(!source.is_active());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_ios_source_name_contains_device_id() {
        let source = IosCaptureSource::new("device-1".to_string(), 1170, 2532);
        assert_eq!(source.name(), "ios-device-1");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_ios_source_device_id_accessor() {
        let source = IosCaptureSource::new("my-device".to_string(), 1920, 1080);
        assert_eq!(source.device_id(), "my-device");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_ios_source_start_err_message() {
        let mut source = IosCaptureSource::new("device-1".to_string(), 1170, 2532);
        let err = source.start().unwrap_err();
        assert!(
            err.contains("not yet fully implemented"),
            "Expected 'not yet fully implemented' in error, got: {}",
            err
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_ios_source_double_stop_ok() {
        let mut source = IosCaptureSource::new("device-1".to_string(), 1170, 2532);
        assert!(source.stop().is_ok());
        assert!(source.stop().is_ok());
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn test_ios_stub_start_fails_with_platform_message() {
        let mut source = IosCaptureSource::new("device-1".to_string(), 1170, 2532);
        let err = source.start().unwrap_err();
        assert!(
            err.contains("only supported on macOS"),
            "Expected platform error, got: {}",
            err
        );
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn test_ios_stub_list_devices_fails() {
        let result = list_ios_devices();
        assert!(result.is_err());
    }

    #[test]
    fn test_ios_device_struct_clone() {
        let device = IosDevice {
            device_id: "42".to_string(),
            name: "iPhone 15 Pro".to_string(),
            model: "iPhone15,3".to_string(),
        };
        let cloned = device.clone();
        assert_eq!(cloned.device_id, "42");
        assert_eq!(cloned.name, "iPhone 15 Pro");
        assert_eq!(cloned.model, "iPhone15,3");
    }

    #[test]
    fn test_ios_device_struct_debug() {
        let device = IosDevice {
            device_id: "1".to_string(),
            name: "iPad Air".to_string(),
            model: "iPad13,2".to_string(),
        };
        let debug_str = format!("{:?}", device);
        assert!(debug_str.contains("iPad Air"));
        assert!(debug_str.contains("iPad13,2"));
    }
}