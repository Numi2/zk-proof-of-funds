//! AI inference within the TEE.

use serde::{Deserialize, Serialize};

use crate::error::NearTeeError;

// ═══════════════════════════════════════════════════════════════════════════════
// AI INFERENCE
// ═══════════════════════════════════════════════════════════════════════════════

/// AI inference engine running within the TEE.
pub struct AiInference {
    model_id: String,
    max_tokens: usize,
    temperature: f32,
    loaded: bool,
}

impl AiInference {
    /// Create a new inference engine.
    pub fn new(model_id: &str, max_tokens: usize, temperature: f32) -> Result<Self, NearTeeError> {
        Ok(Self {
            model_id: model_id.to_string(),
            max_tokens,
            temperature,
            loaded: false,
        })
    }

    /// Load the model into TEE memory.
    pub async fn load_model(&mut self) -> Result<(), NearTeeError> {
        // In production, this would load an actual model
        // For now, mark as loaded
        self.loaded = true;
        tracing::info!("Model {} loaded (mock)", self.model_id);
        Ok(())
    }

    /// Run inference on a prompt.
    pub async fn run(&self, request: &InferenceRequest) -> Result<InferenceResult, NearTeeError> {
        let max_tokens = request.max_tokens.unwrap_or(self.max_tokens);

        if max_tokens > crate::MAX_INFERENCE_TOKENS {
            return Err(NearTeeError::TokenLimitExceeded {
                current: max_tokens,
                max: crate::MAX_INFERENCE_TOKENS,
            });
        }

        // Mock inference - in production would run actual LLM
        let response = self.mock_inference(&request.prompt)?;

        Ok(InferenceResult {
            text: response,
            // Scale mock token usage slightly with temperature to keep it "used".
            tokens_used: (100.0 * self.temperature.max(0.1).min(2.0)) as usize,
            finish_reason: FinishReason::Stop,
        })
    }

    fn mock_inference(&self, prompt: &str) -> Result<String, NearTeeError> {
        // Generate a contextually appropriate mock response
        let response = if prompt.contains("Analyze") {
            "Analysis complete. Your wallet shows healthy diversification across chains. \
             No specific balances or addresses are disclosed for privacy."
        } else if prompt.contains("strategy") || prompt.contains("recommend") {
            "Based on available options, the recommended approach balances privacy and efficiency. \
             Consider the primary rail for maximum privacy guarantees."
        } else if prompt.contains("Explain") {
            "This feature enables privacy-preserving proof generation. \
             Your data never leaves the secure enclave during processing."
        } else if prompt.contains("intent") || prompt.contains("Parse") {
            r#"{"action_type": "generate_proof", "params": {"rail": "recommended"}}"#
        } else {
            "I've processed your request within the secure enclave. \
             No sensitive data has been exposed."
        };

        Ok(response.to_string())
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INFERENCE REQUEST
// ═══════════════════════════════════════════════════════════════════════════════

/// Request for AI inference.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct InferenceRequest {
    /// The prompt to process.
    pub prompt: String,
    /// Maximum tokens to generate (optional).
    pub max_tokens: Option<usize>,
    /// Temperature for generation (optional).
    pub temperature: Option<f32>,
    /// Stop sequences.
    pub stop_sequences: Vec<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// INFERENCE RESULT
// ═══════════════════════════════════════════════════════════════════════════════

/// Result of AI inference.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct InferenceResult {
    /// Generated text.
    pub text: String,
    /// Tokens used.
    pub tokens_used: usize,
    /// Reason for stopping.
    pub finish_reason: FinishReason,
}

/// Reason inference stopped.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FinishReason {
    /// Normal completion.
    Stop,
    /// Hit token limit.
    MaxTokens,
    /// Hit stop sequence.
    StopSequence,
    /// Content filtered.
    ContentFilter,
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIVACY FILTER
// ═══════════════════════════════════════════════════════════════════════════════

/// Filter to prevent privacy leaks in AI outputs.
pub struct PrivacyFilter {
    enabled: bool,
    /// Patterns that should be redacted.
    sensitive_patterns: Vec<SensitivePattern>,
}

impl PrivacyFilter {
    /// Create a new privacy filter.
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            sensitive_patterns: default_sensitive_patterns(),
        }
    }

    /// Filter AI output for privacy.
    pub fn filter(&self, text: &str) -> Result<String, NearTeeError> {
        if !self.enabled {
            return Ok(text.to_string());
        }

        let mut filtered = text.to_string();

        for pattern in &self.sensitive_patterns {
            if pattern.matches(&filtered) {
                match pattern.action {
                    FilterAction::Redact => {
                        filtered = pattern.redact(&filtered);
                    }
                    FilterAction::Block => {
                        return Err(NearTeeError::PrivacyFilterBlocked(
                            pattern.description.clone(),
                        ));
                    }
                    FilterAction::Warn => {
                        tracing::warn!(
                            "Privacy warning: {} - continuing with output",
                            pattern.description
                        );
                    }
                }
            }
        }

        Ok(filtered)
    }
}

