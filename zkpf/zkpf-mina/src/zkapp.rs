//! zkApp interaction helpers for the Mina rail.
//!
//! This module provides utilities for interacting with the zkpf verifier zkApp
//! on Mina, including transaction building and state queries.

use serde::{Deserialize, Serialize};

use crate::{
    error::MinaRailError,
    types::{MinaAddress, MinaTxHash, ZkAppStateEntry, ZkAppUpdate},
    MinaAttestation, MinaPublicMeta, ProofBundle, ZkAppState, RAIL_ID_MINA,
};

/// zkApp method names for the zkpf verifier.
pub mod methods {
    /// Submit a new attestation.
    pub const SUBMIT_ATTESTATION: &str = "submitAttestation";
    /// Query an attestation.
    pub const QUERY_ATTESTATION: &str = "queryAttestation";
    /// Revoke an attestation.
    pub const REVOKE_ATTESTATION: &str = "revokeAttestation";
    /// Update admin.
    pub const UPDATE_ADMIN: &str = "updateAdmin";
    /// Batch submit attestations.
    pub const BATCH_SUBMIT: &str = "batchSubmit";
}

/// zkApp field indices for state storage.
pub mod fields {
    /// Attestation tree root.
    pub const ATTESTATION_ROOT: u8 = 0;
    /// Total attestation count.
    pub const ATTESTATION_COUNT: u8 = 1;
    /// Last updated slot.
    pub const LAST_UPDATED_SLOT: u8 = 2;
    /// Admin public key hash (part 1).
    pub const ADMIN_PUBKEY_HASH_1: u8 = 3;
    /// Admin public key hash (part 2).
    pub const ADMIN_PUBKEY_HASH_2: u8 = 4;
    /// Reserved field 1.
    pub const RESERVED_1: u8 = 5;
    /// Reserved field 2.
    pub const RESERVED_2: u8 = 6;
    /// Reserved field 3.
    pub const RESERVED_3: u8 = 7;
}

/// Arguments for submitting an attestation.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SubmitAttestationArgs {
    /// The proof bundle to submit.
    pub bundle: ProofBundle,
    /// Mina metadata.
    pub mina_meta: MinaPublicMeta,
    /// Validity window in slots.
    pub validity_window_slots: u64,
}

/// Arguments for querying an attestation.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct QueryAttestationArgs {
    /// Holder binding to query.
    pub holder_binding: [u8; 32],
    /// Policy ID.
    pub policy_id: u64,
    /// Epoch.
    pub epoch: u64,
}

/// Arguments for revoking an attestation.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RevokeAttestationArgs {
    /// Attestation ID to revoke.
    pub attestation_id: [u8; 32],
    /// Reason for revocation.
    pub reason: String,
}

/// Result of a zkApp query.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ZkAppQueryResult {
    /// Whether the query succeeded.
    pub success: bool,
    /// The attestation if found.
    pub attestation: Option<MinaAttestation>,
    /// Error message if failed.
    pub error: Option<String>,
    /// Current zkApp state.
    pub state: Option<ZkAppState>,
}

/// Result of a zkApp transaction.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ZkAppTxResult {
    /// Whether the transaction succeeded.
    pub success: bool,
    /// Transaction hash if submitted.
    pub tx_hash: Option<MinaTxHash>,
    /// Error message if failed.
    pub error: Option<String>,
    /// New zkApp state after transaction.
    pub new_state: Option<ZkAppState>,
}

