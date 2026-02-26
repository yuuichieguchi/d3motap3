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

/// Snap a computed sample rate to the nearest standard audio sample rate.
pub fn round_to_standard_rate(rate: f64) -> u32 {
    if !rate.is_finite() || rate <= 0.0 {
        return 48000;
    }
    const STANDARD_RATES: &[u32] = &[
        8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 176400, 192000,
    ];
    STANDARD_RATES
        .iter()
        .copied()
        .min_by_key(|&r| ((rate - r as f64).abs() * 1000.0) as u64)
        .unwrap_or(48000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_round_to_standard_rate_exact_44100() {
        assert_eq!(round_to_standard_rate(44100.0), 44100);
    }

    #[test]
    fn test_round_to_standard_rate_exact_48000() {
        assert_eq!(round_to_standard_rate(48000.0), 48000);
    }

    #[test]
    fn test_round_to_standard_rate_near_44100() {
        // 44050.0 is closer to 44100 than to 32000
        assert_eq!(round_to_standard_rate(44050.0), 44100);
    }

    #[test]
    fn test_round_to_standard_rate_near_48000() {
        assert_eq!(round_to_standard_rate(47800.0), 48000);
    }

    #[test]
    fn test_round_to_standard_rate_between_44100_48000() {
        // 46000.0 is closer to 48000 (distance 2000) than 44100 (distance 1900)
        // Actually 46000 - 44100 = 1900, 48000 - 46000 = 2000, so closer to 44100
        assert_eq!(round_to_standard_rate(46000.0), 44100);
    }

    #[test]
    fn test_round_to_standard_rate_low_rate() {
        // 8100.0 is closer to 8000 (distance 100) than to 11025 (distance 2925)
        assert_eq!(round_to_standard_rate(8100.0), 8000);
    }

    #[test]
    fn test_round_to_standard_rate_high_rate() {
        // 96500.0 is closer to 96000 (distance 500) than to 88200 (distance 8300)
        assert_eq!(round_to_standard_rate(96500.0), 96000);
    }

    #[test]
    fn test_round_to_standard_rate_nan() {
        assert_eq!(round_to_standard_rate(f64::NAN), 48000);
    }

    #[test]
    fn test_round_to_standard_rate_infinity() {
        assert_eq!(round_to_standard_rate(f64::INFINITY), 48000);
    }

    #[test]
    fn test_round_to_standard_rate_neg_infinity() {
        assert_eq!(round_to_standard_rate(f64::NEG_INFINITY), 48000);
    }

    #[test]
    fn test_round_to_standard_rate_zero() {
        assert_eq!(round_to_standard_rate(0.0), 48000);
    }

    #[test]
    fn test_round_to_standard_rate_negative() {
        assert_eq!(round_to_standard_rate(-44100.0), 48000);
    }
}
