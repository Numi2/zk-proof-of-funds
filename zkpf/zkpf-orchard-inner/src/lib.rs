//! zkpf-orchard-inner
//!
//! This crate defines the **inner Orchard proof-of-funds interface** that is meant
//! to be implemented in terms of the official Orchard Halo2 gadgets
//! (`halo2_gadgets::sinsemilla::merkle::MerklePath`, `MerkleCRH`, etc.) over the
//! Pasta (Pallas/Vesta) fields.
//!
//! The intent is that:
//! - This crate specifies the *data model* (public inputs, witnesses, errors).
//! - The actual circuit + prover live either in the upstream Orchard workspace or
//!   in a closely aligned crate that depends on `orchard`, `halo2_proofs`, and
//!   `halo2_gadgets`.
//! - The outer bn256 circuit in `zkpf-zcash-orchard-circuit` treats the inner
//!   proof as an opaque Halo2 proof whose public inputs are described here.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Public inputs exposed by the **inner** Orchard PoF circuit.
///
/// These are deliberately minimal and consensus-oriented; they should be
/// derivable directly from `zcashd` / `lightwalletd` view of the chain and the
/// holder's UFVK.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrchardInnerPublicInputs {
    /// Orchard anchor (Merkle root) at `height`.
    pub anchor_orchard: [u8; 32],
    /// Block height of the anchor.
    pub height: u32,
    /// Commitment to the holder's Unified Full Viewing Key (or Orchard FVK).
    ///
    /// The exact encoding is left to the Orchard implementation, but it should
    /// be a binding that uniquely identifies the UFVK under the chosen domain.
    pub ufvk_commitment: [u8; 32],
    /// Proof-of-funds threshold in zatoshi.
    pub threshold_zats: u64,
    /// Sum of the included Orchard note values, in zatoshi.
    pub sum_zats: u64,
    /// Optional binding that mixes UFVK with additional domain separators,
    /// e.g. `(policy_id, scope_id, epoch)`.
    pub binding: Option<[u8; 32]>,
}

/// A single Orchard note + Merkle path witness as consumed by the inner PoF circuit.
///
/// The Merkle path here is still represented in a consensus-oriented, non-Halo2
/// form. The inner circuit implementation is responsible for converting it to
/// `halo2_gadgets::sinsemilla::merkle::MerklePath` and calling
/// `MerklePath::calculate_root` under the Orchard MerkleChip.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrchardPofNoteWitness {
    /// Note value in zatoshi.
    pub value_zats: u64,
    /// Extracted Orchard note commitment (cmx) as a 32-byte value.
    pub cmx: [u8; 32],
    /// Sibling hashes from leaf to root, encoded as 32-byte digests in the same
    /// domain as `MerkleHashOrchard`.
    pub merkle_siblings: Vec<[u8; 32]>,
    /// Leaf position in the Orchard note commitment tree (as seen by the circuit).
    pub position: u64,
}

/// Complete witness for the inner Orchard PoF statement.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrchardPofInput {
    /// Public inputs the circuit will expose.
    pub public: OrchardInnerPublicInputs,
    /// All Orchard notes included in the proof-of-funds statement.
    pub notes: Vec<OrchardPofNoteWitness>,
    /// UFVK / Orchard viewing key material needed to enforce ownership.
    ///
    /// This is intentionally opaque here; the concrete circuit decides how much
    /// of the UFVK to expose and in what encoding.
    pub ufvk_bytes: Vec<u8>,
}

/// Errors that an inner Orchard PoF prover implementation may return.
#[derive(Debug, Error)]
pub enum OrchardPofError {
    /// Structural problem in the provided witness (e.g. inconsistent paths).
    #[error("invalid Orchard PoF witness: {0}")]
    InvalidWitness(String),

    /// Underlying Orchard / Halo2 error.
    #[error("inner Orchard circuit error: {0}")]
    Circuit(String),

    /// Placeholder returned by this reference crate; real implementations
    /// should never surface this error.
    #[error("Orchard PoF prover not implemented in this build")]
    NotImplemented,
}

/// High-level interface that an inner Orchard PoF prover is expected to expose.
///
/// A production implementation will:
/// - Use Orchard's Halo2 gadgets (MerkleChip + Sinsemilla) over Pallas/Vesta.
/// - Convert `OrchardPofNoteWitness.merkle_siblings` into a
///   `halo2_gadgets::sinsemilla::merkle::MerklePath` for each note and call
///   `MerklePath::calculate_root` to recompute the Orchard anchor.
/// - Enforce ownership via the UFVK bytes.
/// - Enforce `Σ v_i ≥ threshold_zats` and populate `sum_zats`.
pub trait OrchardPofProver {
    /// Generate a proof-of-funds statement for the given input.
    fn prove_orchard_pof_statement(
        &self,
        input: &OrchardPofInput,
    ) -> Result<(Vec<u8>, OrchardInnerPublicInputs), OrchardPofError>;
}


