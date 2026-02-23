use std::collections::HashSet;

use super::types::{Script, ScriptAction, ScriptLayout};

/// Parse a YAML file from disk.
pub fn parse_script_file(path: &str) -> Result<Script, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read file '{}': {}", path, e))?;
    parse_script_str(&content)
}

/// Parse a YAML string.
pub fn parse_script_str(yaml: &str) -> Result<Script, String> {
    let script: Script =
        serde_yml::from_str(yaml).map_err(|e| format!("YAML parse error: {}", e))?;
    validate_script(&script)?;
    Ok(script)
}

/// Parse a resolution string like "1920x1080" into (width, height).
pub fn parse_resolution(resolution: &str) -> Result<(u32, u32), String> {
    let parts: Vec<&str> = resolution.split('x').collect();
    if parts.len() != 2 {
        return Err(format!(
            "Invalid resolution format: '{}' (expected WIDTHxHEIGHT)",
            resolution
        ));
    }
    let width: u32 = parts[0]
        .parse()
        .map_err(|_| format!("Invalid width in resolution: '{}'", resolution))?;
    let height: u32 = parts[1]
        .parse()
        .map_err(|_| format!("Invalid height in resolution: '{}'", resolution))?;
    if width == 0 || height == 0 {
        return Err(format!(
            "Resolution dimensions must be > 0: '{}'",
            resolution
        ));
    }
    Ok((width, height))
}

/// Validate a parsed script for semantic correctness.
pub fn validate_script(script: &Script) -> Result<(), String> {
    // 1. Validate resolution format
    parse_resolution(&script.metadata.output.resolution)?;

    // 2. Validate fps range
    let fps = script.metadata.output.fps;
    if fps == 0 || fps > 120 {
        return Err(format!(
            "fps must be > 0 and <= 120, got: {}",
            fps
        ));
    }

    // 3. Check for duplicate source IDs
    let mut seen_ids = HashSet::new();
    for source in &script.setup.sources {
        if !seen_ids.insert(source.id.as_str()) {
            return Err(format!("Duplicate source id: '{}'", source.id));
        }
    }

    // 4. Validate initial layout references existing source IDs
    validate_layout_references(&script.setup.initial_layout, &seen_ids, "initialLayout")?;

    // 5. Check that steps is not empty
    if script.steps.is_empty() {
        return Err("Script must contain at least one step".to_string());
    }

    // 6. Validate each step's source references
    for (i, step) in script.steps.iter().enumerate() {
        validate_action_references(&step.action, &seen_ids, i)?;
    }

    Ok(())
}

/// Validate that all source references in a layout point to existing source IDs.
fn validate_layout_references(
    layout: &ScriptLayout,
    valid_ids: &HashSet<&str>,
    context: &str,
) -> Result<(), String> {
    for (field, value) in [
        ("primary", &layout.primary),
        ("left", &layout.left),
        ("right", &layout.right),
    ] {
        if let Some(ref id) = value {
            if !valid_ids.contains(id.as_str()) {
                return Err(format!(
                    "Layout '{}' field '{}' references unknown source: '{}'",
                    context, field, id
                ));
            }
        }
    }
    Ok(())
}

/// Validate source references within a step action.
fn validate_action_references(
    action: &ScriptAction,
    valid_ids: &HashSet<&str>,
    step_index: usize,
) -> Result<(), String> {
    match action {
        ScriptAction::Terminal { source, .. } => {
            if let Some(ref id) = source {
                if !valid_ids.contains(id.as_str()) {
                    return Err(format!(
                        "Step {} terminal action references unknown source: '{}'",
                        step_index, id
                    ));
                }
            }
        }
        ScriptAction::SetLayout { layout, .. } => {
            let context = format!("step {} set_layout", step_index);
            validate_layout_references(layout, valid_ids, &context)?;
        }
        ScriptAction::Wait { .. } | ScriptAction::Caption { .. } => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_yaml() -> &'static str {
        r#"
metadata:
  name: "Test Demo"
  output:
    resolution: "1920x1080"
    fps: 30
setup:
  sources:
    - id: term
      type: terminal
      shell: /bin/zsh
  initialLayout:
    type: single
    primary: term
steps:
  - action:
      type: terminal
      source: term
      command: "echo hello\n"
  - action:
      type: wait
      durationMs: 1000
"#
    }

    #[test]
    fn test_parse_valid_script() {
        let result = parse_script_str(valid_yaml());
        assert!(result.is_ok(), "Expected Ok, got: {:?}", result.err());
        let script = result.unwrap();
        assert_eq!(script.metadata.name, "Test Demo");
        assert_eq!(script.metadata.output.resolution, "1920x1080");
        assert_eq!(script.metadata.output.fps, 30);
        assert_eq!(script.setup.sources.len(), 1);
        assert_eq!(script.setup.sources[0].id, "term");
        assert_eq!(script.steps.len(), 2);
    }

    #[test]
    fn test_parse_invalid_yaml() {
        let bad_yaml = "not: [valid: yaml: {{{}}}";
        let result = parse_script_str(bad_yaml);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("YAML parse error"));
    }

    #[test]
    fn test_validate_duplicate_source_ids() {
        let yaml = r#"
metadata:
  name: "Dup Test"
  output:
    resolution: "1920x1080"
    fps: 30
setup:
  sources:
    - id: term
      type: terminal
    - id: term
      type: terminal
  initialLayout:
    type: single
    primary: term
steps:
  - action:
      type: wait
      durationMs: 1000
"#;
        let result = parse_script_str(yaml);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("Duplicate source id"),
            "Expected duplicate id error, got: {}",
            err
        );
    }

    #[test]
    fn test_validate_invalid_resolution_format() {
        // "abc" - no 'x' separator
        let yaml = r#"
metadata:
  name: "Bad Res"
  output:
    resolution: "abc"
    fps: 30
setup:
  sources:
    - id: term
      type: terminal
  initialLayout:
    type: single
    primary: term
steps:
  - action:
      type: wait
      durationMs: 1000
"#;
        let result = parse_script_str(yaml);
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("Invalid resolution format"),
            "Expected resolution format error"
        );

        // "1920x" - missing height
        let yaml2 = r#"
