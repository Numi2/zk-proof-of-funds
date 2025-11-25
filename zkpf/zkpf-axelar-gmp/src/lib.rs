//! zkpf-axelar-gmp
//!
//! Types and utilities for Axelar GMP integration with zkpf proof-of-funds.
//! This crate provides the data structures and encoding/decoding logic for
//! broadcasting PoF receipts across chains via Axelar General Message Passing.

use serde::{Deserialize, Serialize};
use sha3::{Digest, Keccak256};
use thiserror::Error;

pub mod chains;
pub mod encoding;

/// Rail identifier for Axelar GMP
pub const RAIL_ID_AXELAR_GMP: &str = "AXELAR_GMP";

/// Default validity window for PoF receipts (24 hours)
pub const DEFAULT_VALIDITY_WINDOW_SECS: u64 = 86400;

// ═══════════════════════════════════════════════════════════════════════════════
// ERRORS
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Error)]
pub enum AxelarGmpError {
    #[error("encoding error: {0}")]
    Encoding(String),

    #[error("decoding error: {0}")]
    Decoding(String),

    #[error("invalid chain: {0}")]
    InvalidChain(String),

    #[error("invalid message type: {0}")]
    InvalidMessageType(u8),

    #[error("gateway error: {0}")]
    Gateway(String),

    #[error("gas estimation failed: {0}")]
    GasEstimation(String),

    #[error("untrusted source: chain={0}, address={1}")]
    UntrustedSource(String, String),

    #[error("receipt expired")]
    ReceiptExpired,

    #[error("receipt not found")]
    ReceiptNotFound,

    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/// Message types for GMP payloads
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum MessageType {
    /// Standard PoF receipt
    PoFReceipt = 0,
    /// Revocation of a previous receipt
    PoFRevocation = 1,
    /// Query PoF status (for pull-based integrations)
    PoFQuery = 2,
}

impl TryFrom<u8> for MessageType {
    type Error = AxelarGmpError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::PoFReceipt),
            1 => Ok(Self::PoFRevocation),
            2 => Ok(Self::PoFQuery),
            _ => Err(AxelarGmpError::InvalidMessageType(value)),
        }
    }
}

/// PoF receipt payload for GMP transmission
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoFReceipt {
    /// Pseudonymous holder identifier (32 bytes)
    pub holder_id: [u8; 32],
    /// Policy under which proof was verified
    pub policy_id: u64,
    /// Snapshot identifier (32 bytes)
    pub snapshot_id: [u8; 32],
    /// Chain where attestation was recorded
    pub chain_id_origin: u64,
    /// Hash of the full attestation (32 bytes)
    pub attestation_hash: [u8; 32],
    /// Seconds until receipt expires
    pub validity_window: u64,
    /// Timestamp when attestation was issued
    pub issued_at: u64,
}

impl PoFReceipt {
    /// Create a new PoF receipt
    pub fn new(
        holder_id: [u8; 32],
        policy_id: u64,
        snapshot_id: [u8; 32],
        chain_id_origin: u64,
        attestation_hash: [u8; 32],
        validity_window: u64,
        issued_at: u64,
    ) -> Self {
        Self {
            holder_id,
            policy_id,
            snapshot_id,
            chain_id_origin,
            attestation_hash,
            validity_window,
            issued_at,
        }
    }

    /// Check if the receipt has expired
    pub fn is_expired(&self, current_timestamp: u64) -> bool {
        current_timestamp > self.issued_at + self.validity_window
    }

    /// Get the expiration timestamp
    pub fn expires_at(&self) -> u64 {
        self.issued_at + self.validity_window
    }

    /// Compute the receipt hash for verification
    pub fn compute_hash(&self) -> [u8; 32] {
        let mut hasher = Keccak256::new();
        hasher.update(&self.holder_id);
        hasher.update(self.policy_id.to_be_bytes());
        hasher.update(&self.snapshot_id);
        hasher.update(self.chain_id_origin.to_be_bytes());
        hasher.update(&self.attestation_hash);
        hasher.update(self.validity_window.to_be_bytes());
        hasher.update(self.issued_at.to_be_bytes());
        hasher.finalize().into()
    }
}

/// Revocation payload
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoFRevocation {
    /// Pseudonymous holder identifier (32 bytes)
    pub holder_id: [u8; 32],
    /// Policy ID
    pub policy_id: u64,
    /// Snapshot identifier (32 bytes)
    pub snapshot_id: [u8; 32],
}

/// Query payload (for pull-based integrations)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoFQuery {
    /// Holder ID to query
    pub holder_id: [u8; 32],
    /// Policy ID to check
    pub policy_id: u64,
    /// Optional: specific snapshot to query
    pub snapshot_id: Option<[u8; 32]>,
    /// Callback chain for response
    pub callback_chain: String,
    /// Callback contract address
    pub callback_address: String,
}

