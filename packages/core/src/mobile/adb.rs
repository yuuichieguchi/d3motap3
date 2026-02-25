use std::path::PathBuf;
use std::process::{Command, Stdio};

#[derive(Debug, Clone)]
pub struct AdbDevice {
    pub serial: String,
    pub model: String,
    pub state: String,
}

/// Find adb binary on the system.
pub fn find_adb() -> Result<PathBuf, String> {
    // 1. Check ANDROID_HOME / ANDROID_SDK_ROOT environment variables first
    for env_var in &["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        if let Ok(sdk_path) = std::env::var(env_var) {
            let adb_path = PathBuf::from(&sdk_path).join("platform-tools").join("adb");
            if is_valid_adb(&adb_path) {
                return Ok(adb_path);
            }
        }
    }

    // 2. Check well-known paths (with home directory expansion)
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates: Vec<PathBuf> = vec![
        PathBuf::from("/opt/homebrew/bin/adb"),
        PathBuf::from("/usr/local/bin/adb"),
        PathBuf::from("/usr/bin/adb"),
        PathBuf::from(&home).join("Library/Android/sdk/platform-tools/adb"), // macOS Android Studio
        PathBuf::from(&home).join("Android/Sdk/platform-tools/adb"),         // Linux Android Studio
    ];

    for candidate in &candidates {
        if is_valid_adb(candidate) {
            return Ok(candidate.clone());
        }
    }

    // 3. Try bare "adb" command (relies on PATH)
    let bare = PathBuf::from("adb");
    if is_valid_adb(&bare) {
        return Ok(bare);
    }

    Err("ADB not found. Install Android SDK platform-tools.".to_string())
}

fn is_valid_adb(path: &PathBuf) -> bool {
    Command::new(path)
        .arg("version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

pub fn is_adb_available() -> bool {
    find_adb().is_ok()
}

/// Parse `adb devices -l` output into AdbDevice list.
pub fn parse_devices_output(output: &str) -> Vec<AdbDevice> {
    output.lines()
        .skip(1) // skip "List of devices attached" header
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 2 {
                return None;
            }
            let serial = parts[0].to_string();
            let state = parts[1].to_string();
            let model = parts.iter()
                .find(|p| p.starts_with("model:"))
                .map(|p| p.trim_start_matches("model:").to_string())
                .unwrap_or_default();
            Some(AdbDevice { serial, model, state })
        })
        .collect()
}

/// List connected ADB devices.
pub fn list_devices() -> Result<Vec<AdbDevice>, String> {
    let adb = find_adb()?;
    let output = Command::new(adb.as_os_str())
        .args(["devices", "-l"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map_err(|e| format!("Failed to run adb: {}", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_devices_output(&stdout))
}

/// Parse `adb shell wm size` output: "Physical size: 1080x2400"
pub fn parse_resolution_output(output: &str) -> Result<(u32, u32), String> {
    for line in output.lines() {
        if let Some(size_str) = line.strip_prefix("Physical size: ") {
            let parts: Vec<&str> = size_str.trim().split('x').collect();
            if parts.len() == 2 {
                let w = parts[0].parse::<u32>().map_err(|e| e.to_string())?;
                let h = parts[1].parse::<u32>().map_err(|e| e.to_string())?;
                return Ok((w, h));
            }
        }
    }
    Err("Could not parse device resolution".to_string())
}

/// Get screen resolution for a specific device.
pub fn get_device_resolution(serial: &str) -> Result<(u32, u32), String> {
    let adb = find_adb()?;
    let output = Command::new(adb.as_os_str())
        .args(["-s", serial, "shell", "wm", "size"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map_err(|e| format!("Failed to run adb: {}", e))?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_resolution_output(&stdout)
}

/// Wake the device screen if it is off (best-effort).
pub fn wake_screen(serial: &str) {
    let adb = match find_adb() {
        Ok(path) => path,
        Err(e) => {
            eprintln!("wake_screen: adb not found: {}", e);
            return;
        }
    };
    let status = Command::new(adb.as_os_str())
        .args(["-s", serial, "shell", "input", "keyevent", "KEYCODE_WAKEUP"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    match status {
        Ok(s) if s.success() => {}
        Ok(s) => eprintln!("wake_screen: adb keyevent exited with {}", s),
        Err(e) => eprintln!("wake_screen: failed to run adb: {}", e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_devices_single() {
        let output = "List of devices attached\nR5CR1234567     device usb:1-1 product:beyond1 model:SM_G973F transport_id:1\n\n";
        let devices = parse_devices_output(output);
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].serial, "R5CR1234567");
        assert_eq!(devices[0].state, "device");
        assert_eq!(devices[0].model, "SM_G973F");
    }

    #[test]
    fn test_parse_devices_multiple() {
        let output = "List of devices attached\nemulator-5554   device product:sdk_gphone64 model:sdk_gphone64_arm64 transport_id:1\nR5CR1234567     offline\n\n";
        let devices = parse_devices_output(output);
        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].serial, "emulator-5554");
        assert_eq!(devices[0].state, "device");
        assert_eq!(devices[1].serial, "R5CR1234567");
        assert_eq!(devices[1].state, "offline");
        assert_eq!(devices[1].model, "");
    }

    #[test]
    fn test_parse_devices_empty() {
        let output = "List of devices attached\n\n";
        let devices = parse_devices_output(output);
        assert!(devices.is_empty());
    }

    #[test]
    fn test_parse_resolution() {
        let output = "Physical size: 1080x2400\n";
        let (w, h) = parse_resolution_output(output).unwrap();
        assert_eq!(w, 1080);
        assert_eq!(h, 2400);
    }

    #[test]
    fn test_parse_resolution_with_override() {
        let output = "Physical size: 1080x2400\nOverride size: 540x1200\n";
        let (w, h) = parse_resolution_output(output).unwrap();
        assert_eq!(w, 1080);
        assert_eq!(h, 2400);
    }

    #[test]
    fn test_parse_resolution_invalid() {
        let result = parse_resolution_output("no size info");
        assert!(result.is_err());
    }

    #[test]
    fn test_wake_screen_no_panic_without_device() {
        wake_screen("nonexistent-device-12345");
    }
}
