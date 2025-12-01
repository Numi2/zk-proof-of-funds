//! zkpf-orchard-pof-circuit
//!
//! This crate implements the **inner Orchard proof-of-funds Halo2 circuit** over
//! the Pasta (Pallas) field. It is responsible for:
//! - Verifying Merkle paths for each note commitment to the Orchard anchor
//! - Enforcing Σ v_i ≥ threshold_zats inside the circuit
//! - Computing holder binding that is exposed as part of the public inputs
//!
//! The circuit uses the official Orchard Halo2 gadgets from `halo2_gadgets` for
//! Sinsemilla-based Merkle path verification.

use ff::PrimeField;
use orchard::{note::Note, tree};
use pasta_curves::pallas;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use zkpf_orchard_inner::{
    OrchardInnerPublicInputs, OrchardPofError, OrchardPofInput, OrchardPofNoteWitness,
    OrchardPofProver, ORCHARD_POF_MAX_NOTES,
};

mod circuit;
mod domains;
pub mod fixed_bases;
mod gadgets;
pub mod merkle_circuit;
pub mod sinsemilla_hash;

pub use circuit::{OrchardPofCircuit, OrchardPofConfig, MERKLE_DEPTH, MAX_NOTES, warm_cache};
pub use merkle_circuit::{
    MerkleVerificationConfig, MerklePathWitness,
    verify_merkle_path_in_circuit, batch_verify_merkle_paths,
};
pub use domains::{PofHashDomains, PofCommitDomains, PofFixedBases as DomainFixedBases};
pub use fixed_bases::{
    NullifierK, OrchardFixedBases, OrchardFixedBasesFull, PofFixedBases, PofFixedBasesFull,
    ValueCommitV, FIXED_BASE_WINDOW_SIZE, H, NUM_WINDOWS, NUM_WINDOWS_SHORT,
};
pub use sinsemilla_hash::{
    compute_merkle_root, verify_merkle_path, merkle_hash_level,
    bytes_to_field, field_to_bytes, empty_root,
};

/// Snapshot of a single Orchard note as seen by the wallet / prover.
///
/// This is a richer, Orchard-typed representation than the inner-circuit
/// witness and is intended for use in the wallet backend and prover glue.
#[derive(Clone, Debug)]
pub struct OrchardPofNoteSnapshot {
    /// Full Orchard note (includes address, randomness, etc.).
    ///
    /// In early integrations this may be `None` if the caller only has access
    /// to the extracted commitment and Merkle path. A production implementation
    /// should populate this so the circuit can recompute `cmx` from note
    /// fields and viewing keys.
    pub note: Option<Note>,
    /// Note value in zatoshi.
    pub value_zats: orchard::value::NoteValue,
    /// Extracted note commitment (cmx).
    pub cmx: orchard::note::ExtractedNoteCommitment,
    /// Position in the global Orchard note commitment tree.
    pub position: u64,
    /// Canonical Orchard Merkle path from this leaf to the anchor.
    pub merkle_path: tree::MerklePath,
}

/// Snapshot of all Orchard notes included in a single PoF statement at a given
/// chain height.
#[derive(Clone, Debug)]
pub struct OrchardPofSnapshot {
    /// Chain height at which the anchor was taken.
    pub height: u32,
    /// Orchard anchor at `height`.
    pub anchor: tree::Anchor,
    /// All notes included in the PoF.
    pub notes: Vec<OrchardPofNoteSnapshot>,
}

/// Parameters required to build an Orchard PoF statement.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrchardPofParams {
    /// Threshold in zatoshi that the sum of note values must exceed.
    pub threshold_zats: u64,
    /// Opaque UFVK bytes corresponding to the holder's Orchard full viewing key.
    ///
    /// The exact encoding (e.g. ZIP-32 UFVK bytes) must match what the
    /// in-circuit implementation expects when deriving nullifiers and enforcing
    /// ownership.
    pub ufvk_bytes: Vec<u8>,
    /// Optional application-specific holder identifier (e.g. UUID or hash of
    /// KYC record) that is mixed into the binding hash.
    pub holder_id: Option<[u8; 32]>,
}

/// Serialized Halo2 artifacts for the inner Orchard PoF circuit.
///
/// These are the Pasta-field circuit artifacts (using IPA commitment scheme).
#[derive(Clone, Debug)]
pub struct OrchardPofCircuitArtifacts {
    /// Serialized KZG/IPA parameters for the circuit.
    pub params_bytes: Vec<u8>,
    /// Serialized verifying key.
    pub vk_bytes: Vec<u8>,
    /// Serialized proving key.
    pub pk_bytes: Vec<u8>,
    /// Circuit size parameter (k).
    pub k: u32,
}

