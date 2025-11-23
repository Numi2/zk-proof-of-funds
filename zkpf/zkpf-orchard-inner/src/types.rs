// zkpf-orchard-inner/src/types.rs
// Numan Thabtah 2025-11-22
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchardNoteSnapshot {
    pub commitment: [u8; 32],
    pub value: u64,
    pub merkle_path: Vec<[u8; 32]>, // each node hash, top-down or bottom-up
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchardSnapshot {
    pub anchor: [u8; 32],
    pub notes: Vec<OrchardNoteSnapshot>,
    pub holder_commitment: [u8; 32],
    pub height: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RailMeta {
    pub rail_id: String,
    pub policy_hash: [u8; 32],
    pub circuit_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrchardProofBundle {
    pub rail_id: String,
    pub circuit_version: u32,
    pub public_inputs: zkpf_zcash_orchard_circuit::OrchardPofPublicInputs,
    #[serde(with = "serde_bytes")]
    pub proof: Vec<u8>,
    pub height: u64,
}