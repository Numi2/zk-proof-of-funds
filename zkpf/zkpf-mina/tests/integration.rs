//! Integration tests for zkpf-mina crate.
//!
//! These tests verify the complete flow from proof generation to verification.

use zkpf_mina::{
    create_attestation, prove_mina_recursive, verify_mina_proof,
    MinaPublicMeta, PublicMetaInputs, SourceProofInput,
    MinaRailError, RAIL_ID_MINA, MINA_MAX_SOURCE_PROOFS,
    create_proof_of_state_bundle, verify_proof_of_state_bundle,
    verify_proof_of_state_binding, MinaProofOfStatePublicInputs, CANDIDATE_CHAIN_LENGTH,
};
use zkpf_common::{ProofBundle, VerifierPublicInputs, CIRCUIT_VERSION};

// === Test Fixtures ===

fn sample_holder_id() -> String {
    "holder_12345".to_string()
}

fn sample_public_meta_inputs() -> PublicMetaInputs {
    PublicMetaInputs {
        policy_id: 1,
        verifier_scope_id: 100,
        current_epoch: 1700000000,
        required_currency_code: 840, // USD
    }
}

fn sample_mina_public_meta() -> MinaPublicMeta {
    MinaPublicMeta {
        network_id: "testnet".to_string(),
        network_id_numeric: 1,
        global_slot: 1000,
        zkapp_address: "B62qtest...".to_string(),
        recursive_proof_commitment: [0u8; 32],
        source_rail_ids: vec![],
    }
}

fn sample_source_proof() -> SourceProofInput {
    SourceProofInput {
        bundle: ProofBundle {
            rail_id: "ZCASH_ORCHARD".to_string(),
            circuit_version: CIRCUIT_VERSION,
            proof: vec![0u8; 128],
            public_inputs: VerifierPublicInputs {
                threshold_raw: 1_000_000,
                required_currency_code: 840,
                current_epoch: 1700000000,
                verifier_scope_id: 100,
                policy_id: 1,
                nullifier: [0u8; 32],
                custodian_pubkey_hash: [0u8; 32],
                snapshot_block_height: Some(100),
                snapshot_anchor_orchard: Some([1u8; 32]),
                holder_binding: Some([2u8; 32]),
                proven_sum: Some(2_000_000),
            },
        },
        rail_metadata: serde_json::json!({
            "source": "test"
        }),
    }
}

fn sample_proof_of_state_inputs() -> MinaProofOfStatePublicInputs {
    MinaProofOfStatePublicInputs {
        bridge_tip_state_hash: [1u8; 32],
        candidate_chain_state_hashes: [[2u8; 32]; CANDIDATE_CHAIN_LENGTH],
        candidate_chain_ledger_hashes: [[3u8; 32]; CANDIDATE_CHAIN_LENGTH],
    }
}

// === Proof Generation Tests ===

#[test]
fn test_prove_mina_recursive_single_source() {
    let sources = vec![sample_source_proof()];
    let holder_id = sample_holder_id();
    let mina_meta = sample_mina_public_meta();
    let public_meta = sample_public_meta_inputs();

    let result = prove_mina_recursive(&sources, &holder_id, &mina_meta, &public_meta);
    assert!(result.is_ok(), "Should generate proof: {:?}", result.err());

    let bundle = result.unwrap();
    assert_eq!(bundle.rail_id, RAIL_ID_MINA);
    assert!(!bundle.proof.is_empty());
}

#[test]
fn test_prove_mina_recursive_multiple_sources() {
    let sources: Vec<SourceProofInput> = (0..3)
        .map(|i| {
            let mut proof = sample_source_proof();
            proof.bundle.rail_id = format!("SOURCE_{}", i);
            proof
        })
        .collect();
    
    let holder_id = sample_holder_id();
    let mina_meta = sample_mina_public_meta();
    let public_meta = sample_public_meta_inputs();

    let result = prove_mina_recursive(&sources, &holder_id, &mina_meta, &public_meta);
    assert!(result.is_ok(), "Should handle multiple sources");
}

