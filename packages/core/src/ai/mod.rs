//! AI integration module: narration generation and YAML script generation.

pub mod narration;
pub mod script_gen;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};

use serde::Serialize;

static AI_STATUS: LazyLock<Mutex<AiStatus>> = LazyLock::new(|| Mutex::new(AiStatus::Idle));
static AI_CANCEL: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum AiStatus {
    Idle,
    Processing { task: String },
    Completed { result: String },
    Failed { error: String },
}

pub fn start_narration(description: String, api_key: String) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err("API key is required".to_string());
    }
    {
        let mut status = AI_STATUS.lock().map_err(|e| format!("Status lock error: {}", e))?;
        if matches!(*status, AiStatus::Processing { .. }) {
            return Err("AI task already running".to_string());
        }
        AI_CANCEL.store(false, Ordering::Relaxed);
        *status = AiStatus::Processing { task: "narration".to_string() };
    }

    std::thread::spawn(move || {
        if is_cancelled() {
            set_status(AiStatus::Failed { error: "Cancelled".to_string() });
            return;
        }

        match narration::generate_narration(&description, &api_key) {
            Ok(result) => {
                if is_cancelled() {
                    set_status(AiStatus::Failed { error: "Cancelled".to_string() });
                } else {
                    set_status(AiStatus::Completed { result });
                }
            }
            Err(e) => {
                set_status(AiStatus::Failed { error: e });
            }
        }
    });

    Ok(())
}

pub fn start_script_gen(description: String, api_key: String) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err("API key is required".to_string());
    }
    {
        let mut status = AI_STATUS.lock().map_err(|e| format!("Status lock error: {}", e))?;
        if matches!(*status, AiStatus::Processing { .. }) {
            return Err("AI task already running".to_string());
        }
        AI_CANCEL.store(false, Ordering::Relaxed);
        *status = AiStatus::Processing { task: "script_gen".to_string() };
    }

    std::thread::spawn(move || {
        if is_cancelled() {
            set_status(AiStatus::Failed { error: "Cancelled".to_string() });
            return;
        }

        match script_gen::generate_script(&description, &api_key) {
            Ok(result) => {
                if is_cancelled() {
                    set_status(AiStatus::Failed { error: "Cancelled".to_string() });
                } else {
                    set_status(AiStatus::Completed { result });
                }
            }
            Err(e) => {
                set_status(AiStatus::Failed { error: e });
            }
        }
    });

    Ok(())
}

pub fn get_ai_status() -> AiStatus {
    AI_STATUS.lock().ok().map(|s| s.clone()).unwrap_or(AiStatus::Idle)
}

pub fn get_ai_status_json() -> String {
    serde_json::to_string(&get_ai_status())
        .unwrap_or_else(|_| r#"{"status":"idle"}"#.to_string())
}

pub fn cancel_ai() -> Result<(), String> {
    AI_CANCEL.store(true, Ordering::Relaxed);
    Ok(())
}

pub fn reset_ai_status() -> Result<(), String> {
    let mut status = AI_STATUS.lock().map_err(|e| format!("Status lock error: {}", e))?;
    if !matches!(*status, AiStatus::Processing { .. }) {
        *status = AiStatus::Idle;
    }
    Ok(())
}

fn set_status(status: AiStatus) {
    if let Ok(mut s) = AI_STATUS.lock() {
        *s = status;
    }
}

fn is_cancelled() -> bool {
    AI_CANCEL.load(Ordering::Relaxed)
}

/// Call the Claude API with a given prompt. Returns the raw response body.
pub(crate) fn call_claude_api(prompt: &str, api_key: &str) -> Result<String, String> {
    let body = serde_json::json!({
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 4096,
        "messages": [
            {
                "role": "user",
                "content": prompt
            }
        ]
    });

    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(120))
        .build();
    let response = agent.post("https://api.anthropic.com/v1/messages")
        .set("x-api-key", api_key)
        .set("anthropic-version", "2023-06-01")
        .set("content-type", "application/json")
        .send_string(&body.to_string())
        .map_err(|e| {
            let msg = e.to_string();
            if msg.contains("401") || msg.contains("403") {
                "API authentication failed: check your API key".to_string()
            } else if msg.contains("429") {
                "API rate limit exceeded: try again later".to_string()
            } else if msg.contains("timeout") || msg.contains("Timeout") {
                "API request timed out".to_string()
            } else {
                "API request failed: network or server error".to_string()
            }
        })?;

    response.into_string()
        .map_err(|e| format!("Failed to read response body: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ai_status_serialization() {
        let json = serde_json::to_string(&AiStatus::Idle).unwrap();
        assert!(json.contains(r#""status":"idle""#));

        let json = serde_json::to_string(&AiStatus::Processing {
            task: "narration".to_string(),
        }).unwrap();
        assert!(json.contains(r#""status":"processing""#));
        assert!(json.contains(r#""task":"narration""#));

        let json = serde_json::to_string(&AiStatus::Completed {
            result: "generated text".to_string(),
        }).unwrap();
        assert!(json.contains(r#""status":"completed""#));

        let json = serde_json::to_string(&AiStatus::Failed {
            error: "API error".to_string(),
        }).unwrap();
        assert!(json.contains(r#""status":"failed""#));
    }

    #[test]
    fn test_get_ai_status_default() {
        // Default should be Idle (or whatever current state is)
        let status = get_ai_status();
        let json = serde_json::to_string(&status).unwrap();
        // Just verify it serializes without error
        assert!(!json.is_empty());
    }

    #[test]
    fn test_cancel_ai() {
        let result = cancel_ai();
        assert!(result.is_ok());
    }

    #[test]
    fn test_get_ai_status_json() {
        let json = get_ai_status_json();
        assert!(json.contains("status"));
    }
}
