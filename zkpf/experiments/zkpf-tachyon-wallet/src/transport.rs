//! Cross-chain transport layer via Axelar GMP and Omni Bridge.
//!
//! This module handles the relay of attestations and proofs across chains
//! using Axelar's General Message Passing protocol and the Omni Bridge SDK.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::attestation::UnifiedAttestation;
use crate::config::{AxelarConfig, OmniBridgeConfig};
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

// ═══════════════════════════════════════════════════════════════════════════════
// OMNI BRIDGE TRANSPORT
// ═══════════════════════════════════════════════════════════════════════════════

/// Omni Bridge transport for cross-chain asset transfers and attestations.
pub struct OmniBridgeTransport {
    config: OmniBridgeConfig,
    /// Active transfers tracking.
    active_transfers: HashMap<[u8; 32], OmniBridgeTransferStatus>,
}

impl OmniBridgeTransport {
    /// Create a new Omni Bridge transport.
    pub fn new(config: OmniBridgeConfig) -> Self {
        Self {
            config,
            active_transfers: HashMap::new(),
        }
    }

    /// Check if transport is enabled and configured.
    pub fn is_available(&self) -> bool {
        self.config.enabled && self.config.near_rpc_url.is_some()
    }

    /// Get supported chains.
    pub fn supported_chains(&self) -> Vec<&str> {
        self.config
            .chains
            .iter()
            .filter(|c| c.enabled)
            .map(|c| c.chain_id.as_str())
            .collect()
    }

    /// Initiate a token bridge transfer.
    pub async fn initiate_bridge_transfer(
        &mut self,
        source_chain: &str,
        destination_chain: &str,
        token: &str,
        amount: u128,
        recipient: &str,
    ) -> Result<OmniBridgeTransferResult, TachyonError> {
        if !self.is_available() {
            return Err(TachyonError::Transport(
                "Omni Bridge transport not configured".into(),
            ));
        }

        // Validate chains are supported
        let supported = self.supported_chains();
        if !supported.contains(&source_chain) {
            return Err(TachyonError::Transport(format!(
                "Source chain {} not supported",
                source_chain
            )));
        }
        if !supported.contains(&destination_chain) {
            return Err(TachyonError::Transport(format!(
                "Destination chain {} not supported",
                destination_chain
            )));
        }

        // Generate transfer ID
        let transfer_id = Self::compute_transfer_id(
            source_chain,
            destination_chain,
            token,
            amount,
            recipient,
        );

        // In production, this would call the Omni Bridge SDK
        let status = OmniBridgeTransferStatus {
            transfer_id,
            source_chain: source_chain.to_string(),
            destination_chain: destination_chain.to_string(),
            token: token.to_string(),
            amount,
            recipient: recipient.to_string(),
            status: "pending".to_string(),
            source_tx_hash: None,
            destination_tx_hash: None,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        };

        self.active_transfers.insert(transfer_id, status.clone());

        Ok(OmniBridgeTransferResult {
            transfer_id,
            status,
            estimated_completion_secs: self.estimate_bridge_time(source_chain, destination_chain),
        })
    }

    /// Query the status of a bridge transfer.
    pub async fn query_transfer(
        &self,
        transfer_id: &[u8; 32],
    ) -> Result<OmniBridgeTransferStatus, TachyonError> {
        self.active_transfers
            .get(transfer_id)
            .cloned()
            .ok_or_else(|| TachyonError::Transport("Transfer not found".into()))
    }

    /// Broadcast an attestation via Omni Bridge.
    pub async fn broadcast_attestation(
        &self,
        attestation: &UnifiedAttestation,
        target_chains: &[&str],
    ) -> Result<OmniBridgeBroadcastResult, TachyonError> {
        if !self.is_available() {
            return Err(TachyonError::Transport(
                "Omni Bridge transport not configured".into(),
            ));
        }

        let supported = self.supported_chains();
        let mut broadcast_results = Vec::new();

        for chain in target_chains {
            if !supported.contains(chain) {
                broadcast_results.push(OmniBridgeChainResult {
                    chain: chain.to_string(),
                    success: false,
                    error: Some(format!("Chain {} not supported", chain)),
                    tx_hash: None,
                });
                continue;
            }

            // In production, this would submit the attestation to each chain
            broadcast_results.push(OmniBridgeChainResult {
                chain: chain.to_string(),
                success: true,
                error: None,
                tx_hash: None, // Would be populated after submission
            });
        }

        Ok(OmniBridgeBroadcastResult {
            attestation_id: attestation.attestation_id,
            chains: broadcast_results,
        })
    }

