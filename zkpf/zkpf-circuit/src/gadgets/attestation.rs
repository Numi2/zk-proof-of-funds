// zkpf/zkpf-circuit/src/gadgets/attestation.rs
// Numan Thabit 2025

use halo2curves_axiom::bn256::Fr;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EcdsaSignature {
    pub r: [u8; 32],
    pub s: [u8; 32],
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Secp256k1Pubkey {
    pub x: [u8; 32],
    pub y: [u8; 32],
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AttestationWitness {
    pub balance_raw: u64,
    pub currency_code_int: u32,
    pub custodian_id: u32,
    pub attestation_id: u64,
    pub issued_at: u64,
    pub valid_until: u64,
    pub account_id_hash: Fr,
    pub custodian_pubkey: Secp256k1Pubkey,
    pub signature: EcdsaSignature,
    /// Poseidon(attestation_fields) encoded as 32-byte big-endian digest for ECDSA.
    pub message_hash: [u8; 32],
}
