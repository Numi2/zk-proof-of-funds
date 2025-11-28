//! Core types for the NEAR TEE agent.

use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════════════
// NEAR ACCOUNT
// ═══════════════════════════════════════════════════════════════════════════════

/// NEAR account identifier.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AccountId(pub String);

impl AccountId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for AccountId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT ACTION
// ═══════════════════════════════════════════════════════════════════════════════

/// Actions the agent can perform.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentAction {
    /// Analyze wallet state and provide insights.
    AnalyzeWallet {
        /// Wallet identifier (opaque to preserve privacy).
        wallet_id: [u8; 32],
        /// What aspects to analyze.
        analysis_type: WalletAnalysisType,
    },
    /// Suggest optimal proof generation strategy.
    SuggestProofStrategy {
        /// Policy to prove.
        policy_id: u64,
        /// Available rails.
        available_rails: Vec<String>,
        /// Current balances (encrypted or hashed).
        balance_commitment: [u8; 32],
    },
    /// Parse natural language intent into structured action.
    ParseIntent {
        /// User's natural language input.
        input: String,
        /// Context about current wallet state.
        context: IntentContext,
    },
    /// Generate privacy-preserving explanation.
    Explain {
        /// What to explain.
        topic: ExplanationTopic,
        /// Detail level.
        detail_level: DetailLevel,
    },
    /// Derive keys within TEE.
    DeriveKey {
        /// Key derivation path.
        derivation_path: String,
        /// Key type to derive.
        key_type: KeyType,
    },
    /// Sign data within TEE.
    Sign {
        /// Data to sign (hash).
        data_hash: [u8; 32],
        /// Key identifier.
        key_id: String,
    },
}

/// Types of wallet analysis.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WalletAnalysisType {
    /// Overall portfolio health.
    PortfolioHealth,
    /// Privacy recommendations.
    PrivacyRecommendations,
    /// Gas optimization suggestions.
    GasOptimization,
    /// Risk assessment.
    RiskAssessment,
    /// Activity patterns (anonymized).
    ActivityPatterns,
}

/// Context for intent parsing.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IntentContext {
    /// Available actions.
    pub available_actions: Vec<String>,
    /// Current mode/screen.
    pub current_mode: String,
    /// Recent actions (anonymized).
    pub recent_action_types: Vec<String>,
}

/// Topics for explanation.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExplanationTopic {
    /// Explain a specific proof.
    Proof { proof_type: String },
    /// Explain a policy.
    Policy { policy_id: u64 },
    /// Explain a rail.
    Rail { rail_id: String },
    /// Explain privacy implications.
    Privacy { context: String },
    /// General help.
    Help { query: String },
}

/// Detail level for explanations.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DetailLevel {
    /// Brief one-liner.
    Brief,
    /// Standard explanation.
    #[default]
    Standard,
    /// Detailed technical explanation.
    Detailed,
}

/// Key types that can be derived.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KeyType {
    /// Ed25519 signing key.
    Ed25519,
    /// X25519 encryption key.
    X25519,
    /// Secp256k1 (for Ethereum compatibility).
    Secp256k1,
}

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT RESPONSE
// ═══════════════════════════════════════════════════════════════════════════════

/// Response from the agent.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentResponse {
    /// Analysis result.
    Analysis {
        /// Analysis summary.
        summary: String,
        /// Specific insights.
        insights: Vec<Insight>,
        /// Recommended actions.
        recommendations: Vec<Recommendation>,
    },
    /// Proof strategy suggestion.
    ProofStrategy {
        /// Recommended rail.
        recommended_rail: String,
        /// Reasoning.
        reasoning: String,
        /// Estimated success probability.
        success_probability: f32,
        /// Alternative strategies.
        alternatives: Vec<AlternativeStrategy>,
    },
    /// Parsed intent.
    ParsedIntent {
        /// Structured action.
        action: Option<ParsedAction>,
        /// Confidence score.
        confidence: f32,
        /// Clarification needed.
        clarification_needed: Option<String>,
    },
    /// Explanation.
    Explanation {
        /// Explanation text.
        text: String,
        /// Related topics.
        related_topics: Vec<String>,
    },
    /// Derived key.
    DerivedKey {
        /// Public key (safe to expose).
        public_key: Vec<u8>,
        /// Key identifier.
        key_id: String,
    },
    /// Signature.
    Signature {
        /// Signature bytes.
        signature: Vec<u8>,
        /// Key identifier used.
        key_id: String,
    },
    /// Error response.
    Error {
        /// Error message.
        message: String,
        /// Error code.
        code: String,
    },
}

/// Insight from analysis.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Insight {
    /// Insight category.
    pub category: String,
    /// Insight description.
    pub description: String,
    /// Severity/importance (0-1).
    pub importance: f32,
}

/// Recommendation from analysis.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Recommendation {
    /// Action to take.
    pub action: String,
    /// Reason for recommendation.
    pub reason: String,
    /// Priority (0-1).
    pub priority: f32,
}

/// Alternative proof strategy.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AlternativeStrategy {
    /// Rail to use.
    pub rail: String,
    /// Pros of this strategy.
    pub pros: Vec<String>,
    /// Cons of this strategy.
    pub cons: Vec<String>,
}

/// Parsed action from natural language.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ParsedAction {
    /// Action type.
    pub action_type: String,
    /// Parameters.
    pub params: std::collections::HashMap<String, serde_json::Value>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT STATE
// ═══════════════════════════════════════════════════════════════════════════════

/// Agent state stored on NEAR.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AgentState {
    /// Owner account.
    pub owner: AccountId,
    /// Agent version.
    pub version: u32,
    /// TEE attestation hash.
    pub attestation_hash: [u8; 32],
    /// Last activity timestamp.
    pub last_activity: u64,
    /// Total inference count.
    pub inference_count: u64,
    /// Derived key count.
    pub key_count: u32,
}