#[test]
fn test_prove_mina_recursive_max_sources() {
    let sources: Vec<SourceProofInput> = (0..MINA_MAX_SOURCE_PROOFS)
        .map(|i| {
            let mut proof = sample_source_proof();
            proof.bundle.rail_id = format!("SOURCE_{}", i);
            proof
        })
        .collect();
    
    let holder_id = sample_holder_id();
    let mina_meta = sample_mina_public_meta();
    let public_meta = sample_public_meta_inputs();

    let result = prove_mina_recursive(&sources, &holder_id, &mina_meta, &public_meta);
    assert!(result.is_ok(), "Should handle max source proofs");
}

#[test]
fn test_prove_mina_recursive_too_many_sources() {
    let sources: Vec<SourceProofInput> = (0..MINA_MAX_SOURCE_PROOFS + 1)
        .map(|i| {
            let mut proof = sample_source_proof();
            proof.bundle.rail_id = format!("SOURCE_{}", i);
            proof
        })
        .collect();
    
    let holder_id = sample_holder_id();
    let mina_meta = sample_mina_public_meta();
    let public_meta = sample_public_meta_inputs();

    let result = prove_mina_recursive(&sources, &holder_id, &mina_meta, &public_meta);
    assert!(result.is_err(), "Should reject too many sources");
}

#[test]
fn test_prove_mina_recursive_empty_sources() {
    let sources: Vec<SourceProofInput> = vec![];
    let holder_id = sample_holder_id();
    let mina_meta = sample_mina_public_meta();
    let public_meta = sample_public_meta_inputs();

    let result = prove_mina_recursive(&sources, &holder_id, &mina_meta, &public_meta);
    assert!(result.is_err(), "Should reject empty sources");
}

// === Proof Verification Tests ===

#[test]
fn test_verify_mina_proof_rejects_placeholder() {
    let sources = vec![sample_source_proof()];
    let holder_id = sample_holder_id();
    let mina_meta = sample_mina_public_meta();
    let public_meta = sample_public_meta_inputs();

    let bundle = prove_mina_recursive(&sources, &holder_id, &mina_meta, &public_meta)
        .expect("Should generate proof");

    // Placeholder proofs should be rejected for security
    let result = verify_mina_proof(&bundle);
    assert!(result.is_err(), "Placeholder proofs should be rejected");
}

#[test]
fn test_verify_mina_proof_wrong_rail_id() {
    let sources = vec![sample_source_proof()];
    let holder_id = sample_holder_id();
    let mina_meta = sample_mina_public_meta();
    let public_meta = sample_public_meta_inputs();

    let mut bundle = prove_mina_recursive(&sources, &holder_id, &mina_meta, &public_meta)
        .expect("Should generate proof");
    
    bundle.rail_id = "WRONG_RAIL".to_string();

    let result = verify_mina_proof(&bundle);
    assert!(result.is_err());
}

// === Attestation Tests ===

#[test]
fn test_create_attestation() {
    let sources = vec![sample_source_proof()];
    let holder_id = sample_holder_id();
    let mina_meta = sample_mina_public_meta();
    let public_meta = sample_public_meta_inputs();

    let bundle = prove_mina_recursive(&sources, &holder_id, &mina_meta, &public_meta)
        .expect("Should generate proof");

    let attestation = create_attestation(&bundle, &mina_meta, 7200)
        .expect("Should create attestation");

    // Verify attestation fields
    assert_eq!(attestation.mina_slot, mina_meta.global_slot);
    assert_eq!(attestation.expires_at_slot, mina_meta.global_slot + 7200);
}

#[test]
fn test_create_attestation_custom_validity() {
    let sources = vec![sample_source_proof()];
    let holder_id = sample_holder_id();
    let mina_meta = sample_mina_public_meta();
    let public_meta = sample_public_meta_inputs();

    let bundle = prove_mina_recursive(&sources, &holder_id, &mina_meta, &public_meta)
        .expect("Should generate proof");

    let validity_window = 3600;
    let attestation = create_attestation(&bundle, &mina_meta, validity_window)
        .expect("Should create attestation");

    assert_eq!(attestation.expires_at_slot, mina_meta.global_slot + validity_window);
}

// === Proof of State Tests ===

