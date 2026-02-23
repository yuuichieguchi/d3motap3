//! Narration text generation via LLM API.

use super::call_claude_api;

/// Build the prompt for narration generation.
pub fn build_narration_prompt(video_description: &str) -> String {
    format!(
        "You are a narration writer for screen recording demos. \
         Based on the following video description, generate clear and concise \
         narration/subtitle text that can be overlaid on the recording. \
         Write each subtitle as a separate line with a timestamp estimate.\n\n\
         Video description: {}\n\n\
         Output the narration text only, no additional commentary.",
        video_description
    )
}

/// Parse the Claude API response JSON to extract text content.
pub fn parse_narration_response(response_body: &str) -> Result<String, String> {
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

    Ok(text.to_string())
}

/// Call Claude API to generate narration (blocking HTTP).
pub fn generate_narration(description: &str, api_key: &str) -> Result<String, String> {
    let prompt = build_narration_prompt(description);
    let response = call_claude_api(&prompt, api_key)?;
    parse_narration_response(&response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_narration_prompt_contains_description() {
        let prompt = build_narration_prompt("A terminal showing git commands");
        assert!(prompt.contains("git commands"), "Prompt should contain the description");
        assert!(prompt.contains("narration") || prompt.contains("subtitle"),
            "Prompt should mention narration/subtitle generation");
    }

    #[test]
    fn test_build_narration_prompt_not_empty() {
        let prompt = build_narration_prompt("demo video");
        assert!(!prompt.is_empty());
        assert!(prompt.len() > 50, "Prompt should be substantial, got {} chars", prompt.len());
    }

    #[test]
    fn test_parse_narration_response_valid() {
        let response = r#"{
            "content": [
                {
                    "type": "text",
                    "text": "Welcome to this demo. First, we initialize the project."
                }
            ]
        }"#;
        let result = parse_narration_response(response);
        assert!(result.is_ok(), "Expected Ok, got: {:?}", result.err());
        let text = result.unwrap();
        assert!(text.contains("Welcome to this demo"));
    }

    #[test]
    fn test_parse_narration_response_invalid_json() {
        let result = parse_narration_response("not json");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_narration_response_empty_content() {
        let response = r#"{"content": []}"#;
        let result = parse_narration_response(response);
        assert!(result.is_err());
    }
}
