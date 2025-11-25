//! Test fixtures for the Mina recursive proof hub rail.

use zkpf_common::{ProofBundle, VerifierPublicInputs, CIRCUIT_VERSION};

/// Rail ID for Mina.
pub const RAIL_ID_MINA: &str = "MINA_RECURSIVE";

/// Sample Mina public metadata.
#[derive(Clone, Debug)]
pub struct MinaPublicMeta {
    pub network_id: String,
    pub network_id_numeric: u32,
    pub global_slot: u64,
    pub zkapp_address: String,
    pub recursive_proof_commitment: [u8; 32],
    pub source_rail_ids: Vec<String>,
}

impl Default for MinaPublicMeta {
    fn default() -> Self {
        Self {
            network_id: "testnet".to_string(),
            network_id_numeric: 1,
            global_slot: 500_000,
            zkapp_address: "B62qxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx".to_string(),
            recursive_proof_commitment: [0u8; 32],
            source_rail_ids: vec!["STARKNET_L2".to_string()],
        }
    }
}

/// Sample Mina attestation for testing.
#[derive(Clone, Debug)]
pub struct MinaAttestation {
    pub attestation_id: [u8; 32],
    pub holder_binding: [u8; 32],
    pub policy_id: u64,
    pub epoch: u64,
    pub mina_slot: u64,
    pub expires_at_slot: u64,
    pub source_rails: Vec<String>,
    pub is_valid: bool,
}

impl Default for MinaAttestation {
    fn default() -> Self {
        Self {
            attestation_id: [1u8; 32],
            holder_binding: [2u8; 32],
            policy_id: 100,
            epoch: 1_700_000_000,
            mina_slot: 500_000,
            expires_at_slot: 507_200, // 24 hours at ~12s per slot
            source_rails: vec!["STARKNET_L2".to_string()],
            is_valid: true,
        }
    }
}

/// Create a sample Mina proof bundle for testing.
pub fn sample_mina_bundle() -> ProofBundle {
    let holder_binding = compute_holder_binding("test-holder", &[0u8; 32]);
    let nullifier = compute_mina_nullifier(&holder_binding, 42, 100, 1_700_000_000);

    ProofBundle {
        rail_id: RAIL_ID_MINA.to_string(),
        circuit_version: CIRCUIT_VERSION,
        proof: create_placeholder_proof(&nullifier),
        public_inputs: VerifierPublicInputs {
            threshold_raw: 1_000_000_000_000_000_000, // 1 ETH
            required_currency_code: 1027,             // ETH
            current_epoch: 1_700_000_000,
            verifier_scope_id: 42,
            policy_id: 100,
            nullifier,
            custodian_pubkey_hash: [0u8; 32], // Non-custodial
            snapshot_block_height: Some(500_000),
            snapshot_anchor_orchard: Some([1u8; 32]), // Recursive proof commitment
            holder_binding: Some(holder_binding),
            proven_sum: Some(5_000_000_000_000_000_000), // 5 ETH
        },
    }
}

/// Create a sample source proof (Starknet) for aggregation testing.
pub fn sample_source_proof_starknet() -> ProofBundle {
    ProofBundle {
        rail_id: "STARKNET_L2".to_string(),
        circuit_version: CIRCUIT_VERSION,
        proof: vec![0u8; 64],
        public_inputs: VerifierPublicInputs {
            threshold_raw: 1_000_000_000_000_000_000,
            required_currency_code: 1027,
            current_epoch: 1_700_000_000,
            verifier_scope_id: 42,
            policy_id: 100,
            nullifier: [3u8; 32],
            custodian_pubkey_hash: [0u8; 32],
            snapshot_block_height: Some(123456),
            snapshot_anchor_orchard: Some([4u8; 32]),
            holder_binding: Some([5u8; 32]),
            proven_sum: Some(3_000_000_000_000_000_000),
        },
    }
}

/// Create a sample source proof (Orchard) for aggregation testing.
pub fn sample_source_proof_orchard() -> ProofBundle {
    ProofBundle {
        rail_id: "ORCHARD".to_string(),
        circuit_version: CIRCUIT_VERSION,
        proof: vec![1u8; 64],
        public_inputs: VerifierPublicInputs {
            threshold_raw: 500_000_000_000_000_000,
            required_currency_code: 1027,
            current_epoch: 1_700_000_000,
            verifier_scope_id: 42,
            policy_id: 100,
            nullifier: [6u8; 32],
            custodian_pubkey_hash: [0u8; 32],
            snapshot_block_height: Some(2_500_000),
            snapshot_anchor_orchard: Some([7u8; 32]),
            holder_binding: Some([8u8; 32]),
            proven_sum: Some(2_000_000_000_000_000_000),
        },
    }
}

/// Create a sample attestation for testing.
pub fn sample_attestation() -> MinaAttestation {
    MinaAttestation::default()
}

/// Create sample public metadata for testing.
pub fn sample_mina_meta() -> MinaPublicMeta {
    MinaPublicMeta::default()
}

// Helper functions

fn compute_holder_binding(holder_id: &str, recursive_commitment: &[u8; 32]) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"mina_holder_binding_v1");
    hasher.update(holder_id.as_bytes());
    hasher.update(recursive_commitment);
    *hasher.finalize().as_bytes()
}

fn compute_mina_nullifier(
    holder_binding: &[u8; 32],
    scope_id: u64,
    policy_id: u64,
    epoch: u64,
) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"mina_pof_nullifier_v1");
    hasher.update(holder_binding);
    hasher.update(&scope_id.to_be_bytes());
    hasher.update(&policy_id.to_be_bytes());
    hasher.update(&epoch.to_be_bytes());
    *hasher.finalize().as_bytes()
}

fn create_placeholder_proof(nullifier: &[u8; 32]) -> Vec<u8> {
    let mut proof = vec![];
    proof.extend_from_slice(b"MINA_RECURSIVE_V1");
    let mut hasher = blake3::Hasher::new();
    hasher.update(nullifier);
    proof.extend_from_slice(hasher.finalize().as_bytes());
    proof
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sample_mina_bundle() {
        let bundle = sample_mina_bundle();
        assert_eq!(bundle.rail_id, RAIL_ID_MINA);
        assert!(bundle.proof.starts_with(b"MINA_RECURSIVE_V1"));
    }

    #[test]
    fn test_sample_source_proofs() {
        let starknet = sample_source_proof_starknet();
        let orchard = sample_source_proof_orchard();

        assert_eq!(starknet.rail_id, "STARKNET_L2");
        assert_eq!(orchard.rail_id, "ORCHARD");
        assert_eq!(starknet.public_inputs.policy_id, orchard.public_inputs.policy_id);
    }

    #[test]
    fn test_sample_attestation() {
        let attestation = sample_attestation();
        assert!(attestation.is_valid);
        assert!(attestation.expires_at_slot > attestation.mina_slot);
    }
}

