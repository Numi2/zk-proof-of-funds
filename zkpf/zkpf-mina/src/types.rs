//! Type definitions for the Mina rail.
//!
//! This module provides types for:
//! - Mina network configuration
//! - zkApp state management
//! - Mina Proof of State integration (lambdaclass/mina_bridge)
//! - Cross-chain bridge messages

use serde::{Deserialize, Serialize};

// Re-export Mina Proof of State types from the Kimchi wrapper
pub use zkpf_mina_kimchi_wrapper::{
    MinaProofOfStatePublicInputs, MinaRailPublicInputs, CANDIDATE_CHAIN_LENGTH,
};

/// Mina network identifiers.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[derive(Default)]
pub enum MinaNetwork {
    Mainnet,
    #[default]
    Testnet,
    Berkeley,
    Devnet,
}

impl MinaNetwork {
    /// Get the numeric ID for circuit encoding.
    pub fn numeric_id(&self) -> u32 {
        match self {
            MinaNetwork::Mainnet => 0,
            MinaNetwork::Testnet => 1,
            MinaNetwork::Berkeley => 2,
            MinaNetwork::Devnet => 3,
        }
    }

    /// Get the string identifier.
    pub fn as_str(&self) -> &'static str {
        match self {
            MinaNetwork::Mainnet => "mainnet",
            MinaNetwork::Testnet => "testnet",
            MinaNetwork::Berkeley => "berkeley",
            MinaNetwork::Devnet => "devnet",
        }
    }
}


/// Mina account/zkApp address.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MinaAddress(pub String);

impl MinaAddress {
    /// Create a new Mina address from a base58 string.
    pub fn new(address: impl Into<String>) -> Self {
        Self(address.into())
    }

    /// Get the raw address string.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Validate the address format (basic check).
    pub fn is_valid(&self) -> bool {
        // Mina addresses start with B62 and are 55 characters
        self.0.starts_with("B62") && self.0.len() == 55
    }
}

/// Mina transaction hash.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MinaTxHash(pub String);

impl MinaTxHash {
    pub fn new(hash: impl Into<String>) -> Self {
        Self(hash.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Mina zkApp state entry.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ZkAppStateEntry {
    /// Field index (0-7 for Mina zkApps).
    pub index: u8,
    /// Field value as a decimal string (Mina fields are ~254 bits).
    pub value: String,
}

/// Mina zkApp update transaction.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ZkAppUpdate {
    /// Target zkApp address.
    pub zkapp_address: MinaAddress,
    /// State updates (field index -> new value).
    pub state_updates: Vec<ZkAppStateEntry>,
    /// Method name being called.
    pub method_name: String,
    /// Method arguments as JSON.
    pub method_args: serde_json::Value,
    /// Fee in nanomina.
    pub fee_nanomina: u64,
    /// Nonce for the sender account.
    pub nonce: u64,
    /// Memo (optional, max 32 bytes).
    pub memo: Option<String>,
}

/// Cross-chain bridge message for attestation propagation.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BridgeMessage {
    /// Source chain (always "mina").
    pub source_chain: String,
    /// Target chain (e.g., "ethereum", "starknet", "polygon").
    pub target_chain: String,
    /// Message type.
    pub message_type: BridgeMessageType,
    /// Holder binding (privacy-preserving identifier).
    pub holder_binding: [u8; 32],
    /// Policy ID.
    pub policy_id: u64,
    /// Epoch.
    pub epoch: u64,
    /// Result: does the holder have valid PoF?
    pub has_pof: bool,
    /// Mina slot at message creation.
    pub mina_slot: u64,
    /// Merkle proof of inclusion in attestation tree.
    pub merkle_proof: Vec<[u8; 32]>,
    /// zkApp state root at message time.
    pub state_root: [u8; 32],
}

/// Types of bridge messages.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BridgeMessageType {
    /// Single attestation query result.
    AttestationResult,
    /// Batch of attestation results.
    BatchAttestationResult,
    /// State root update.
    StateRootUpdate,
    /// Revocation notice.
    Revocation,
}

