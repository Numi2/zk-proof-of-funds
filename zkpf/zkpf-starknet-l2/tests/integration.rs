//! Integration tests for the Starknet L2 rail.
//!
//! These tests verify the end-to-end flow of the Starknet proof-of-funds rail,
//! from snapshot creation to proof generation and verification.

use zkpf_common::CIRCUIT_VERSION;
use zkpf_starknet_l2::{
    prove_starknet_pof, PublicMetaInputs, StarknetAccountSnapshot,
    StarknetPublicMeta, StarknetSnapshot, TokenBalance, RAIL_ID_STARKNET_L2,
};

/// Create a test snapshot with the given total balance.
fn create_test_snapshot(total_balance: u128) -> StarknetSnapshot {
    StarknetSnapshot {
        chain_id: "SN_SEPOLIA".to_string(),
        block_number: 500_000,
        block_hash: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
            .to_string(),
        timestamp: 1_700_000_000,
        accounts: vec![StarknetAccountSnapshot {
            address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
                .to_string(),
            class_hash: "0x05400e90f7e0ae78bd02c77cd75527280470e2fe19c54970dd79dc37a9d3645c"
                .to_string(),
            native_balance: total_balance,
            token_balances: vec![],
            defi_positions: vec![],
        }],
    }
}

/// Create public meta inputs for testing.
fn create_test_meta(policy_id: u64) -> (StarknetPublicMeta, PublicMetaInputs) {
    let starknet_meta = StarknetPublicMeta {
        chain_id: "SN_SEPOLIA".to_string(),
        chain_id_numeric: 0x534e5f5345504f4c4941,
        block_number: 500_000,
        account_commitment: [0u8; 32],
        holder_binding: [0u8; 32],
    };

    let public_meta = PublicMetaInputs {
        policy_id,
        verifier_scope_id: 42,
        current_epoch: 1_700_000_000,
        required_currency_code: 1027, // ETH
    };

    (starknet_meta, public_meta)
}

#[test]
fn test_end_to_end_proof_generation() {
    // Setup: Create a snapshot with 5 ETH
    let balance = 5_000_000_000_000_000_000u128; // 5 ETH in wei
    let threshold = 1_000_000_000_000_000_000u64; // 1 ETH threshold
    let snapshot = create_test_snapshot(balance);
    let holder_id = "starknet-test-holder".to_string();
    let (starknet_meta, public_meta) = create_test_meta(200001);

    // Generate proof
    let bundle = prove_starknet_pof(
        &snapshot,
        &holder_id,
        threshold,
        None, // No asset filter
        &starknet_meta,
        &public_meta,
    )
    .expect("should generate proof");

    // Verify bundle structure
    assert_eq!(bundle.rail_id, RAIL_ID_STARKNET_L2);
    assert_eq!(bundle.circuit_version, CIRCUIT_VERSION);
    assert!(!bundle.proof.is_empty());
    
    // Verify public inputs
    assert_eq!(bundle.public_inputs.threshold_raw, threshold);
    assert_eq!(bundle.public_inputs.policy_id, 200001);
    assert_eq!(bundle.public_inputs.required_currency_code, 1027);
    
    // Verify proven sum matches expected
    let proven_sum = bundle.public_inputs.proven_sum.expect("should have proven sum");
    assert_eq!(proven_sum, balance);
}

#[test]
fn test_threshold_boundary() {
    // Test exact threshold match
    let balance = 1_000_000_000_000_000_000u128; // Exactly 1 ETH
    let threshold = 1_000_000_000_000_000_000u64; // 1 ETH threshold
    let snapshot = create_test_snapshot(balance);
    let holder_id = "boundary-test".to_string();
    let (starknet_meta, public_meta) = create_test_meta(200001);

    let bundle = prove_starknet_pof(
        &snapshot,
        &holder_id,
        threshold,
        None,
        &starknet_meta,
        &public_meta,
    )
    .expect("should succeed at exact threshold");

    assert_eq!(bundle.public_inputs.proven_sum, Some(balance));
}

#[test]
fn test_insufficient_funds_rejected() {
    // Test that insufficient funds are rejected
    let balance = 500_000_000_000_000_000u128; // 0.5 ETH
    let threshold = 1_000_000_000_000_000_000u64; // 1 ETH threshold
    let snapshot = create_test_snapshot(balance);
    let holder_id = "insufficient-test".to_string();
    let (starknet_meta, public_meta) = create_test_meta(200001);

    let result = prove_starknet_pof(
        &snapshot,
        &holder_id,
        threshold,
        None,
        &starknet_meta,
        &public_meta,
    );

    assert!(result.is_err());
    let err = result.unwrap_err();
    let err_msg = err.to_string();
    assert!(
        err_msg.contains("insufficient") || err_msg.contains("threshold"),
        "Error should mention insufficient funds: {}",
        err_msg
    );
}

