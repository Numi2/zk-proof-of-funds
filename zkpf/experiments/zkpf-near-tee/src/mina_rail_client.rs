//! Mina Rail HTTP client for the PCD Keeper.
//!
//! This module provides a client for communicating with the Mina Recursive Rail
//! backend to submit tachystamps and query epoch state.
//!
//! # Architecture
//!
//! The Mina Rail aggregates tachystamps into per-epoch recursive proofs:
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────────┐
//! │                          Mina Rail                                   │
//! ├─────────────────────────────────────────────────────────────────────┤
//! │                                                                      │
//! │   Tachystamps ──► Shards ──► Shard Proofs ──► Epoch Proof           │
//! │                                                                      │
//! │   • Each shard aggregates ~100 tachystamps                          │
//! │   • Shards are proven in parallel                                   │
//! │   • Shard proofs are recursively combined into epoch proof          │
//! │   • Epoch proof is anchored on Mina L1                              │
//! │                                                                      │
//! └─────────────────────────────────────────────────────────────────────┘
//! ```

use std::time::Duration;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::pcd_keeper::{PcdKeeperError, Tachystamp};

// ═══════════════════════════════════════════════════════════════════════════════
// ERRORS
// ═══════════════════════════════════════════════════════════════════════════════

/// Errors from the Mina Rail client.
#[derive(Debug, Error)]
pub enum MinaRailError {
    #[error("Connection failed: {0}")]
    ConnectionFailed(String),

    #[error("Request failed: {0}")]
    RequestFailed(String),

    #[error("Invalid response: {0}")]
    InvalidResponse(String),

    #[error("Submission failed: {0}")]
    SubmissionFailed(String),

    #[error("Epoch not found: {0}")]
    EpochNotFound(u64),

    #[error("Rate limited")]
    RateLimited,

    #[error("Server error: {0}")]
    ServerError(String),
}

impl From<MinaRailError> for PcdKeeperError {
    fn from(e: MinaRailError) -> Self {
        PcdKeeperError::MinaRailUnavailable(e.to_string())
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MINA RAIL TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/// Request to submit a tachystamp.
#[derive(Clone, Debug, Serialize)]
pub struct SubmitTachystampRequest {
    /// The tachystamp to submit.
    pub tachystamp: TachystampSubmission,
}

/// Tachystamp data for submission (API format).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TachystampSubmission {
    /// Epoch number.
    pub epoch: u64,
    /// Nullifier (hex).
    pub nullifier: String,
    /// Holder commitment (hex).
    pub holder_commitment: String,
    /// Policy ID.
    pub policy_id: u64,
    /// Threshold value.
    pub threshold: u128,
    /// Currency code.
    pub currency_code: u32,
    /// Proof data.
    pub proof_data: TachystampProofSubmission,
    /// L1 block number.
    pub l1_block_number: u64,
    /// L1 transaction hash (hex).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub l1_tx_hash: Option<String>,
}

/// Proof data for submission (API format).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TachystampProofSubmission {
    /// Proof bytes (base64).
    pub proof_bytes: String,
    /// Public inputs (hex strings).
    pub public_inputs: Vec<String>,
    /// VK hash (hex).
    pub vk_hash: String,
}

/// Response from tachystamp submission.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitTachystampResponse {
    /// Whether submission was successful.
    pub success: bool,
    /// Assigned tachystamp ID.
    pub tachystamp_id: String,
    /// Assigned shard.
    pub shard_id: i32,
    /// Current epoch.
    pub epoch: u64,
    /// Position in aggregation queue.
    pub queue_position: i32,
    /// Error message if failed.
    pub error: Option<String>,
}

/// Mina Rail status.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinaRailStatus {
    /// Current epoch being aggregated.
    pub current_epoch: u64,
    /// Total tachystamps in current epoch.
    pub total_tachystamps: u64,
    /// Aggregation progress (0-100).
    pub aggregation_progress: f32,
    /// Sync status.
    pub sync_status: String,
    /// Latest finalized epoch.
    pub latest_finalized_epoch: u64,
    /// Latest epoch proof hash.
    pub latest_epoch_proof_hash: Option<String>,
    /// Time until next epoch (seconds).
    pub time_to_next_epoch: u64,
    /// Error message if any.
    pub error: Option<String>,
}

/// Epoch state.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinaRailEpochState {
    /// Epoch number.
    pub epoch: u64,
    /// Start slot.
    pub start_slot: u64,
    /// End slot (if finalized).
    pub end_slot: Option<u64>,
    /// Nullifier root.
    pub nullifier_root: String,
    /// Tachystamp count.
    pub tachystamp_count: u64,
    /// Holder count.
    pub holder_count: u64,
    /// Accumulator hash.
    pub accumulator_hash: String,
    /// Previous epoch hash.
    pub previous_epoch_hash: String,
    /// Whether finalized.
    pub is_finalized: bool,
}

