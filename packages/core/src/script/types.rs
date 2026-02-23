use serde::{Deserialize, Serialize};

/// Top-level script definition parsed from YAML.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Script {
    pub metadata: ScriptMetadata,
    pub setup: ScriptSetup,
    pub steps: Vec<ScriptStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptMetadata {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub output: OutputConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputConfig {
    pub resolution: String,
    pub fps: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptSetup {
    pub sources: Vec<ScriptSource>,
    #[serde(rename = "initialLayout")]
    pub initial_layout: ScriptLayout,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptSource {
    pub id: String,
    #[serde(rename = "type")]
    pub source_type: String,
    #[serde(default)]
    pub shell: Option<String>,
    #[serde(default)]
    pub device: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptLayout {
    #[serde(rename = "type")]
    pub layout_type: String,
    #[serde(default)]
    pub primary: Option<String>,
    #[serde(default)]
    pub left: Option<String>,
    #[serde(default)]
    pub right: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptStep {
    pub action: ScriptAction,
    #[serde(default)]
    pub caption: Option<StepCaption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepCaption {
    pub text: String,
    pub position: CaptionPosition,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ScriptAction {
    Terminal {
        #[serde(default)]
        source: Option<String>,
        command: String,
        #[serde(default, rename = "waitFor")]
        wait_for: Option<WaitCondition>,
    },
    #[serde(rename = "set_layout")]
    SetLayout {
        layout: ScriptLayout,
        #[serde(default, rename = "transitionMs")]
        transition_ms: Option<u64>,
    },
    Wait {
        #[serde(rename = "durationMs")]
        duration_ms: u64,
    },
    Caption {
        text: String,
        position: CaptionPosition,
        #[serde(default, rename = "durationMs")]
        duration_ms: Option<u64>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WaitCondition {
    Text {
        pattern: String,
        #[serde(default = "default_timeout_ms", rename = "timeoutMs")]
        timeout_ms: u64,
    },
    Timeout {
        #[serde(rename = "timeoutMs")]
        timeout_ms: u64,
    },
}

fn default_timeout_ms() -> u64 {
    5000
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptionPosition {
    Top,
    Bottom,
    Center,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deserialize_full_script() {
        let yaml = r#"
metadata:
  name: "Demo Recording"
  description: "A full demo script"
  output:
    resolution: "1920x1080"
    fps: 30
setup:
  sources:
    - id: "term1"
      type: "terminal"
      shell: "/bin/zsh"
    - id: "cam1"
      type: "webcam"
      device: "FaceTime HD Camera"
  initialLayout:
    type: "fullscreen"
    primary: "term1"
steps:
  - action:
      type: terminal
      source: "term1"
      command: "echo hello\n"
      waitFor:
        type: text
        pattern: "hello"
        timeoutMs: 3000
  - action:
      type: wait
      durationMs: 1000
  - action:
      type: caption
      text: "Welcome!"
      position: top
      durationMs: 2000
"#;
        let script: Script = serde_yml::from_str(yaml).unwrap();
        assert_eq!(script.metadata.name, "Demo Recording");
        assert_eq!(script.metadata.description.as_deref(), Some("A full demo script"));
        assert_eq!(script.metadata.output.resolution, "1920x1080");
        assert_eq!(script.metadata.output.fps, 30);
        assert_eq!(script.setup.sources.len(), 2);
        assert_eq!(script.setup.sources[0].id, "term1");
        assert_eq!(script.setup.sources[0].source_type, "terminal");
        assert_eq!(script.setup.sources[0].shell.as_deref(), Some("/bin/zsh"));
        assert_eq!(script.setup.sources[1].id, "cam1");
        assert_eq!(script.setup.sources[1].device.as_deref(), Some("FaceTime HD Camera"));
        assert_eq!(script.setup.initial_layout.layout_type, "fullscreen");
        assert_eq!(script.setup.initial_layout.primary.as_deref(), Some("term1"));
        assert_eq!(script.steps.len(), 3);
    }

    #[test]
    fn test_deserialize_terminal_action() {
        let yaml = r#"
type: terminal
source: "term1"
command: "echo hello\n"
waitFor:
  type: text
  pattern: "hello"
  timeoutMs: 3000
"#;
        let action: ScriptAction = serde_yml::from_str(yaml).unwrap();
        match action {
            ScriptAction::Terminal {
                source,
                command,
                wait_for,
            } => {
                assert_eq!(source.as_deref(), Some("term1"));
                assert_eq!(command, "echo hello\n");
                let wf = wait_for.unwrap();
                match wf {
                    WaitCondition::Text {
                        pattern,
                        timeout_ms,
                    } => {
                        assert_eq!(pattern, "hello");
                        assert_eq!(timeout_ms, 3000);
                    }
                    _ => panic!("Expected WaitCondition::Text"),
                }
            }
            _ => panic!("Expected ScriptAction::Terminal"),
        }
    }

    #[test]
    fn test_deserialize_terminal_action_no_wait() {
        let yaml = r#"
type: terminal
command: "ls -la\n"
"#;
        let action: ScriptAction = serde_yml::from_str(yaml).unwrap();
        match action {
            ScriptAction::Terminal {
                source,
                command,
                wait_for,
            } => {
                assert!(source.is_none());
                assert_eq!(command, "ls -la\n");
                assert!(wait_for.is_none());
            }
            _ => panic!("Expected ScriptAction::Terminal"),
        }
    }

    #[test]
    fn test_deserialize_wait_action() {
        let yaml = r#"
type: wait
durationMs: 2500
"#;
        let action: ScriptAction = serde_yml::from_str(yaml).unwrap();
        match action {
            ScriptAction::Wait { duration_ms } => {
                assert_eq!(duration_ms, 2500);
            }
            _ => panic!("Expected ScriptAction::Wait"),
        }
    }

    #[test]
    fn test_deserialize_caption_action() {
        let yaml = r#"
type: caption
text: "Hello World"
position: bottom
durationMs: 5000
"#;
        let action: ScriptAction = serde_yml::from_str(yaml).unwrap();
        match action {
            ScriptAction::Caption {
                text,
                position,
                duration_ms,
            } => {
                assert_eq!(text, "Hello World");
                assert_eq!(position, CaptionPosition::Bottom);
                assert_eq!(duration_ms, Some(5000));
            }
            _ => panic!("Expected ScriptAction::Caption"),
        }
    }

    #[test]
    fn test_deserialize_caption_action_no_duration() {
        let yaml = r#"
type: caption
text: "No duration"
position: center
"#;
        let action: ScriptAction = serde_yml::from_str(yaml).unwrap();
        match action {
            ScriptAction::Caption {
                text,
                position,
                duration_ms,
            } => {
                assert_eq!(text, "No duration");
                assert_eq!(position, CaptionPosition::Center);
                assert!(duration_ms.is_none());
            }
            _ => panic!("Expected ScriptAction::Caption"),
        }
    }

    #[test]
    fn test_deserialize_set_layout_action() {
        let yaml = r#"
type: set_layout
layout:
  type: "side_by_side"
  left: "term1"
  right: "cam1"
transitionMs: 500
"#;
        let action: ScriptAction = serde_yml::from_str(yaml).unwrap();
        match action {
            ScriptAction::SetLayout {
                layout,
                transition_ms,
            } => {
                assert_eq!(layout.layout_type, "side_by_side");
                assert_eq!(layout.left.as_deref(), Some("term1"));
                assert_eq!(layout.right.as_deref(), Some("cam1"));
                assert_eq!(transition_ms, Some(500));
            }
            _ => panic!("Expected ScriptAction::SetLayout"),
        }
    }

    #[test]
    fn test_deserialize_wait_condition_text() {
        let yaml = r#"
type: text
pattern: "\\$"
"#;
        let condition: WaitCondition = serde_yml::from_str(yaml).unwrap();
        match condition {
            WaitCondition::Text {
                pattern,
                timeout_ms,
            } => {
                assert_eq!(pattern, "\\$");
                assert_eq!(timeout_ms, 5000, "Default timeout should be 5000ms");
            }
            _ => panic!("Expected WaitCondition::Text"),
        }
    }

    #[test]
    fn test_deserialize_wait_condition_timeout() {
        let yaml = r#"
type: timeout
timeoutMs: 10000
"#;
        let condition: WaitCondition = serde_yml::from_str(yaml).unwrap();
        match condition {
            WaitCondition::Timeout { timeout_ms } => {
                assert_eq!(timeout_ms, 10000);
            }
            _ => panic!("Expected WaitCondition::Timeout"),
        }
    }

    #[test]
    fn test_caption_position_variants() {
        let top: CaptionPosition = serde_yml::from_str("top").unwrap();
        assert_eq!(top, CaptionPosition::Top);

        let bottom: CaptionPosition = serde_yml::from_str("bottom").unwrap();
        assert_eq!(bottom, CaptionPosition::Bottom);

        let center: CaptionPosition = serde_yml::from_str("center").unwrap();
        assert_eq!(center, CaptionPosition::Center);
    }
}
