//! iOS device capture via CoreMediaIO + AVFoundation (macOS only).
//!
//! USB-connected iOS devices appear as AVFoundation "muxed" capture devices.
//! They require CoreMediaIO's `AllowScreenCaptureDevices` property to be
//! enabled before they become visible to AVFoundation.

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

    use objc::runtime::{Class, Object, Sel, BOOL, YES};
    use objc::{class, msg_send, sel, sel_impl};
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::{Arc, Mutex, Once};

    /// Keywords used to identify iOS devices among muxed capture devices.
    const IOS_KEYWORDS: &[&str] = &["iPhone", "iPad", "iPod"];

    // ---- CoreMediaIO FFI ----

    #[link(name = "CoreMediaIO", kind = "framework")]
    extern "C" {
        fn CMIOObjectSetPropertyData(
            object_id: u32,
            address: *const CMIOObjectPropertyAddress,
            qualifier_data_size: u32,
            qualifier_data: *const c_void,
            data_size: u32,
            data: *const c_void,
        ) -> i32;
    }

    #[repr(C)]
    struct CMIOObjectPropertyAddress {
        selector: u32,
        scope: u32,
        element: u32,
    }

    const CMIO_OBJECT_SYSTEM_OBJECT: u32 = 1;
    const CMIO_HARDWARE_PROPERTY_ALLOW_SCREEN_CAPTURE_DEVICES: u32 = 0x79657320; // 'yes '
    const CMIO_OBJECT_PROPERTY_SCOPE_GLOBAL: u32 = 0x676C6F62; // 'glob'
    const CMIO_OBJECT_PROPERTY_ELEMENT_MAIN: u32 = 0x6D61696E; // 'main'

    // ---- CoreMedia / CoreVideo FFI (re-exported from nokhwa deps) ----

    type CMSampleBufferRef = *mut c_void;
    type CVImageBufferRef = *mut c_void;

    extern "C" {
        fn CMSampleBufferGetImageBuffer(sbuf: CMSampleBufferRef) -> CVImageBufferRef;
        fn CVPixelBufferLockBaseAddress(buf: CVImageBufferRef, flags: u64) -> i32;
        fn CVPixelBufferUnlockBaseAddress(buf: CVImageBufferRef, flags: u64) -> i32;
        fn CVPixelBufferGetBaseAddress(buf: CVImageBufferRef) -> *mut u8;
        fn CVPixelBufferGetDataSize(buf: CVImageBufferRef) -> usize;
        fn CVPixelBufferGetWidth(buf: CVImageBufferRef) -> usize;
        fn CVPixelBufferGetHeight(buf: CVImageBufferRef) -> usize;
        fn CVPixelBufferGetBytesPerRow(buf: CVImageBufferRef) -> usize;
    }

    // ---- libdispatch FFI ----

    extern "C" {
        fn dispatch_queue_create(label: *const i8, attr: *const c_void) -> *mut c_void;
    }

    // ---- Enable screen capture devices (one-time) ----

    static ENABLE_SCREEN_CAPTURE: Once = Once::new();

    fn ensure_screen_capture_enabled() {
        ENABLE_SCREEN_CAPTURE.call_once(|| unsafe {
            let mut allow: u32 = 1;
            let address = CMIOObjectPropertyAddress {
                selector: CMIO_HARDWARE_PROPERTY_ALLOW_SCREEN_CAPTURE_DEVICES,
                scope: CMIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
                element: CMIO_OBJECT_PROPERTY_ELEMENT_MAIN,
            };
            CMIOObjectSetPropertyData(
                CMIO_OBJECT_SYSTEM_OBJECT,
                &address,
                0,
                std::ptr::null(),
                std::mem::size_of::<u32>() as u32,
                &mut allow as *mut u32 as *const c_void,
            );
        });
    }

    // ---- AVFoundation helpers via objc ----

    /// Get an NSString constant from AVFoundation by symbol name.
    fn av_media_type_muxed() -> *mut Object {
        extern "C" {
            #[link_name = "\x01_AVMediaTypeMuxed"]
            static AVMediaTypeMuxed: *mut Object;
        }
        unsafe { AVMediaTypeMuxed }
    }

    fn nsstring_to_string(nsstring: *mut Object) -> String {
        if nsstring.is_null() {
            return String::new();
        }
        unsafe {
            let utf8: *const i8 = msg_send![nsstring, UTF8String];
            if utf8.is_null() {
                return String::new();
            }
            std::ffi::CStr::from_ptr(utf8)
                .to_string_lossy()
                .into_owned()
        }
    }

    fn nsstring_from_str(s: &str) -> *mut Object {
        let cstr = std::ffi::CString::new(s).unwrap();
        unsafe {
            let cls = class!(NSString);
            msg_send![cls, stringWithUTF8String: cstr.as_ptr()]
        }
    }

    /// List iOS devices visible as AVFoundation muxed capture devices.
    pub fn list_ios_devices() -> Result<Vec<IosDevice>, String> {
        ensure_screen_capture_enabled();

        let devices = unsafe {
            // Create discovery session for muxed devices
            let external_type: *mut Object = {
                let s = nsstring_from_str("AVCaptureDeviceTypeExternal");
                s
            };
            let type_array: *mut Object = msg_send![
                class!(NSArray),
                arrayWithObject: external_type
            ];

            let media_type = av_media_type_muxed();

            let discovery_cls = class!(AVCaptureDeviceDiscoverySession);
            let discovery: *mut Object = msg_send![
                discovery_cls,
                discoverySessionWithDeviceTypes: type_array
                mediaType: media_type
                position: 0i64  // AVCaptureDevicePositionUnspecified
            ];

            if discovery.is_null() {
                return Ok(Vec::new());
            }

            let av_devices: *mut Object = msg_send![discovery, devices];
            if av_devices.is_null() {
                return Ok(Vec::new());
            }

            let count: usize = msg_send![av_devices, count];
            let mut result = Vec::new();

            for i in 0..count {
                let device: *mut Object = msg_send![av_devices, objectAtIndex: i];
                if device.is_null() {
                    continue;
                }

                let name_ns: *mut Object = msg_send![device, localizedName];
                let name = nsstring_to_string(name_ns);

                let model_ns: *mut Object = msg_send![device, modelID];
                let model = nsstring_to_string(model_ns);

                let uid_ns: *mut Object = msg_send![device, uniqueID];
                let uid = nsstring_to_string(uid_ns);

                // Filter: only iOS devices (by name keywords or model)
                let is_ios =
                    IOS_KEYWORDS.iter().any(|kw| name.contains(kw)) || model.contains("iOS Device");

                if is_ios {
                    result.push(IosDevice {
                        device_id: uid,
                        name,
                        model,
                    });
                }
            }

            result
        };

        Ok(devices)
    }

    // ---- Frame callback delegate ----

    /// Shared state for the frame callback delegate.
    struct CallbackState {
        latest_frame: Arc<Mutex<Option<Arc<CapturedFrame>>>>,
        is_active: Arc<AtomicBool>,
        frame_count: Arc<AtomicU64>,
    }

    /// Register the Objective-C delegate class once.
    static REGISTER_DELEGATE: Once = Once::new();
    static mut DELEGATE_CLASS_NAME: &str = "D3motap3IosCaptureDelegate";

    fn ensure_delegate_registered() {
        REGISTER_DELEGATE.call_once(|| {
            use objc::declare::ClassDecl;

            let superclass = class!(NSObject);
            let mut decl = ClassDecl::new(unsafe { DELEGATE_CLASS_NAME }, superclass).unwrap();

            // Add ivar to hold a pointer to CallbackState
            decl.add_ivar::<*mut c_void>("_callbackState");

            // captureOutput:didOutputSampleBuffer:fromConnection:
            extern "C" fn capture_output(
                this: &mut Object,
                _sel: Sel,
                _output: *mut Object,
                sample_buffer: CMSampleBufferRef,
                _connection: *mut Object,
            ) {
                unsafe {
                    let state_ptr: *mut c_void = *this.get_ivar("_callbackState");
                    if state_ptr.is_null() {
                        return;
                    }
                    let state = &*(state_ptr as *const CallbackState);

                    if !state.is_active.load(Ordering::Relaxed) {
                        return;
                    }

                    let image_buffer = CMSampleBufferGetImageBuffer(sample_buffer);
                    if image_buffer.is_null() {
                        return;
                    }

                    CVPixelBufferLockBaseAddress(image_buffer, 1); // kCVPixelBufferLock_ReadOnly

                    let data_ptr = CVPixelBufferGetBaseAddress(image_buffer);
                    let data_size = CVPixelBufferGetDataSize(image_buffer);
                    let width = CVPixelBufferGetWidth(image_buffer);
                    let height = CVPixelBufferGetHeight(image_buffer);
                    let bytes_per_row = CVPixelBufferGetBytesPerRow(image_buffer);

                    if !data_ptr.is_null() && data_size > 0 && width > 0 && height > 0 {
                        let data = std::slice::from_raw_parts(data_ptr, data_size).to_vec();

                        let frame = Arc::new(CapturedFrame {
                            data,
                            width,
                            height,
                            bytes_per_row,
                            timestamp_ms: 0.0,
                        });

                        if let Ok(mut latest) = state.latest_frame.lock() {
                            *latest = Some(frame);
                        }
                        state.frame_count.fetch_add(1, Ordering::Relaxed);
                    }

                    CVPixelBufferUnlockBaseAddress(image_buffer, 1);
                }
            }

            // captureOutput:didDropSampleBuffer:fromConnection:
            extern "C" fn capture_drop(
                _this: &mut Object,
                _sel: Sel,
                _output: *mut Object,
                _sample_buffer: CMSampleBufferRef,
                _connection: *mut Object,
            ) {
                // Intentionally empty — dropped frames are expected
            }

            unsafe {
                let capture_sel = sel!(captureOutput:didOutputSampleBuffer:fromConnection:);
                decl.add_method(
                    capture_sel,
                    capture_output
                        as extern "C" fn(
                            &mut Object,
                            Sel,
                            *mut Object,
                            CMSampleBufferRef,
                            *mut Object,
                        ),
                );

                let drop_sel = sel!(captureOutput:didDropSampleBuffer:fromConnection:);
                decl.add_method(
                    drop_sel,
                    capture_drop
                        as extern "C" fn(
                            &mut Object,
                            Sel,
                            *mut Object,
                            CMSampleBufferRef,
                            *mut Object,
                        ),
                );
            }

            decl.register();
        });
    }

    // ---- IosCaptureSource ----

    pub struct IosCaptureSource {
        device_uid: String,
        width: u32,
        height: u32,
        source_name: String,
        latest_frame: Arc<Mutex<Option<Arc<CapturedFrame>>>>,
        is_active: Arc<AtomicBool>,
        frame_count: Arc<AtomicU64>,
        // Objective-C objects (retained)
        session: Option<*mut Object>,
        delegate: Option<*mut Object>,
        // Prevent CallbackState from being dropped while delegate uses it
        _callback_state: Option<Box<CallbackState>>,
    }

    // AVCaptureSession and related ObjC objects are thread-safe when accessed
    // through synchronized methods. We guard mutation through &mut self.
    unsafe impl Send for IosCaptureSource {}

    impl IosCaptureSource {
        pub fn new(device_id: String, width: u32, height: u32) -> Result<Self, String> {
            // Validate the device_id is not empty
            if device_id.is_empty() {
                return Err("Device ID cannot be empty".to_string());
            }

            let name = format!("ios-{}", device_id);
            Ok(Self {
                device_uid: device_id,
                width,
                height,
                source_name: name,
                latest_frame: Arc::new(Mutex::new(None)),
                is_active: Arc::new(AtomicBool::new(false)),
                frame_count: Arc::new(AtomicU64::new(0)),
                session: None,
                delegate: None,
                _callback_state: None,
            })
        }

        pub fn device_id(&self) -> &str {
            &self.device_uid
        }
    }

    impl CaptureSource for IosCaptureSource {
        fn start(&mut self) -> Result<(), String> {
            if self.is_active.load(Ordering::Relaxed) {
                return Err("Already active".to_string());
            }

            ensure_screen_capture_enabled();
            ensure_delegate_registered();

            unsafe {
                // Find device by UID
                let uid_ns = nsstring_from_str(&self.device_uid);
                let device: *mut Object =
                    msg_send![class!(AVCaptureDevice), deviceWithUniqueID: uid_ns];
                if device.is_null() {
                    return Err(format!(
                        "iOS device '{}' not found. Is it connected and trusted?",
                        self.device_uid
                    ));
                }

                // Create session
                let session: *mut Object = msg_send![class!(AVCaptureSession), alloc];
                let session: *mut Object = msg_send![session, init];

                let _: () = msg_send![session, beginConfiguration];

                // Create input
                let mut err_ptr: *mut Object = std::ptr::null_mut();
                let input: *mut Object = {
                    let alloc: *mut Object = msg_send![class!(AVCaptureDeviceInput), alloc];
                    msg_send![alloc, initWithDevice: device error: &mut err_ptr]
                };
                if input.is_null() {
                    let _: () = msg_send![session, release];
                    return Err("Failed to create capture input for iOS device".to_string());
                }

                let can_add_input: BOOL = msg_send![session, canAddInput: input];
                if can_add_input != YES {
                    let _: () = msg_send![input, release];
                    let _: () = msg_send![session, release];
                    return Err("Cannot add iOS device input to capture session".to_string());
                }
                let _: () = msg_send![session, addInput: input];

                // Create video data output
                let output: *mut Object = msg_send![class!(AVCaptureVideoDataOutput), new];

                // Set BGRA pixel format
                let format_key = nsstring_from_str("PixelFormatType");
                let bgra_value: *mut Object = msg_send![
                    class!(NSNumber),
                    numberWithUnsignedInt: 0x42475241u32  // kCVPixelFormatType_32BGRA
                ];
                let settings: *mut Object = msg_send![
                    class!(NSDictionary),
                    dictionaryWithObject: bgra_value
                    forKey: format_key
                ];
                let _: () = msg_send![output, setVideoSettings: settings];

                // Create dispatch queue
                let queue_label = std::ffi::CString::new("d3motap3.ios.capture").unwrap();
                let queue = dispatch_queue_create(queue_label.as_ptr(), std::ptr::null());

                // Create delegate
                let delegate_cls =
                    Class::get(DELEGATE_CLASS_NAME).ok_or("Delegate class not registered")?;
                let delegate: *mut Object = msg_send![delegate_cls, alloc];
                let delegate: *mut Object = msg_send![delegate, init];

                // Set up callback state
                let callback_state = Box::new(CallbackState {
                    latest_frame: Arc::clone(&self.latest_frame),
                    is_active: Arc::clone(&self.is_active),
                    frame_count: Arc::clone(&self.frame_count),
                });
                let state_ptr = &*callback_state as *const CallbackState as *mut c_void;
                (*delegate).set_ivar("_callbackState", state_ptr);

                // Set delegate on output
                let _: () = msg_send![
                    output,
                    setSampleBufferDelegate: delegate
                    queue: queue
                ];

                let can_add_output: BOOL = msg_send![session, canAddOutput: output];
                if can_add_output != YES {
                    let _: () = msg_send![delegate, release];
                    let _: () = msg_send![input, release];
                    let _: () = msg_send![session, release];
                    return Err("Cannot add video output to capture session".to_string());
                }
                let _: () = msg_send![session, addOutput: output];

                let _: () = msg_send![session, commitConfiguration];

                // Start
                self.frame_count.store(0, Ordering::Relaxed);
                self.is_active.store(true, Ordering::Relaxed);
                let _: () = msg_send![session, startRunning];

                self.session = Some(session);
                self.delegate = Some(delegate);
                self._callback_state = Some(callback_state);

                Ok(())
            }
        }

        fn stop(&mut self) -> Result<(), String> {
            self.is_active.store(false, Ordering::Relaxed);

            if let Some(session) = self.session.take() {
                unsafe {
                    let _: () = msg_send![session, stopRunning];
                    let _: () = msg_send![session, release];
                }
            }

            if let Some(delegate) = self.delegate.take() {
                unsafe {
                    // Clear the callback state pointer before releasing
                    let null_ptr: *mut c_void = std::ptr::null_mut();
                    (*delegate).set_ivar("_callbackState", null_ptr);
                    let _: () = msg_send![delegate, release];
                }
            }

            self._callback_state = None;

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
            let _ = self.stop();
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

    #[cfg(target_os = "macos")]
    fn make_source(width: u32, height: u32) -> IosCaptureSource {
        IosCaptureSource::new("test-uid-999".to_string(), width, height).unwrap()
    }

    #[cfg(not(target_os = "macos"))]
    fn make_source(width: u32, height: u32) -> IosCaptureSource {
        IosCaptureSource::new("test-uid-999".to_string(), width, height)
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
        // On macOS: fails because "test-uid-999" is not a real device UID.
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
        let source = IosCaptureSource::new("my-uid".to_string(), 1170, 2532).unwrap();
        assert_eq!(source.name(), "ios-my-uid");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_ios_source_device_id_accessor() {
        let source = IosCaptureSource::new("my-uid".to_string(), 1920, 1080).unwrap();
        assert_eq!(source.device_id(), "my-uid");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_ios_source_new_empty_id_returns_err() {
        let result = IosCaptureSource::new("".to_string(), 1170, 2532);
        assert!(result.is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_ios_source_double_stop_ok() {
        let mut source = IosCaptureSource::new("test-uid".to_string(), 1170, 2532).unwrap();
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
