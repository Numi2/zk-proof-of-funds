//! Zcash → Axelar bridge module
//!
//! This module provides the bridge logic for transmitting Zcash proof-of-funds
//! credentials to EVM/Cosmos chains via Axelar GMP. Since Zcash is not natively
//! supported by Axelar, we model it as an "external chain via Amplifier" that
//! follows GMP semantics.

use serde::{Deserialize, Serialize};
use sha3::{Digest, Keccak256};

use crate::{
    chains, encoding, AxelarGmpError, ChainSubscription, ChainType, GmpMessage, MessageType,
    PoFReceipt,
};
use crate::zcash::{
    CreditLineConfig, RevocationReason, ZcashBridgeMessage, ZecCredential, ZecTier,
    ZCASH_CHAIN_ID, ZCASH_MAINNET_ID,
};

// ═══════════════════════════════════════════════════════════════════════════════
// BRIDGE CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/// Configuration for the Zcash → Axelar bridge
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZcashBridgeConfig {
    /// Origin chain identifier (Zcash)
    pub origin_chain_id: String,

    /// Origin chain numeric ID
    pub origin_chain_numeric: u64,

    /// Default validity window for credentials (seconds)
    pub default_validity_window: u64,

    /// Subscribed destination chains
    pub subscriptions: Vec<ChainSubscription>,

    /// Whether to automatically broadcast on credential creation
    pub auto_broadcast: bool,

    /// Minimum tier required for broadcasting
    pub min_broadcast_tier: ZecTier,

    /// Credit line configurations per destination chain
    pub credit_configs: Vec<(String, CreditLineConfig)>,

    /// Gas budget per chain (in native units)
    pub gas_budget: std::collections::HashMap<String, u64>,
}

impl Default for ZcashBridgeConfig {
    fn default() -> Self {
        Self {
            origin_chain_id: ZCASH_CHAIN_ID.to_string(),
            origin_chain_numeric: ZCASH_MAINNET_ID,
            default_validity_window: 86400, // 24 hours
            subscriptions: Vec::new(),
            auto_broadcast: true,
            min_broadcast_tier: ZecTier::Tier1,
            credit_configs: Vec::new(),
            gas_budget: std::collections::HashMap::new(),
        }
    }
}

impl ZcashBridgeConfig {
    /// Create a new bridge config with common EVM chains
    pub fn with_evm_chains() -> Self {
        let mut config = Self::default();

        // Add common EVM chains
        for chain_name in [
            chains::ETHEREUM,
            chains::ARBITRUM,
            chains::OPTIMISM,
            chains::BASE,
            chains::POLYGON,
        ] {
            if let Some(info) = chains::get_chain_info(chain_name) {
                config.subscriptions.push(ChainSubscription {
                    chain_name: chain_name.to_string(),
                    receiver_contract: String::new(), // To be configured
                    active: false, // Not active until configured
                    default_gas: info.default_gas,
                    chain_type: ChainType::Evm,
                });
                config.gas_budget.insert(chain_name.to_string(), info.default_gas);
            }
        }

        config
    }

    /// Create a new bridge config with common Cosmos chains
    pub fn with_cosmos_chains() -> Self {
        let mut config = Self::default();

        for chain_name in [chains::OSMOSIS, chains::NEUTRON, chains::SEI] {
            if let Some(info) = chains::get_chain_info(chain_name) {
                config.subscriptions.push(ChainSubscription {
                    chain_name: chain_name.to_string(),
                    receiver_contract: String::new(),
                    active: false,
                    default_gas: info.default_gas,
                    chain_type: ChainType::Cosmos,
                });
                config.gas_budget.insert(chain_name.to_string(), info.default_gas);
            }
        }

        config
    }

    /// Get credit config for a destination chain
    pub fn get_credit_config(&self, chain_name: &str) -> Option<&CreditLineConfig> {
        self.credit_configs
            .iter()
            .find(|(name, _)| name == chain_name)
            .map(|(_, config)| config)
    }

    /// Add a chain subscription
    pub fn subscribe(&mut self, chain_name: &str, receiver_contract: &str) -> &mut Self {
        if let Some(sub) = self
            .subscriptions
            .iter_mut()
            .find(|s| s.chain_name == chain_name)
        {
            sub.receiver_contract = receiver_contract.to_string();
            sub.active = true;
        } else if let Some(info) = chains::get_chain_info(chain_name) {
            self.subscriptions.push(ChainSubscription {
                chain_name: chain_name.to_string(),
                receiver_contract: receiver_contract.to_string(),
                active: true,
                default_gas: info.default_gas,
                chain_type: info.chain_type,
            });
        }
        self
    }

