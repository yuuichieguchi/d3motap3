//! Script execution engine.
//!
//! Orchestrates YAML-driven demo recordings: parses the script, sets up
//! capture sources, starts V2 recording, executes steps sequentially,
//! then stops recording and cleans up.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::capture;
use crate::capture::source::{CaptureSource, SourceId};
use crate::capture::terminal;
use crate::compositor;
use crate::recording;

use super::parser;
use super::types::*;
use super::wait;

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------

static SCRIPT_STATUS: LazyLock<Mutex<ScriptStatus>> =
    LazyLock::new(|| Mutex::new(ScriptStatus::Idle));
static SCRIPT_CANCEL: AtomicBool = AtomicBool::new(false);
static SCRIPT_THREAD: LazyLock<Mutex<Option<thread::JoinHandle<()>>>> =
    LazyLock::new(|| Mutex::new(None));

// ---------------------------------------------------------------------------
// ScriptStatus — reported back to the TS layer
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ScriptStatus {
    Idle,
    Parsing,
    SettingUp,
    Running {
        current_step: usize,
        total_steps: usize,
        step_description: String,
    },
    Stopping,
    Completed {
        output_path: String,
        duration_ms: u64,
    },
    Failed {
        error: String,
        step: Option<usize>,
    },
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Start script execution in a background thread.
pub fn run_script(yaml_path: String, output_path: String) -> Result<(), String> {
    // Hold the lock for both the check and the state transition to prevent races.
    {
        let mut status = SCRIPT_STATUS
            .lock()
            .map_err(|e| format!("Status lock error: {}", e))?;
        if !matches!(
            *status,
            ScriptStatus::Idle | ScriptStatus::Completed { .. } | ScriptStatus::Failed { .. }
        ) {
            return Err("Script already running".to_string());
        }
        SCRIPT_CANCEL.store(false, Ordering::Relaxed);
        *status = ScriptStatus::Parsing;
    }

    let handle = thread::spawn(move || {
        match execute_script(&yaml_path, &output_path) {
            Ok(()) => {} // Status already set to Completed inside execute_script
            Err(e) => {
                set_status(ScriptStatus::Failed {
                    error: e,
                    step: None,
                });
            }
        }
    });

    if let Ok(mut thread_guard) = SCRIPT_THREAD.lock() {
        *thread_guard = Some(handle);
    }

    Ok(())
}

/// Cancel a running script.
pub fn cancel_script() -> Result<(), String> {
    SCRIPT_CANCEL.store(true, Ordering::Relaxed);
    Ok(())
}

/// Get current script execution status.
pub fn get_script_status() -> ScriptStatus {
    SCRIPT_STATUS
        .lock()
        .ok()
        .map(|s| s.clone())
        .unwrap_or(ScriptStatus::Idle)
}

/// Get current script execution status as a JSON string.
pub fn get_script_status_json() -> String {
    serde_json::to_string(&get_script_status())
        .unwrap_or_else(|_| r#"{"status":"idle"}"#.to_string())
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn set_status(status: ScriptStatus) {
    if let Ok(mut s) = SCRIPT_STATUS.lock() {
        *s = status;
    }
}

fn is_cancelled() -> bool {
    SCRIPT_CANCEL.load(Ordering::Relaxed)
}

// ---------------------------------------------------------------------------
// Core execution pipeline
// ---------------------------------------------------------------------------

fn execute_script(yaml_path: &str, output_path: &str) -> Result<(), String> {
    let start_time = Instant::now();

    // 1. Parse the YAML script
    set_status(ScriptStatus::Parsing);
    let script = parser::parse_script_file(yaml_path)?;

    if is_cancelled() {
        return Err("Cancelled".to_string());
    }

    // 2. Setup sources
    set_status(ScriptStatus::SettingUp);
    let (width, height) = parser::parse_resolution(&script.metadata.output.resolution)?;
    let fps = script.metadata.output.fps;

    // Map script source id (string) -> runtime SourceId (u32)
    let mut source_map: HashMap<String, SourceId> = HashMap::new();

    for source in &script.setup.sources {
        let source_id = setup_source(source)?;
        source_map.insert(source.id.clone(), source_id);
    }

    if is_cancelled() {
        cleanup_sources(&source_map);
        return Err("Cancelled".to_string());
    }

    // 3. Set initial layout
    let layout = build_layout(&script.setup.initial_layout, &source_map)?;
    recording::set_layout_impl(layout);

    // 4. Wait for first frames to arrive (500ms warm-up)
    thread::sleep(Duration::from_millis(500));

    if is_cancelled() {
        cleanup_sources(&source_map);
        return Err("Cancelled".to_string());
    }

    // 5. Start V2 recording
    recording::start_recording_v2_impl(recording::RecordingConfigV2 {
        output_width: width,
        output_height: height,
        fps,
        output_path: output_path.to_string(),
        format: "mp4".to_string(),
        quality: "high".to_string(),
    })?;

    // 6. Execute steps sequentially
    let total_steps = script.steps.len();
    let mut failed_step = None;

    for (i, step) in script.steps.iter().enumerate() {
        if is_cancelled() {
            break;
        }

        let description = describe_action(&step.action);
        set_status(ScriptStatus::Running {
            current_step: i,
            total_steps,
            step_description: description,
        });

        if let Err(e) = execute_action(&step.action, &source_map) {
            failed_step = Some((i, e));
            break;
        }
    }

    // 7. Stop recording
    set_status(ScriptStatus::Stopping);
    let _result = recording::stop_recording_v2_impl();

    // 8. Cleanup
    if let Ok(mut cap) = recording::ACTIVE_CAPTION.lock() {
        *cap = None;
    }
    cleanup_sources(&source_map);

    // 9. Report final result
    if let Some((step_idx, error)) = failed_step {
        set_status(ScriptStatus::Failed {
            error,
            step: Some(step_idx),
        });
        return Err("Step execution failed".to_string());
    }

    if is_cancelled() {
        set_status(ScriptStatus::Failed {
            error: "Cancelled by user".to_string(),
            step: None,
        });
        return Ok(());
    }

    let duration_ms = start_time.elapsed().as_millis() as u64;
    set_status(ScriptStatus::Completed {
        output_path: output_path.to_string(),
        duration_ms,
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// Source setup and teardown
// ---------------------------------------------------------------------------

fn setup_source(source: &ScriptSource) -> Result<SourceId, String> {
    match source.source_type.as_str() {
        "terminal" => {
            let shell = source
                .shell
                .clone()
                .unwrap_or_else(|| "/bin/zsh".to_string());
            let config = terminal::TerminalConfig {
                shell,
                rows: 24,
                cols: 80,
                width: 960,
                height: 540,
                ..terminal::TerminalConfig::default()
            };
            let mut src = terminal::TerminalCaptureSource::new(config);
            src.start()
                .map_err(|e| format!("Failed to start terminal: {}", e))?;
            let handle = src.take_handle();
            let boxed: Box<dyn capture::CaptureSource> = Box::new(src);
            let id = capture::source::with_registry(|reg| reg.add(boxed))
                .map_err(|e| format!("Registry error: {}", e))?;
            if let Some(h) = handle {
                terminal::register_terminal_handle(id, h);
            }
            Ok(id)
        }
        other => Err(format!("Unsupported source type for script: {}", other)),
    }
}

fn cleanup_sources(source_map: &HashMap<String, SourceId>) {
    for (_, &source_id) in source_map {
        terminal::remove_terminal_handle(source_id);
        let _ = capture::source::with_registry(|reg| reg.remove(source_id));
    }
}

// ---------------------------------------------------------------------------
// Layout construction
// ---------------------------------------------------------------------------

fn build_layout(
    script_layout: &ScriptLayout,
    source_map: &HashMap<String, SourceId>,
) -> Result<compositor::Layout, String> {
    match script_layout.layout_type.as_str() {
        "single" => {
            let primary = script_layout
                .primary
                .as_ref()
                .ok_or_else(|| "Single layout requires 'primary' field".to_string())?;
            let source_id = source_map
                .get(primary)
                .ok_or_else(|| format!("Source '{}' not found", primary))?;
            Ok(compositor::Layout::Single { source: *source_id })
        }
        "side_by_side" => {
            let left = script_layout
                .left
                .as_ref()
                .ok_or_else(|| "SideBySide layout requires 'left' field".to_string())?;
            let right = script_layout
                .right
                .as_ref()
                .ok_or_else(|| "SideBySide layout requires 'right' field".to_string())?;
            let left_id = source_map
                .get(left)
                .ok_or_else(|| format!("Source '{}' not found", left))?;
            let right_id = source_map
                .get(right)
                .ok_or_else(|| format!("Source '{}' not found", right))?;
            Ok(compositor::Layout::SideBySide {
                left: *left_id,
                right: *right_id,
                ratio: 0.5,
            })
        }
        "pip" => {
            let primary = script_layout
                .primary
                .as_ref()
                .ok_or_else(|| "Pip layout requires 'primary' field".to_string())?;
            let primary_id = source_map
                .get(primary)
                .ok_or_else(|| format!("Source '{}' not found", primary))?;
            // Find any other source for the PiP overlay
            let pip_id = source_map
                .iter()
                .find(|(k, _)| k.as_str() != primary.as_str())
                .map(|(_, v)| *v);
            match pip_id {
                Some(pip) => Ok(compositor::Layout::Pip {
                    primary: *primary_id,
                    pip,
                    pip_position: compositor::PipPosition::BottomRight,
                    pip_scale: 0.25,
                }),
                None => Ok(compositor::Layout::Single {
                    source: *primary_id,
                }),
            }
        }
        other => Err(format!("Unsupported layout type: {}", other)),
    }
}

// ---------------------------------------------------------------------------
// Source resolution
// ---------------------------------------------------------------------------

fn resolve_terminal_source(
    source: &Option<String>,
    source_map: &HashMap<String, SourceId>,
) -> Result<SourceId, String> {
    match source {
        Some(name) => source_map
            .get(name)
            .copied()
            .ok_or_else(|| format!("Terminal source '{}' not found", name)),
        None => {
            // Use the first available terminal source
            source_map
                .values()
                .next()
                .copied()
                .ok_or_else(|| "No terminal sources available".to_string())
        }
    }
}

// ---------------------------------------------------------------------------
// Action execution
// ---------------------------------------------------------------------------

fn execute_action(
    action: &ScriptAction,
    source_map: &HashMap<String, SourceId>,
) -> Result<(), String> {
    match action {
        ScriptAction::Terminal {
            source,
            command,
            wait_for,
        } => {
            let source_id = resolve_terminal_source(source, source_map)?;

            // Write command to terminal
            terminal::terminal_write_input(source_id, command.as_bytes())?;

            // Handle waitFor if specified
            if let Some(condition) = wait_for {
                match condition {
                    WaitCondition::Text {
                        pattern,
                        timeout_ms,
                    } => {
                        let rx = terminal::subscribe_output(source_id)?;
                        let result = wait::wait_for_text(
                            &rx,
                            pattern,
                            Duration::from_millis(*timeout_ms),
                        );
                        let _ = terminal::unsubscribe_output(source_id);

                        match result {
                            wait::WaitResult::Matched => {}
                            wait::WaitResult::Timeout => {
                                return Err(format!(
                                    "Timeout waiting for text pattern '{}'",
                                    pattern
                                ));
                            }
                            wait::WaitResult::Disconnected => {
                                return Err(
                                    "Terminal disconnected while waiting".to_string()
                                );
                            }
                        }
                    }
                    WaitCondition::Timeout { timeout_ms } => {
                        interruptible_sleep(Duration::from_millis(*timeout_ms));
                    }
                }
            }

            Ok(())
        }

        ScriptAction::SetLayout {
            layout,
            transition_ms: _,
        } => {
            let compositor_layout = build_layout(layout, source_map)?;
            recording::set_layout_impl(compositor_layout);
            Ok(())
        }

        ScriptAction::Wait { duration_ms } => {
            interruptible_sleep(Duration::from_millis(*duration_ms));
            Ok(())
        }

        ScriptAction::Caption {
            text,
            position,
            duration_ms,
        } => {
            // Set active caption
            if let Ok(mut cap) = recording::ACTIVE_CAPTION.lock() {
                *cap = Some(recording::ActiveCaption {
                    text: text.clone(),
                    position: *position,
                    font_size: 24.0,
                });
            }

            // Wait for duration if specified, then clear
            if let Some(ms) = duration_ms {
                interruptible_sleep(Duration::from_millis(*ms));
                if let Ok(mut cap) = recording::ACTIVE_CAPTION.lock() {
                    *cap = None;
                }
            }
            // If no duration, caption stays until next caption or end

            Ok(())
        }
    }
}

// ---------------------------------------------------------------------------
// Action description (for status reporting)
// ---------------------------------------------------------------------------

fn describe_action(action: &ScriptAction) -> String {
    match action {
        ScriptAction::Terminal { command, .. } => {
            let preview = if command.len() > 40 {
                // Safe truncation: find the last char boundary before position 37
                let truncate_at = command
                    .char_indices()
                    .take_while(|(i, _)| *i < 37)
                    .last()
                    .map(|(i, c)| i + c.len_utf8())
                    .unwrap_or(37.min(command.len()));
                format!("{}...", &command[..truncate_at])
            } else {
                command.replace('\n', "\\n")
            };
            format!("Terminal: {}", preview)
        }
        ScriptAction::SetLayout { layout, .. } => {
            format!("Set layout: {}", layout.layout_type)
        }
        ScriptAction::Wait { duration_ms } => {
            format!("Wait {}ms", duration_ms)
        }
        ScriptAction::Caption { text, .. } => {
            let preview = if text.len() > 40 {
                // Safe truncation: find the last char boundary before position 37
                let truncate_at = text
                    .char_indices()
                    .take_while(|(i, _)| *i < 37)
                    .last()
                    .map(|(i, c)| i + c.len_utf8())
                    .unwrap_or(37.min(text.len()));
                format!("{}...", &text[..truncate_at])
            } else {
                text.clone()
            };
            format!("Caption: {}", preview)
        }
    }
}

// ---------------------------------------------------------------------------
// Interruptible sleep
// ---------------------------------------------------------------------------

/// Sleep that can be interrupted by cancellation, checking every 50ms.
fn interruptible_sleep(duration: Duration) {
    let start = Instant::now();
    while start.elapsed() < duration {
        if is_cancelled() {
            return;
        }
        thread::sleep(Duration::from_millis(50).min(duration.saturating_sub(start.elapsed())));
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ==================== ScriptStatus serialization ====================

    #[test]
    fn test_script_status_serialization() {
        // Idle
        let json = serde_json::to_string(&ScriptStatus::Idle).expect("serialize Idle");
        assert!(json.contains(r#""status":"idle""#), "Idle: {}", json);

        // Parsing
        let json = serde_json::to_string(&ScriptStatus::Parsing).expect("serialize Parsing");
        assert!(json.contains(r#""status":"parsing""#), "Parsing: {}", json);

        // SettingUp
        let json = serde_json::to_string(&ScriptStatus::SettingUp).expect("serialize SettingUp");
        assert!(
            json.contains(r#""status":"setting_up""#),
            "SettingUp: {}",
            json
        );

        // Running
        let json = serde_json::to_string(&ScriptStatus::Running {
            current_step: 2,
            total_steps: 5,
            step_description: "Wait 1000ms".to_string(),
        })
        .expect("serialize Running");
        assert!(json.contains(r#""status":"running""#), "Running: {}", json);
        assert!(
            json.contains(r#""current_step":2"#),
            "Running current_step: {}",
            json
        );
        assert!(
            json.contains(r#""total_steps":5"#),
            "Running total_steps: {}",
            json
        );

        // Stopping
        let json = serde_json::to_string(&ScriptStatus::Stopping).expect("serialize Stopping");
        assert!(
            json.contains(r#""status":"stopping""#),
            "Stopping: {}",
            json
        );

        // Completed
        let json = serde_json::to_string(&ScriptStatus::Completed {
            output_path: "/tmp/out.mp4".to_string(),
            duration_ms: 12345,
        })
        .expect("serialize Completed");
        assert!(
            json.contains(r#""status":"completed""#),
            "Completed: {}",
            json
        );
        assert!(
            json.contains(r#""output_path":"/tmp/out.mp4""#),
            "Completed output_path: {}",
            json
        );

        // Failed
        let json = serde_json::to_string(&ScriptStatus::Failed {
            error: "something broke".to_string(),
            step: Some(3),
        })
        .expect("serialize Failed");
        assert!(json.contains(r#""status":"failed""#), "Failed: {}", json);
        assert!(
            json.contains(r#""step":3"#),
            "Failed step: {}",
            json
        );
    }

    // ==================== describe_action ====================

    #[test]
    fn test_describe_action_terminal() {
        let action = ScriptAction::Terminal {
            source: Some("term1".to_string()),
            command: "echo hello\n".to_string(),
            wait_for: None,
        };
        let desc = describe_action(&action);
        assert!(
            desc.starts_with("Terminal: "),
            "Expected 'Terminal: ' prefix, got: {}",
            desc
        );
        assert!(
            desc.contains("echo hello"),
            "Expected command text, got: {}",
            desc
        );
    }

    #[test]
    fn test_describe_action_terminal_long_command() {
        let action = ScriptAction::Terminal {
            source: None,
            command: "a]".repeat(30), // 60 chars, > 40
            wait_for: None,
        };
        let desc = describe_action(&action);
        assert!(desc.ends_with("..."), "Long command should be truncated: {}", desc);
    }

    #[test]
    fn test_describe_action_wait() {
        let action = ScriptAction::Wait { duration_ms: 2500 };
        let desc = describe_action(&action);
        assert_eq!(desc, "Wait 2500ms");
    }

    #[test]
    fn test_describe_action_caption() {
        let action = ScriptAction::Caption {
            text: "Hello World".to_string(),
            position: CaptionPosition::Bottom,
            duration_ms: Some(5000),
        };
        let desc = describe_action(&action);
        assert_eq!(desc, "Caption: Hello World");
    }

    #[test]
    fn test_describe_action_set_layout() {
        let action = ScriptAction::SetLayout {
            layout: ScriptLayout {
                layout_type: "side_by_side".to_string(),
                primary: None,
                left: Some("t1".to_string()),
                right: Some("t2".to_string()),
            },
            transition_ms: None,
        };
        let desc = describe_action(&action);
        assert_eq!(desc, "Set layout: side_by_side");
    }

    // ==================== build_layout ====================

    #[test]
    fn test_build_layout_single() {
        let mut source_map = HashMap::new();
        source_map.insert("term1".to_string(), 42u32);

        let script_layout = ScriptLayout {
            layout_type: "single".to_string(),
            primary: Some("term1".to_string()),
            left: None,
            right: None,
        };

        let result = build_layout(&script_layout, &source_map);
        assert!(result.is_ok(), "Expected Ok, got: {:?}", result.err());

        match result.unwrap() {
            compositor::Layout::Single { source } => {
                assert_eq!(source, 42);
            }
            other => panic!("Expected Layout::Single, got: {:?}", other),
        }
    }

    #[test]
    fn test_build_layout_side_by_side() {
        let mut source_map = HashMap::new();
        source_map.insert("left_src".to_string(), 1u32);
        source_map.insert("right_src".to_string(), 2u32);

        let script_layout = ScriptLayout {
            layout_type: "side_by_side".to_string(),
            primary: None,
            left: Some("left_src".to_string()),
            right: Some("right_src".to_string()),
        };

        let result = build_layout(&script_layout, &source_map);
        assert!(result.is_ok());

        match result.unwrap() {
            compositor::Layout::SideBySide { left, right, ratio } => {
                assert_eq!(left, 1);
                assert_eq!(right, 2);
                assert!((ratio - 0.5).abs() < f32::EPSILON);
            }
            other => panic!("Expected Layout::SideBySide, got: {:?}", other),
        }
    }

    #[test]
    fn test_build_layout_unsupported() {
        let source_map = HashMap::new();
        let script_layout = ScriptLayout {
            layout_type: "hologram".to_string(),
            primary: None,
            left: None,
            right: None,
        };

        let result = build_layout(&script_layout, &source_map);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("Unsupported layout type"),
            "Expected unsupported error, got: {}",
            err
        );
    }

    #[test]
    fn test_build_layout_missing_source() {
        let source_map = HashMap::new(); // empty

        let script_layout = ScriptLayout {
            layout_type: "single".to_string(),
            primary: Some("missing".to_string()),
            left: None,
            right: None,
        };

        let result = build_layout(&script_layout, &source_map);
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("not found"),
            "Expected 'not found' error"
        );
    }

    // ==================== resolve_terminal_source ====================

    #[test]
    fn test_resolve_terminal_source_named() {
        let mut source_map = HashMap::new();
        source_map.insert("term1".to_string(), 10u32);
        source_map.insert("term2".to_string(), 20u32);

        let result = resolve_terminal_source(&Some("term2".to_string()), &source_map);
        assert_eq!(result, Ok(20));
    }

    #[test]
    fn test_resolve_terminal_source_default() {
        let mut source_map = HashMap::new();
        source_map.insert("only_term".to_string(), 7u32);

        let result = resolve_terminal_source(&None, &source_map);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 7);
    }

    #[test]
    fn test_resolve_terminal_source_named_not_found() {
        let source_map = HashMap::new();
        let result = resolve_terminal_source(&Some("ghost".to_string()), &source_map);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("ghost"));
    }

    #[test]
    fn test_resolve_terminal_source_empty_map() {
        let source_map = HashMap::new();
        let result = resolve_terminal_source(&None, &source_map);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No terminal sources"));
    }
}
