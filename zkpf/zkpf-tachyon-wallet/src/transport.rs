//! Cross-chain transport layer via Axelar GMP.
//!
//! This module handles the relay of attestations and proofs across chains
//! using Axelar's General Message Passing protocol.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::attestation::UnifiedAttestation;
use crate::config::AxelarConfig;
use crate::error::TachyonError;
use crate::types::ChainId;

// ═══════════════════════════════════════════════════════════════════════════════
// AXELAR TRANSPORT
// ═══════════════════════════════════════════════════════════════════════════════

/// Axelar GMP transport for cross-chain attestations.
pub struct AxelarTransport {
    config: AxelarConfig,
    /// Trusted sources per chain.
    trusted_sources: HashMap<String, Vec<String>>,
}

impl AxelarTransport {
    pub fn new(config: AxelarConfig) -> Self {
        Self {
            config,
            trusted_sources: HashMap::new(),
        }
    }

    /// Check if transport is enabled and configured.
    pub fn is_available(&self) -> bool {
        self.config.enabled && self.config.gateway_address.is_some()
    }

    /// Add a trusted source for a chain.
    pub fn add_trusted_source(&mut self, chain: &str, address: &str) {
        self.trusted_sources
            .entry(chain.to_string())
            .or_default()
            .push(address.to_string());
    }

    /// Verify that a message source is trusted.
    pub fn verify_source(&self, chain: &str, address: &str) -> bool {
        self.trusted_sources
            .get(chain)
            .map(|addrs| addrs.iter().any(|a| a.eq_ignore_ascii_case(address)))
            .unwrap_or(false)
    }

    /// Broadcast an attestation to target chains via Axelar GMP.
    pub async fn broadcast_attestation(
        &self,
        attestation: &UnifiedAttestation,
        target_chains: &[ChainId],
    ) -> Result<BroadcastResult, TachyonError> {
        if !self.is_available() {
            return Err(TachyonError::Transport(
                "Axelar transport not configured".into(),
            ));
        }

        let message = self.encode_attestation(attestation)?;
        let mut results = Vec::new();

        for chain in target_chains {
            let chain_name = self.chain_id_to_axelar_name(chain)?;
            let receiver = self.get_receiver_for_chain(&chain_name)?;

            // In production, this would call the Axelar gateway contract
            let tx_result = ChainBroadcastResult {
                chain: chain.clone(),
                success: true,
                tx_hash: None, // Would be filled by actual transaction
                gas_used: 0,
                error: None,
            };

            results.push(tx_result);
        }

        Ok(BroadcastResult {
            attestation_id: attestation.attestation_id,
            chains: results,
            message_hash: message.hash(),
        })
    }

    /// Query attestation status on a target chain.
    pub async fn query_attestation(
        &self,
        attestation_id: &[u8; 32],
        chain: &ChainId,
    ) -> Result<AttestationQueryResult, TachyonError> {
        if !self.is_available() {
            return Err(TachyonError::Transport(
                "Axelar transport not configured".into(),
            ));
        }

        // In production, this would query the receiver contract on the target chain
        Ok(AttestationQueryResult {
            found: false,
            valid: false,
            expires_at: None,
            last_updated: None,
        })
    }

    /// Revoke an attestation across chains.
    pub async fn revoke_attestation(
        &self,
        attestation_id: &[u8; 32],
        holder_binding: &[u8; 32],
        target_chains: &[ChainId],
    ) -> Result<BroadcastResult, TachyonError> {
        if !self.is_available() {
            return Err(TachyonError::Transport(
                "Axelar transport not configured".into(),
            ));
        }

        let message = CrossChainMessage::Revocation {
            attestation_id: *attestation_id,
            holder_binding: *holder_binding,
        };

        let mut results = Vec::new();

        for chain in target_chains {
            let chain_name = self.chain_id_to_axelar_name(chain)?;
            let receiver = self.get_receiver_for_chain(&chain_name)?;

            let tx_result = ChainBroadcastResult {
                chain: chain.clone(),
                success: true,
                tx_hash: None,
                gas_used: 0,
                error: None,
            };

            results.push(tx_result);
        }

        Ok(BroadcastResult {
            attestation_id: *attestation_id,
            chains: results,
            message_hash: message.hash(),
        })
    }

    fn encode_attestation(
        &self,
        attestation: &UnifiedAttestation,
    ) -> Result<CrossChainMessage, TachyonError> {
        Ok(CrossChainMessage::Attestation {
            attestation_id: attestation.attestation_id,
            holder_binding: attestation.holder_binding,
            policy_id: attestation.policy_id,
            epoch: attestation.epoch,
            expires_at: attestation.expires_at,
        })
    }