/// GMP message wrapper
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GmpMessage {
    /// Message type
    pub msg_type: MessageType,
    /// Encoded payload
    pub payload: Vec<u8>,
}

impl GmpMessage {
    /// Create a receipt message
    pub fn receipt(receipt: PoFReceipt) -> Result<Self, AxelarGmpError> {
        let payload = encoding::encode_receipt(&receipt)?;
        Ok(Self {
            msg_type: MessageType::PoFReceipt,
            payload,
        })
    }

    /// Create a revocation message
    pub fn revocation(revocation: PoFRevocation) -> Result<Self, AxelarGmpError> {
        let payload = encoding::encode_revocation(&revocation)?;
        Ok(Self {
            msg_type: MessageType::PoFRevocation,
            payload,
        })
    }

    /// Create a query message
    pub fn query(query: PoFQuery) -> Result<Self, AxelarGmpError> {
        let payload = encoding::encode_query(&query)?;
        Ok(Self {
            msg_type: MessageType::PoFQuery,
            payload,
        })
    }

    /// Decode a GMP message from bytes
    pub fn decode(bytes: &[u8]) -> Result<Self, AxelarGmpError> {
        if bytes.is_empty() {
            return Err(AxelarGmpError::Decoding("empty payload".into()));
        }

        let msg_type = MessageType::try_from(bytes[0])?;
        let payload = bytes[1..].to_vec();

        Ok(Self { msg_type, payload })
    }

    /// Encode the message to bytes
    pub fn encode(&self) -> Vec<u8> {
        let mut result = vec![self.msg_type as u8];
        result.extend_from_slice(&self.payload);
        result
    }

    /// Decode the payload as a receipt
    pub fn as_receipt(&self) -> Result<PoFReceipt, AxelarGmpError> {
        if self.msg_type != MessageType::PoFReceipt {
            return Err(AxelarGmpError::InvalidMessageType(self.msg_type as u8));
        }
        encoding::decode_receipt(&self.payload)
    }

    /// Decode the payload as a revocation
    pub fn as_revocation(&self) -> Result<PoFRevocation, AxelarGmpError> {
        if self.msg_type != MessageType::PoFRevocation {
            return Err(AxelarGmpError::InvalidMessageType(self.msg_type as u8));
        }
        encoding::decode_revocation(&self.payload)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHAIN SUBSCRIPTION
// ═══════════════════════════════════════════════════════════════════════════════

/// Chain subscription configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainSubscription {
    /// Axelar chain identifier (e.g., "osmosis", "neutron", "ethereum")
    pub chain_name: String,
    /// PoFReceiver contract address on that chain
    pub receiver_contract: String,
    /// Whether subscription is active
    pub active: bool,
    /// Default gas limit for GMP calls
    pub default_gas: u64,
    /// Chain type (EVM, Cosmos, etc.)
    pub chain_type: ChainType,
}

/// Chain type classification
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ChainType {
    /// EVM-compatible chain
    Evm,
    /// Cosmos SDK chain (CosmWasm)
    Cosmos,
    /// Starknet
    Starknet,
    /// Other/unknown
    Other,
}

impl ChainSubscription {
    /// Create a new EVM chain subscription
    pub fn evm(chain_name: &str, receiver_contract: &str, default_gas: u64) -> Self {
        Self {
            chain_name: chain_name.to_string(),
            receiver_contract: receiver_contract.to_string(),
            active: true,
            default_gas,
            chain_type: ChainType::Evm,
        }
    }

