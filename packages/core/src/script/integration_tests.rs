//! Integration tests for the script pipeline:
//! YAML parsing → validation → layout verification → action description.

use super::engine::ScriptStatus;
use super::parser;
use super::types::*;

// ---------------------------------------------------------------------------
// 1. Parse and validate the example YAML
// ---------------------------------------------------------------------------

#[test]
fn test_parse_and_validate_example_yaml() {
    let yaml = include_str!("../../examples/demo.yaml");
    let result = parser::parse_script_str(yaml);
    assert!(
        result.is_ok(),
        "Expected example YAML to parse successfully, got error: {:?}",
        result.err()
    );
    let script = result.expect("already checked is_ok");

    // Metadata
    assert_eq!(
        script.metadata.name, "CLI Tool Demo",
        "Expected metadata.name to be 'CLI Tool Demo', got: {:?}",
        script.metadata.name
    );
    assert_eq!(
        script.metadata.output.resolution, "1920x1080",
        "Expected resolution '1920x1080', got: {:?}",
        script.metadata.output.resolution
    );
    assert_eq!(
        script.metadata.output.fps, 30,
        "Expected fps 30, got: {}",
        script.metadata.output.fps
    );
    assert_eq!(
        script.metadata.description.as_deref(),
        Some("Demonstrates building and testing a Rust CLI tool with two terminal panes"),
        "Expected description to match, got: {:?}",
        script.metadata.description
    );

    // Sources
    assert_eq!(
        script.setup.sources.len(),
        2,
        "Expected 2 sources, got: {}",
        script.setup.sources.len()
    );
    assert_eq!(
        script.setup.sources[0].id, "term1",
        "Expected first source id 'term1', got: {:?}",
        script.setup.sources[0].id
    );
    assert_eq!(
        script.setup.sources[0].source_type, "terminal",
        "Expected first source type 'terminal', got: {:?}",
        script.setup.sources[0].source_type
    );
    assert_eq!(
        script.setup.sources[1].id, "term2",
        "Expected second source id 'term2', got: {:?}",
        script.setup.sources[1].id
    );
    assert_eq!(
        script.setup.sources[1].source_type, "terminal",
        "Expected second source type 'terminal', got: {:?}",
        script.setup.sources[1].source_type
    );
    assert_eq!(
        script.setup.sources[0].shell.as_deref(),
        Some("/bin/zsh"),
        "Expected first source shell '/bin/zsh', got: {:?}",
        script.setup.sources[0].shell
    );
    assert_eq!(
        script.setup.sources[1].shell.as_deref(),
        Some("/bin/zsh"),
        "Expected second source shell '/bin/zsh', got: {:?}",
        script.setup.sources[1].shell
    );

    // Initial layout
    assert_eq!(
        script.setup.initial_layout.layout_type, "single",
        "Expected initialLayout type 'single', got: {:?}",
        script.setup.initial_layout.layout_type
    );
    assert_eq!(
        script.setup.initial_layout.primary.as_deref(),
        Some("term1"),
        "Expected initialLayout primary 'term1', got: {:?}",
        script.setup.initial_layout.primary
    );

    // Steps count
    assert_eq!(
        script.steps.len(),
        7,
        "Expected 7 steps, got: {}",
        script.steps.len()
    );
}

// ---------------------------------------------------------------------------
// 2. ScriptStatus serialization for all variants
// ---------------------------------------------------------------------------

#[test]
fn test_script_status_transitions() {
    let variants: Vec<(ScriptStatus, &str)> = vec![
        (ScriptStatus::Idle, "idle"),
        (ScriptStatus::Parsing, "parsing"),
        (ScriptStatus::SettingUp, "setting_up"),
        (
            ScriptStatus::Running {
                current_step: 0,
                total_steps: 5,
                step_description: "test".into(),
            },
            "running",
        ),
        (ScriptStatus::Stopping, "stopping"),
        (
            ScriptStatus::Completed {
                output_path: "/tmp/test.mp4".into(),
                duration_ms: 1000,
            },
            "completed",
        ),
        (
            ScriptStatus::Failed {
                error: "test error".into(),
                step: Some(0),
            },
            "failed",
        ),
    ];

    for (status, expected_tag) in &variants {
        let json = serde_json::to_string(status).unwrap_or_else(|e| {
            panic!(
                "Failed to serialize ScriptStatus::{}: {}",
                expected_tag, e
            )
        });
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap_or_else(|e| {
            panic!("Failed to parse serialized JSON '{}': {}", json, e)
        });
        let status_field = parsed
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| {
                panic!(
                    "Missing 'status' field in serialized JSON for '{}': {}",
                    expected_tag, json
                )
            });
        assert_eq!(
            status_field, *expected_tag,
            "Expected status tag '{}', got '{}' in JSON: {}",
            expected_tag, status_field, json
        );
    }
}