/// Build a zkApp update for submitting an attestation.
pub fn build_submit_attestation_tx(
    zkapp_address: &MinaAddress,
    args: &SubmitAttestationArgs,
    fee_nanomina: u64,
    nonce: u64,
) -> Result<ZkAppUpdate, MinaRailError> {
    // Validate bundle
    if args.bundle.rail_id != RAIL_ID_MINA {
        return Err(MinaRailError::InvalidInput(format!(
            "expected rail_id {}, got {}",
            RAIL_ID_MINA, args.bundle.rail_id
        )));
    }

    // Build state updates from the attestation
    let holder_binding = args
        .bundle
        .public_inputs
        .holder_binding
        .ok_or_else(|| MinaRailError::InvalidInput("missing holder_binding".into()))?;

    let attestation_id = compute_attestation_id(
        &holder_binding,
        args.bundle.public_inputs.policy_id,
        args.bundle.public_inputs.current_epoch,
    );

    let state_updates = vec![
        // Note: Actual state updates would compute new Merkle root
        ZkAppStateEntry {
            index: fields::LAST_UPDATED_SLOT,
            value: args.mina_meta.global_slot.to_string(),
        },
    ];

    Ok(ZkAppUpdate {
        zkapp_address: zkapp_address.clone(),
        state_updates,
        method_name: methods::SUBMIT_ATTESTATION.to_string(),
        method_args: serde_json::json!({
            "attestation_id": hex::encode(attestation_id),
            "holder_binding": hex::encode(holder_binding),
            "policy_id": args.bundle.public_inputs.policy_id,
            "epoch": args.bundle.public_inputs.current_epoch,
            "validity_window": args.validity_window_slots,
            "proof": base64::engine::general_purpose::STANDARD.encode(&args.bundle.proof),
        }),
        fee_nanomina,
        nonce,
        memo: Some("zkpf attestation".to_string()),
    })
}

/// Build a zkApp query for checking an attestation.
pub fn build_query_attestation(
    zkapp_address: &MinaAddress,
    args: &QueryAttestationArgs,
) -> serde_json::Value {
    serde_json::json!({
        "zkapp_address": zkapp_address.as_str(),
        "method": methods::QUERY_ATTESTATION,
        "args": {
            "holder_binding": hex::encode(args.holder_binding),
            "policy_id": args.policy_id,
            "epoch": args.epoch
        }
    })
}

/// Parse zkApp state from field values.
pub fn parse_zkapp_state(fields: &[ZkAppStateEntry]) -> Result<ZkAppState, MinaRailError> {
    let mut attestation_root = [0u8; 32];
    let mut attestation_count = 0u64;
    let mut last_updated_slot = 0u64;
    let mut admin_pubkey_hash = [0u8; 32];

    for field in fields {
        match field.index {
            fields::ATTESTATION_ROOT => {
                // Parse attestation root from decimal string
                let bytes = parse_field_to_bytes(&field.value)?;
                attestation_root[..bytes.len().min(32)].copy_from_slice(&bytes[..bytes.len().min(32)]);
            }
            fields::ATTESTATION_COUNT => {
                attestation_count = field
                    .value
                    .parse()
                    .map_err(|_| MinaRailError::State("invalid attestation_count".into()))?;
            }
            fields::LAST_UPDATED_SLOT => {
                last_updated_slot = field
                    .value
                    .parse()
                    .map_err(|_| MinaRailError::State("invalid last_updated_slot".into()))?;
            }
            fields::ADMIN_PUBKEY_HASH_1 => {
                let bytes = parse_field_to_bytes(&field.value)?;
                admin_pubkey_hash[..16].copy_from_slice(&bytes[..bytes.len().min(16)]);
            }
            fields::ADMIN_PUBKEY_HASH_2 => {
                let bytes = parse_field_to_bytes(&field.value)?;
                admin_pubkey_hash[16..].copy_from_slice(&bytes[..bytes.len().min(16)]);
            }
            _ => {}
        }
    }

    Ok(ZkAppState {
        attestation_root,
        attestation_count,
        last_updated_slot,
        admin_pubkey_hash,
    })
}

