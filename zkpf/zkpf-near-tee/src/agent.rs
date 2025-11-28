//! NEAR TEE Agent implementation.

use std::collections::HashMap;

use crate::attestation::{TeeAttestation, TeeProvider};
use crate::crypto::TeeKeyManager;
use crate::error::NearTeeError;
use crate::inference::{AiInference, InferenceRequest, PrivacyFilter};
use crate::types::{AccountId, AgentAction, AgentResponse, AgentState};

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/// Configuration for the NEAR TEE agent.
#[derive(Clone, Debug)]
pub struct AgentConfig {
    /// NEAR network (mainnet/testnet).
    pub network: NearNetwork,
    /// NEAR RPC endpoint.
    pub rpc_url: String,
    /// Agent contract account ID.
    pub agent_account_id: AccountId,
    /// TEE provider configuration.
    pub tee_provider: TeeProvider,
    /// AI model identifier.
    pub model_id: String,
    /// Maximum tokens per inference.
    pub max_tokens: usize,
    /// Inference temperature.
    pub temperature: f32,
    /// Enable privacy filter.
    pub privacy_filter_enabled: bool,
}

/// NEAR network selection.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NearNetwork {
    Mainnet,
    Testnet,
}

impl AgentConfig {
    pub fn testnet(agent_account_id: impl Into<String>) -> Self {
        Self {
            network: NearNetwork::Testnet,
            rpc_url: "https://rpc.testnet.near.org".to_string(),
            agent_account_id: AccountId::new(agent_account_id),
            tee_provider: TeeProvider::Mock,
            model_id: "default".to_string(),
            max_tokens: 2048,
            temperature: 0.7,
            privacy_filter_enabled: true,
        }
    }

