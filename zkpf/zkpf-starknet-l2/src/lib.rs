//! zkpf-starknet-l2
//!
//! Starknet L2 rail for zkpf: zero-knowledge proof-of-funds over Starknet accounts,
//! DeFi positions, and vault shares.
//!
//! # Architecture
//!
//! The Starknet rail proves statements of the form:
//! - "I control Starknet account(s) with total balance ≥ threshold in asset X"
//! - "My aggregated DeFi positions (vaults, LP tokens, lending positions) have value ≥ threshold"
//!
//! Unlike L1 Ethereum, Starknet has native account abstraction and uses STARK-friendly
//! cryptography (Pedersen hash, ECDSA over Stark curve). This rail leverages these
//! properties for efficient proofs.
//!
//! # Implementation Options
//!
//! 1. **bn256 prover + Starknet verifier contract**: Generate proofs using the existing
//!    Halo2/bn256 stack, deploy a verifier contract on Starknet that checks proofs.
//!
//! 2. **Cairo-native prover**: Implement the PoF circuit directly in Cairo for
//!    Starknet-native verification (STARK-based, no cross-curve overhead).
//!
//! This crate provides the bn256 approach with hooks for Cairo integration.
//!
//! # Public Inputs (V3_STARKNET layout)
//!
//! The Starknet rail extends the base zkpf public inputs with:
//! - `starknet_chain_id`: Starknet chain identifier (mainnet, sepolia, etc.)
//! - `snapshot_block_number`: Block number at which state was captured
//! - `account_commitment`: Commitment to the set of Starknet accounts
//! - `holder_binding`: H(holder_id || account_addresses)

pub mod circuit;
pub mod error;
pub mod state;
pub mod types;
pub mod wallet;

#[cfg(feature = "starknet-rpc")]
pub mod rpc;

#[cfg(feature = "starknet-rpc")]
pub mod defi;

use blake3::Hasher;
use serde::{Deserialize, Serialize};
use zkpf_common::{ProofBundle, VerifierPublicInputs, CIRCUIT_VERSION};

pub use circuit::{
    create_starknet_proof, create_starknet_proof_with_artifacts,
    deserialize_starknet_proving_key, deserialize_starknet_verifying_key,
    load_starknet_prover_artifacts, load_starknet_prover_artifacts_from_path,
    load_starknet_verifier_artifacts, load_starknet_verifier_artifacts_from_path,
    serialize_starknet_proving_key, serialize_starknet_verifying_key, starknet_default_params,
    starknet_keygen, starknet_public_inputs_to_instances,
    verify_starknet_proof, verify_starknet_proof_detailed, verify_starknet_proof_with_loaded_artifacts,
    StarknetPofCircuit, StarknetPofCircuitInput, StarknetProverArtifacts, StarknetProverParams,
    StarknetVerificationResult, StarknetVerifierArtifacts,
    STARKNET_DEFAULT_K, STARKNET_INSTANCE_COLUMNS,
};
pub use error::StarknetRailError;
pub use types::*;

#[cfg(feature = "starknet-rpc")]
pub use rpc::StarknetRpcClient;

#[cfg(feature = "starknet-rpc")]
pub use defi::{
    DefiProtocol, DefiQueryError, DefiPositionQuery,
    JediSwapQuery, NostraQuery, ZkLendQuery, EkuboQuery, HaikoQuery,
};

pub use wallet::{
    create_session_binding, hash_proof_binding_poseidon, pedersen_hash, poseidon_hash_many,
    prepare_batch_request, validate_session_config, verify_proof_binding_signature,
    verify_session_key_signature, verify_stark_signature, ProofBindingMessage, SessionKeyManager,
    SignatureVerification, StarkSignature,
};

/// Constant rail identifier for the Starknet L2 rail.
pub const RAIL_ID_STARKNET_L2: &str = "STARKNET_L2";

/// Number of public inputs in the V3_STARKNET layout.
/// Base (7) + starknet_chain_id + snapshot_block_number + account_commitment + holder_binding
pub const PUBLIC_INPUT_COUNT_V3_STARKNET: usize = 11;