    fn chain_id_to_axelar_name(&self, chain: &ChainId) -> Result<String, TachyonError> {
        let name = match chain {
            ChainId::ZcashMainnet | ChainId::ZcashTestnet => {
                return Err(TachyonError::Transport(
                    "Zcash not supported for direct Axelar transport".into(),
                ));
            }
            ChainId::MinaMainnet | ChainId::MinaBerkeley => {
                return Err(TachyonError::Transport(
                    "Mina not supported for direct Axelar transport".into(),
                ));
            }
            ChainId::StarknetMainnet => "starknet",
            ChainId::StarknetSepolia => "starknet-sepolia",
            ChainId::NearMainnet => "near",
            ChainId::NearTestnet => "near-testnet",
            ChainId::Custom(name) => name.as_str(),
        };
        Ok(name.to_string())
    }

    fn get_receiver_for_chain(&self, chain_name: &str) -> Result<String, TachyonError> {
        self.config
            .destination_chains
            .iter()
            .find(|c| c.chain_name == chain_name)
            .map(|c| c.receiver_address.clone())
            .ok_or_else(|| {
                TachyonError::Transport(format!("no receiver configured for chain {}", chain_name))
            })
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CROSS-CHAIN MESSAGE
// ═══════════════════════════════════════════════════════════════════════════════

/// Cross-chain message types.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum CrossChainMessage {
    /// Attestation broadcast.
    Attestation {
        attestation_id: [u8; 32],
        holder_binding: [u8; 32],
        policy_id: u64,
        epoch: u64,
        expires_at: u64,
    },
    /// Revocation broadcast.
    Revocation {
        attestation_id: [u8; 32],
        holder_binding: [u8; 32],
    },
    /// Query for attestation status.
    Query {
        holder_binding: [u8; 32],
        policy_id: u64,
        callback_chain: String,
        callback_address: String,
    },
}

impl CrossChainMessage {
    /// Compute hash of the message.
    pub fn hash(&self) -> [u8; 32] {
        let encoded = serde_json::to_vec(self).unwrap_or_default();
        *blake3::hash(&encoded).as_bytes()
    }

    /// Encode message for GMP transmission.
    pub fn encode(&self) -> Result<Vec<u8>, TachyonError> {
        use zkpf_axelar_gmp::{GmpMessage, PoFReceipt, PoFRevocation};

        match self {
            Self::Attestation {
                attestation_id,
                holder_binding,
                policy_id,
                epoch,
                expires_at,
            } => {
                let receipt = PoFReceipt::new(
                    *holder_binding,
                    *policy_id,
                    *attestation_id, // snapshot_id
                    0,               // chain_id_origin - would be filled
                    *attestation_id, // attestation_hash
                    expires_at - epoch,
                    *epoch,
                );
                let msg = GmpMessage::receipt(receipt)?;
                Ok(msg.encode())
            }
            Self::Revocation {
                attestation_id,
                holder_binding,
            } => {
                let revocation = PoFRevocation {
                    holder_id: *holder_binding,
                    policy_id: 0, // Would need to be tracked
                    snapshot_id: *attestation_id,
                };
                let msg = GmpMessage::revocation(revocation)?;
                Ok(msg.encode())
            }
            Self::Query { .. } => {
                // Query encoding would go here
                Err(TachyonError::MessageEncoding("Query not yet supported".into()))
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BROADCAST RESULT
// ═══════════════════════════════════════════════════════════════════════════════

/// Result of a cross-chain broadcast.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BroadcastResult {
    /// Attestation ID that was broadcast.
    pub attestation_id: [u8; 32],
    /// Per-chain results.
    pub chains: Vec<ChainBroadcastResult>,
    /// Hash of the broadcast message.
    pub message_hash: [u8; 32],
}

impl BroadcastResult {
    /// Check if all chains succeeded.
    pub fn all_success(&self) -> bool {
        self.chains.iter().all(|c| c.success)
    }

    /// Get chains that failed.
    pub fn failed_chains(&self) -> Vec<&ChainId> {
        self.chains
            .iter()
            .filter(|c| !c.success)
            .map(|c| &c.chain)
            .collect()
    }
}

/// Result for a single chain broadcast.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChainBroadcastResult {
    /// Target chain.
    pub chain: ChainId,
    /// Whether broadcast succeeded.
    pub success: bool,
    /// Transaction hash (if applicable).
    pub tx_hash: Option<String>,
    /// Gas used.
    pub gas_used: u64,
    /// Error message if failed.
    pub error: Option<String>,
}

/// Result of querying attestation status.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AttestationQueryResult {
    /// Whether the attestation was found.
    pub found: bool,
    /// Whether it's currently valid.
    pub valid: bool,
    /// Expiration timestamp.
    pub expires_at: Option<u64>,
    /// Last update timestamp.
    pub last_updated: Option<u64>,
}