#[test]
fn test_verify_proof_of_state_binding() {
    let pos_inputs = sample_proof_of_state_inputs();
    let holder_id = "test_holder_123";
    let policy_id = 1u64;
    let current_epoch = 1700000000u64;
    let verifier_scope_id = 100u64;

    let result = verify_proof_of_state_binding(
        &pos_inputs,
        holder_id,
        policy_id,
        current_epoch,
        verifier_scope_id,
    );

    assert!(result.is_ok(), "Should verify binding: {:?}", result.err());
    let rail_inputs = result.unwrap();
    
    // Verify computed values are deterministic
    let result2 = verify_proof_of_state_binding(
        &pos_inputs,
        holder_id,
        policy_id,
        current_epoch,
        verifier_scope_id,
    ).unwrap();

    assert_eq!(rail_inputs.mina_digest, result2.mina_digest);
    assert_eq!(rail_inputs.holder_binding, result2.holder_binding);
}

#[test]
fn test_create_proof_of_state_bundle() {
    let pos_inputs = sample_proof_of_state_inputs();
    let holder_id = "test_holder";
    let meta = sample_public_meta_inputs();
    let mina_meta = sample_mina_public_meta();

    let result = create_proof_of_state_bundle(&pos_inputs, holder_id, &meta, &mina_meta);
    assert!(result.is_ok(), "Should create bundle: {:?}", result.err());

    let bundle = result.unwrap();
    assert_eq!(bundle.rail_id, RAIL_ID_MINA);
}

#[test]
fn test_verify_proof_of_state_bundle() {
    let pos_inputs = sample_proof_of_state_inputs();
    let holder_id = "test_holder";
    let meta = sample_public_meta_inputs();
    let mina_meta = sample_mina_public_meta();

    let bundle = create_proof_of_state_bundle(&pos_inputs, holder_id, &meta, &mina_meta)
        .expect("Should create bundle");

    // Placeholder proofs should be rejected for security
    let result = verify_proof_of_state_bundle(&bundle);
    assert!(result.is_err(), "Placeholder proofs should be rejected");
}

// === Nullifier Determinism Tests ===

#[test]
fn test_nullifier_determinism() {
    let pos_inputs = sample_proof_of_state_inputs();
    let holder_id = "test_holder";
    let policy_id = 1u64;
    let current_epoch = 1700000000u64;
    let verifier_scope_id = 100u64;

    let rail_inputs1 = verify_proof_of_state_binding(
        &pos_inputs,
        holder_id,
        policy_id,
        current_epoch,
        verifier_scope_id,
    ).expect("Should verify binding");

    let rail_inputs2 = verify_proof_of_state_binding(
        &pos_inputs,
        holder_id,
        policy_id,
        current_epoch,
        verifier_scope_id,
    ).expect("Should verify binding");

    let nullifier1 = rail_inputs1.compute_nullifier();
    let nullifier2 = rail_inputs2.compute_nullifier();

    assert_eq!(nullifier1, nullifier2, "Nullifiers should be deterministic");
}

#[test]
fn test_nullifier_changes_with_holder() {
    let pos_inputs = sample_proof_of_state_inputs();
    let policy_id = 1u64;
    let current_epoch = 1700000000u64;
    let verifier_scope_id = 100u64;

    let rail_inputs1 = verify_proof_of_state_binding(
        &pos_inputs,
        "holder_a",
        policy_id,
        current_epoch,
        verifier_scope_id,
    ).expect("Should verify binding");

    let rail_inputs2 = verify_proof_of_state_binding(
        &pos_inputs,
        "holder_b",
        policy_id,
        current_epoch,
        verifier_scope_id,
    ).expect("Should verify binding");

    let nullifier1 = rail_inputs1.compute_nullifier();
    let nullifier2 = rail_inputs2.compute_nullifier();

    assert_ne!(nullifier1, nullifier2, "Different holders should have different nullifiers");
}

#[test]
fn test_nullifier_changes_with_epoch() {
    let pos_inputs = sample_proof_of_state_inputs();
    let holder_id = "test_holder";
    let policy_id = 1u64;
    let verifier_scope_id = 100u64;

    let rail_inputs1 = verify_proof_of_state_binding(
        &pos_inputs,
        holder_id,
        policy_id,
        1700000000,
        verifier_scope_id,
    ).expect("Should verify binding");

    let rail_inputs2 = verify_proof_of_state_binding(
        &pos_inputs,
        holder_id,
        policy_id,
        1700000001,
        verifier_scope_id,
    ).expect("Should verify binding");

    let nullifier1 = rail_inputs1.compute_nullifier();
    let nullifier2 = rail_inputs2.compute_nullifier();

    assert_ne!(nullifier1, nullifier2, "Different epochs should have different nullifiers");
}