    /// Get active subscriptions
    pub fn active_subscriptions(&self) -> Vec<&ChainSubscription> {
        self.subscriptions.iter().filter(|s| s.active).collect()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BRIDGE STATE
// ═══════════════════════════════════════════════════════════════════════════════

/// Pending GMP message waiting to be broadcast
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingBroadcast {
    /// Unique broadcast ID
    pub broadcast_id: [u8; 32],

    /// Credential being broadcast
    pub credential: ZecCredential,

    /// Target chains
    pub target_chains: Vec<String>,

    /// Timestamp when queued
    pub queued_at: u64,

    /// Status per chain
    pub chain_status: Vec<(String, BroadcastStatus)>,
}

/// Status of a broadcast to a specific chain
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BroadcastStatus {
    /// Queued for broadcast
    Queued,
    /// Sent to Axelar Gateway
    Sent,
    /// Confirmed on destination chain
    Confirmed,
    /// Failed to broadcast
    Failed,
    /// Expired before confirmation
    Expired,
}

/// Bridge state tracking
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct BridgeState {
    /// Pending broadcasts
    pub pending: Vec<PendingBroadcast>,

    /// Completed broadcasts (credential_id -> chain -> tx_hash)
    pub completed: std::collections::HashMap<String, std::collections::HashMap<String, String>>,

    /// Failed broadcasts with reasons
    pub failed: Vec<(PendingBroadcast, String)>,

    /// Statistics
    pub stats: BridgeStats,
}

/// Bridge statistics
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct BridgeStats {
    /// Total credentials broadcast
    pub total_broadcast: u64,

    /// Successful broadcasts
    pub successful: u64,

    /// Failed broadcasts
    pub failed: u64,

    /// Total gas spent (estimated)
    pub total_gas_spent: u64,

    /// Breakdown by chain
    pub chain_stats: std::collections::HashMap<String, ChainBridgeStats>,
}

/// Per-chain bridge statistics
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ChainBridgeStats {
    /// Broadcasts to this chain
    pub broadcasts: u64,

    /// Successful
    pub successful: u64,

    /// Average confirmation time (seconds)
    pub avg_confirmation_time: u64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// BRIDGE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/// Zcash → Axelar bridge for cross-chain credential broadcasting
#[derive(Debug)]
pub struct ZcashBridge {
    /// Bridge configuration
    pub config: ZcashBridgeConfig,

    /// Bridge state
    pub state: BridgeState,
}

impl ZcashBridge {
    /// Create a new bridge with the given configuration
    pub fn new(config: ZcashBridgeConfig) -> Self {
        Self {
            config,
            state: BridgeState::default(),
        }
    }

    /// Create a bridge with default EVM chain configuration
    pub fn default_evm() -> Self {
        Self::new(ZcashBridgeConfig::with_evm_chains())
    }

    /// Create a bridge with default Cosmos chain configuration
    pub fn default_cosmos() -> Self {
        Self::new(ZcashBridgeConfig::with_cosmos_chains())
    }

    /// Prepare a credential for cross-chain broadcast
    pub fn prepare_broadcast(
        &mut self,
        credential: ZecCredential,
        target_chains: Option<Vec<String>>,
    ) -> Result<PendingBroadcast, AxelarGmpError> {
        // Check tier meets minimum
        if credential.tier < self.config.min_broadcast_tier {
            return Err(AxelarGmpError::InvalidChain(format!(
                "credential tier {:?} below minimum {:?}",
                credential.tier, self.config.min_broadcast_tier
            )));
        }

        // Determine target chains
        let targets = target_chains.unwrap_or_else(|| {
            self.config
                .active_subscriptions()
                .iter()
                .map(|s| s.chain_name.clone())
                .collect()
        });

        if targets.is_empty() {
            return Err(AxelarGmpError::InvalidChain(
                "no target chains configured".into(),
            ));
        }

        // Generate broadcast ID
        let broadcast_id = self.compute_broadcast_id(&credential, &targets);

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let chain_status = targets
            .iter()
            .map(|c| (c.clone(), BroadcastStatus::Queued))
            .collect();

        let pending = PendingBroadcast {
            broadcast_id,
            credential,
            target_chains: targets,
            queued_at: now,
            chain_status,
        };

        self.state.pending.push(pending.clone());

        Ok(pending)
    }

    /// Encode a credential broadcast for a specific chain
    pub fn encode_for_chain(
        &self,
        credential: &ZecCredential,
        chain_name: &str,
    ) -> Result<Vec<u8>, AxelarGmpError> {
        let sub = self
            .config
            .subscriptions
            .iter()
            .find(|s| s.chain_name == chain_name && s.active)
            .ok_or_else(|| AxelarGmpError::InvalidChain(chain_name.into()))?;

        match sub.chain_type {
            ChainType::Evm => self.encode_for_evm(credential),
            ChainType::Cosmos => self.encode_for_cosmos(credential),
            _ => self.encode_generic(credential),
        }
    }

    /// Encode credential for EVM chains (ABI encoding)
    fn encode_for_evm(&self, credential: &ZecCredential) -> Result<Vec<u8>, AxelarGmpError> {
        // Message type (1 byte) + ABI-encoded data
        let mut payload = vec![0u8]; // 0 = credential broadcast

        // ABI encode: (bytes32 accountTag, uint8 tier, bytes32 stateRoot, uint64 blockHeight,
        //              uint64 issuedAt, uint64 expiresAt, bytes32 proofCommitment, bytes32 attestationHash)
        let mut encoded = Vec::with_capacity(8 * 32);

        // bytes32 accountTag
        encoded.extend_from_slice(&credential.account_tag);

        // uint8 tier (padded to 32 bytes)
        let mut tier_bytes = [0u8; 32];
        tier_bytes[31] = credential.tier.as_u8();
        encoded.extend_from_slice(&tier_bytes);

        // bytes32 stateRoot
        encoded.extend_from_slice(&credential.state_root);

        // uint64 blockHeight (padded to 32 bytes)
        let mut height_bytes = [0u8; 32];
        height_bytes[24..].copy_from_slice(&credential.block_height.to_be_bytes());
        encoded.extend_from_slice(&height_bytes);

        // uint64 issuedAt
        let mut issued_bytes = [0u8; 32];
        issued_bytes[24..].copy_from_slice(&credential.issued_at.to_be_bytes());
        encoded.extend_from_slice(&issued_bytes);

        // uint64 expiresAt
        let mut expires_bytes = [0u8; 32];
        expires_bytes[24..].copy_from_slice(&credential.expires_at.to_be_bytes());
        encoded.extend_from_slice(&expires_bytes);

        // bytes32 proofCommitment
        encoded.extend_from_slice(&credential.proof_commitment);

        // bytes32 attestationHash
        encoded.extend_from_slice(&credential.attestation_hash);

        payload.extend_from_slice(&encoded);

        Ok(payload)
    }

    /// Encode credential for Cosmos chains (JSON encoding)
    fn encode_for_cosmos(&self, credential: &ZecCredential) -> Result<Vec<u8>, AxelarGmpError> {
        let msg = ZcashBridgeMessage::CredentialBroadcast(credential.clone());
        msg.encode()
    }

    /// Generic encoding for unknown chain types
    fn encode_generic(&self, credential: &ZecCredential) -> Result<Vec<u8>, AxelarGmpError> {
        // Use JSON for maximum compatibility
        let json = serde_json::to_vec(credential)?;
        Ok(json)
    }

    /// Encode a revocation message
    pub fn encode_revocation(
        &self,
        credential_id: [u8; 32],
        reason: RevocationReason,
        chain_name: &str,
    ) -> Result<Vec<u8>, AxelarGmpError> {
        let sub = self
            .config
            .subscriptions
            .iter()
            .find(|s| s.chain_name == chain_name && s.active)
            .ok_or_else(|| AxelarGmpError::InvalidChain(chain_name.into()))?;

        match sub.chain_type {
            ChainType::Evm => {
                // Message type (1 byte) + ABI-encoded (bytes32 credentialId, uint8 reason)
                let mut payload = vec![1u8]; // 1 = revocation

                payload.extend_from_slice(&credential_id);

                let mut reason_bytes = [0u8; 32];
                reason_bytes[31] = reason as u8;
                payload.extend_from_slice(&reason_bytes);

                Ok(payload)
            }
            ChainType::Cosmos => {
                let msg = ZcashBridgeMessage::CredentialRevoke {
                    credential_id,
                    reason,
                };
                msg.encode()
            }
            _ => Err(AxelarGmpError::InvalidChain("unsupported chain type".into())),
        }
    }

    /// Convert credential to PoFReceipt for legacy GMP format
    pub fn credential_to_receipt(&self, credential: &ZecCredential) -> PoFReceipt {
        credential.to_pof_receipt()
    }

    /// Create a GMP message from a credential
    pub fn credential_to_gmp_message(
        &self,
        credential: &ZecCredential,
    ) -> Result<GmpMessage, AxelarGmpError> {
        let receipt = self.credential_to_receipt(credential);
        GmpMessage::receipt(receipt)
    }

    /// Update broadcast status for a chain
    pub fn update_broadcast_status(
        &mut self,
        broadcast_id: &[u8; 32],
        chain_name: &str,
        status: BroadcastStatus,
    ) {
        if let Some(pending) = self
            .state
            .pending
            .iter_mut()
            .find(|p| &p.broadcast_id == broadcast_id)
        {
            if let Some((_, chain_status)) = pending
                .chain_status
                .iter_mut()
                .find(|(c, _)| c == chain_name)
            {
                *chain_status = status;
            }
        }

        // Update stats
        if status == BroadcastStatus::Confirmed {
            self.state.stats.successful += 1;
            self.state
                .stats
                .chain_stats
                .entry(chain_name.to_string())
                .or_default()
                .successful += 1;
        } else if status == BroadcastStatus::Failed {
            self.state.stats.failed += 1;
        }
    }

    /// Mark a broadcast as complete
    pub fn complete_broadcast(
        &mut self,
        broadcast_id: &[u8; 32],
        chain_name: &str,
        tx_hash: String,
    ) {
        self.update_broadcast_status(broadcast_id, chain_name, BroadcastStatus::Confirmed);

        let cred_id = hex::encode(broadcast_id);
        self.state
            .completed
            .entry(cred_id)
            .or_default()
            .insert(chain_name.to_string(), tx_hash);

        self.state.stats.total_broadcast += 1;
    }

    /// Compute a unique broadcast ID
    fn compute_broadcast_id(&self, credential: &ZecCredential, targets: &[String]) -> [u8; 32] {
        let mut hasher = Keccak256::new();
        hasher.update(&credential.account_tag);
        hasher.update(&credential.proof_commitment);
        hasher.update(credential.issued_at.to_be_bytes());
        for target in targets {
            hasher.update(target.as_bytes());
        }
        hasher.finalize().into()
    }

    /// Get pending broadcasts
    pub fn pending_broadcasts(&self) -> &[PendingBroadcast] {
        &self.state.pending
    }

    /// Get bridge statistics
    pub fn stats(&self) -> &BridgeStats {
        &self.state.stats
    }

    /// Estimate gas for broadcasting to all active chains
    pub fn estimate_total_gas(&self) -> u64 {
        self.config
            .active_subscriptions()
            .iter()
            .map(|s| self.config.gas_budget.get(&s.chain_name).copied().unwrap_or(500_000))
            .sum()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CREDENTIAL BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

/// Builder for creating ZEC credentials
#[derive(Debug, Default)]
pub struct CredentialBuilder {
    account_tag: Option<[u8; 32]>,
    tier: Option<ZecTier>,
    policy_id: Option<u64>,
    state_root: Option<[u8; 32]>,
    block_height: Option<u64>,
    validity_window: Option<u64>,
    proof_commitment: Option<[u8; 32]>,
    attestation_hash: Option<[u8; 32]>,
}

impl CredentialBuilder {
    /// Create a new credential builder
    pub fn new() -> Self {
        Self::default()
    }

    /// Set the account tag
    pub fn account_tag(mut self, tag: [u8; 32]) -> Self {
        self.account_tag = Some(tag);
        self
    }

    /// Set the tier
    pub fn tier(mut self, tier: ZecTier) -> Self {
        self.tier = Some(tier);
        self
    }

    /// Set the policy ID
    pub fn policy_id(mut self, id: u64) -> Self {
        self.policy_id = Some(id);
        self
    }

    /// Set the state root
    pub fn state_root(mut self, root: [u8; 32]) -> Self {
        self.state_root = Some(root);
        self
    }

    /// Set the block height
    pub fn block_height(mut self, height: u64) -> Self {
        self.block_height = Some(height);
        self
    }

    /// Set the validity window
    pub fn validity_window(mut self, window: u64) -> Self {
        self.validity_window = Some(window);
        self
    }

    /// Set the proof commitment (nullifier)
    pub fn proof_commitment(mut self, commitment: [u8; 32]) -> Self {
        self.proof_commitment = Some(commitment);
        self
    }

    /// Set the attestation hash
    pub fn attestation_hash(mut self, hash: [u8; 32]) -> Self {
        self.attestation_hash = Some(hash);
        self
    }

    /// Build the credential
    pub fn build(self) -> Result<ZecCredential, AxelarGmpError> {
        let tier = self
            .tier
            .ok_or_else(|| AxelarGmpError::Encoding("tier is required".into()))?;

        let policy_id = self
            .policy_id
            .unwrap_or_else(|| crate::zcash::tier_to_policy_id(tier));

        Ok(ZecCredential::new(
            self.account_tag
                .ok_or_else(|| AxelarGmpError::Encoding("account_tag is required".into()))?,
            tier,
            policy_id,
            self.state_root
                .ok_or_else(|| AxelarGmpError::Encoding("state_root is required".into()))?,
            self.block_height
                .ok_or_else(|| AxelarGmpError::Encoding("block_height is required".into()))?,
            self.validity_window.unwrap_or(86400),
            self.proof_commitment
                .ok_or_else(|| AxelarGmpError::Encoding("proof_commitment is required".into()))?,
            self.attestation_hash
                .ok_or_else(|| AxelarGmpError::Encoding("attestation_hash is required".into()))?,
        ))
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bridge_config() {
        let mut config = ZcashBridgeConfig::with_evm_chains();

        config.subscribe(chains::ETHEREUM, "0x1234567890abcdef");

        let active = config.active_subscriptions();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].chain_name, chains::ETHEREUM);
    }

    #[test]
    fn test_credential_builder() {
        let cred = CredentialBuilder::new()
            .account_tag([1u8; 32])
            .tier(ZecTier::Tier100)
            .state_root([2u8; 32])
            .block_height(1000000)
            .proof_commitment([3u8; 32])
            .attestation_hash([4u8; 32])
            .build()
            .unwrap();

        assert_eq!(cred.tier, ZecTier::Tier100);
        assert!(cred.is_valid(cred.issued_at + 1000));
    }

    #[test]
    fn test_bridge_prepare_broadcast() {
        let mut config = ZcashBridgeConfig::default();
        config.min_broadcast_tier = ZecTier::Tier10;
        config.subscribe(chains::ARBITRUM, "0xreceiver");

        let mut bridge = ZcashBridge::new(config);

        let cred = CredentialBuilder::new()
            .account_tag([1u8; 32])
            .tier(ZecTier::Tier100)
            .state_root([2u8; 32])
            .block_height(1000000)
            .proof_commitment([3u8; 32])
            .attestation_hash([4u8; 32])
            .build()
            .unwrap();

        let pending = bridge.prepare_broadcast(cred, None).unwrap();
        assert_eq!(pending.target_chains.len(), 1);
        assert_eq!(pending.target_chains[0], chains::ARBITRUM);
    }

    #[test]
    fn test_evm_encoding() {
        let mut config = ZcashBridgeConfig::default();
        config.subscribe(chains::ETHEREUM, "0xreceiver");

        let bridge = ZcashBridge::new(config);

        let cred = CredentialBuilder::new()
            .account_tag([1u8; 32])
            .tier(ZecTier::Tier10)
            .state_root([2u8; 32])
            .block_height(1000000)
            .proof_commitment([3u8; 32])
            .attestation_hash([4u8; 32])
            .build()
            .unwrap();

        let encoded = bridge.encode_for_chain(&cred, chains::ETHEREUM).unwrap();

        // 1 byte message type + 8 * 32 bytes ABI-encoded data
        assert_eq!(encoded.len(), 1 + 8 * 32);
        assert_eq!(encoded[0], 0); // Credential broadcast type
    }

    #[test]
    fn test_revocation_encoding() {
        let mut config = ZcashBridgeConfig::default();
        config.subscribe(chains::ARBITRUM, "0xreceiver");

        let bridge = ZcashBridge::new(config);

        let cred_id = [5u8; 32];
        let encoded = bridge
            .encode_revocation(cred_id, RevocationReason::UserRequested, chains::ARBITRUM)
            .unwrap();

        // 1 byte message type + 32 bytes credential ID + 32 bytes reason
        assert_eq!(encoded.len(), 1 + 32 + 32);
        assert_eq!(encoded[0], 1); // Revocation type
    }
}