/// Maximum number of accounts that can be aggregated in a single proof.
pub const STARKNET_MAX_ACCOUNTS: usize = 16;

/// Maximum number of DeFi positions per account.
pub const STARKNET_MAX_POSITIONS: usize = 32;

/// Metadata specific to the Starknet L2 rail.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StarknetPublicMeta {
    /// Starknet chain ID (e.g., "SN_MAIN", "SN_SEPOLIA").
    pub chain_id: String,
    /// Numeric chain ID for circuit encoding.
    /// Uses u128 to accommodate full felt252 chain ID encodings.
    pub chain_id_numeric: u128,
    /// Block number at which the state snapshot was taken.
    pub block_number: u64,
    /// Commitment to the set of account addresses being proven.
    pub account_commitment: [u8; 32],
    /// Holder binding: H(holder_id || account_data).
    pub holder_binding: [u8; 32],
}

/// Public meta inputs shared with the existing zkpf stack.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PublicMetaInputs {
    pub policy_id: u64,
    pub verifier_scope_id: u64,
    pub current_epoch: u64,
    /// Currency code (e.g., ETH, STRK, USDC on Starknet).
    pub required_currency_code: u32,
}

/// Starknet account balance snapshot.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StarknetAccountSnapshot {
    /// Account address (felt252 as hex).
    pub address: String,
    /// Account class hash (identifies the account type).
    pub class_hash: String,
    /// Native balance (ETH or STRK).
    pub native_balance: u128,
    /// ERC-20 token balances: (token_address, balance).
    pub token_balances: Vec<TokenBalance>,
    /// DeFi positions (vault shares, LP tokens, lending positions).
    pub defi_positions: Vec<DefiPosition>,
}

/// ERC-20 token balance.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TokenBalance {
    /// Token contract address.
    pub token_address: String,
    /// Token symbol (e.g., "USDC", "DAI").
    pub symbol: String,
    /// Balance in token's smallest unit.
    pub balance: u128,
    /// USD value at snapshot time (optional).
    pub usd_value: Option<u64>,
}

/// DeFi position (vault, LP, lending).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DefiPosition {
    /// Protocol name (e.g., "JediSwap", "Nostra", "zkLend").
    pub protocol: String,
    /// Position type.
    pub position_type: PositionType,
    /// Contract address.
    pub contract_address: String,
    /// Position value in base asset.
    pub value: u128,
    /// USD value at snapshot time (optional).
    pub usd_value: Option<u64>,
}

/// Types of DeFi positions supported.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PositionType {
    /// LP token in an AMM.
    LiquidityPool,
    /// Lending position (collateral or borrowed).
    Lending,
    /// Vault/staking position.
    Vault,
    /// Perpetual futures position.
    Perpetual,
    /// Generic position.
    Other,
}

/// Complete snapshot for Starknet proof generation.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StarknetSnapshot {
    /// Chain identifier.
    pub chain_id: String,
    /// Block number at snapshot time.
    pub block_number: u64,
    /// Block hash for verification.
    pub block_hash: String,
    /// Unix timestamp of the block.
    pub timestamp: u64,
    /// Account snapshots.
    pub accounts: Vec<StarknetAccountSnapshot>,
}

/// Holder identifier type.
pub type HolderId = String;

/// Build canonical `VerifierPublicInputs` for a Starknet proof.
pub fn build_verifier_public_inputs(
    threshold: u64,
    proven_sum: u128,
    starknet_meta: &StarknetPublicMeta,
    meta: &PublicMetaInputs,
    nullifier: [u8; 32],
    custodian_pubkey_hash: [u8; 32],
) -> VerifierPublicInputs {
    VerifierPublicInputs {
        threshold_raw: threshold,
        required_currency_code: meta.required_currency_code,
        current_epoch: meta.current_epoch,
        verifier_scope_id: meta.verifier_scope_id,
        policy_id: meta.policy_id,
        nullifier,
        custodian_pubkey_hash,
        // Starknet-specific fields mapped to the optional snapshot fields
        snapshot_block_height: Some(starknet_meta.block_number),
        snapshot_anchor_orchard: Some(starknet_meta.account_commitment), // Reused for account commitment
        holder_binding: Some(starknet_meta.holder_binding),
        proven_sum: Some(proven_sum),
    }
}

