//! zkpf-zcash-orchard-circuit
//!
//! This crate defines the public API for the ZCASH_ORCHARD rail in the zkpf stack.
//! It intentionally **does not** implement the Halo2 circuit yet; instead it provides
//! a typed wrapper around `zkpf-common::ProofBundle` and a `prove_orchard_pof` entrypoint
//! that can be wired to a concrete circuit implementation in a follow-up iteration.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use zkpf_common::{ProofBundle, VerifierPublicInputs};
use zkpf_zcash_orchard_wallet::{OrchardFvk, OrchardSnapshot};

/// Constant rail identifier for the Orchard rail.
pub const RAIL_ID_ZCASH_ORCHARD: &str = "ZCASH_ORCHARD";

/// Metadata fields specific to the Zcash Orchard rail that are not yet part of
/// the global `VerifierPublicInputs` struct.
///
/// In a future circuit version these would likely be folded into the public-input
/// vector and/or serialized alongside `VerifierPublicInputs`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrchardPublicMeta {
    /// Chain identifier, e.g. "ZEC".
    pub chain_id: String,
    /// Pool identifier, e.g. "ORCHARD".
    pub pool_id: String,
    /// Height B at which the Orchard anchor was taken.
    pub block_height: u32,
    /// Orchard anchor (Merkle root) at height B.
    pub anchor_orchard: [u8; 32],
    /// Holder binding, e.g. H(holder_id || fvk_bytes).
    pub holder_binding: [u8; 32],
}

/// Aggregated error type for the Orchard rail circuit/prover wrapper.
#[derive(Debug, Error)]
pub enum OrchardRailError {
    /// Error coming from the Orchard wallet/snapshot builder.
    #[error("wallet error: {0}")]
    Wallet(String),

    /// Validation error in the inputs (e.g. threshold, snapshot height).
    #[error("invalid input: {0}")]
    InvalidInput(String),

    /// Placeholder while the actual circuit implementation is not yet wired.
    #[error("Orchard circuit not implemented")]
    NotImplemented,
}

impl From<zkpf_zcash_orchard_wallet::WalletError> for OrchardRailError {
    fn from(err: zkpf_zcash_orchard_wallet::WalletError) -> Self {
        OrchardRailError::Wallet(err.to_string())
    }
}

/// Holder identifier type; in practice this can be a UUID, hash of KYC record, etc.
pub type HolderId = String;

/// Public meta inputs that are shared with the existing zkpf stack (policy, scope, epoch).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PublicMetaInputs {
    pub policy_id: u64,
    pub verifier_scope_id: u64,
    pub current_epoch: u64,
    /// Currency code for ZEC in your policy catalog (e.g. ISO-4217-style numeric).
    pub required_currency_code: u32,
}

/// Convenience function for computing the canonical `VerifierPublicInputs` for an Orchard
/// proof-of-funds statement, given the Orchard-specific meta and threshold.
///
/// NOTE: This does **not** yet encode the Orchard anchor or block height; doing so will
/// require extending `VerifierPublicInputs` and the public-input layout in a new circuit
/// version. For now we focus on making the rail interface explicit.
pub fn build_verifier_public_inputs(
    threshold_zats: u64,
    meta: &PublicMetaInputs,
    nullifier: [u8; 32],
    custodian_pubkey_hash: [u8; 32],
) -> VerifierPublicInputs {
    VerifierPublicInputs {
        threshold_raw: threshold_zats,
        required_currency_code: meta.required_currency_code,
        // For the Orchard rail, `required_custodian_id` can represent the
        // entity operating the rail (e.g. a specific Zcash lightwalletd/attestor).
        required_custodian_id: 0,
        current_epoch: meta.current_epoch,
        verifier_scope_id: meta.verifier_scope_id,
        policy_id: meta.policy_id,
        nullifier,
        custodian_pubkey_hash,
    }
}

/// High-level entrypoint that the prover rail calls to generate a `ProofBundle` for
/// the ZCASH_ORCHARD rail.
///
/// In this reference implementation, the function validates the snapshot and
/// meta-parameters, derives the canonical `VerifierPublicInputs`, and then returns
/// an error indicating that the actual Halo2 circuit is not yet wired.
///
/// This keeps the API stable and allows the HTTP rail service to be built and tested
/// around a mocked `ProofBundle`.
pub fn prove_orchard_pof(
    snapshot: &OrchardSnapshot,
    _fvk: &OrchardFvk,
    _holder_id: &HolderId,
    threshold_zats: u64,
    _orchard_meta: &OrchardPublicMeta,
    meta: &PublicMetaInputs,
) -> Result<ProofBundle, OrchardRailError> {
    if snapshot.notes.is_empty() {
        return Err(OrchardRailError::InvalidInput(
            "no Orchard notes discovered for this FVK at the requested height".into(),
        ));
    }

    if threshold_zats == 0 {
        return Err(OrchardRailError::InvalidInput(
            "threshold_zats must be > 0".into(),
        ));
    }

    // In a real circuit, the nullifier and custodian_pubkey_hash would be computed inside
    // the zk circuit or derived from policy / attestation context. Here we simply use
    // placeholder zero values to keep the API shape coherent.
    let nullifier = [0u8; 32];
    let custodian_pubkey_hash = [0u8; 32];

    let public_inputs = build_verifier_public_inputs(threshold_zats, meta, nullifier, custodian_pubkey_hash);

    // TODO: call into a dedicated Orchard Halo2 circuit + prover artifacts.
    // Until that exists, we return an explicit NotImplemented error so callers
    // can distinguish "API wired but circuit missing" from other failures.
    let _ = (snapshot, public_inputs);

    Err(OrchardRailError::NotImplemented)
}