/// Epoch proof.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinaRailEpochProof {
    /// Epoch number.
    pub epoch: u64,
    /// Pre-state hash.
    pub pre_state_hash: String,
    /// Post-state hash.
    pub post_state_hash: String,
    /// Nullifier root.
    pub nullifier_root: String,
    /// Proof count.
    pub proof_count: u64,
    /// Proof hash.
    pub proof_hash: String,
    /// Mina anchor hash.
    pub mina_anchor_hash: String,
    /// Mina slot.
    pub mina_slot: u64,
}

/// Get epoch proof response.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetEpochProofResponse {
    /// Whether finalized.
    pub is_finalized: bool,
    /// The proof (if finalized).
    pub proof: Option<MinaRailEpochProof>,
    /// Current state.
    pub epoch_state: MinaRailEpochState,
}

// ═══════════════════════════════════════════════════════════════════════════════
// MINA RAIL CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

/// Configuration for the Mina Rail client.
#[derive(Clone, Debug)]
pub struct MinaRailConfig {
    /// Base URL for the Mina Rail API.
    pub base_url: String,
    /// Request timeout.
    pub timeout: Duration,
    /// Max retries on failure.
    pub max_retries: u32,
}

impl Default for MinaRailConfig {
    fn default() -> Self {
        Self {
            base_url: "http://localhost:3000".to_string(),
            timeout: Duration::from_secs(30),
            max_retries: 3,
        }
    }
}

/// Mina Rail HTTP client.
pub struct MinaRailClient {
    /// Configuration.
    config: MinaRailConfig,
    /// HTTP client.
    http_client: reqwest::Client,
}

impl MinaRailClient {
    /// Create a new Mina Rail client.
    pub fn new(config: MinaRailConfig) -> Result<Self, MinaRailError> {
        let http_client = reqwest::Client::builder()
            .timeout(config.timeout)
            .build()
            .map_err(|e| MinaRailError::ConnectionFailed(e.to_string()))?;

        Ok(Self {
            config,
            http_client,
        })
    }

    /// Create a client with default configuration.
    pub fn default_client() -> Result<Self, MinaRailError> {
        Self::new(MinaRailConfig::default())
    }

    /// Create a client for a specific URL.
    pub fn with_url(base_url: impl Into<String>) -> Result<Self, MinaRailError> {
        Self::new(MinaRailConfig {
            base_url: base_url.into(),
            ..Default::default()
        })
    }

    /// Get the current Mina Rail status.
    pub async fn get_status(&self) -> Result<MinaRailStatus, MinaRailError> {
        let url = format!("{}/mina-rail/status", self.config.base_url);
        self.get(&url).await
    }

    /// Get epoch state.
    pub async fn get_epoch_state(&self, epoch: Option<u64>) -> Result<MinaRailEpochState, MinaRailError> {
        let path = match epoch {
            Some(e) => format!("/mina-rail/epoch/{}/state", e),
            None => "/mina-rail/epoch/current/state".to_string(),
        };
        let url = format!("{}{}", self.config.base_url, path);
        self.get(&url).await
    }

    /// Get epoch proof.
    pub async fn get_epoch_proof(&self, epoch: u64) -> Result<GetEpochProofResponse, MinaRailError> {
        let url = format!("{}/mina-rail/epoch/{}/proof", self.config.base_url, epoch);
        self.get(&url).await
    }

    /// Submit a tachystamp for aggregation.
    pub async fn submit_tachystamp(
        &self,
        tachystamp: &Tachystamp,
    ) -> Result<SubmitTachystampResponse, MinaRailError> {
        let url = format!("{}/mina-rail/tachystamp/submit", self.config.base_url);

        // Convert internal tachystamp to API format
        let submission = TachystampSubmission {
            epoch: tachystamp.epoch,
            nullifier: hex_encode(&tachystamp.nullifier),
            holder_commitment: hex_encode(&tachystamp.holder_commitment),
            policy_id: tachystamp.policy_id,
            threshold: tachystamp.threshold,
            currency_code: tachystamp.currency_code,
            proof_data: TachystampProofSubmission {
                proof_bytes: base64_encode(&tachystamp.proof_data.proof_bytes),
                public_inputs: tachystamp
                    .proof_data
                    .public_inputs
                    .iter()
                    .map(|pi| hex_encode(pi))
                    .collect(),
                vk_hash: hex_encode(&tachystamp.proof_data.vk_hash),
            },
            l1_block_number: tachystamp.l1_block_number,
            l1_tx_hash: tachystamp.l1_tx_hash.map(|h| hex_encode(&h)),
        };

        let request = SubmitTachystampRequest {
            tachystamp: submission,
        };

        self.post(&url, &request).await
    }

    /// Check if a nullifier has been used.
    pub async fn is_nullifier_used(&self, nullifier: &[u8; 32]) -> Result<bool, MinaRailError> {
        let url = format!(
            "{}/mina-rail/nullifier/{}/check",
            self.config.base_url,
            hex_encode(nullifier)
        );

        #[derive(Deserialize)]
        struct NullifierCheck {
            used: bool,
        }

        let response: NullifierCheck = self.get(&url).await?;
        Ok(response.used)
    }