    /// Estimate bridge completion time.
    fn estimate_bridge_time(&self, source: &str, destination: &str) -> u64 {
        // Estimates based on chain finality
        let source_time = match source {
            "near" | "near-testnet" => 2,
            "solana" | "solana-devnet" => 30,
            "arbitrum" | "arbitrum-sepolia" => 60,
            "base" | "base-sepolia" => 60,
            "ethereum" | "ethereum-sepolia" => 900,
            _ => 300,
        };

        let dest_time = match destination {
            "near" | "near-testnet" => 2,
            "solana" | "solana-devnet" => 30,
            "arbitrum" | "arbitrum-sepolia" => 60,
            "base" | "base-sepolia" => 60,
            "ethereum" | "ethereum-sepolia" => 900,
            _ => 300,
        };

        source_time + dest_time + 60 // Add buffer
    }

    /// Compute a transfer ID.
    fn compute_transfer_id(
        source: &str,
        destination: &str,
        token: &str,
        amount: u128,
        recipient: &str,
    ) -> [u8; 32] {
        use sha2::{Digest, Sha256};

        let mut hasher = Sha256::new();
        hasher.update(b"omni_transfer_v1");
        hasher.update(source.as_bytes());
        hasher.update(destination.as_bytes());
        hasher.update(token.as_bytes());
        hasher.update(&amount.to_be_bytes());
        hasher.update(recipient.as_bytes());
        
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        hasher.update(&now.to_be_bytes());

        let result = hasher.finalize();
        let mut id = [0u8; 32];
        id.copy_from_slice(&result);
        id
    }
}

/// Status of an Omni Bridge transfer.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OmniBridgeTransferStatus {
    /// Unique transfer ID.
    pub transfer_id: [u8; 32],
    /// Source chain.
    pub source_chain: String,
    /// Destination chain.
    pub destination_chain: String,
    /// Token being transferred.
    pub token: String,
    /// Amount being transferred.
    pub amount: u128,
    /// Recipient address.
    pub recipient: String,
    /// Current status (pending, confirmed, completed, failed).
    pub status: String,
    /// Source transaction hash.
    pub source_tx_hash: Option<String>,
    /// Destination transaction hash.
    pub destination_tx_hash: Option<String>,
    /// Creation timestamp.
    pub created_at: u64,
}

/// Result of initiating a bridge transfer.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OmniBridgeTransferResult {
    /// Transfer ID.
    pub transfer_id: [u8; 32],
    /// Current status.
    pub status: OmniBridgeTransferStatus,
    /// Estimated time to completion in seconds.
    pub estimated_completion_secs: u64,
}

/// Result of broadcasting via Omni Bridge.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OmniBridgeBroadcastResult {
    /// Attestation ID that was broadcast.
    pub attestation_id: [u8; 32],
    /// Per-chain results.
    pub chains: Vec<OmniBridgeChainResult>,
}

/// Result for a single chain in Omni Bridge broadcast.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OmniBridgeChainResult {
    /// Target chain.
    pub chain: String,
    /// Whether broadcast succeeded.
    pub success: bool,
    /// Error message if failed.
    pub error: Option<String>,
    /// Transaction hash.
    pub tx_hash: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// UNIFIED TRANSPORT
// ═══════════════════════════════════════════════════════════════════════════════

/// Unified transport that can use either Axelar GMP or Omni Bridge.
pub struct UnifiedTransport {
    /// Axelar transport.
    pub axelar: Option<AxelarTransport>,
    /// Omni Bridge transport.
    pub omni_bridge: Option<OmniBridgeTransport>,
}

impl UnifiedTransport {
    /// Create a new unified transport.
    pub fn new(axelar_config: AxelarConfig, omni_config: OmniBridgeConfig) -> Self {
        Self {
            axelar: if axelar_config.enabled {
                Some(AxelarTransport::new(axelar_config))
            } else {
                None
            },
            omni_bridge: if omni_config.enabled {
                Some(OmniBridgeTransport::new(omni_config))
            } else {
                None
            },
        }
    }

    /// Check if any transport is available.
    pub fn is_available(&self) -> bool {
        self.axelar.as_ref().map(|a| a.is_available()).unwrap_or(false)
            || self.omni_bridge.as_ref().map(|o| o.is_available()).unwrap_or(false)
    }

    /// Get all supported chains across transports.
    pub fn supported_chains(&self) -> Vec<String> {
        let mut chains = Vec::new();

        if let Some(ref omni) = self.omni_bridge {
            chains.extend(omni.supported_chains().into_iter().map(String::from));
        }

        chains.sort();
        chains.dedup();
        chains
    }

    /// Broadcast attestation using the best available transport.
    pub async fn broadcast_attestation(
        &self,
        attestation: &UnifiedAttestation,
        target_chains: &[ChainId],
    ) -> Result<BroadcastResult, TachyonError> {
        // Try Axelar first for EVM chains
        if let Some(ref axelar) = self.axelar {
            if axelar.is_available() {
                return axelar.broadcast_attestation(attestation, target_chains).await;
            }
        }

        // Fall back to creating a placeholder result
        Err(TachyonError::Transport(
            "No transport available for broadcast".into(),
        ))
    }
}

