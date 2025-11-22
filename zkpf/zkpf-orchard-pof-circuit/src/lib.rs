//! zkpf-orchard-pof-circuit
//!
//! This crate is the intended home of the **inner Orchard proof-of-funds Halo2
//! circuit** over the Pasta (Pallas) field. It is responsible for:
//! - Reusing Orchard's official Halo2 gadgets for note commitments, Merkle
//!   paths, and nullifier computation.
//! - Enforcing Σ v_i ≥ threshold_zats inside the circuit using the committed
//!   Orchard note values.
//! - Computing a UFVK / holder binding that is exposed as part of the public
//!   inputs.
//!
//! At the moment this crate only defines the high-level data structures and a
//! placeholder prover implementation; the concrete Halo2 circuit wiring will be
//! added in a follow-up iteration that depends on the exact halo2_proofs /
//! halo2_gadgets versions used by the upstream `orchard` crate.

use orchard::{note::Note, tree};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use zkpf_orchard_inner::{
    OrchardInnerPublicInputs, OrchardPofError, OrchardPofInput, OrchardPofNoteWitness,
    OrchardPofProver, ORCHARD_POF_MAX_NOTES,
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
/// These are treated as opaque here; the concrete Halo2 integration will
/// deserialize them into `ParamsKZG`, verifying key, and proving key for a
/// fixed-parameter circuit (with `ORCHARD_POF_MAX_NOTES` notes).
#[derive(Clone, Debug)]
pub struct OrchardPofCircuitArtifacts {
    pub params_bytes: Vec<u8>,
    pub vk_bytes: Vec<u8>,
    pub pk_bytes: Vec<u8>,
}

/// Concrete prover handle for the inner Orchard PoF circuit.
///
/// In a full implementation this would own the deserialized Halo2 parameters,
/// proving key, and verifying key. For now we keep only the serialized
/// artifacts so key management and caching can be wired without pulling in the
/// Halo2 dependency surface.
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

        let public = OrchardInnerPublicInputs {
            anchor_orchard: snapshot.anchor.to_bytes(),
            height: snapshot.height,
            ufvk_commitment: [0u8; 32], // to be computed by the concrete circuit implementation
            threshold_zats: params.threshold_zats,
            sum_zats: 0,                // populated by the circuit in the real prover
            nullifiers: Vec::new(),     // populated by the circuit in the real prover
            binding: None,              // populated by the circuit in the real prover
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
        _input: &OrchardPofInput,
    ) -> Result<(Vec<u8>, OrchardInnerPublicInputs), OrchardPofError> {
        // The real implementation will:
        // - build an `OrchardPofCircuit` over Pasta Fp,
        // - run Halo2 KZG keygen / create_proof,
        // - extract the finalized `OrchardInnerPublicInputs` from the circuit,
        // - and return `(proof_bytes, public_inputs)`.
        Err(OrchardPofError::NotImplemented)
    }
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
}