/// Concrete prover handle for the inner Orchard PoF circuit.
///
/// This implementation uses the zcash Halo2 proof system over Pasta curves
/// with the IPA (inner product argument) polynomial commitment scheme.
#[derive(Clone, Debug)]
pub struct OrchardPofCircuitProver {
    pub artifacts: OrchardPofCircuitArtifacts,
}

impl OrchardPofCircuitProver {
    /// Construct a new prover instance.
    ///
    /// The real implementation will likely load parameters and keys from disk
    /// or generate them on first use.
    pub fn new(artifacts: OrchardPofCircuitArtifacts) -> Self {
        OrchardPofCircuitProver { artifacts }
    }

    /// Helper that converts a rich `OrchardPofSnapshot` + params into the
    /// minimal `OrchardPofInput` expected by the inner circuit.
    pub fn snapshot_to_inner_input(
        snapshot: &OrchardPofSnapshot,
        params: &OrchardPofParams,
    ) -> Result<OrchardPofInput, OrchardPofError> {
        if snapshot.notes.len() > ORCHARD_POF_MAX_NOTES {
            return Err(OrchardPofError::InvalidWitness(format!(
                "too many Orchard notes: got {}, max supported is {}",
                snapshot.notes.len(),
                ORCHARD_POF_MAX_NOTES
            )));
        }

        // Compute the sum of note values
        let sum_zats: u64 = snapshot
            .notes
            .iter()
            .map(|n| n.value_zats.inner())
            .sum();

        // Compute holder binding from UFVK + holder_id
        let binding = compute_holder_binding(&params.ufvk_bytes, params.holder_id.as_ref());

        // Compute UFVK commitment
        let ufvk_commitment = compute_ufvk_commitment(&params.ufvk_bytes);

        let public = OrchardInnerPublicInputs {
            anchor_orchard: snapshot.anchor.to_bytes(),
            height: snapshot.height,
            ufvk_commitment,
            threshold_zats: params.threshold_zats,
            sum_zats,
            nullifiers: Vec::new(), // Nullifiers are computed in-circuit
            binding: Some(binding),
        };

        let notes: Vec<OrchardPofNoteWitness> = snapshot
            .notes
            .iter()
            .map(|n| OrchardPofNoteWitness {
                value_zats: n.value_zats.inner(),
                cmx: n.cmx.to_bytes(),
                merkle_siblings: n
                    .merkle_path
                    .auth_path()
                    .iter()
                    .map(|h| h.to_bytes())
                    .collect(),
                position: n.position,
            })
            .collect();

        Ok(OrchardPofInput {
            public,
            notes,
            ufvk_bytes: params.ufvk_bytes.clone(),
        })
    }
}

impl OrchardPofProver for OrchardPofCircuitProver {
    fn prove_orchard_pof_statement(
        &self,
        input: &OrchardPofInput,
    ) -> Result<(Vec<u8>, OrchardInnerPublicInputs), OrchardPofError> {
        // Validate the input
        if input.notes.len() > ORCHARD_POF_MAX_NOTES {
            return Err(OrchardPofError::InvalidWitness(format!(
                "too many notes: {} > {}",
                input.notes.len(),
                ORCHARD_POF_MAX_NOTES
            )));
        }

        // Check that the sum meets the threshold
        let sum: u64 = input.notes.iter().map(|n| n.value_zats).sum();
        if sum < input.public.threshold_zats {
            return Err(OrchardPofError::InvalidWitness(format!(
                "sum {} < threshold {}",
                sum, input.public.threshold_zats
            )));
        }

        // Build the circuit witness
        let circuit = OrchardPofCircuit::from_input(input)?;

        // Build public inputs for the circuit
        let public_inputs = build_public_instances(&input.public);

        // Generate the proof using Halo2 IPA
        let proof = circuit::generate_proof(&circuit, &public_inputs, &self.artifacts)?;

        // Return the proof and finalized public inputs
        let mut finalized_public = input.public.clone();
        finalized_public.sum_zats = sum;

        Ok((proof, finalized_public))
    }
}

/// Verify an Orchard PoF proof.
pub fn verify_orchard_pof_proof(
    proof: &[u8],
    public_inputs: &OrchardInnerPublicInputs,
    artifacts: &OrchardPofCircuitArtifacts,
) -> Result<bool, OrchardPofError> {
    let instances = build_public_instances(public_inputs);
    circuit::verify_proof(proof, &instances, artifacts)
}