    pub fn mainnet(agent_account_id: impl Into<String>) -> Self {
        Self {
            network: NearNetwork::Mainnet,
            rpc_url: "https://rpc.mainnet.near.org".to_string(),
            agent_account_id: AccountId::new(agent_account_id),
            tee_provider: TeeProvider::Mock, // Would be real TEE in production
            model_id: "default".to_string(),
            max_tokens: 2048,
            temperature: 0.7,
            privacy_filter_enabled: true,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AGENT CAPABILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/// Capabilities of the NEAR TEE agent.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum AgentCapability {
    /// Wallet analysis and insights.
    WalletAnalysis,
    /// Proof strategy suggestions.
    ProofStrategy,
    /// Natural language intent parsing.
    IntentParsing,
    /// Privacy-preserving explanations.
    Explanation,
    /// Key derivation within TEE.
    KeyDerivation,
    /// Signing within TEE.
    Signing,
    /// Cross-chain message construction.
    CrossChainMessaging,
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEAR AGENT
// ═══════════════════════════════════════════════════════════════════════════════

/// The main NEAR TEE agent.
pub struct NearAgent {
    config: AgentConfig,
    key_manager: TeeKeyManager,
    inference: AiInference,
    privacy_filter: PrivacyFilter,
    state: AgentState,
    attestation: Option<TeeAttestation>,
}

impl NearAgent {
    /// Create a new NEAR TEE agent.
    pub fn new(config: AgentConfig) -> Result<Self, NearTeeError> {
        let key_manager = TeeKeyManager::new(&config.tee_provider)?;
        let inference = AiInference::new(&config.model_id, config.max_tokens, config.temperature)?;
        let privacy_filter = PrivacyFilter::new(config.privacy_filter_enabled);

        let state = AgentState {
            owner: config.agent_account_id.clone(),
            version: crate::NEAR_TEE_VERSION,
            attestation_hash: [0u8; 32],
            last_activity: current_timestamp(),
            inference_count: 0,
            key_count: 0,
        };

        Ok(Self {
            config,
            key_manager,
            inference,
            privacy_filter,
            state,
            attestation: None,
        })
    }

    /// Initialize the agent with TEE attestation.
    pub async fn initialize(&mut self) -> Result<(), NearTeeError> {
        // Generate TEE attestation
        let attestation = TeeAttestation::generate(&self.config.tee_provider).await?;
        
        // Store attestation hash in state
        self.state.attestation_hash = attestation.hash();
        self.attestation = Some(attestation);

        tracing::info!(
            "NEAR TEE agent initialized with attestation hash: {:?}",
            hex::encode(&self.state.attestation_hash[..8])
        );

        Ok(())
    }

    /// Execute an agent action.
    pub async fn execute(&mut self, action: AgentAction) -> Result<AgentResponse, NearTeeError> {
        // Verify TEE attestation is valid
        if let Some(ref attestation) = self.attestation {
            if attestation.is_expired() {
                return Err(NearTeeError::AttestationExpired);
            }
        } else {
            return Err(NearTeeError::TeeNotAvailable(
                "Agent not initialized".into(),
            ));
        }

        // Update state
        self.state.last_activity = current_timestamp();

        // Execute action
        match action {
            AgentAction::AnalyzeWallet {
                wallet_id,
                analysis_type,
            } => self.analyze_wallet(wallet_id, analysis_type).await,

            AgentAction::SuggestProofStrategy {
                policy_id,
                available_rails,
                balance_commitment,
            } => {
                self.suggest_proof_strategy(policy_id, available_rails, balance_commitment)
                    .await
            }

            AgentAction::ParseIntent { input, context } => {
                self.parse_intent(&input, context).await
            }

            AgentAction::Explain {
                topic,
                detail_level,
            } => self.explain(topic, detail_level).await,

            AgentAction::DeriveKey {
                derivation_path,
                key_type,
            } => self.derive_key(&derivation_path, key_type).await,

            AgentAction::Sign { data_hash, key_id } => {
                self.sign(&data_hash, &key_id).await
            }
        }
    }

    /// Get the current agent state.
    pub fn state(&self) -> &AgentState {
        &self.state
    }

    /// Get the current TEE attestation.
    pub fn attestation(&self) -> Option<&TeeAttestation> {
        self.attestation.as_ref()
    }

    /// Get available capabilities.
    pub fn capabilities(&self) -> Vec<AgentCapability> {
        vec![
            AgentCapability::WalletAnalysis,
            AgentCapability::ProofStrategy,
            AgentCapability::IntentParsing,
            AgentCapability::Explanation,
            AgentCapability::KeyDerivation,
            AgentCapability::Signing,
        ]
    }

    // === Action implementations ===

    async fn analyze_wallet(
        &mut self,
        wallet_id: [u8; 32],
        analysis_type: crate::types::WalletAnalysisType,
    ) -> Result<AgentResponse, NearTeeError> {
        let prompt = format!(
            "Analyze wallet {} for {:?}. Provide insights without revealing specific balances or addresses.",
            hex::encode(&wallet_id[..8]),
            analysis_type
        );

        let request = InferenceRequest {
            prompt,
            max_tokens: Some(512),
            temperature: Some(0.5),
            stop_sequences: vec![],
        };

        let result = self.inference.run(&request).await?;
        let filtered = self.privacy_filter.filter(&result.text)?;

        self.state.inference_count += 1;

        Ok(AgentResponse::Analysis {
            summary: filtered,
            insights: vec![],
            recommendations: vec![],
        })
    }

    async fn suggest_proof_strategy(
        &mut self,
        policy_id: u64,
        available_rails: Vec<String>,
        _balance_commitment: [u8; 32],
    ) -> Result<AgentResponse, NearTeeError> {
        // Suggest based on rail capabilities
        let recommended = if available_rails.contains(&"ZCASH_ORCHARD".to_string()) {
            "ZCASH_ORCHARD"
        } else if available_rails.contains(&"STARKNET_L2".to_string()) {
            "STARKNET_L2"
        } else {
            available_rails.first().map(|s| s.as_str()).unwrap_or("NONE")
        };

        self.state.inference_count += 1;

        Ok(AgentResponse::ProofStrategy {
            recommended_rail: recommended.to_string(),
            reasoning: format!(
                "For policy {}, {} offers the best balance of privacy and efficiency.",
                policy_id, recommended
            ),
            success_probability: 0.9,
            alternatives: available_rails
                .iter()
                .filter(|r| r.as_str() != recommended)
                .map(|r| crate::types::AlternativeStrategy {
                    rail: r.clone(),
                    pros: vec!["Available".to_string()],
                    cons: vec![],
                })
                .collect(),
        })
    }

    async fn parse_intent(
        &mut self,
        input: &str,
        context: crate::types::IntentContext,
    ) -> Result<AgentResponse, NearTeeError> {
        let prompt = format!(
            "Parse the following user intent into a structured action.\n\
             Available actions: {:?}\n\
             Current mode: {}\n\
             User input: \"{}\"\n\
             Output as JSON with action_type and params.",
            context.available_actions, context.current_mode, input
        );

        let request = InferenceRequest {
            prompt,
            max_tokens: Some(256),
            temperature: Some(0.3),
            stop_sequences: vec![],
        };

        let result = self.inference.run(&request).await?;
        let filtered = self.privacy_filter.filter(&result.text)?;

        self.state.inference_count += 1;

        // Try to parse the response as JSON
        let parsed = serde_json::from_str(&filtered).ok();

        Ok(AgentResponse::ParsedIntent {
            action: parsed,
            confidence: 0.8,
            clarification_needed: None,
        })
    }

    async fn explain(
        &mut self,
        topic: crate::types::ExplanationTopic,
        detail_level: crate::types::DetailLevel,
    ) -> Result<AgentResponse, NearTeeError> {
        let detail_instruction = match detail_level {
            crate::types::DetailLevel::Brief => "in one sentence",
            crate::types::DetailLevel::Standard => "in a clear paragraph",
            crate::types::DetailLevel::Detailed => "with technical details",
        };

        let topic_str = match &topic {
            crate::types::ExplanationTopic::Proof { proof_type } => {
                format!("the {} proof type", proof_type)
            }
            crate::types::ExplanationTopic::Policy { policy_id } => {
                format!("policy {}", policy_id)
            }
            crate::types::ExplanationTopic::Rail { rail_id } => {
                format!("the {} rail", rail_id)
            }
            crate::types::ExplanationTopic::Privacy { context } => {
                format!("privacy implications of {}", context)
            }
            crate::types::ExplanationTopic::Help { query } => {
                format!("how to {}", query)
            }
        };

        let prompt = format!(
            "Explain {} {}. Do not reveal any specific wallet data or balances.",
            topic_str, detail_instruction
        );

        let request = InferenceRequest {
            prompt,
            max_tokens: Some(match detail_level {
                crate::types::DetailLevel::Brief => 100,
                crate::types::DetailLevel::Standard => 300,
                crate::types::DetailLevel::Detailed => 800,
            }),
            temperature: Some(0.5),
            stop_sequences: vec![],
        };

        let result = self.inference.run(&request).await?;
        let filtered = self.privacy_filter.filter(&result.text)?;

        self.state.inference_count += 1;

        Ok(AgentResponse::Explanation {
            text: filtered,
            related_topics: vec![],
        })
    }

    async fn derive_key(
        &mut self,
        derivation_path: &str,
        key_type: crate::types::KeyType,
    ) -> Result<AgentResponse, NearTeeError> {
        let (public_key, key_id) = self
            .key_manager
            .derive_key(derivation_path, key_type)
            .await?;

        self.state.key_count += 1;

        Ok(AgentResponse::DerivedKey {
            public_key,
            key_id,
        })
    }

    async fn sign(
        &mut self,
        data_hash: &[u8; 32],
        key_id: &str,
    ) -> Result<AgentResponse, NearTeeError> {
        let signature = self.key_manager.sign(data_hash, key_id).await?;

        Ok(AgentResponse::Signature {
            signature,
            key_id: key_id.to_string(),
        })
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time went backwards")
        .as_secs()
}

mod hex {
    pub fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }
}