    /// Create a new Cosmos chain subscription
    pub fn cosmos(chain_name: &str, receiver_contract: &str, default_gas: u64) -> Self {
        Self {
            chain_name: chain_name.to_string(),
            receiver_contract: receiver_contract.to_string(),
            active: true,
            default_gas,
            chain_type: ChainType::Cosmos,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STORED RECEIPT
// ═══════════════════════════════════════════════════════════════════════════════

/// Stored receipt on receiver chains
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredReceipt {
    /// Pseudonymous holder identifier
    pub holder_id: [u8; 32],
    /// Policy ID
    pub policy_id: u64,
    /// Snapshot identifier
    pub snapshot_id: [u8; 32],
    /// Chain where attestation was recorded
    pub chain_id_origin: u64,
    /// Hash of the full attestation
    pub attestation_hash: [u8; 32],
    /// Timestamp when attestation was issued
    pub issued_at: u64,
    /// Timestamp when receipt expires
    pub expires_at: u64,
    /// Whether receipt is currently valid
    pub valid: bool,
}

impl StoredReceipt {
    /// Create from a PoF receipt
    pub fn from_receipt(receipt: &PoFReceipt) -> Self {
        Self {
            holder_id: receipt.holder_id,
            policy_id: receipt.policy_id,
            snapshot_id: receipt.snapshot_id,
            chain_id_origin: receipt.chain_id_origin,
            attestation_hash: receipt.attestation_hash,
            issued_at: receipt.issued_at,
            expires_at: receipt.expires_at(),
            valid: true,
        }
    }

    /// Check if the receipt is currently valid
    pub fn is_valid(&self, current_timestamp: u64) -> bool {
        self.valid && current_timestamp < self.expires_at
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRUSTED SOURCE
// ═══════════════════════════════════════════════════════════════════════════════

/// Trusted source configuration for receiver contracts
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustedSource {
    /// Axelar chain identifier
    pub chain_name: String,
    /// AttestationBridge contract address on that chain
    pub bridge_contract: String,
    /// Whether this source is active
    pub active: bool,
}

impl TrustedSource {
    /// Create a new trusted source
    pub fn new(chain_name: &str, bridge_contract: &str) -> Self {
        Self {
            chain_name: chain_name.to_string(),
            bridge_contract: bridge_contract.to_string(),
            active: true,
        }
    }

    /// Verify that a source matches this configuration
    pub fn matches(&self, chain_name: &str, source_address: &str) -> bool {
        self.active
            && self.chain_name == chain_name
            && self.bridge_contract.to_lowercase() == source_address.to_lowercase()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERCHAIN ACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/// Configuration for interchain actions that can be triggered by PoF receipts
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterchainActionConfig {
    /// Action identifier
    pub action_id: String,
    /// Required policy IDs for this action
    pub required_policies: Vec<u64>,
    /// Minimum balance threshold (in smallest unit)
    pub min_threshold: Option<u64>,
    /// Target chain for the action
    pub target_chain: String,
    /// Target contract address
    pub target_contract: String,
    /// Action type
    pub action_type: InterchainActionType,
}

/// Types of interchain actions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum InterchainActionType {
    /// Mint position on remote chain
    Mint { asset: String, amount_cap: u64 },
    /// Credit line on remote chain
    CreditLine { max_credit: u64, interest_rate_bps: u32 },
    /// Whitelist for undercollateralized borrowing
    BorrowWhitelist { max_ltv_bps: u32 },
    /// Custom action with arbitrary payload
    Custom { action_name: String, payload: Vec<u8> },
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_receipt_creation() {
        let receipt = PoFReceipt::new(
            [1u8; 32],
            271828,
            [2u8; 32],
            1, // Ethereum mainnet
            [3u8; 32],
            DEFAULT_VALIDITY_WINDOW_SECS,
            1700000000,
        );

        assert_eq!(receipt.policy_id, 271828);
        assert_eq!(receipt.chain_id_origin, 1);
        assert_eq!(receipt.expires_at(), 1700000000 + DEFAULT_VALIDITY_WINDOW_SECS);
        assert!(!receipt.is_expired(1700000000));
        assert!(receipt.is_expired(1700000000 + DEFAULT_VALIDITY_WINDOW_SECS + 1));
    }

    #[test]
    fn test_gmp_message_roundtrip() {
        let receipt = PoFReceipt::new(
            [1u8; 32],
            271828,
            [2u8; 32],
            1,
            [3u8; 32],
            86400,
            1700000000,
        );

        let msg = GmpMessage::receipt(receipt.clone()).unwrap();
        let encoded = msg.encode();
        let decoded = GmpMessage::decode(&encoded).unwrap();

        assert_eq!(decoded.msg_type, MessageType::PoFReceipt);

        let decoded_receipt = decoded.as_receipt().unwrap();
        assert_eq!(decoded_receipt.holder_id, receipt.holder_id);
        assert_eq!(decoded_receipt.policy_id, receipt.policy_id);
    }

    #[test]
    fn test_message_type_conversion() {
        assert_eq!(MessageType::try_from(0).unwrap(), MessageType::PoFReceipt);
        assert_eq!(MessageType::try_from(1).unwrap(), MessageType::PoFRevocation);
        assert_eq!(MessageType::try_from(2).unwrap(), MessageType::PoFQuery);
        assert!(MessageType::try_from(3).is_err());
    }

    #[test]
    fn test_trusted_source_matching() {
        let source = TrustedSource::new("ethereum", "0x1234567890abcdef");
        assert!(source.matches("ethereum", "0x1234567890abcdef"));
        assert!(source.matches("ethereum", "0x1234567890ABCDEF")); // Case insensitive
        assert!(!source.matches("arbitrum", "0x1234567890abcdef"));
        assert!(!source.matches("ethereum", "0xdifferent"));
    }
}

