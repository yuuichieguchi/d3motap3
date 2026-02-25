//! iOS device capture via ScreenCaptureKit (macOS only).
//!
//! USB-connected iOS devices appear as external display sources on modern
//! macOS. This module uses ScreenCaptureKit to enumerate displays, then
//! checks IOKit display names for iOS device keywords (iPhone, iPad, iPod).

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
    use crate::capture::DisplayCaptureSource;
    use crate::capture::source::CaptureSource;
    use crate::capture::CapturedFrame;
    use screencapturekit::prelude::*;
    use std::ffi::c_void;
    use std::sync::Arc;

    /// Keywords used to identify iOS devices among external displays.
    const IOS_KEYWORDS: &[&str] = &["iPhone", "iPad", "iPod"];

    // ---- CoreGraphics / IOKit FFI for display name resolution ----

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGDisplayIsBuiltin(display: u32) -> bool;
        fn CGDisplayIOServicePort(display: u32) -> u32;
    }

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IODisplayCreateInfoDictionary(service: u32, options: u32) -> *const c_void;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFDictionaryGetValue(dict: *const c_void, key: *const c_void) -> *const c_void;
        fn CFStringGetCStringPtr(string: *const c_void, encoding: u32) -> *const i8;
        fn CFStringGetCString(
            string: *const c_void,
            buffer: *mut i8,
            buffer_size: isize,
            encoding: u32,
        ) -> bool;
        fn CFDictionaryGetCount(dict: *const c_void) -> isize;
        fn CFDictionaryGetKeysAndValues(
            dict: *const c_void,
            keys: *mut *const c_void,
            values: *mut *const c_void,
        );
        fn CFRelease(cf: *const c_void);
    }

    // CFStringCreateWithCString to create CFString keys
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(
            alloc: *const c_void,
            c_str: *const i8,
            encoding: u32,
        ) -> *const c_void;
    }

    const K_CFSTRING_ENCODING_UTF8: u32 = 0x08000100;
    const K_IO_DISPLAY_ONLY_PREFERRED_NAME: u32 = 0x00000200;

    /// Get the display name from IOKit for a given CGDirectDisplayID.
    fn get_display_name(display_id: u32) -> Option<String> {
        unsafe {
            let service = CGDisplayIOServicePort(display_id);
            if service == 0 {
                return None;
            }

            let info = IODisplayCreateInfoDictionary(service, K_IO_DISPLAY_ONLY_PREFERRED_NAME);
            if info.is_null() {
                return None;
            }

            // Create the "DisplayProductName" key as a CFString
            let key_cstr = b"DisplayProductName\0".as_ptr() as *const i8;
            let key_cf = CFStringCreateWithCString(
                std::ptr::null(),
                key_cstr,
                K_CFSTRING_ENCODING_UTF8,
            );
            if key_cf.is_null() {
                CFRelease(info);
                return None;
            }

            let names_dict = CFDictionaryGetValue(info, key_cf);
            CFRelease(key_cf);

            if names_dict.is_null() {
                CFRelease(info);
                return None;
            }

            // The DisplayProductName value is a dictionary of locale -> name.
            // Get the first value (there's usually only one).
            let count = CFDictionaryGetCount(names_dict);
            if count <= 0 {
                CFRelease(info);
                return None;
            }

            let mut keys: Vec<*const c_void> = vec![std::ptr::null(); count as usize];
            let mut values: Vec<*const c_void> = vec![std::ptr::null(); count as usize];
            CFDictionaryGetKeysAndValues(names_dict, keys.as_mut_ptr(), values.as_mut_ptr());

            let name_cf = values[0];
            if name_cf.is_null() {
                CFRelease(info);
                return None;
            }

            // Try the fast path first
            let cstr_ptr = CFStringGetCStringPtr(name_cf, K_CFSTRING_ENCODING_UTF8);
            let name = if !cstr_ptr.is_null() {
                std::ffi::CStr::from_ptr(cstr_ptr)
                    .to_string_lossy()
                    .into_owned()
            } else {
                // Fallback: copy into buffer
                let mut buf = [0i8; 256];
                if CFStringGetCString(
                    name_cf,
                    buf.as_mut_ptr(),
                    buf.len() as isize,
                    K_CFSTRING_ENCODING_UTF8,
                ) {
                    std::ffi::CStr::from_ptr(buf.as_ptr())
                        .to_string_lossy()
                        .into_owned()
                } else {
                    CFRelease(info);
                    return None;
                }
            };

            CFRelease(info);
            Some(name)
        }
    }

    /// List iOS devices visible as external displays via ScreenCaptureKit.
    ///
    /// Enumerates all displays, excludes the built-in display, then checks
    /// the IOKit display name for iOS device keywords.
    pub fn list_ios_devices() -> Result<Vec<IosDevice>, String> {
        let content = SCShareableContent::get()
            .map_err(|e| format!("Failed to get shareable content: {}", e))?;

        let mut devices = Vec::new();

        for display in content.displays() {
            let id = display.display_id();

            // Skip the Mac's built-in display
            let is_builtin = unsafe { CGDisplayIsBuiltin(id) };
            if is_builtin {
                continue;
            }

            if let Some(name) = get_display_name(id) {
                if IOS_KEYWORDS.iter().any(|kw| name.contains(kw)) {
                    devices.push(IosDevice {
                        device_id: id.to_string(),
                        name: name.clone(),
                        model: format!("{}x{}", display.width(), display.height()),
                    });
                }
            }
        }

        Ok(devices)
    }

    /// A capture source for USB-connected iOS devices.
    ///
    /// Delegates to `DisplayCaptureSource` which uses ScreenCaptureKit
    /// to capture the iOS device's display output.
    pub struct IosCaptureSource {
        display_id: u32,
        width: u32,
        height: u32,
        source_name: String,
        inner: Option<DisplayCaptureSource>,
    }

    unsafe impl Send for IosCaptureSource {}

    impl IosCaptureSource {
        pub fn new(device_id: String, width: u32, height: u32) -> Result<Self, String> {
            let display_id: u32 = device_id
                .parse()
                .map_err(|e| format!("Invalid device ID '{}': {}", device_id, e))?;
            let name = format!("ios-{}", device_id);
            Ok(Self {
                display_id,
                width,
                height,
                source_name: name,
                inner: None,
            })
        }

        pub fn device_id(&self) -> String {
            self.display_id.to_string()
        }
    }

    impl CaptureSource for IosCaptureSource {
        fn start(&mut self) -> Result<(), String> {
            if self.inner.is_some() {
                return Err("Already active".to_string());
            }

            let mut inner = DisplayCaptureSource::from_display_id(
                self.display_id,
                self.width,
                self.height,
                self.source_name.clone(),
            )?;
            inner.start()?;
            self.inner = Some(inner);
            Ok(())
        }

        fn stop(&mut self) -> Result<(), String> {
            if let Some(mut inner) = self.inner.take() {
                inner.stop()?;
            }
            Ok(())
        }

        fn latest_frame(&self) -> Option<Arc<CapturedFrame>> {
            self.inner.as_ref()?.latest_frame()
        }

        fn frame_count(&self) -> u64 {
            self.inner.as_ref().map_or(0, |i| i.frame_count())
        }

        fn dimensions(&self) -> (u32, u32) {
            (self.width, self.height)
        }

        fn is_active(&self) -> bool {
            self.inner.as_ref().map_or(false, |i| i.is_active())
        }

        fn name(&self) -> &str {
            &self.source_name
        }
    }

    impl Drop for IosCaptureSource {
        fn drop(&mut self) {
            if let Some(mut inner) = self.inner.take() {
                let _ = inner.stop();
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

    /// Helper: create a source with a numeric (but fake) device ID.
    /// On macOS this returns Ok because the ID parses to u32.
    /// On non-macOS it always succeeds (stub returns Self directly).
    #[cfg(target_os = "macos")]
    fn make_source(width: u32, height: u32) -> IosCaptureSource {
        IosCaptureSource::new("999999".to_string(), width, height).unwrap()
    }

    #[cfg(not(target_os = "macos"))]
    fn make_source(width: u32, height: u32) -> IosCaptureSource {
        IosCaptureSource::new("999999".to_string(), width, height)
    }

    #[test]
    fn test_ios_source_new_dimensions() {
        let source = make_source(1170, 2532);
        assert_eq!(source.dimensions(), (1170, 2532));
    }

    #[test]
    fn test_ios_source_not_active_initially() {
        let source = make_source(1170, 2532);
        assert!(!source.is_active());
    }

    #[test]
    fn test_ios_source_stop_ok() {
        let mut source = make_source(1170, 2532);
        assert!(source.stop().is_ok());
    }

    #[test]
    fn test_ios_source_no_frame_before_start() {
        let source = make_source(1170, 2532);
        assert!(source.latest_frame().is_none());
    }

    #[test]
    fn test_ios_source_frame_count_zero_initially() {
        let source = make_source(1170, 2532);
        assert_eq!(source.frame_count(), 0);
    }

    #[test]
    fn test_ios_source_start_returns_err() {
        // On macOS: fails because display ID 999999 does not exist.
        // On other platforms: returns "only supported on macOS" error.
        let mut source = make_source(1170, 2532);
        let result = source.start();
        assert!(result.is_err());
    }

    #[test]
    fn test_ios_source_not_active_after_failed_start() {
        let mut source = make_source(1170, 2532);
        let _ = source.start();
        assert!(!source.is_active());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_ios_source_name_contains_device_id() {
        let source = IosCaptureSource::new("999999".to_string(), 1170, 2532).unwrap();
        assert_eq!(source.name(), "ios-999999");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_ios_source_device_id_accessor() {
        let source = IosCaptureSource::new("123456".to_string(), 1920, 1080).unwrap();
        assert_eq!(source.device_id(), "123456");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_ios_source_new_invalid_id_returns_err() {
        // Non-numeric device IDs should fail at construction time
        let result = IosCaptureSource::new("not-a-number".to_string(), 1170, 2532);
        assert!(result.is_err());
        let err = result.err().unwrap();
        assert!(err.contains("Invalid device ID"), "Expected parse error, got: {}", err);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_ios_source_double_stop_ok() {
        let mut source = IosCaptureSource::new("999999".to_string(), 1170, 2532).unwrap();
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