// ---------------------------------------------------------------------------
// 3. Layout structure verification from script
// ---------------------------------------------------------------------------

#[test]
fn test_build_layout_from_script() {
    let yaml = include_str!("../../examples/demo.yaml");
    let script = parser::parse_script_str(yaml)
        .expect("Example YAML should parse successfully");

    // Find the SetLayout action in steps and verify its layout
    let set_layout_step = script.steps.iter().find(|step| {
        matches!(step.action, ScriptAction::SetLayout { .. })
    });
    assert!(
        set_layout_step.is_some(),
        "Expected to find a SetLayout action in the script steps"
    );

    match &set_layout_step.expect("already checked is_some").action {
        ScriptAction::SetLayout { layout, transition_ms } => {
            assert_eq!(
                layout.layout_type, "side_by_side",
                "Expected SetLayout type 'side_by_side', got: {:?}",
                layout.layout_type
            );
            assert_eq!(
                layout.left.as_deref(),
                Some("term1"),
                "Expected SetLayout left 'term1', got: {:?}",
                layout.left
            );
            assert_eq!(
                layout.right.as_deref(),
                Some("term2"),
                "Expected SetLayout right 'term2', got: {:?}",
                layout.right
            );
            assert_eq!(
                *transition_ms,
                Some(500),
                "Expected SetLayout transitionMs Some(500), got: {:?}",
                transition_ms
            );
        }
        other => panic!("Expected ScriptAction::SetLayout, got: {:?}", other),
    }
}

// ---------------------------------------------------------------------------
// 4. Zoom action details
// ---------------------------------------------------------------------------

#[test]
fn test_zoom_action_in_yaml() {
    let yaml = include_str!("../../examples/demo.yaml");
    let script = parser::parse_script_str(yaml)
        .expect("Example YAML should parse successfully");

    let zoom_step = script.steps.iter().find(|step| {
        matches!(step.action, ScriptAction::Zoom { .. })
    });
    assert!(
        zoom_step.is_some(),
        "Expected to find a Zoom action in the script steps"
    );

    match &zoom_step.expect("already checked is_some").action {
        ScriptAction::Zoom {
            target,
            level,
            duration_ms,
        } => {
            assert_eq!(
                target.source, "term1",
                "Expected zoom target source 'term1', got: {:?}",
                target.source
            );
            assert!(
                (*level - 2.0).abs() < f32::EPSILON,
                "Expected zoom level approximately 2.0, got: {}",
                level
            );
            assert_eq!(
                *duration_ms,
                Some(800),
                "Expected zoom duration_ms Some(800), got: {:?}",
                duration_ms
            );
            assert!(
                (target.focus_x - 0.5).abs() < f32::EPSILON,
                "Expected focus_x approximately 0.5, got: {}",
                target.focus_x
            );
            assert!(
                (target.focus_y - 0.8).abs() < f32::EPSILON,
                "Expected focus_y approximately 0.8, got: {}",
                target.focus_y
            );
        }
        other => panic!(
            "Expected ScriptAction::Zoom, got: {:?}",
            other
        ),
    }
}

// ---------------------------------------------------------------------------
// 5. Full script execution placeholder (requires runtime)
// ---------------------------------------------------------------------------

#[test]
fn test_full_script_execution() {
    let example_path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/examples/demo.yaml"
    );
    let result = parser::parse_script_file(example_path);
    assert!(
        result.is_ok(),
        "Expected example YAML to parse via parse_script_file, got error: {:?}",
        result.err()
    );
}

// ---------------------------------------------------------------------------
// 6. All action types present in example YAML
// ---------------------------------------------------------------------------

#[test]
fn test_all_action_types_present() {
    let yaml = include_str!("../../examples/demo.yaml");
    let script = parser::parse_script_str(yaml)
        .expect("Example YAML should parse successfully");

    let mut has_terminal = false;
    let mut has_caption = false;
    let mut has_wait = false;
    let mut has_zoom = false;
    let mut has_set_layout = false;

    for step in &script.steps {
        match &step.action {
            ScriptAction::Terminal { .. } => has_terminal = true,
            ScriptAction::Caption { .. } => has_caption = true,
            ScriptAction::Wait { .. } => has_wait = true,
            ScriptAction::Zoom { .. } => has_zoom = true,
            ScriptAction::SetLayout { .. } => has_set_layout = true,
        }
    }

    assert!(has_terminal, "Expected Terminal action in example YAML");
    assert!(has_caption, "Expected Caption action in example YAML");
    assert!(has_wait, "Expected Wait action in example YAML");
    assert!(has_zoom, "Expected Zoom action in example YAML");
    assert!(has_set_layout, "Expected SetLayout action in example YAML");
}