/// Build the public instance vector for the circuit.
fn build_public_instances(public: &OrchardInnerPublicInputs) -> Vec<pallas::Base> {
    let mut instances = vec![
        // Anchor (as field element)
        pallas::Base::from_repr(public.anchor_orchard).unwrap_or(pallas::Base::zero()),
        // Height (as field element)
        pallas::Base::from(public.height as u64),
        // Threshold (as field element)
        pallas::Base::from(public.threshold_zats),
        // Sum (as field element)
        pallas::Base::from(public.sum_zats),
        // UFVK commitment
        pallas::Base::from_repr(public.ufvk_commitment).unwrap_or(pallas::Base::zero()),
    ];

    // Holder binding (if present)
    if let Some(binding) = public.binding {
        instances.push(pallas::Base::from_repr(binding).unwrap_or(pallas::Base::zero()));
    }

    instances
}

/// Compute holder binding from UFVK bytes and optional holder ID.
fn compute_holder_binding(ufvk_bytes: &[u8], holder_id: Option<&[u8; 32]>) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"zkpf_orchard_holder_binding_v1");
    hasher.update(ufvk_bytes);
    if let Some(id) = holder_id {
        hasher.update(id);
    }
    *hasher.finalize().as_bytes()
}

/// Compute UFVK commitment (hash of UFVK bytes).
fn compute_ufvk_commitment(ufvk_bytes: &[u8]) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"zkpf_orchard_ufvk_commitment_v1");
    hasher.update(ufvk_bytes);
    *hasher.finalize().as_bytes()
}

/// Errors specific to this crate.
#[derive(Debug, Error)]
pub enum OrchardPofCircuitError {
    /// Wrapper for inner-circuit errors.
    #[error("inner Orchard PoF error: {0}")]
    Inner(String),

    /// Misconfiguration or missing parameters / keys.
    #[error("Orchard PoF circuit configuration error: {0}")]
    Config(String),

    /// Proof generation failed.
    #[error("proof generation failed: {0}")]
    ProofGeneration(String),

    /// Proof verification failed.
    #[error("proof verification failed: {0}")]
    Verification(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_holder_binding_computation() {
        let ufvk = b"test_ufvk_bytes";
        let holder_id = [1u8; 32];
        
        let binding = compute_holder_binding(ufvk, Some(&holder_id));
        assert_ne!(binding, [0u8; 32]);
        
        // Different inputs should produce different bindings
        let binding2 = compute_holder_binding(ufvk, None);
        assert_ne!(binding, binding2);
    }

    #[test]
    fn test_ufvk_commitment() {
        let ufvk = b"test_ufvk_bytes";
        let commitment = compute_ufvk_commitment(ufvk);
        assert_ne!(commitment, [0u8; 32]);
        
        // Same input should produce same commitment
        let commitment2 = compute_ufvk_commitment(ufvk);
        assert_eq!(commitment, commitment2);
    }
    
    #[test]
    fn test_warm_cache() {
        // This test verifies that the cache can be initialized
        warm_cache();
        // Second call should be a no-op
        warm_cache();
    }
    
    #[test]
    fn test_circuit_prover_creation() {
        let artifacts = OrchardPofCircuitArtifacts {
            params_bytes: vec![],
            vk_bytes: vec![],
            pk_bytes: vec![],
            k: 11,
        };
        
        let prover = OrchardPofCircuitProver::new(artifacts);
        assert_eq!(prover.artifacts.k, 11);
    }
    
    #[test]
    fn test_public_inputs_construction() {
        use zkpf_orchard_inner::OrchardInnerPublicInputs;
        
        let public = OrchardInnerPublicInputs {
            anchor_orchard: [1u8; 32],
            height: 2000000,
            ufvk_commitment: [2u8; 32],
            threshold_zats: 1_000_000,
            sum_zats: 5_000_000,
            nullifiers: vec![],
            binding: Some([3u8; 32]),
        };
        
        let instances = build_public_instances(&public);
        
        // Should have 6 instances (anchor, height, threshold, sum, ufvk_commitment, binding)
        assert_eq!(instances.len(), 6);
        
        // Height should be 2000000
        assert_eq!(instances[1], pallas::Base::from(2000000u64));
        
        // Threshold should be 1_000_000
        assert_eq!(instances[2], pallas::Base::from(1_000_000u64));
        
        // Sum should be 5_000_000
        assert_eq!(instances[3], pallas::Base::from(5_000_000u64));
    }
}
