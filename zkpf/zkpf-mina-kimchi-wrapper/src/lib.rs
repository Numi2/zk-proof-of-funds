//! zkpf-mina-kimchi-wrapper
//!
//! BN254 wrapper circuit for verifying Mina Proof of State (Kimchi) proofs.
//!
//! # Overview
//!
//! This crate implements a BN254 circuit that:
//! 1. Takes a Mina Proof of State Kimchi proof as witness
//! 2. Re-runs the Kimchi verifier using foreign-field Pasta arithmetic
//! 3. Computes a digest over the public inputs
//! 4. Exposes `mina_digest` as the single BN254 public input
//!
//! # Mina Proof of State
//!
//! The Mina Proof of State circuit (from lambdaclass/mina_bridge) verifies:
//! - Mina's recursive state proof of the tip state (Pickles state SNARK)
//! - Consistency of candidate state chain (state hashes form valid chain)
//! - Ledger roots match states
//! - Consensus conditions for chain segment
//!
//! # Public Inputs
//!
//! From the Mina Bridge spec, a Mina Proof of State is defined with:
//!
//! ```text
//! [
//!   bridge_tip_state_hash,
//!   candidate_chain_state_hashes[16],
//!   candidate_chain_ledger_hashes[16],
//! ]
//! ```
//!
//! The wrapper circuit computes:
//! ```text
//! mina_digest = H(bridge_tip_state_hash || state_hashes[0..16] || ledger_hashes[0..16])
//! ```
//!
//! # Architecture
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────────────┐
//! │                    BN254 Wrapper Circuit                                 │
//! │                                                                          │
//! │  ┌────────────────────┐    ┌──────────────────────────────────────────┐ │
//! │  │  Kimchi Proof      │    │  Foreign-Field Pasta Arithmetic          │ │
//! │  │  (Witness)         │───►│  - Verify Pickles state proof            │ │
//! │  │                    │    │  - Check state hash chain                │ │
//! │  │  • tip_proof       │    │  - Verify ledger root consistency        │ │
//! │  │  • chain_states    │    │  - Consensus checks                      │ │
//! │  │  • bridge_tip      │    │                                          │ │
//! │  └────────────────────┘    └──────────────────────────────────────────┘ │
//! │                                         │                                │
//! │                                         ▼                                │
//! │                            ┌─────────────────────────┐                   │
//! │                            │  Digest Computation     │                   │
//! │                            │                         │                   │
//! │                            │  mina_digest = H(       │                   │
//! │                            │    bridge_tip_hash ||   │                   │
//! │                            │    state_hashes[16] ||  │                   │
//! │                            │    ledger_hashes[16]    │                   │
//! │                            │  )                      │                   │
//! │                            └───────────┬─────────────┘                   │
//! │                                        │                                 │
//! │                                        ▼                                 │
//! │                            ┌─────────────────────────┐                   │
//! │                            │  Public Output          │                   │
//! │                            │  mina_digest : Fr(BN254)│                   │
//! │                            └─────────────────────────┘                   │
//! └─────────────────────────────────────────────────────────────────────────┘
//! ```

pub mod accumulator;
pub mod circuit;
pub mod ec;
pub mod error;
pub mod ff;
pub mod gates;
pub mod ipa;
pub mod kimchi_core;
pub mod linearization;
pub mod poseidon;
pub mod proof_parser;
pub mod types;
pub mod verifier;

use blake3::Hasher;
use serde::{Deserialize, Serialize};

pub use circuit::{
    MinaProofOfStateWrapperCircuit, MinaProofOfStateWrapperInput,
    mina_wrapper_default_params, mina_wrapper_keygen, create_wrapper_proof,
    WRAPPER_DEFAULT_K, WRAPPER_INSTANCE_COLUMNS,
};
pub use error::KimchiWrapperError;
pub use types::*;

/// Number of candidate chain states in Mina Proof of State.
/// This is a fixed constant from the Mina Bridge specification.
pub const CANDIDATE_CHAIN_LENGTH: usize = 16;

/// Domain separator for Mina digest computation.
pub const MINA_DIGEST_DOMAIN: &[u8] = b"zkpf_mina_state_digest_v1";

/// Mina Proof of State public inputs as defined in lambdaclass/mina_bridge.
///
/// These are the canonical public inputs for the Mina Proof of State circuit:
/// - `bridge_tip_state_hash`: Hash of the currently bridged tip state
/// - `candidate_chain_state_hashes`: 16 state hashes of the candidate chain segment
/// - `candidate_chain_ledger_hashes`: 16 ledger root hashes for each state
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MinaProofOfStatePublicInputs {
    /// Hash of the currently bridged tip state (the last verified Mina state).
    /// This is a Pasta field element encoded as 32 bytes.
    pub bridge_tip_state_hash: [u8; 32],

    /// Hashes of the 16 candidate chain states ending in the new candidate tip.
    /// Each hash encodes the transition frontier segment being proposed.
    pub candidate_chain_state_hashes: [[u8; 32]; CANDIDATE_CHAIN_LENGTH],

    /// Ledger root hashes for each of the 16 candidate states.
    /// Each is a Merkle root over account hashes, used for account proofs.
    pub candidate_chain_ledger_hashes: [[u8; 32]; CANDIDATE_CHAIN_LENGTH],
}