metadata:
  name: "Bad Res 2"
  output:
    resolution: "1920x"
    fps: 30
setup:
  sources:
    - id: term
      type: terminal
  initialLayout:
    type: single
    primary: term
steps:
  - action:
      type: wait
      durationMs: 1000
"#;
        let result2 = parse_script_str(yaml2);
        assert!(result2.is_err());
        assert!(
            result2.unwrap_err().contains("resolution"),
            "Expected resolution-related error"
        );
    }

    #[test]
    fn test_validate_zero_resolution() {
        let yaml = r#"
metadata:
  name: "Zero Res"
  output:
    resolution: "0x1080"
    fps: 30
setup:
  sources:
    - id: term
      type: terminal
  initialLayout:
    type: single
    primary: term
steps:
  - action:
      type: wait
      durationMs: 1000
"#;
        let result = parse_script_str(yaml);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("must be > 0"),
            "Expected 'must be > 0' error, got: {}",
            err
        );
    }

    #[test]
    fn test_validate_empty_steps() {
        let yaml = r#"
metadata:
  name: "Empty Steps"
  output:
    resolution: "1920x1080"
    fps: 30
setup:
  sources:
    - id: term
      type: terminal
  initialLayout:
    type: single
    primary: term
steps: []
"#;
        let result = parse_script_str(yaml);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("must contain at least one step"),
            "Expected empty steps error, got: {}",
            err
        );
    }

    #[test]
    fn test_validate_invalid_layout_reference() {
        let yaml = r#"
metadata:
  name: "Bad Layout Ref"
  output:
    resolution: "1920x1080"
    fps: 30
setup:
  sources:
    - id: term
      type: terminal
  initialLayout:
    type: single
    primary: nonexistent
steps:
  - action:
      type: wait
      durationMs: 1000
"#;
        let result = parse_script_str(yaml);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("nonexistent"),
            "Expected error mentioning 'nonexistent', got: {}",
            err
        );
    }

    #[test]
    fn test_validate_invalid_terminal_source_reference() {
        let yaml = r#"
metadata:
  name: "Bad Source Ref"
  output:
    resolution: "1920x1080"
    fps: 30
setup:
  sources:
    - id: term
      type: terminal
  initialLayout:
    type: single
    primary: term
steps:
  - action:
      type: terminal
      source: missing_source
      command: "echo hello\n"
"#;
        let result = parse_script_str(yaml);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("missing_source"),
            "Expected error mentioning 'missing_source', got: {}",
            err
        );
    }

    #[test]
    fn test_parse_resolution() {
        // Valid
        assert_eq!(parse_resolution("1920x1080"), Ok((1920, 1080)));
        assert_eq!(parse_resolution("3840x2160"), Ok((3840, 2160)));

        // Invalid format
        assert!(parse_resolution("abc").is_err());
        assert!(parse_resolution("1920x").is_err());
        assert!(parse_resolution("x1080").is_err());
        assert!(parse_resolution("1920x1080x60").is_err());

        // Zero dimensions
        assert!(parse_resolution("0x1080").is_err());
        assert!(parse_resolution("1920x0").is_err());
    }

    #[test]
    fn test_validate_fps_out_of_range() {
        // fps = 0
        let yaml_zero_fps = r#"
metadata:
  name: "Zero FPS"
  output:
    resolution: "1920x1080"
    fps: 0
setup:
  sources:
    - id: term
      type: terminal
  initialLayout:
    type: single
    primary: term
steps:
  - action:
      type: wait
      durationMs: 1000
"#;
        let result = parse_script_str(yaml_zero_fps);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("fps"));

        // fps = 121
        let yaml_high_fps = r#"
metadata:
  name: "High FPS"
  output:
    resolution: "1920x1080"
    fps: 121
setup:
  sources:
    - id: term
      type: terminal
  initialLayout:
    type: single
    primary: term
steps:
  - action:
      type: wait
      durationMs: 1000
"#;
        let result2 = parse_script_str(yaml_high_fps);
        assert!(result2.is_err());
        assert!(result2.unwrap_err().contains("fps"));
    }
}
