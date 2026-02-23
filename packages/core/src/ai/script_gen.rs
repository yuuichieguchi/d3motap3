//! YAML script generation from natural language via LLM API.

use super::call_claude_api;
use crate::script::parser;

/// Build the prompt for script generation.
pub fn build_script_prompt(description: &str) -> String {
    format!(
        "You are a YAML script generator for d3motap3, a screen recording tool.\n\
         Generate a valid YAML script based on the user's description.\n\n\
         The YAML schema requires:\n\
         - metadata: name, output (resolution like \"1920x1080\", fps)\n\
         - setup: sources (each with id and type), initialLayout (type and primary)\n\
         - steps: list of actions (terminal, wait, caption, set_layout, zoom)\n\n\
         Terminal action example:\n\
         ```yaml\n\
         - action:\n\
             type: terminal\n\
             source: term\n\
             command: \"echo hello\\n\"\n\
             waitFor:\n\
               type: text\n\
               pattern: \"hello\"\n\
               timeoutMs: 5000\n\
         ```\n\n\
         User description: {}\n\n\
         Output only the YAML script inside a ```yaml code block.",
        description
    )
}

/// Parse the Claude API response JSON to extract YAML content.
pub fn parse_script_response(response_body: &str) -> Result<String, String> {
    let json: serde_json::Value = serde_json::from_str(response_body)
        .map_err(|e| format!("Failed to parse API response: {}", e))?;

    let content = json.get("content")
        .and_then(|c| c.as_array())
        .ok_or_else(|| "Missing 'content' array in response".to_string())?;

    if content.is_empty() {
        return Err("Empty content array in response".to_string());
    }

    let text = content[0]
        .get("text")
        .and_then(|t| t.as_str())
        .ok_or_else(|| "Missing 'text' field in content".to_string())?;

    // Extract YAML from code block if present
    if let Some(start) = text.find("```yaml") {
        let yaml_start = start + "```yaml".len();
        if let Some(end) = text[yaml_start..].find("```") {
            let yaml = text[yaml_start..yaml_start + end].trim();
            return Ok(yaml.to_string());
        }
    }

    // Also try ```yml variant
    if let Some(start) = text.find("```yml") {
        let yaml_start = start + "```yml".len();
        if let Some(end) = text[yaml_start..].find("```") {
            let yaml = text[yaml_start..yaml_start + end].trim();
            return Ok(yaml.to_string());
        }
    }

    // Also try generic code blocks
    if let Some(start) = text.find("```\n") {
        let yaml_start = start + "```\n".len();
        if let Some(end) = text[yaml_start..].find("```") {
            let yaml = text[yaml_start..yaml_start + end].trim();
            return Ok(yaml.to_string());
        }
    }

    // If no code block found, return the full text trimmed
    Ok(text.trim().to_string())
}

/// Validate that generated YAML is a valid d3motap3 script.
pub fn validate_generated_yaml(yaml: &str) -> Result<(), String> {
    parser::parse_script_str(yaml)?;
    Ok(())
}

/// Call Claude API to generate a YAML script (blocking HTTP).
pub fn generate_script(description: &str, api_key: &str) -> Result<String, String> {
    let prompt = build_script_prompt(description);
    let response = call_claude_api(&prompt, api_key)?;
    let yaml = parse_script_response(&response)?;
    validate_generated_yaml(&yaml)?;
    Ok(yaml)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_script_prompt_contains_description() {
        let prompt = build_script_prompt("Show git workflow with commits and branches");
        assert!(prompt.contains("git workflow"), "Prompt should contain description");
        assert!(prompt.contains("YAML") || prompt.contains("yaml"),
            "Prompt should mention YAML format");
    }

    #[test]
    fn test_build_script_prompt_includes_schema() {
        let prompt = build_script_prompt("any demo");
        assert!(prompt.contains("metadata") && prompt.contains("steps"),
            "Prompt should include schema structure hints");
    }

    #[test]
    fn test_parse_script_response_valid() {
        let response = r#"{
            "content": [
                {
                    "type": "text",
                    "text": "```yaml\nmetadata:\n  name: test\n```"
                }
            ]
        }"#;
        let result = parse_script_response(response);
        assert!(result.is_ok(), "Expected Ok, got: {:?}", result.err());
        let yaml = result.unwrap();
        assert!(yaml.contains("metadata:"));
    }

    #[test]
    fn test_parse_script_response_extracts_from_code_block() {
        let response = r#"{
            "content": [
                {
                    "type": "text",
                    "text": "Here's the script:\n```yaml\nmetadata:\n  name: Demo\n```\nLet me know if you need changes."
                }
            ]
        }"#;
        let result = parse_script_response(response);
        assert!(result.is_ok());
        let yaml = result.unwrap();
        assert!(yaml.starts_with("metadata:"), "Should extract only YAML block, got: {}", yaml);
        assert!(!yaml.contains("```"), "Should not contain code fence markers");
    }

    #[test]
    fn test_validate_generated_yaml_valid() {
        let yaml = r#"
metadata:
  name: "Test"
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
      type: wait
      durationMs: 1000
"#;
        let result = validate_generated_yaml(yaml);
        assert!(result.is_ok(), "Expected Ok, got: {:?}", result.err());
    }

    #[test]
    fn test_validate_generated_yaml_invalid() {
        let yaml = "not: valid: script:";
        let result = validate_generated_yaml(yaml);
        assert!(result.is_err());
    }
}