/// Generate a Starknet proof-of-funds bundle.
///
/// This function:
/// 1. Validates the snapshot against the threshold
/// 2. Computes holder binding and nullifier
/// 3. Generates the ZK proof
/// 4. Returns a `ProofBundle` tagged for the Starknet rail
pub fn prove_starknet_pof(
    snapshot: &StarknetSnapshot,
    holder_id: &HolderId,
    threshold: u64,
    asset_filter: Option<&str>,
    starknet_meta: &StarknetPublicMeta,
    meta: &PublicMetaInputs,
) -> Result<ProofBundle, StarknetRailError> {
    // Validate snapshot
    if snapshot.accounts.is_empty() {
        return Err(StarknetRailError::InvalidInput(
            "no Starknet accounts in snapshot".into(),
        ));
    }

    if snapshot.accounts.len() > STARKNET_MAX_ACCOUNTS {
        return Err(StarknetRailError::InvalidInput(format!(
            "too many accounts: {} > {}",
            snapshot.accounts.len(),
            STARKNET_MAX_ACCOUNTS
        )));
    }

    if threshold == 0 {
        return Err(StarknetRailError::InvalidInput(
            "threshold must be > 0".into(),
        ));
    }

    // Calculate total value based on asset filter
    let total_value = calculate_total_value(snapshot, asset_filter)?;

    if total_value < threshold as u128 {
        return Err(StarknetRailError::InvalidInput(format!(
            "insufficient funds: {} < {}",
            total_value, threshold
        )));
    }

    // Compute account commitment
    let account_commitment = compute_account_commitment(&snapshot.accounts);

    // Compute holder binding
    let holder_binding = compute_holder_binding(holder_id, &account_commitment);

    // Compute nullifier
    let nullifier = compute_pof_nullifier(
        &holder_binding,
        meta.verifier_scope_id,
        meta.policy_id,
        meta.current_epoch,
    );

    // Starknet is non-custodial; this field is zeroed
    let custodian_pubkey_hash = [0u8; 32];

    // Build public inputs
    let mut starknet_meta_with_binding = starknet_meta.clone();
    starknet_meta_with_binding.account_commitment = account_commitment;
    starknet_meta_with_binding.holder_binding = holder_binding;

    let public_inputs = build_verifier_public_inputs(
        threshold,
        total_value,
        &starknet_meta_with_binding,
        meta,
        nullifier,
        custodian_pubkey_hash,
    );

    // Build circuit input
    let circuit_input = StarknetPofCircuitInput {
        public_inputs: public_inputs.clone(),
        account_values: snapshot
            .accounts
            .iter()
            .map(|a| calculate_account_value(a, asset_filter))
            .collect(),
    };

    // Generate proof (placeholder for now - will integrate with actual prover)
    let proof = circuit::create_starknet_proof(&circuit_input)?;

    Ok(ProofBundle {
        rail_id: RAIL_ID_STARKNET_L2.to_string(),
        circuit_version: CIRCUIT_VERSION,
        proof,
        public_inputs,
    })
}

/// Calculate total value across all accounts.
fn calculate_total_value(
    snapshot: &StarknetSnapshot,
    asset_filter: Option<&str>,
) -> Result<u128, StarknetRailError> {
    let mut total: u128 = 0;
    for account in &snapshot.accounts {
        total = total
            .checked_add(calculate_account_value(account, asset_filter))
            .ok_or_else(|| StarknetRailError::InvalidInput("overflow in total calculation".into()))?;
    }
    Ok(total)
}

/// Calculate value for a single account.
fn calculate_account_value(account: &StarknetAccountSnapshot, asset_filter: Option<&str>) -> u128 {
    let mut value: u128 = 0;

    match asset_filter {
        Some("ETH") | Some("STRK") => {
            // Native balance only
            value = account.native_balance;
        }
        Some(symbol) => {
            // Specific token
            for token in &account.token_balances {
                if token.symbol == symbol {
                    value = value.saturating_add(token.balance);
                }
            }
        }
        None => {
            // All assets (use USD values if available, otherwise raw balances)
            value = account.native_balance;
            for token in &account.token_balances {
                value = value.saturating_add(token.balance);
            }
            for position in &account.defi_positions {
                value = value.saturating_add(position.value);
            }
        }
    }

    value
}