// === Error Handling Tests ===

#[test]
fn test_error_types() {
    // Test that error types work correctly
    let err = MinaRailError::InvalidInput("test error".to_string());
    assert!(err.to_string().contains("test error"));

    let err = MinaRailError::NotImplemented("feature".to_string());
    assert!(err.to_string().contains("feature"));
}

// === Public Inputs Tests ===

#[test]
fn test_proof_of_state_inputs_digest() {
    let inputs = sample_proof_of_state_inputs();
    let digest = inputs.compute_digest();
    
    // Digest should be deterministic
    let digest2 = inputs.compute_digest();
    assert_eq!(digest, digest2);

    // Different inputs should produce different digests
    let mut inputs2 = inputs.clone();
    inputs2.bridge_tip_state_hash[0] = 99;
    let digest3 = inputs2.compute_digest();
    assert_ne!(digest, digest3);
}

// === Bundle Structure Tests ===

#[test]
fn test_bundle_has_correct_structure() {
    let sources = vec![sample_source_proof()];
    let holder_id = sample_holder_id();
    let mina_meta = sample_mina_public_meta();
    let public_meta = sample_public_meta_inputs();

    let bundle = prove_mina_recursive(&sources, &holder_id, &mina_meta, &public_meta)
        .expect("Should generate proof");

    // Check bundle structure
    assert_eq!(bundle.rail_id, RAIL_ID_MINA);
    assert!(!bundle.proof.is_empty());
    assert_eq!(bundle.public_inputs.policy_id, public_meta.policy_id);
    assert_eq!(bundle.public_inputs.verifier_scope_id, public_meta.verifier_scope_id);
    assert_eq!(bundle.public_inputs.current_epoch, public_meta.current_epoch);
}

#[test]
fn test_bundle_preserves_policy() {
    let sources = vec![sample_source_proof()];
    let holder_id = sample_holder_id();
    let mina_meta = sample_mina_public_meta();
    let mut public_meta = sample_public_meta_inputs();
    public_meta.policy_id = 42;

    // Source proof must match policy
    let mut sources_fixed = sources;
    sources_fixed[0].bundle.public_inputs.policy_id = 42;

    let bundle = prove_mina_recursive(&sources_fixed, &holder_id, &mina_meta, &public_meta)
        .expect("Should generate proof");

    assert_eq!(bundle.public_inputs.policy_id, 42);
}

// === Edge Cases ===

#[test]
fn test_zero_validity_window() {
    let sources = vec![sample_source_proof()];
    let holder_id = sample_holder_id();
    let mina_meta = sample_mina_public_meta();
    let public_meta = sample_public_meta_inputs();

    let bundle = prove_mina_recursive(&sources, &holder_id, &mina_meta, &public_meta)
        .expect("Should generate proof");

    // Zero validity window is technically valid (immediate expiry)
    let result = create_attestation(&bundle, &mina_meta, 0);
    assert!(result.is_ok());
    
    let attestation = result.unwrap();
    assert_eq!(attestation.expires_at_slot, mina_meta.global_slot);
}

#[test]
fn test_max_validity_window() {
    let sources = vec![sample_source_proof()];
    let holder_id = sample_holder_id();
    let mina_meta = sample_mina_public_meta();
    let public_meta = sample_public_meta_inputs();

    let bundle = prove_mina_recursive(&sources, &holder_id, &mina_meta, &public_meta)
        .expect("Should generate proof");

    // Very large validity window
    let result = create_attestation(&bundle, &mina_meta, u64::MAX / 2);
    assert!(result.is_ok());
}

#[test]
fn test_empty_holder_id_rejected() {
    let pos_inputs = sample_proof_of_state_inputs();
    
    let result = verify_proof_of_state_binding(
        &pos_inputs,
        "",
        1,
        1700000000,
        100,
    );
    
    assert!(result.is_err(), "Empty holder_id should be rejected");
}

#[test]
fn test_zero_bridge_tip_rejected() {
    let mut pos_inputs = sample_proof_of_state_inputs();
    pos_inputs.bridge_tip_state_hash = [0u8; 32];
    
    let result = verify_proof_of_state_binding(
        &pos_inputs,
        "holder",
        1,
        1700000000,
        100,
    );
    
    assert!(result.is_err(), "Zero bridge_tip should be rejected");
}