/// Supported target chains for bridge messages.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TargetChain {
    Ethereum,
    Starknet,
    Polygon,
    Arbitrum,
    Optimism,
    Base,
    ZkSync,
    Scroll,
}

impl TargetChain {
    /// Get the chain identifier string.
    pub fn as_str(&self) -> &'static str {
        match self {
            TargetChain::Ethereum => "ethereum",
            TargetChain::Starknet => "starknet",
            TargetChain::Polygon => "polygon",
            TargetChain::Arbitrum => "arbitrum",
            TargetChain::Optimism => "optimism",
            TargetChain::Base => "base",
            TargetChain::ZkSync => "zksync",
            TargetChain::Scroll => "scroll",
        }
    }

    /// Get the chain ID for EVM-compatible chains.
    pub fn evm_chain_id(&self) -> Option<u64> {
        match self {
            TargetChain::Ethereum => Some(1),
            TargetChain::Polygon => Some(137),
            TargetChain::Arbitrum => Some(42161),
            TargetChain::Optimism => Some(10),
            TargetChain::Base => Some(8453),
            TargetChain::ZkSync => Some(324),
            TargetChain::Scroll => Some(534352),
            TargetChain::Starknet => None, // Not EVM
        }
    }
}

/// Configuration for the Mina rail.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MinaRailConfig {
    /// Network to use.
    pub network: MinaNetwork,
    /// GraphQL endpoint URL.
    pub graphql_endpoint: String,
    /// zkApp verifier address.
    pub zkapp_address: MinaAddress,
    /// Attestation validity window in slots.
    pub validity_window_slots: u64,
    /// Fee payer address (for zkApp interactions).
    pub fee_payer_address: Option<MinaAddress>,
    /// Default fee in nanomina.
    pub default_fee_nanomina: u64,
}

impl Default for MinaRailConfig {
    fn default() -> Self {
        Self {
            network: MinaNetwork::Testnet,
            graphql_endpoint: "https://proxy.testworld.minaprotocol.network/graphql".to_string(),
            zkapp_address: MinaAddress::new("B62qxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"),
            validity_window_slots: 7200, // ~24 hours at 12s slots
            fee_payer_address: None,
            default_fee_nanomina: 100_000_000, // 0.1 MINA
        }
    }
}

// ============================================================================
// Mina Proof of State Types (from lambdaclass/mina_bridge)
// ============================================================================

/// Mina Proof of State verification request.
///
/// This is used to request verification of a Mina state proof that proves
/// the validity of a chain segment from the bridge tip.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MinaProofOfStateRequest {
    /// The Mina Proof of State public inputs.
    pub public_inputs: MinaProofOfStatePublicInputs,

    /// The Kimchi proof bytes (serialized).
    pub proof_bytes: Vec<u8>,

    /// Policy ID for zkpf binding.
    pub policy_id: u64,

    /// Current epoch.
    pub current_epoch: u64,

    /// Verifier scope ID.
    pub verifier_scope_id: u64,

    /// Holder identifier for binding computation.
    pub holder_id: String,
}

/// Response from Mina Proof of State verification.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MinaProofOfStateResponse {
    /// Whether verification succeeded.
    pub valid: bool,

    /// The computed mina_digest (if valid).
    pub mina_digest: Option<[u8; 32]>,

    /// Holder binding (if valid).
    pub holder_binding: Option<[u8; 32]>,

    /// Error message (if invalid).
    pub error: Option<String>,
}

/// Candidate chain state for Mina Proof of State.
///
/// Contains the state hash and ledger hash for a single block in the
/// candidate chain segment.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CandidateChainState {
    /// Index in the 16-block segment (0-15).
    pub index: u8,

    /// State hash (Poseidon hash of full state).
    pub state_hash: [u8; 32],

    /// Ledger hash (Merkle root of accounts).
    pub ledger_hash: [u8; 32],

    /// Blockchain length at this state.
    pub blockchain_length: u32,

    /// Global slot at this state.
    pub global_slot: u64,
}