/// Encode zkApp state to field values.
pub fn encode_zkapp_state(state: &ZkAppState) -> Vec<ZkAppStateEntry> {
    vec![
        ZkAppStateEntry {
            index: fields::ATTESTATION_ROOT,
            value: bytes_to_decimal(&state.attestation_root),
        },
        ZkAppStateEntry {
            index: fields::ATTESTATION_COUNT,
            value: state.attestation_count.to_string(),
        },
        ZkAppStateEntry {
            index: fields::LAST_UPDATED_SLOT,
            value: state.last_updated_slot.to_string(),
        },
        ZkAppStateEntry {
            index: fields::ADMIN_PUBKEY_HASH_1,
            value: bytes_to_decimal(&state.admin_pubkey_hash[..16]),
        },
        ZkAppStateEntry {
            index: fields::ADMIN_PUBKEY_HASH_2,
            value: bytes_to_decimal(&state.admin_pubkey_hash[16..]),
        },
    ]
}

// === Helper functions ===

fn compute_attestation_id(holder_binding: &[u8; 32], policy_id: u64, epoch: u64) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"mina_attestation_id_v1");
    hasher.update(holder_binding);
    hasher.update(&policy_id.to_be_bytes());
    hasher.update(&epoch.to_be_bytes());
    *hasher.finalize().as_bytes()
}

fn parse_field_to_bytes(value: &str) -> Result<Vec<u8>, MinaRailError> {
    // Mina fields are ~254-bit values encoded as decimal strings
    // For simplicity, we treat them as big integers and convert to bytes
    let num: num_bigint::BigUint = value
        .parse()
        .map_err(|_| MinaRailError::State(format!("invalid field value: {}", value)))?;
    Ok(num.to_bytes_be())
}

fn bytes_to_decimal(bytes: &[u8]) -> String {
    let num = num_bigint::BigUint::from_bytes_be(bytes);
    num.to_string()
}

// We need num-bigint for field encoding
use base64::Engine;
use num_bigint;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encode_decode_state() {
        let state = ZkAppState {
            attestation_root: [1u8; 32],
            attestation_count: 42,
            last_updated_slot: 500_000,
            admin_pubkey_hash: [2u8; 32],
        };

        let fields = encode_zkapp_state(&state);
        let decoded = parse_zkapp_state(&fields).expect("should decode");

        assert_eq!(decoded.attestation_count, state.attestation_count);
        assert_eq!(decoded.last_updated_slot, state.last_updated_slot);
    }

    #[test]
    fn test_build_submit_attestation_tx() {
        use crate::{ProofBundle, VerifierPublicInputs, CIRCUIT_VERSION};

        let zkapp_address = MinaAddress::new("B62qxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
        let args = SubmitAttestationArgs {
            bundle: ProofBundle {
                rail_id: RAIL_ID_MINA.to_string(),
                circuit_version: CIRCUIT_VERSION,
                proof: vec![0u8; 64],
                public_inputs: VerifierPublicInputs {
                    threshold_raw: 1_000_000,
                    required_currency_code: 1027,
                    current_epoch: 1_700_000_000,
                    verifier_scope_id: 42,
                    policy_id: 100,
                    nullifier: [0u8; 32],
                    custodian_pubkey_hash: [0u8; 32],
                    snapshot_block_height: Some(500_000),
                    snapshot_anchor_orchard: Some([1u8; 32]),
                    holder_binding: Some([2u8; 32]),
                    proven_sum: Some(5_000_000),
                },
            },
            mina_meta: MinaPublicMeta {
                network_id: "testnet".to_string(),
                network_id_numeric: 1,
                global_slot: 500_000,
                zkapp_address: "B62qxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx".to_string(),
                recursive_proof_commitment: [0u8; 32],
                source_rail_ids: vec!["STARKNET_L2".to_string()],
            },
            validity_window_slots: 7200,
        };

        let tx = build_submit_attestation_tx(&zkapp_address, &args, 100_000_000, 0)
            .expect("should build tx");

        assert_eq!(tx.method_name, methods::SUBMIT_ATTESTATION);
        assert!(tx.fee_nanomina > 0);
    }
}

