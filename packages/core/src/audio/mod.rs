//! Audio recording configuration and device enumeration.
//!
//! Provides [`AudioConfig`] for controlling audio capture settings and
//! [`list_audio_input_devices`] for enumerating available microphone devices
//! via the `screencapturekit` crate's AVFoundation bindings.

pub mod system;

use screencapturekit::audio_devices::AudioInputDevice;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// Configuration for audio capture during a recording session.
///
/// Controls whether system audio and/or microphone input is captured, along
/// with the target sample rate and channel count.
#[derive(Debug, Clone)]
pub struct AudioConfig {
    /// Capture desktop / system audio output.
    pub capture_system_audio: bool,
    /// Capture microphone input.
    pub capture_microphone: bool,
    /// Specific microphone device to use. `None` selects the system default.
    pub microphone_device_id: Option<String>,
    /// Sample rate in Hz (e.g. 48000).
    pub sample_rate: u32,
    /// Number of channels for system audio (e.g. 2 for stereo).
    pub channel_count: u32,
    /// Number of channels for microphone audio (e.g. 1 for mono).
    pub mic_channel_count: u32,
}

impl Default for AudioConfig {
    fn default() -> Self {
        Self {
            capture_system_audio: false,
            capture_microphone: false,
            microphone_device_id: None,
            sample_rate: 48_000,
            channel_count: 2,
            mic_channel_count: 1,
        }
    }
}

impl AudioConfig {
    /// Returns `true` if at least one audio capture source is enabled.
    pub fn is_enabled(&self) -> bool {
        self.capture_system_audio || self.capture_microphone
    }
}

// ---------------------------------------------------------------------------
// Device enumeration
// ---------------------------------------------------------------------------

/// Metadata about a single audio input device (microphone).
#[derive(Debug, Clone)]
pub struct AudioDeviceInfo {
    /// Unique device identifier.
    pub id: String,
    /// Human-readable device name.
    pub name: String,
    /// Whether this device is the system default input.
    pub is_default: bool,
}

/// List all available audio input (microphone) devices.
///
/// Delegates to `screencapturekit::audio_devices::AudioInputDevice::list()`
/// and maps the results into [`AudioDeviceInfo`].
pub fn list_audio_input_devices() -> Vec<AudioDeviceInfo> {
    AudioInputDevice::list()
        .into_iter()
        .map(|d| AudioDeviceInfo {
            id: d.id,
            name: d.name,
            is_default: d.is_default,
        })
        .collect()
}

// ---------------------------------------------------------------------------
// CoreAudio: default output device sample rate
// ---------------------------------------------------------------------------

/// Query the default audio output device's nominal sample rate via CoreAudio.
///
/// Returns `None` if the query fails (e.g. no audio output device available).
/// This is used as a fallback for system audio recording, where ScreenCaptureKit's
/// CMFormatDescription may report the configured rate rather than the actual
/// hardware rate.
pub fn get_default_output_sample_rate() -> Option<u32> {
    #[cfg(target_os = "macos")]
    {
        core_audio_query::default_output_sample_rate()
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

#[cfg(target_os = "macos")]
mod core_audio_query {
    use std::os::raw::c_void;

    type OSStatus = i32;
    type AudioObjectID = u32;

    #[repr(C)]
    struct AudioObjectPropertyAddress {
        m_selector: u32,
        m_scope: u32,
        m_element: u32,
    }

    // FourCharCode constants
    const AUDIO_HARDWARE_PROPERTY_DEFAULT_OUTPUT_DEVICE: u32 = 0x646F7574; // 'dout'
    const AUDIO_DEVICE_PROPERTY_NOMINAL_SAMPLE_RATE: u32 = 0x6E737274;     // 'nsrt'
    const AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL: u32 = 0x676C6F62;           // 'glob'
    const AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN: u32 = 0;
    const AUDIO_OBJECT_SYSTEM_OBJECT: AudioObjectID = 1;

    #[link(name = "CoreAudio", kind = "framework")]
    extern "C" {
        fn AudioObjectGetPropertyData(
            in_object_id: AudioObjectID,
            in_address: *const AudioObjectPropertyAddress,
            in_qualifier_data_size: u32,
            in_qualifier_data: *const c_void,
            io_data_size: *mut u32,
            out_data: *mut c_void,
        ) -> OSStatus;
    }

    pub(super) fn default_output_sample_rate() -> Option<u32> {
        unsafe {
            // Step 1: Get the default output device ID
            let address = AudioObjectPropertyAddress {
                m_selector: AUDIO_HARDWARE_PROPERTY_DEFAULT_OUTPUT_DEVICE,
                m_scope: AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
                m_element: AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
            };
            let mut device_id: AudioObjectID = 0;
            let mut size = std::mem::size_of::<AudioObjectID>() as u32;

            let status = AudioObjectGetPropertyData(
                AUDIO_OBJECT_SYSTEM_OBJECT,
                &address,
                0,
                std::ptr::null(),
                &mut size,
                &mut device_id as *mut _ as *mut c_void,
            );
            if status != 0 || device_id == 0 {
                eprintln!("[audio] CoreAudio: failed to get default output device (status={})", status);
                return None;
            }

            // Step 2: Get the device's nominal sample rate
            let rate_address = AudioObjectPropertyAddress {
                m_selector: AUDIO_DEVICE_PROPERTY_NOMINAL_SAMPLE_RATE,
                m_scope: AUDIO_OBJECT_PROPERTY_SCOPE_GLOBAL,
                m_element: AUDIO_OBJECT_PROPERTY_ELEMENT_MAIN,
            };
            let mut sample_rate: f64 = 0.0;
            let mut rate_size = std::mem::size_of::<f64>() as u32;

            let status = AudioObjectGetPropertyData(
                device_id,
                &rate_address,
                0,
                std::ptr::null(),
                &mut rate_size,
                &mut sample_rate as *mut _ as *mut c_void,
            );
            if status != 0 || !sample_rate.is_finite() || sample_rate <= 0.0 {
                eprintln!("[audio] CoreAudio: failed to get sample rate (status={})", status);
                return None;
            }

            eprintln!("[audio] CoreAudio: default output sample rate = {} Hz", sample_rate);
            Some(sample_rate.round() as u32)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_default_output_sample_rate() {
        // On macOS CI/dev machines, there should be a default output device.
        let rate = get_default_output_sample_rate();
        // Rate may be None in headless environments, but if present, should be reasonable.
        if let Some(r) = rate {
            assert!(r >= 8000 && r <= 384000, "Sample rate {} is out of reasonable range", r);
        }
    }
}