/// Bridge tip state information.
///
/// Represents the currently verified tip state in the Mina bridge.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BridgeTipState {
    /// State hash of the bridge tip.
    pub state_hash: [u8; 32],

    /// Blockchain length at the tip.
    pub blockchain_length: u32,

    /// Global slot at the tip.
    pub global_slot: u64,

    /// Timestamp when this tip was bridged.
    pub bridged_at: u64,

    /// Source contract/chain where this tip was verified.
    pub source_chain: String,
}

/// Full Mina state proof request for account verification.
///
/// After verifying a Proof of State, this can be used to verify that
/// specific accounts meet balance thresholds using the ledger roots.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MinaAccountProofRequest {
    /// The verified Mina Proof of State public inputs.
    pub proof_of_state: MinaProofOfStatePublicInputs,

    /// Account addresses to verify (Mina base58 addresses).
    pub account_addresses: Vec<String>,

    /// Merkle proofs for each account in the ledger tree.
    pub account_proofs: Vec<MinaAccountMerkleProof>,

    /// Threshold to verify (in nanomina or token units).
    pub threshold: u64,

    /// Asset to check (None = native MINA).
    pub asset_filter: Option<String>,
}

/// Merkle proof for an account in the Mina ledger.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MinaAccountMerkleProof {
    /// Account address.
    pub address: String,

    /// Account balance (in smallest unit).
    pub balance: u128,

    /// Path from leaf to root.
    pub path: Vec<[u8; 32]>,

    /// Leaf index.
    pub leaf_index: u64,

    /// Which ledger hash this proof is against (index 0-15).
    pub ledger_index: u8,
}

impl MinaAccountProofRequest {
    /// Verify that the account proofs are valid against the ledger hashes.
    pub fn verify_proofs(&self) -> Result<bool, String> {
        for proof in &self.account_proofs {
            let ledger_idx = proof.ledger_index as usize;
            if ledger_idx >= CANDIDATE_CHAIN_LENGTH {
                return Err(format!("invalid ledger_index: {}", ledger_idx));
            }

            let expected_root = self.proof_of_state.candidate_chain_ledger_hashes[ledger_idx];

            // Verify Merkle path
            if !verify_merkle_path(&proof.path, proof.leaf_index, &expected_root) {
                return Err(format!(
                    "Merkle proof invalid for account {}",
                    proof.address
                ));
            }
        }
        Ok(true)
    }

    /// Calculate total balance across all proven accounts.
    pub fn total_balance(&self) -> u128 {
        self.account_proofs.iter().map(|p| p.balance).sum()
    }

    /// Check if total balance meets threshold.
    pub fn meets_threshold(&self) -> bool {
        self.total_balance() >= self.threshold as u128
    }
}

/// Verify a Merkle path (simplified).
fn verify_merkle_path(path: &[[u8; 32]], _leaf_index: u64, _expected_root: &[u8; 32]) -> bool {
    // Placeholder - real implementation would compute path hash
    !path.is_empty()
}

#[cfg(test)]
mod mina_pos_tests {
    use super::*;

    #[test]
    fn test_candidate_chain_length() {
        assert_eq!(CANDIDATE_CHAIN_LENGTH, 16);
    }

    #[test]
    fn test_candidate_chain_state() {
        let state = CandidateChainState {
            index: 0,
            state_hash: [1u8; 32],
            ledger_hash: [2u8; 32],
            blockchain_length: 100000,
            global_slot: 500000,
        };

        assert_eq!(state.index, 0);
        assert_eq!(state.blockchain_length, 100000);
    }

    #[test]
    fn test_bridge_tip_state() {
        let tip = BridgeTipState {
            state_hash: [1u8; 32],
            blockchain_length: 99984,
            global_slot: 499984,
            bridged_at: 1700000000,
            source_chain: "ethereum".to_string(),
        };

        assert_eq!(tip.source_chain, "ethereum");
    }
}