/// Compute commitment to account addresses.
fn compute_account_commitment(accounts: &[StarknetAccountSnapshot]) -> [u8; 32] {
    let mut hasher = Hasher::new();
    hasher.update(b"starknet_account_commitment_v1");
    for account in accounts {
        hasher.update(account.address.as_bytes());
    }
    *hasher.finalize().as_bytes()
}

/// Compute holder binding.
fn compute_holder_binding(holder_id: &str, account_commitment: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Hasher::new();
    hasher.update(b"starknet_holder_binding_v1");
    hasher.update(holder_id.as_bytes());
    hasher.update(account_commitment);
    *hasher.finalize().as_bytes()
}

/// Compute PoF nullifier.
fn compute_pof_nullifier(
    holder_binding: &[u8; 32],
    scope_id: u64,
    policy_id: u64,
    epoch: u64,
) -> [u8; 32] {
    let mut hasher = Hasher::new();
    hasher.update(b"starknet_pof_nullifier_v1");
    hasher.update(holder_binding);
    hasher.update(&scope_id.to_be_bytes());
    hasher.update(&policy_id.to_be_bytes());
    hasher.update(&epoch.to_be_bytes());
    *hasher.finalize().as_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_snapshot() -> StarknetSnapshot {
        StarknetSnapshot {
            chain_id: "SN_SEPOLIA".to_string(),
            block_number: 123456,
            block_hash: "0x1234".to_string(),
            timestamp: 1700000000,
            accounts: vec![StarknetAccountSnapshot {
                address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7".to_string(),
                class_hash: "0x0".to_string(),
                native_balance: 10_000_000_000_000_000_000, // 10 ETH
                token_balances: vec![TokenBalance {
                    token_address: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8".to_string(),
                    symbol: "USDC".to_string(),
                    balance: 5_000_000_000, // 5000 USDC (6 decimals)
                    usd_value: Some(5_000_000_000),
                }],
                defi_positions: vec![],
            }],
        }
    }

    #[test]
    fn test_prove_starknet_pof_success() {
        let snapshot = sample_snapshot();
        let holder_id = "holder-123".to_string();
        let threshold = 1_000_000_000_000_000_000; // 1 ETH
        let starknet_meta = StarknetPublicMeta {
            chain_id: "SN_SEPOLIA".to_string(),
            chain_id_numeric: 393402133025997798000961,
            block_number: 123456,
            account_commitment: [0u8; 32],
            holder_binding: [0u8; 32],
        };
        let public_meta = PublicMetaInputs {
            policy_id: 42,
            verifier_scope_id: 7,
            current_epoch: 1_700_000_000,
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
        .expect("should succeed");

        assert_eq!(bundle.rail_id, RAIL_ID_STARKNET_L2);
        assert_eq!(bundle.public_inputs.threshold_raw, threshold);
    }

    #[test]
    fn test_prove_starknet_pof_insufficient_funds() {
        let snapshot = sample_snapshot();
        let holder_id = "holder-123".to_string();
        let threshold = 11_000_000_000_000_000_000; // 11 ETH (more than the 10 ETH we have)
        let starknet_meta = StarknetPublicMeta {
            chain_id: "SN_SEPOLIA".to_string(),
            chain_id_numeric: 393402133025997798000961,
            block_number: 123456,
            account_commitment: [0u8; 32],
            holder_binding: [0u8; 32],
        };
        let public_meta = PublicMetaInputs {
            policy_id: 42,
            verifier_scope_id: 7,
            current_epoch: 1_700_000_000,
            required_currency_code: 1027,
        };

        let result = prove_starknet_pof(
            &snapshot,
            &holder_id,
            threshold,
            Some("ETH"),
            &starknet_meta,
            &public_meta,
        );

        assert!(result.is_err());
        assert!(matches!(result, Err(StarknetRailError::InvalidInput(_))));
    }
}