// ---------------------------------------------------------------------------
// 7. Validate all action fields from parsed YAML
// ---------------------------------------------------------------------------

#[test]
fn test_describe_all_actions() {
    let yaml = include_str!("../../examples/demo.yaml");
    let script = parser::parse_script_str(yaml)
        .expect("Example YAML should parse successfully");

    for (i, step) in script.steps.iter().enumerate() {
        match &step.action {
            ScriptAction::Terminal { source, command, .. } => {
                assert!(
                    !command.is_empty(),
                    "Step {} Terminal action has empty command",
                    i
                );
                assert!(
                    source.is_some(),
                    "Step {} Terminal action should have an explicit source",
                    i
                );
            }
            ScriptAction::Caption { text, duration_ms, .. } => {
                assert!(
                    !text.is_empty(),
                    "Step {} Caption action has empty text",
                    i
                );
                assert!(
                    duration_ms.is_some(),
                    "Step {} Caption action should have durationMs set",
                    i
                );
            }
            ScriptAction::Wait { duration_ms } => {
                assert!(
                    *duration_ms > 0,
                    "Step {} Wait action has zero duration_ms: {}",
                    i, duration_ms
                );
            }
            ScriptAction::Zoom { level, .. } => {
                assert!(
                    *level >= 1.0 && *level <= 10.0,
                    "Step {} Zoom action has out-of-range level: {} (expected 1.0..=10.0)",
                    i, level
                );
            }
            ScriptAction::SetLayout { layout, .. } => {
                assert!(
                    !layout.layout_type.is_empty(),
                    "Step {} SetLayout action has empty layout_type",
                    i
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 8. Terminal waitFor variants (Some and None)
// ---------------------------------------------------------------------------

#[test]
fn test_terminal_waitfor_variants() {
    let yaml = include_str!("../../examples/demo.yaml");
    let script = parser::parse_script_str(yaml)
        .expect("Example YAML should parse successfully");

    let terminal_steps: Vec<_> = script
        .steps
        .iter()
        .filter_map(|step| match &step.action {
            ScriptAction::Terminal { source, command, wait_for } => {
                Some((source.clone(), command.clone(), wait_for.clone()))
            }
            _ => None,
        })
        .collect();

    assert!(
        terminal_steps.len() >= 2,
        "Expected at least 2 terminal steps, got: {}",
        terminal_steps.len()
    );

    // First terminal step has waitFor (text pattern)
    let (ref src1, ref cmd1, ref wf1) = terminal_steps[0];
    assert_eq!(
        src1.as_deref(), Some("term1"),
        "Expected first terminal source 'term1', got: {:?}", src1
    );
    assert!(
        !cmd1.is_empty(),
        "Expected first terminal command to be non-empty"
    );
    assert!(
        wf1.is_some(),
        "Expected first terminal step to have waitFor"
    );
    match wf1.as_ref().unwrap() {
        WaitCondition::Text { pattern, timeout_ms } => {
            assert!(
                !pattern.is_empty(),
                "Expected non-empty wait pattern"
            );
            assert!(
                *timeout_ms > 0,
                "Expected positive timeout_ms, got: {}", timeout_ms
            );
        }
        other => panic!("Expected WaitCondition::Text, got: {:?}", other),
    }

    // Second terminal step has no waitFor
    let (ref src2, ref cmd2, ref wf2) = terminal_steps[1];
    assert_eq!(
        src2.as_deref(), Some("term2"),
        "Expected second terminal source 'term2', got: {:?}", src2
    );
    assert!(
        !cmd2.is_empty(),
        "Expected second terminal command to be non-empty"
    );
    assert!(
        wf2.is_none(),
        "Expected second terminal step to have no waitFor, got: {:?}", wf2
    );
}

// ---------------------------------------------------------------------------
// 9. Step-level caption field
// ---------------------------------------------------------------------------

#[test]
fn test_step_level_caption() {
    let yaml = include_str!("../../examples/demo.yaml");
    let script = parser::parse_script_str(yaml)
        .expect("Example YAML should parse successfully");

    let step_with_caption = script.steps.iter().find(|step| step.caption.is_some());
    assert!(
        step_with_caption.is_some(),
        "Expected at least one step with a step-level caption in the example YAML"
    );

    let cap = step_with_caption
        .expect("already checked is_some")
        .caption
        .as_ref()
        .expect("already checked is_some");
    assert!(
        !cap.text.is_empty(),
        "Step-level caption text should not be empty"
    );
}
