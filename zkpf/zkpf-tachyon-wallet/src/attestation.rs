//! Cross-chain attestation types for the Tachyon wallet.

use serde::{Deserialize, Serialize};

use crate::types::{ChainId, HolderId};

// ═══════════════════════════════════════════════════════════════════════════════
// UNIFIED ATTESTATION
// ═══════════════════════════════════════════════════════════════════════════════

/// Unified attestation that can be verified on any supported chain.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UnifiedAttestation {
    /// Unique attestation identifier.
    pub attestation_id: [u8; 32],
    /// Holder binding (privacy-preserving identifier).
    pub holder_binding: [u8; 32],
    /// Policy ID that was proven.
    pub policy_id: u64,
    /// Epoch at which the proof was generated.
    pub epoch: u64,
    /// Rail that generated the source proof.
    pub source_rail: String,
    /// Chains where this attestation is valid.
    pub valid_on: Vec<ChainId>,
    /// Timestamp when attestation was created.
    pub created_at: u64,
    /// Timestamp when attestation expires.
    pub expires_at: u64,
    /// Whether attestation has been revoked.
    pub revoked: bool,
    /// Proof data for verification.
    pub proof: AttestationProof,
}

impl UnifiedAttestation {
    /// Check if the attestation is currently valid.
    pub fn is_valid(&self, current_timestamp: u64) -> bool {
        !self.revoked && current_timestamp < self.expires_at
    }

    /// Check if the attestation is valid on a specific chain.
    pub fn is_valid_on(&self, chain: &ChainId, current_timestamp: u64) -> bool {
        self.is_valid(current_timestamp) && self.valid_on.contains(chain)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ATTESTATION PROOF
// ═══════════════════════════════════════════════════════════════════════════════

/// Proof data for attestation verification.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum AttestationProof {
    /// Direct proof from source rail.
    Direct {
        /// Raw proof bytes.
        proof: Vec<u8>,
        /// Public inputs hash.
        public_inputs_hash: [u8; 32],
    },
    /// Mina recursive wrapper proof.
    MinaRecursive {
        /// Mina proof bytes.
        mina_proof: Vec<u8>,
        /// Mina zkApp state commitment.
        zkapp_commitment: [u8; 32],
        /// Mina global slot at proof creation.
        mina_slot: u64,
    },
    /// Axelar GMP receipt (for cross-chain claims).
    AxelarReceipt {
        /// Receipt hash.
        receipt_hash: [u8; 32],
        /// Source chain.
        source_chain: String,
        /// Axelar transaction ID.
        axelar_tx_id: String,
        /// Block number on source chain.
        source_block: u64,
    },
}

// ═══════════════════════════════════════════════════════════════════════════════
// ATTESTATION REQUEST
// ═══════════════════════════════════════════════════════════════════════════════

/// Request to create a cross-chain attestation.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AttestationRequest {
    /// Holder identity.
    pub holder_id: HolderId,
    /// Policy ID.
    pub policy_id: u64,
    /// Target chains for the attestation.
    pub target_chains: Vec<ChainId>,
    /// Validity duration in seconds.
    pub validity_secs: u64,
    /// Whether to broadcast via Axelar immediately.
    pub broadcast_immediately: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// ATTESTATION VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

/// Result of attestation verification.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AttestationVerification {
    /// Whether the attestation is valid.
    pub valid: bool,
    /// Verification timestamp.
    pub verified_at: u64,
    /// Chain where verification occurred.
    pub verified_on: ChainId,
    /// Error message if invalid.
    pub error: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// ATTESTATION REVOCATION
// ═══════════════════════════════════════════════════════════════════════════════

/// Revocation record for an attestation.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AttestationRevocation {
    /// Attestation being revoked.
    pub attestation_id: [u8; 32],
    /// Holder binding (must match original attestation).
    pub holder_binding: [u8; 32],
    /// Reason for revocation.
    pub reason: RevocationReason,
    /// Timestamp of revocation.
    pub revoked_at: u64,
    /// Chains notified of revocation.
    pub notified_chains: Vec<ChainId>,
}

/// Reasons for attestation revocation.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RevocationReason {
    /// Holder requested revocation.
    HolderRequest,
    /// Policy compliance issue detected.
    PolicyViolation,
    /// Key compromise suspected.
    KeyCompromise,
    /// Attestation superseded by newer one.
    Superseded,
    /// Administrative revocation.
    Administrative { reason: String },
}