impl MinaProofOfStatePublicInputs {
    /// Compute the canonical digest over all public inputs.
    ///
    /// This digest is exposed as the single BN254 public input from the wrapper circuit.
    ///
    /// ```text
    /// mina_digest = H(
    ///   bridge_tip_state_hash ||
    ///   candidate_chain_state_hashes[0..16] ||
    ///   candidate_chain_ledger_hashes[0..16]
    /// )
    /// ```
    ///
    /// where H is BLAKE3 (could be Poseidon for in-circuit friendliness).
    pub fn compute_digest(&self) -> [u8; 32] {
        let mut hasher = Hasher::new();
        hasher.update(MINA_DIGEST_DOMAIN);
        hasher.update(&self.bridge_tip_state_hash);
        for hash in &self.candidate_chain_state_hashes {
            hasher.update(hash);
        }
        for hash in &self.candidate_chain_ledger_hashes {
            hasher.update(hash);
        }
        *hasher.finalize().as_bytes()
    }

    /// Compute the digest using Poseidon (BN254-friendly, for in-circuit use).
    ///
    /// This is the variant used inside the wrapper circuit itself.
    pub fn compute_digest_poseidon(&self) -> [u8; 32] {
        // For the circuit, we use Poseidon over reduced field elements
        // The implementation delegates to the circuit module
        circuit::compute_mina_digest_poseidon(self)
    }

    /// Create from raw bytes (convenience for deserialization).
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, KimchiWrapperError> {
        if bytes.len() < 32 + 32 * CANDIDATE_CHAIN_LENGTH * 2 {
            return Err(KimchiWrapperError::InvalidInput(
                "insufficient bytes for MinaProofOfStatePublicInputs".into(),
            ));
        }

        let mut offset = 0;

        let mut bridge_tip_state_hash = [0u8; 32];
        bridge_tip_state_hash.copy_from_slice(&bytes[offset..offset + 32]);
        offset += 32;

        let mut candidate_chain_state_hashes = [[0u8; 32]; CANDIDATE_CHAIN_LENGTH];
        for hash in &mut candidate_chain_state_hashes {
            hash.copy_from_slice(&bytes[offset..offset + 32]);
            offset += 32;
        }

        let mut candidate_chain_ledger_hashes = [[0u8; 32]; CANDIDATE_CHAIN_LENGTH];
        for hash in &mut candidate_chain_ledger_hashes {
            hash.copy_from_slice(&bytes[offset..offset + 32]);
            offset += 32;
        }

        Ok(Self {
            bridge_tip_state_hash,
            candidate_chain_state_hashes,
            candidate_chain_ledger_hashes,
        })
    }

    /// Serialize to bytes.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(32 + 32 * CANDIDATE_CHAIN_LENGTH * 2);
        bytes.extend_from_slice(&self.bridge_tip_state_hash);
        for hash in &self.candidate_chain_state_hashes {
            bytes.extend_from_slice(hash);
        }
        for hash in &self.candidate_chain_ledger_hashes {
            bytes.extend_from_slice(hash);
        }
        bytes
    }
}

/// Full zkpf public inputs for the Mina rail with Proof of State binding.
///
/// This combines:
/// - `mina_digest`: The single BN254 public input from the wrapper circuit
/// - zkpf metadata: policy_id, epoch, scope, holder_binding
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MinaRailPublicInputs {
    /// Digest of Mina Proof of State public inputs.
    /// H(bridge_tip_state_hash || 16 state hashes || 16 ledger hashes)
    pub mina_digest: [u8; 32],

    /// Policy ID from zkpf policy registry.
    pub policy_id: u64,

    /// Current epoch (Unix timestamp or protocol-specific epoch number).
    pub current_epoch: u64,

    /// Verifier scope identifier for domain separation.
    pub verifier_scope_id: u64,

    /// Holder binding: H(holder_id || mina_digest || policy_id || scope).
    /// This binds the holder's identity to the proof without revealing it.
    pub holder_binding: [u8; 32],
}

impl MinaRailPublicInputs {
    /// Create from Mina Proof of State public inputs and zkpf metadata.
    pub fn new(
        mina_public_inputs: &MinaProofOfStatePublicInputs,
        policy_id: u64,
        current_epoch: u64,
        verifier_scope_id: u64,
        holder_id: &str,
    ) -> Self {
        let mina_digest = mina_public_inputs.compute_digest();
        let holder_binding =
            compute_holder_binding(holder_id, &mina_digest, policy_id, verifier_scope_id);

        Self {
            mina_digest,
            policy_id,
            current_epoch,
            verifier_scope_id,
            holder_binding,
        }
    }

