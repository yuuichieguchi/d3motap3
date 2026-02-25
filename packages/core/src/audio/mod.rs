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
    /// Number of audio channels (e.g. 2 for stereo).
    pub channel_count: u32,
}

impl Default for AudioConfig {
    fn default() -> Self {
        Self {
            capture_system_audio: false,
            capture_microphone: false,
            microphone_device_id: None,
            sample_rate: 48_000,
            channel_count: 2,
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
