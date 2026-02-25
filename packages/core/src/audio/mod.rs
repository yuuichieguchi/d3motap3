#[cfg(target_os = "macos")]
pub mod macos;

/// Audio capture configuration.
#[derive(Debug, Clone)]
pub struct AudioConfig {
    pub capture_system_audio: bool,
    pub capture_microphone: bool,
    pub microphone_device_id: Option<String>,
    pub sample_rate: u32,
    pub channel_count: u32,
}

impl Default for AudioConfig {
    fn default() -> Self {
        Self {
            capture_system_audio: false,
            capture_microphone: false,
            microphone_device_id: None,
            sample_rate: 48000,
            channel_count: 2,
        }
    }
}

/// Information about an audio input device (microphone).
#[derive(Debug, Clone)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

/// List available audio input devices on the system.
#[cfg(target_os = "macos")]
pub fn list_audio_input_devices() -> Vec<AudioDeviceInfo> {
    screencapturekit::audio_devices::AudioInputDevice::list()
        .into_iter()
        .map(|d| AudioDeviceInfo {
            id: d.id,
            name: d.name,
            is_default: d.is_default,
        })
        .collect()
}

#[cfg(not(target_os = "macos"))]
pub fn list_audio_input_devices() -> Vec<AudioDeviceInfo> {
    Vec::new()
}
