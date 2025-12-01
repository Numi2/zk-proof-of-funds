//! Starknet L2 rail test fixtures.
//!
//! This module provides sample data for testing the Starknet proof-of-funds rail.

use once_cell::sync::OnceCell;
use zkpf_common::{ProofBundle, VerifierPublicInputs};
use zkpf_starknet_l2::{
    prove_starknet_pof, PublicMetaInputs, StarknetAccountSnapshot, StarknetPublicMeta,
    StarknetSnapshot, TokenBalance,
};

static STARKNET_FIXTURES: OnceCell<StarknetFixtures> = OnceCell::new();

/// Pre-generated Starknet test fixtures.
pub struct StarknetFixtures {
    /// Sample snapshot with multiple accounts.
    pub snapshot: StarknetSnapshot,
    /// Sample proof bundle.
    pub bundle: ProofBundle,
    /// Public inputs from the proof.
    pub public_inputs: VerifierPublicInputs,
    /// Holder ID used in the fixture.
    pub holder_id: String,
    /// Policy ID used in the fixture.
    pub policy_id: u64,
}

/// Get lazily-initialized Starknet test fixtures.
pub fn starknet_fixtures() -> &'static StarknetFixtures {
    STARKNET_FIXTURES.get_or_init(build_starknet_fixtures)
}

fn build_starknet_fixtures() -> StarknetFixtures {
    let snapshot = sample_starknet_snapshot();
    let holder_id = "starknet-holder-test-001".to_string();
    let policy_id = 1001;
    let verifier_scope_id = 42;
    let current_epoch = 1_700_000_000;
    let threshold = 1_000_000_000_000_000_000u64; // 1 ETH

    let starknet_meta = StarknetPublicMeta {
        chain_id: "SN_SEPOLIA".to_string(),
        chain_id_numeric: 0x534e5f5345504f4c4941,
        block_number: snapshot.block_number,
        account_commitment: [0u8; 32],
        holder_binding: [0u8; 32],
    };

    let public_meta = PublicMetaInputs {
        policy_id,
        verifier_scope_id,
        current_epoch,
        required_currency_code: 1027, // ETH
    };

    let bundle = prove_starknet_pof(
        &snapshot,
        &holder_id,
        threshold,
        Some("ETH"),
        &starknet_meta,
        &public_meta,
    )
    .expect("should generate Starknet proof");

    let public_inputs = bundle.public_inputs.clone();

    StarknetFixtures {
        snapshot,
        bundle,
        public_inputs,
        holder_id,
        policy_id,
    }
}

/// Create a sample Starknet snapshot for testing.
pub fn sample_starknet_snapshot() -> StarknetSnapshot {
    StarknetSnapshot {
        chain_id: "SN_SEPOLIA".to_string(),
        block_number: 500_000,
        block_hash: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".to_string(),
        timestamp: 1_700_000_000,
        accounts: vec![
            StarknetAccountSnapshot {
                address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7"
                    .to_string(),
                class_hash: "0x05400e90f7e0ae78bd02c77cd75527280470e2fe19c54970dd79dc37a9d3645c"
                    .to_string(),
                native_balance: 5_000_000_000_000_000_000, // 5 ETH
                token_balances: vec![TokenBalance {
                    token_address:
                        "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8"
                            .to_string(),
                    symbol: "USDC".to_string(),
                    balance: 10_000_000_000, // 10,000 USDC
                    usd_value: Some(10_000_000_000),
                }],
                defi_positions: vec![],
            },
            StarknetAccountSnapshot {
                address: "0x07394cbe418daa16e42b87ba67372d4ab4a5df0b05c6e554d158458ce245bc10"
                    .to_string(),
                class_hash: "0x05400e90f7e0ae78bd02c77cd75527280470e2fe19c54970dd79dc37a9d3645c"
                    .to_string(),
                native_balance: 3_000_000_000_000_000_000, // 3 ETH
                token_balances: vec![],
                defi_positions: vec![],
            },
        ],
    }
}

/// Create a minimal Starknet snapshot with a single account.
pub fn minimal_starknet_snapshot(native_balance: u128) -> StarknetSnapshot {
    StarknetSnapshot {
        chain_id: "SN_SEPOLIA".to_string(),
        block_number: 100_000,
        block_hash: "0x0000000000000000000000000000000000000000000000000000000000001234".to_string(),
        timestamp: 1_700_000_000,
        accounts: vec![StarknetAccountSnapshot {
            address: "0x0000000000000000000000000000000000000000000000000000000000000001".to_string(),
            class_hash: "0x0".to_string(),
            native_balance,
            token_balances: vec![],
            defi_positions: vec![],
        }],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use zkpf_common::CIRCUIT_VERSION;
    use zkpf_starknet_l2::RAIL_ID_STARKNET_L2;

    #[test]
    fn test_starknet_fixtures_load() {
        let fixtures = starknet_fixtures();
        assert_eq!(fixtures.bundle.rail_id, RAIL_ID_STARKNET_L2);
        assert_eq!(fixtures.bundle.circuit_version, CIRCUIT_VERSION);
        assert_eq!(fixtures.policy_id, 1001);
    }

    #[test]
    fn test_sample_snapshot() {
        let snapshot = sample_starknet_snapshot();
        assert_eq!(snapshot.chain_id, "SN_SEPOLIA");
        assert_eq!(snapshot.accounts.len(), 2);
        
        let total: u128 = snapshot.accounts.iter().map(|a| a.native_balance).sum();
        assert_eq!(total, 8_000_000_000_000_000_000); // 8 ETH
    }

    #[test]
    fn test_minimal_snapshot() {
        let snapshot = minimal_starknet_snapshot(1_000_000_000_000_000_000);
        assert_eq!(snapshot.accounts.len(), 1);
        assert_eq!(snapshot.accounts[0].native_balance, 1_000_000_000_000_000_000);
    }
}