    /// Health check.
    pub async fn health_check(&self) -> bool {
        self.get_status().await.is_ok()
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HTTP HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    async fn get<T: serde::de::DeserializeOwned>(&self, url: &str) -> Result<T, MinaRailError> {
        let mut last_error = None;

        for attempt in 0..self.config.max_retries {
            match self.http_client.get(url).send().await {
                Ok(response) => {
                    if response.status().is_success() {
                        return response
                            .json()
                            .await
                            .map_err(|e| MinaRailError::InvalidResponse(e.to_string()));
                    } else if response.status().as_u16() == 429 {
                        last_error = Some(MinaRailError::RateLimited);
                        // Exponential backoff
                        tokio::time::sleep(Duration::from_millis(100 * 2u64.pow(attempt))).await;
                        continue;
                    } else if response.status().as_u16() == 404 {
                        return Err(MinaRailError::RequestFailed("Not found".into()));
                    } else {
                        let status = response.status();
                        let body = response.text().await.unwrap_or_default();
                        return Err(MinaRailError::ServerError(format!(
                            "HTTP {}: {}",
                            status, body
                        )));
                    }
                }
                Err(e) => {
                    last_error = Some(MinaRailError::ConnectionFailed(e.to_string()));
                    if attempt < self.config.max_retries - 1 {
                        tokio::time::sleep(Duration::from_millis(100 * 2u64.pow(attempt))).await;
                    }
                }
            }
        }

        Err(last_error.unwrap_or(MinaRailError::RequestFailed("Max retries exceeded".into())))
    }

    async fn post<T: serde::de::DeserializeOwned, R: serde::Serialize>(
        &self,
        url: &str,
        body: &R,
    ) -> Result<T, MinaRailError> {
        let mut last_error = None;

        for attempt in 0..self.config.max_retries {
            match self
                .http_client
                .post(url)
                .header("Content-Type", "application/json")
                .json(body)
                .send()
                .await
            {
                Ok(response) => {
                    if response.status().is_success() {
                        return response
                            .json()
                            .await
                            .map_err(|e| MinaRailError::InvalidResponse(e.to_string()));
                    } else if response.status().as_u16() == 429 {
                        last_error = Some(MinaRailError::RateLimited);
                        tokio::time::sleep(Duration::from_millis(100 * 2u64.pow(attempt))).await;
                        continue;
                    } else {
                        let status = response.status();
                        let body = response.text().await.unwrap_or_default();
                        
                        // Try to parse error from response
                        if let Ok(err_response) = serde_json::from_str::<ErrorResponse>(&body) {
                            let message = err_response
                                .error
                                .or(err_response.message)
                                .unwrap_or_else(|| format!("HTTP {}", status));
                            return Err(MinaRailError::SubmissionFailed(message));
                        }
                        
                        return Err(MinaRailError::ServerError(format!(
                            "HTTP {}: {}",
                            status, body
                        )));
                    }
                }
                Err(e) => {
                    last_error = Some(MinaRailError::ConnectionFailed(e.to_string()));
                    if attempt < self.config.max_retries - 1 {
                        tokio::time::sleep(Duration::from_millis(100 * 2u64.pow(attempt))).await;
                    }
                }
            }
        }

        Err(last_error.unwrap_or(MinaRailError::RequestFailed("Max retries exceeded".into())))
    }
}

/// Generic error response.
#[derive(Deserialize)]
struct ErrorResponse {
    error: Option<String>,
    message: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENCODING HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

fn hex_encode(bytes: &[u8]) -> String {
    format!("0x{}", bytes.iter().map(|b| format!("{:02x}", b)).collect::<String>())
}

fn base64_encode(bytes: &[u8]) -> String {
    use base64::{Engine, engine::general_purpose::STANDARD};
    STANDARD.encode(bytes)
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_default() {
        let config = MinaRailConfig::default();
        assert!(config.base_url.contains("localhost"));
        assert_eq!(config.max_retries, 3);
    }

    #[test]
    fn test_hex_encode() {
        let bytes = [0x01, 0x02, 0x03, 0x04];
        assert_eq!(hex_encode(&bytes), "0x01020304");
    }

    #[test]
    fn test_base64_encode() {
        let bytes = b"hello";
        let encoded = base64_encode(bytes);
        assert_eq!(encoded, "aGVsbG8=");
    }

    #[tokio::test]
    async fn test_client_creation() {
        let client = MinaRailClient::default_client();
        assert!(client.is_ok());
    }

    #[test]
    fn test_tachystamp_serialization() {
        let submission = TachystampSubmission {
            epoch: 1,
            nullifier: "0x1234".to_string(),
            holder_commitment: "0x5678".to_string(),
            policy_id: 100,
            threshold: 1000,
            currency_code: 0x5A4543,
            proof_data: TachystampProofSubmission {
                proof_bytes: "base64data".to_string(),
                public_inputs: vec!["0xabc".to_string()],
                vk_hash: "0xdef".to_string(),
            },
            l1_block_number: 2500000,
            l1_tx_hash: None,
        };

        let json = serde_json::to_string(&SubmitTachystampRequest {
            tachystamp: submission,
        }).unwrap();

        assert!(json.contains("nullifier"));
        assert!(json.contains("holderCommitment"));
        assert!(json.contains("proofData"));
    }
}