    /// Compute the nullifier for replay protection.
    pub fn compute_nullifier(&self) -> [u8; 32] {
        compute_mina_nullifier(
            &self.holder_binding,
            self.verifier_scope_id,
            self.policy_id,
            self.current_epoch,
        )
    }
}

/// Compute holder binding for the Mina rail.
pub fn compute_holder_binding(
    holder_id: &str,
    mina_digest: &[u8; 32],
    policy_id: u64,
    scope_id: u64,
) -> [u8; 32] {
    let mut hasher = Hasher::new();
    hasher.update(b"mina_holder_binding_v1");
    hasher.update(holder_id.as_bytes());
    hasher.update(mina_digest);
    hasher.update(&policy_id.to_be_bytes());
    hasher.update(&scope_id.to_be_bytes());
    *hasher.finalize().as_bytes()
}

/// Compute nullifier for the Mina rail.
pub fn compute_mina_nullifier(
    holder_binding: &[u8; 32],
    scope_id: u64,
    policy_id: u64,
    epoch: u64,
) -> [u8; 32] {
    let mut hasher = Hasher::new();
    hasher.update(b"mina_pof_nullifier_v1");
    hasher.update(holder_binding);
    hasher.update(&scope_id.to_be_bytes());
    hasher.update(&policy_id.to_be_bytes());
    hasher.update(&epoch.to_be_bytes());
    *hasher.finalize().as_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_proof_of_state_inputs() -> MinaProofOfStatePublicInputs {
        MinaProofOfStatePublicInputs {
            bridge_tip_state_hash: [1u8; 32],
            candidate_chain_state_hashes: [[2u8; 32]; CANDIDATE_CHAIN_LENGTH],
            candidate_chain_ledger_hashes: [[3u8; 32]; CANDIDATE_CHAIN_LENGTH],
        }
    }

    #[test]
    fn test_digest_computation() {
        let inputs = sample_proof_of_state_inputs();
        let digest = inputs.compute_digest();
        assert_ne!(digest, [0u8; 32]);

        // Digest should be deterministic
        let digest2 = inputs.compute_digest();
        assert_eq!(digest, digest2);
    }

    #[test]
    fn test_digest_changes_with_inputs() {
        let mut inputs1 = sample_proof_of_state_inputs();
        let mut inputs2 = sample_proof_of_state_inputs();

        // Change one state hash
        inputs2.candidate_chain_state_hashes[0] = [99u8; 32];

        let digest1 = inputs1.compute_digest();
        let digest2 = inputs2.compute_digest();
        assert_ne!(digest1, digest2);

        // Change bridge tip
        inputs1.bridge_tip_state_hash = [100u8; 32];
        let digest3 = inputs1.compute_digest();
        assert_ne!(digest1, digest3);
    }

    #[test]
    fn test_bytes_round_trip() {
        let inputs = sample_proof_of_state_inputs();
        let bytes = inputs.to_bytes();
        let recovered = MinaProofOfStatePublicInputs::from_bytes(&bytes).unwrap();

        assert_eq!(inputs.bridge_tip_state_hash, recovered.bridge_tip_state_hash);
        assert_eq!(
            inputs.candidate_chain_state_hashes,
            recovered.candidate_chain_state_hashes
        );
        assert_eq!(
            inputs.candidate_chain_ledger_hashes,
            recovered.candidate_chain_ledger_hashes
        );
    }

    #[test]
    fn test_rail_public_inputs() {
        let mina_inputs = sample_proof_of_state_inputs();
        let rail_inputs = MinaRailPublicInputs::new(
            &mina_inputs,
            100,           // policy_id
            1700000000,    // epoch
            42,            // scope_id
            "holder-123",  // holder_id
        );

        assert_eq!(rail_inputs.policy_id, 100);
        assert_eq!(rail_inputs.current_epoch, 1700000000);
        assert_ne!(rail_inputs.holder_binding, [0u8; 32]);

        let nullifier = rail_inputs.compute_nullifier();
        assert_ne!(nullifier, [0u8; 32]);
    }

    #[test]
    fn test_holder_binding_uniqueness() {
        let mina_inputs = sample_proof_of_state_inputs();
        let mina_digest = mina_inputs.compute_digest();

        let binding1 = compute_holder_binding("holder-1", &mina_digest, 100, 42);
        let binding2 = compute_holder_binding("holder-2", &mina_digest, 100, 42);
        let binding3 = compute_holder_binding("holder-1", &mina_digest, 101, 42);

        assert_ne!(binding1, binding2);
        assert_ne!(binding1, binding3);
    }
}