#[test]
fn test_multi_account_aggregation() {
    // Test that multiple accounts are aggregated correctly
    let snapshot = StarknetSnapshot {
        chain_id: "SN_SEPOLIA".to_string(),
        block_number: 500_000,
        block_hash: "0x1234".to_string(),
        timestamp: 1_700_000_000,
        accounts: vec![
            StarknetAccountSnapshot {
                address: "0x001".to_string(),
                class_hash: "0x0".to_string(),
                native_balance: 2_000_000_000_000_000_000, // 2 ETH
                token_balances: vec![],
                defi_positions: vec![],
            },
            StarknetAccountSnapshot {
                address: "0x002".to_string(),
                class_hash: "0x0".to_string(),
                native_balance: 3_000_000_000_000_000_000, // 3 ETH
                token_balances: vec![],
                defi_positions: vec![],
            },
        ],
    };

    let holder_id = "multi-account-test".to_string();
    let threshold = 4_000_000_000_000_000_000u64; // 4 ETH (requires both accounts)
    let (starknet_meta, public_meta) = create_test_meta(200001);

    let bundle = prove_starknet_pof(
        &snapshot,
        &holder_id,
        threshold,
        None,
        &starknet_meta,
        &public_meta,
    )
    .expect("should aggregate multiple accounts");

    // Should prove 5 ETH total
    assert_eq!(
        bundle.public_inputs.proven_sum,
        Some(5_000_000_000_000_000_000)
    );
}

#[test]
fn test_token_balance_aggregation() {
    // Test that token balances are included when using asset filter
    let snapshot = StarknetSnapshot {
        chain_id: "SN_SEPOLIA".to_string(),
        block_number: 500_000,
        block_hash: "0x1234".to_string(),
        timestamp: 1_700_000_000,
        accounts: vec![StarknetAccountSnapshot {
            address: "0x001".to_string(),
            class_hash: "0x0".to_string(),
            native_balance: 1_000_000_000_000_000_000, // 1 ETH native
            token_balances: vec![TokenBalance {
                token_address: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8"
                    .to_string(),
                symbol: "USDC".to_string(),
                balance: 10_000_000_000, // 10,000 USDC
                usd_value: Some(10_000_000_000),
            }],
            defi_positions: vec![],
        }],
    };

    let holder_id = "token-test".to_string();
    let threshold = 1_000_000_000_000_000_000u64; // 1 ETH
    let (starknet_meta, public_meta) = create_test_meta(200001);

    // Without filter, should only count native ETH
    let bundle = prove_starknet_pof(
        &snapshot,
        &holder_id,
        threshold,
        Some("ETH"), // Filter for ETH only
        &starknet_meta,
        &public_meta,
    )
    .expect("should work with ETH filter");

    assert_eq!(
        bundle.public_inputs.proven_sum,
        Some(1_000_000_000_000_000_000)
    );
}

#[test]
fn test_nullifier_determinism() {
    // Test that the same inputs produce the same nullifier
    let snapshot = create_test_snapshot(5_000_000_000_000_000_000);
    let holder_id = "nullifier-test".to_string();
    let threshold = 1_000_000_000_000_000_000u64;
    let (starknet_meta, public_meta) = create_test_meta(200001);

    let bundle1 = prove_starknet_pof(
        &snapshot,
        &holder_id,
        threshold,
        None,
        &starknet_meta,
        &public_meta,
    )
    .expect("first proof");

    let bundle2 = prove_starknet_pof(
        &snapshot,
        &holder_id,
        threshold,
        None,
        &starknet_meta,
        &public_meta,
    )
    .expect("second proof");

    // Same inputs should produce same nullifier
    assert_eq!(
        bundle1.public_inputs.nullifier,
        bundle2.public_inputs.nullifier
    );
}

#[test]
fn test_different_policies_different_nullifiers() {
    // Test that different policy IDs produce different nullifiers
    let snapshot = create_test_snapshot(5_000_000_000_000_000_000);
    let holder_id = "policy-nullifier-test".to_string();
    let threshold = 1_000_000_000_000_000_000u64;
    let starknet_meta = StarknetPublicMeta {
        chain_id: "SN_SEPOLIA".to_string(),
        chain_id_numeric: 0x534e5f5345504f4c4941,
        block_number: 500_000,
        account_commitment: [0u8; 32],
        holder_binding: [0u8; 32],
    };

    let public_meta1 = PublicMetaInputs {
        policy_id: 200001,
        verifier_scope_id: 42,
        current_epoch: 1_700_000_000,
        required_currency_code: 1027,
    };

    let public_meta2 = PublicMetaInputs {
        policy_id: 200002, // Different policy
        verifier_scope_id: 42,
        current_epoch: 1_700_000_000,
        required_currency_code: 1027,
    };

    let bundle1 = prove_starknet_pof(
        &snapshot,
        &holder_id,
        threshold,
        None,
        &starknet_meta,
        &public_meta1,
    )
    .expect("policy 1");

    let bundle2 = prove_starknet_pof(
        &snapshot,
        &holder_id,
        threshold,
        None,
        &starknet_meta,
        &public_meta2,
    )
    .expect("policy 2");

    // Different policies should produce different nullifiers
    assert_ne!(
        bundle1.public_inputs.nullifier,
        bundle2.public_inputs.nullifier
    );
}

#[test]
fn test_proof_format() {
    // Test that the proof has expected format
    let snapshot = create_test_snapshot(5_000_000_000_000_000_000);
    let holder_id = "format-test".to_string();
    let threshold = 1_000_000_000_000_000_000u64;
    let (starknet_meta, public_meta) = create_test_meta(200001);

    let bundle = prove_starknet_pof(
        &snapshot,
        &holder_id,
        threshold,
        None,
        &starknet_meta,
        &public_meta,
    )
    .expect("should generate proof");

    // Proof should start with magic bytes
    assert!(
        bundle.proof.starts_with(b"STARKNET_POF_V1"),
        "Proof should have STARKNET_POF_V1 magic bytes"
    );

    // Proof should include hash of public inputs (32 bytes after magic)
    assert!(
        bundle.proof.len() >= 15 + 32,
        "Proof should be at least {} bytes, got {}",
        15 + 32,
        bundle.proof.len()
    );
}