/// A pattern that indicates sensitive content.
struct SensitivePattern {
    /// Regex pattern or literal match.
    pattern_type: PatternType,
    /// What to do when matched.
    action: FilterAction,
    /// Description of the sensitivity.
    description: String,
}

impl SensitivePattern {
    fn matches(&self, text: &str) -> bool {
        match &self.pattern_type {
            PatternType::Literal(s) => text.contains(s),
            PatternType::Prefix(p) => {
                // Check for hex addresses with prefix
                text.contains(p)
            }
            PatternType::Numeric { min_digits } => {
                // Check for long numeric sequences that might be amounts
                text.chars()
                    .filter(|c| c.is_ascii_digit())
                    .count()
                    >= *min_digits
            }
        }
    }

    fn redact(&self, text: &str) -> String {
        match &self.pattern_type {
            PatternType::Literal(s) => text.replace(s, "[REDACTED]"),
            PatternType::Prefix(p) => {
                // Redact hex addresses starting with prefix
                let mut result = text.to_string();
                while let Some(idx) = result.find(p) {
                    let end = result[idx..]
                        .find(|c: char| !c.is_ascii_hexdigit() && c != 'x')
                        .map(|i| idx + i)
                        .unwrap_or(result.len());
                    result.replace_range(idx..end, "[ADDRESS]");
                }
                result
            }
            PatternType::Numeric { .. } => {
                // Redact large numbers
                text.to_string() // Would implement proper numeric redaction
            }
        }
    }
}

enum PatternType {
    Literal(String),
    Prefix(String),
    Numeric { min_digits: usize },
}

enum FilterAction {
    Redact,
    Block,
    Warn,
}

fn default_sensitive_patterns() -> Vec<SensitivePattern> {
    vec![
        // Zcash addresses
        SensitivePattern {
            pattern_type: PatternType::Prefix("zs1".to_string()),
            action: FilterAction::Redact,
            description: "Zcash shielded address".to_string(),
        },
        // Ethereum addresses
        SensitivePattern {
            pattern_type: PatternType::Prefix("0x".to_string()),
            action: FilterAction::Warn, // Just warn, as 0x is common
            description: "Potential Ethereum address".to_string(),
        },
        // Large numeric sequences that may represent exact balances.
        SensitivePattern {
            pattern_type: PatternType::Numeric { min_digits: 10 },
            action: FilterAction::Redact,
            description: "Large numeric value (possible balance or account number)".to_string(),
        },
        // Private keys (common prefixes)
        SensitivePattern {
            pattern_type: PatternType::Literal("privateKey".to_string()),
            action: FilterAction::Block,
            description: "Private key mention".to_string(),
        },
        SensitivePattern {
            pattern_type: PatternType::Literal("secret".to_string()),
            action: FilterAction::Warn,
            description: "Secret mention".to_string(),
        },
    ]
}

