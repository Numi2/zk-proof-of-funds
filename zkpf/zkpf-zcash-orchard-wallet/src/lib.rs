//! zkpf-zcash-orchard-wallet
//!
//! Zcash/Orchard-specific wallet + sync abstraction for the zkpf stack.
//! This crate is intentionally minimal and focused on the **interface** the prover rail needs:
//! given an Orchard full viewing key and a target height, produce a snapshot of owned notes,
//! their zatoshi values, and Merkle paths to the Orchard anchor at that height.
//!
//! The actual chain sync and Orchard cryptography must be implemented using the official
//! Zcash Rust crates (`librustzcash`, `zcash_client_backend`, `orchard`, etc.) in a
//! downstream integration. Here we expose a stable, serializable API surface.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Newtype wrapper for an Orchard full viewing key.
///
/// In a real deployment this should carry either:
/// - the raw FVK bytes, or
/// - a Bech32-encoded FVK string.
///
/// This crate deliberately treats it as opaque to avoid depending directly on specific
/// Zcash crate versions in the core interface.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrchardFvk {
    /// Opaque representation of the FVK (e.g. bytes or Bech32 string).
    pub encoded: String,
}

/// Serializable Merkle path type for Orchard notes.
///
/// This is a minimal stand-in for the richer types provided by `orchard` and friends.
/// A production implementation should bridge from the Orchard Merkle path representation
/// to this flattened form.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrchardMerklePath {
    /// Sibling hashes from leaf to root, encoded as 32-byte big-endian digests.
    pub siblings: Vec<[u8; 32]>,
    /// Index of the leaf in the tree (from the perspective of the Orchard circuit).
    pub position: u64,
}

/// A single Orchard note witness at a particular chain height.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrchardNoteWitness {
    /// Note value in zatoshi.
    pub value_zats: u64,
    /// Orchard note commitment (cm) as a 32-byte value.
    pub commitment: [u8; 32],
    /// Merkle path proving inclusion of `commitment` under `OrchardSnapshot.anchor`.
    pub merkle_path: OrchardMerklePath,
}

/// A snapshot of all discovered Orchard notes for a given FVK at a specific height.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrchardSnapshot {
    /// Block height used as the snapshot boundary.
    pub height: u32,
    /// Orchard tree anchor (Merkle root) at `height`, 32 bytes.
    pub anchor: [u8; 32],
    /// All notes discovered for the FVK up to and including `height`.
    pub notes: Vec<OrchardNoteWitness>,
}

/// Errors that can occur while building snapshots or interacting with the wallet backend.
#[derive(Debug, Error)]
pub enum WalletError {
    /// The requested height does not correspond to a known Orchard anchor.
    #[error("no Orchard anchor available at height {0}")]
    UnknownAnchor(u32),

    /// The provided FVK could not be parsed or decoded.
    #[error("invalid Orchard full viewing key: {0}")]
    InvalidFvk(String),

    /// Underlying storage or network error.
    #[error("backend error: {0}")]
    Backend(String),

    /// Placeholder for unimplemented functionality in this reference crate.
    #[error("Orchard wallet backend not implemented")]
    NotImplemented,
}

/// Primary interface the prover rail needs: given an Orchard FVK and a target height,
/// return a snapshot of all owned notes at that height.
///
/// # Production expectations
///
/// A real implementation should:
/// - Use `zcash_client_backend` and related crates to ingest compact blocks,
///   maintain the Orchard note commitment tree, and derive incremental witnesses.
/// - Validate that `height` corresponds to a known Orchard anchor and return
///   [`WalletError::UnknownAnchor`] otherwise.
/// - Treat `fvk` as sensitive (never log it; only store if designed as a keystore).
///
/// # Current status
///
/// This function is a **stub** and always returns [`WalletError::NotImplemented`].
/// It exists to define a stable API that downstream integrations can implement behind
/// a feature flag or in a separate crate that depends on the full Zcash stack.
pub fn build_snapshot_for_fvk(_fvk: &OrchardFvk, height: u32) -> Result<OrchardSnapshot, WalletError> {
    // Height is included in the signature so callers can rely on UnknownAnchor vs other errors.
    let _ = height;
    Err(WalletError::NotImplemented)
}


