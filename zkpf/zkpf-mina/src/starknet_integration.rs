//! Starknet → Mina recursive proof integration.
//!
//! This module provides helpers for wrapping Starknet proof-of-funds proofs
//! into Mina recursive proofs for cross-chain attestations.
//!
//! # Flow
//!
//! 1. Generate a Starknet PoF proof using `zkpf-starknet-l2`
//! 2. Convert the `ProofBundle` to a `SourceProofInput` using this module
//! 3. Call `prove_mina_recursive` to wrap it into a Mina-compatible proof
//! 4. The resulting attestation can be queried from any target chain via zkBridges
//!
//! # Example
//!
//! ```ignore
//! use zkpf_mina::starknet_integration::{wrap_starknet_proof, StarknetWrapConfig};
//!
//! let starknet_bundle = /* ... generate Starknet proof ... */;
//!
//! let config = StarknetWrapConfig {
//!     holder_id: "user-123".to_string(),
//!     mina_slot: 500000,
//!     zkapp_address: Some("B62q...".to_string()),
//! };
//!
//! let mina_bundle = wrap_starknet_proof(starknet_bundle, config)?;
//! ```

use blake3::Hasher;
use serde::{Deserialize, Serialize};
use zkpf_common::{ProofBundle, CIRCUIT_VERSION};

use crate::{
    error::MinaRailError,
    prove_mina_recursive, MinaPublicMeta, PublicMetaInputs, SourceProofInput,
};

/// Starknet rail identifier (must match `zkpf-starknet-l2::RAIL_ID_STARKNET_L2`).
pub const RAIL_ID_STARKNET: &str = "STARKNET_L2";

/// Starknet chain identifiers.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[derive(Default)]
pub enum StarknetChainId {
    /// Starknet Mainnet
    Mainnet,
    /// Starknet Sepolia Testnet
    #[default]
    Sepolia,
    /// Starknet Goerli (deprecated)
    #[deprecated(note = "Goerli is deprecated, use Sepolia")]
    Goerli,
}

impl StarknetChainId {
    /// Get the chain ID string (as used in Starknet RPC).
    pub fn as_str(&self) -> &'static str {
        match self {
            StarknetChainId::Mainnet => "SN_MAIN",
            StarknetChainId::Sepolia => "SN_SEPOLIA",
            #[allow(deprecated)]
            StarknetChainId::Goerli => "SN_GOERLI",
        }
    }

    /// Get the numeric chain ID (for circuit encoding).
    pub fn numeric_id(&self) -> u128 {
        match self {
            StarknetChainId::Mainnet => 0x534e5f4d41494e, // "SN_MAIN" encoded
            StarknetChainId::Sepolia => 0x534e5f5345504f4c4941, // "SN_SEPOLIA" encoded
            #[allow(deprecated)]
            StarknetChainId::Goerli => 0x534e5f474f45524c49, // "SN_GOERLI" encoded
        }
    }

    /// Parse from chain ID string.
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "SN_MAIN" => Some(StarknetChainId::Mainnet),
            "SN_SEPOLIA" => Some(StarknetChainId::Sepolia),
            #[allow(deprecated)]
            "SN_GOERLI" => Some(StarknetChainId::Goerli),
            _ => None,
        }
    }
}


/// Metadata extracted from a Starknet proof bundle.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StarknetProofMetadata {
    /// Starknet chain ID.
    pub chain_id: String,
    /// Numeric chain ID for circuit encoding.
    pub chain_id_numeric: u128,
    /// Block number at which the snapshot was taken.
    pub block_number: u64,
    /// Account commitment (hash of account addresses).
    pub account_commitment: [u8; 32],
    /// Holder binding from the Starknet proof.
    pub holder_binding: [u8; 32],
    /// Proven sum (if available).
    pub proven_sum: Option<u128>,
    /// Currency code.
    pub currency_code: u32,
}

impl StarknetProofMetadata {
    /// Extract metadata from a Starknet proof bundle.
    pub fn from_bundle(bundle: &ProofBundle) -> Result<Self, MinaRailError> {
        if bundle.rail_id != RAIL_ID_STARKNET {
            return Err(MinaRailError::InvalidInput(format!(
                "expected rail_id '{}', got '{}'",
                RAIL_ID_STARKNET, bundle.rail_id
            )));
        }

        let block_number = bundle.public_inputs.snapshot_block_height.ok_or_else(|| {
            MinaRailError::InvalidInput("missing snapshot_block_height in Starknet bundle".into())
        })?;

        let account_commitment =
            bundle
                .public_inputs
                .snapshot_anchor_orchard
                .ok_or_else(|| {
                    MinaRailError::InvalidInput(
                        "missing account_commitment (snapshot_anchor_orchard) in Starknet bundle"
                            .into(),
                    )
                })?;

        let holder_binding = bundle.public_inputs.holder_binding.ok_or_else(|| {
            MinaRailError::InvalidInput("missing holder_binding in Starknet bundle".into())
        })?;

        Ok(StarknetProofMetadata {
            // Default to Sepolia; caller can override via StarknetWrapConfig
            chain_id: StarknetChainId::default().as_str().to_string(),
            chain_id_numeric: StarknetChainId::default().numeric_id(),
            block_number,
            account_commitment,
            holder_binding,
            proven_sum: bundle.public_inputs.proven_sum,
            currency_code: bundle.public_inputs.required_currency_code,
        })
    }

    /// Update chain ID.
    pub fn with_chain_id(mut self, chain_id: StarknetChainId) -> Self {
        self.chain_id = chain_id.as_str().to_string();
        self.chain_id_numeric = chain_id.numeric_id();
        self
    }
}

/// Configuration for wrapping a Starknet proof into Mina.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[derive(Default)]
pub struct StarknetWrapConfig {
    /// Holder identifier (must match the holder used in Starknet proof).
    pub holder_id: String,
    /// Current Mina global slot.
    pub mina_slot: u64,
    /// Optional zkApp address (uses default if not specified).
    pub zkapp_address: Option<String>,
    /// Starknet chain ID (parsed from metadata if not specified).
    pub chain_id: Option<StarknetChainId>,
    /// Attestation validity window in Mina slots (default: 7200 ≈ 24 hours).
    pub validity_window_slots: Option<u64>,
}


/// Result of wrapping a Starknet proof into Mina.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StarknetWrapResult {
    /// The Mina recursive proof bundle.
    pub bundle: ProofBundle,
    /// Original Starknet metadata.
    pub starknet_metadata: StarknetProofMetadata,
    /// Cross-chain attestation info.
    pub attestation_info: CrossChainAttestationInfo,
}

/// Information about the cross-chain attestation.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CrossChainAttestationInfo {
    /// Attestation ID (derived from holder binding and policy).
    pub attestation_id: [u8; 32],
    /// Mina slot at creation.
    pub mina_slot: u64,
    /// Expiration slot.
    pub expires_at_slot: u64,
    /// Source chain.
    pub source_chain: String,
    /// Source rails that were wrapped.
    pub source_rails: Vec<String>,
    /// Policy ID.
    pub policy_id: u64,
    /// Current epoch.
    pub epoch: u64,
}

/// Convert a Starknet proof bundle to a SourceProofInput for Mina wrapping.
pub fn starknet_bundle_to_source_input(
    bundle: ProofBundle,
    metadata: &StarknetProofMetadata,
) -> Result<SourceProofInput, MinaRailError> {
    // Validate the bundle
    if bundle.rail_id != RAIL_ID_STARKNET {
        return Err(MinaRailError::InvalidInput(format!(
            "expected rail_id '{}', got '{}'",
            RAIL_ID_STARKNET, bundle.rail_id
        )));
    }

    // Build rail-specific metadata
    let rail_metadata = serde_json::json!({
        "chain_id": metadata.chain_id,
        "chain_id_numeric": format!("0x{:x}", metadata.chain_id_numeric),
        "block_number": metadata.block_number,
        "account_commitment": hex::encode(metadata.account_commitment),
        "source_holder_binding": hex::encode(metadata.holder_binding),
    });

    Ok(SourceProofInput {
        bundle,
        rail_metadata,
    })
}

/// Wrap a single Starknet proof bundle into a Mina recursive proof.
///
/// This is the high-level function for the Starknet → Mina integration.
pub fn wrap_starknet_proof(
    starknet_bundle: ProofBundle,
    config: StarknetWrapConfig,
) -> Result<StarknetWrapResult, MinaRailError> {
    // Validate holder_id
    if config.holder_id.is_empty() {
        return Err(MinaRailError::InvalidInput(
            "holder_id is required".to_string(),
        ));
    }

    // Extract metadata from the Starknet bundle
    let mut metadata = StarknetProofMetadata::from_bundle(&starknet_bundle)?;

    // Apply chain_id override if specified
    if let Some(chain_id) = config.chain_id {
        metadata = metadata.with_chain_id(chain_id);
    }

    // Build Mina metadata
    let mina_meta = MinaPublicMeta {
        network_id: "testnet".to_string(), // Can be configured
        network_id_numeric: 1,
        global_slot: config.mina_slot,
        zkapp_address: config.zkapp_address.unwrap_or_default(),
        recursive_proof_commitment: [0u8; 32], // Computed by prove_mina_recursive
        source_rail_ids: vec![RAIL_ID_STARKNET.to_string()],
    };

    // Build public meta inputs (inherit from Starknet bundle)
    let public_meta = PublicMetaInputs {
        policy_id: starknet_bundle.public_inputs.policy_id,
        verifier_scope_id: starknet_bundle.public_inputs.verifier_scope_id,
        current_epoch: starknet_bundle.public_inputs.current_epoch,
        required_currency_code: starknet_bundle.public_inputs.required_currency_code,
    };

    // Convert to source input
    let source_input = starknet_bundle_to_source_input(starknet_bundle.clone(), &metadata)?;

    // Generate Mina recursive proof
    let mina_bundle = prove_mina_recursive(
        &[source_input],
        &config.holder_id,
        &mina_meta,
        &public_meta,
    )?;

    // Compute attestation info
    let validity_window = config.validity_window_slots.unwrap_or(7200);
    let holder_binding = mina_bundle.public_inputs.holder_binding.ok_or_else(|| {
        MinaRailError::InvalidInput(
            "Mina bundle missing holder_binding after prove_mina_recursive; \
             this indicates a bug in the proof generation"
                .into(),
        )
    })?;
    let attestation_id = compute_attestation_id(
        &holder_binding,
        public_meta.policy_id,
        public_meta.current_epoch,
    );

    let attestation_info = CrossChainAttestationInfo {
        attestation_id,
        mina_slot: config.mina_slot,
        expires_at_slot: config.mina_slot + validity_window,
        source_chain: "starknet".to_string(),
        source_rails: vec![RAIL_ID_STARKNET.to_string()],
        policy_id: public_meta.policy_id,
        epoch: public_meta.current_epoch,
    };

    Ok(StarknetWrapResult {
        bundle: mina_bundle,
        starknet_metadata: metadata,
        attestation_info,
    })
}

/// Wrap multiple Starknet proof bundles into a single Mina recursive proof.
///
/// This allows aggregating proofs from multiple Starknet accounts/positions
/// into a single cross-chain attestation.
pub fn wrap_starknet_proofs(
    starknet_bundles: Vec<ProofBundle>,
    config: StarknetWrapConfig,
) -> Result<StarknetWrapResult, MinaRailError> {
    if starknet_bundles.is_empty() {
        return Err(MinaRailError::InvalidInput(
            "at least one Starknet bundle is required".to_string(),
        ));
    }

    if config.holder_id.is_empty() {
        return Err(MinaRailError::InvalidInput(
            "holder_id is required".to_string(),
        ));
    }

    // Extract metadata from the first bundle (all should have consistent policy)
    let first_bundle = &starknet_bundles[0];
    let mut metadata = StarknetProofMetadata::from_bundle(first_bundle)?;

    if let Some(chain_id) = config.chain_id {
        metadata = metadata.with_chain_id(chain_id);
    }

    // Validate all bundles have consistent policy
    let policy_id = first_bundle.public_inputs.policy_id;
    for (idx, bundle) in starknet_bundles.iter().enumerate() {
        if bundle.public_inputs.policy_id != policy_id {
            return Err(MinaRailError::InvalidInput(format!(
                "policy_id mismatch at index {}: expected {}, got {}",
                idx, policy_id, bundle.public_inputs.policy_id
            )));
        }
        if bundle.rail_id != RAIL_ID_STARKNET {
            return Err(MinaRailError::InvalidInput(format!(
                "bundle at index {} has wrong rail_id: expected '{}', got '{}'",
                idx, RAIL_ID_STARKNET, bundle.rail_id
            )));
        }
    }

    // Convert all bundles to source inputs
    let mut source_inputs = Vec::with_capacity(starknet_bundles.len());
    for bundle in starknet_bundles.iter() {
        let bundle_metadata = StarknetProofMetadata::from_bundle(bundle)?;
        let source_input = starknet_bundle_to_source_input(bundle.clone(), &bundle_metadata)?;
        source_inputs.push(source_input);
    }

    // Build Mina metadata
    let mina_meta = MinaPublicMeta {
        network_id: "testnet".to_string(),
        network_id_numeric: 1,
        global_slot: config.mina_slot,
        zkapp_address: config.zkapp_address.unwrap_or_default(),
        recursive_proof_commitment: [0u8; 32],
        source_rail_ids: vec![RAIL_ID_STARKNET.to_string()],
    };

    // Build public meta inputs
    let public_meta = PublicMetaInputs {
        policy_id: first_bundle.public_inputs.policy_id,
        verifier_scope_id: first_bundle.public_inputs.verifier_scope_id,
        current_epoch: first_bundle.public_inputs.current_epoch,
        required_currency_code: first_bundle.public_inputs.required_currency_code,
    };

    // Generate Mina recursive proof
    let mina_bundle =
        prove_mina_recursive(&source_inputs, &config.holder_id, &mina_meta, &public_meta)?;

    // Compute attestation info
    let validity_window = config.validity_window_slots.unwrap_or(7200);
    let holder_binding = mina_bundle.public_inputs.holder_binding.ok_or_else(|| {
        MinaRailError::InvalidInput(
            "Mina bundle missing holder_binding after prove_mina_recursive; \
             this indicates a bug in the proof generation"
                .into(),
        )
    })?;
    let attestation_id = compute_attestation_id(
        &holder_binding,
        public_meta.policy_id,
        public_meta.current_epoch,
    );

    let attestation_info = CrossChainAttestationInfo {
        attestation_id,
        mina_slot: config.mina_slot,
        expires_at_slot: config.mina_slot + validity_window,
        source_chain: "starknet".to_string(),
        source_rails: vec![RAIL_ID_STARKNET.to_string()],
        policy_id: public_meta.policy_id,
        epoch: public_meta.current_epoch,
    };

    Ok(StarknetWrapResult {
        bundle: mina_bundle,
        starknet_metadata: metadata,
        attestation_info,
    })
}

/// Validate that a Starknet proof bundle is suitable for Mina wrapping.
pub fn validate_starknet_bundle(bundle: &ProofBundle) -> Result<(), MinaRailError> {
    // Check rail ID
    if bundle.rail_id != RAIL_ID_STARKNET {
        return Err(MinaRailError::InvalidInput(format!(
            "expected rail_id '{}', got '{}'",
            RAIL_ID_STARKNET, bundle.rail_id
        )));
    }

    // Check circuit version compatibility
    if bundle.circuit_version != CIRCUIT_VERSION {
        return Err(MinaRailError::InvalidInput(format!(
            "circuit version mismatch: bundle has {}, expected {}",
            bundle.circuit_version, CIRCUIT_VERSION
        )));
    }

    // Check required fields
    if bundle.public_inputs.snapshot_block_height.is_none() {
        return Err(MinaRailError::InvalidInput(
            "missing snapshot_block_height (Starknet block number)".into(),
        ));
    }

    if bundle.public_inputs.snapshot_anchor_orchard.is_none() {
        return Err(MinaRailError::InvalidInput(
            "missing snapshot_anchor_orchard (account commitment)".into(),
        ));
    }

    if bundle.public_inputs.holder_binding.is_none() {
        return Err(MinaRailError::InvalidInput(
            "missing holder_binding".into(),
        ));
    }

    // Check proof is not empty
    if bundle.proof.is_empty() {
        return Err(MinaRailError::InvalidInput("proof bytes are empty".into()));
    }

    Ok(())
}

// === Internal helpers ===

fn compute_attestation_id(holder_binding: &[u8; 32], policy_id: u64, epoch: u64) -> [u8; 32] {
    let mut hasher = Hasher::new();
    hasher.update(b"starknet_mina_attestation_id_v1");
    hasher.update(holder_binding);
    hasher.update(&policy_id.to_be_bytes());
    hasher.update(&epoch.to_be_bytes());
    *hasher.finalize().as_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::RAIL_ID_MINA;
    use zkpf_common::VerifierPublicInputs;

    fn sample_starknet_bundle() -> ProofBundle {
        ProofBundle {
            rail_id: RAIL_ID_STARKNET.to_string(),
            circuit_version: CIRCUIT_VERSION,
            proof: vec![0u8; 64], // Placeholder proof
            public_inputs: VerifierPublicInputs {
                threshold_raw: 1_000_000_000_000_000_000, // 1 ETH
                required_currency_code: 1027,            // ETH
                current_epoch: 1700000000,
                verifier_scope_id: 42,
                policy_id: 100,
                nullifier: [1u8; 32],
                custodian_pubkey_hash: [0u8; 32],
                snapshot_block_height: Some(123456),
                snapshot_anchor_orchard: Some([2u8; 32]), // account_commitment
                holder_binding: Some([3u8; 32]),
                proven_sum: Some(5_000_000_000_000_000_000), // 5 ETH
            },
        }
    }

    #[test]
    fn test_starknet_chain_id() {
        assert_eq!(StarknetChainId::Mainnet.as_str(), "SN_MAIN");
        assert_eq!(StarknetChainId::Sepolia.as_str(), "SN_SEPOLIA");
        assert_eq!(
            StarknetChainId::from_str("SN_MAIN"),
            Some(StarknetChainId::Mainnet)
        );
        assert_eq!(StarknetChainId::from_str("INVALID"), None);
    }

    #[test]
    fn test_extract_starknet_metadata() {
        let bundle = sample_starknet_bundle();
        let metadata = StarknetProofMetadata::from_bundle(&bundle).expect("should succeed");

        assert_eq!(metadata.block_number, 123456);
        assert_eq!(metadata.account_commitment, [2u8; 32]);
        assert_eq!(metadata.holder_binding, [3u8; 32]);
        assert_eq!(metadata.proven_sum, Some(5_000_000_000_000_000_000));
    }

    #[test]
    fn test_validate_starknet_bundle() {
        let bundle = sample_starknet_bundle();
        assert!(validate_starknet_bundle(&bundle).is_ok());

        // Test wrong rail_id
        let mut bad_bundle = bundle.clone();
        bad_bundle.rail_id = "WRONG_RAIL".to_string();
        assert!(validate_starknet_bundle(&bad_bundle).is_err());

        // Test missing snapshot_block_height
        let mut bad_bundle = bundle.clone();
        bad_bundle.public_inputs.snapshot_block_height = None;
        assert!(validate_starknet_bundle(&bad_bundle).is_err());

        // Test empty proof
        let mut bad_bundle = bundle.clone();
        bad_bundle.proof = vec![];
        assert!(validate_starknet_bundle(&bad_bundle).is_err());
    }

    #[test]
    fn test_starknet_bundle_to_source_input() {
        let bundle = sample_starknet_bundle();
        let metadata = StarknetProofMetadata::from_bundle(&bundle).expect("should succeed");

        let source_input =
            starknet_bundle_to_source_input(bundle.clone(), &metadata).expect("should succeed");

        assert_eq!(source_input.bundle.rail_id, RAIL_ID_STARKNET);
        assert!(source_input.rail_metadata.get("chain_id").is_some());
        assert!(source_input.rail_metadata.get("block_number").is_some());
    }

    #[test]
    fn test_wrap_starknet_proof() {
        let bundle = sample_starknet_bundle();
        let config = StarknetWrapConfig {
            holder_id: "test-holder-123".to_string(),
            mina_slot: 500000,
            zkapp_address: Some("B62qtest...".to_string()),
            chain_id: Some(StarknetChainId::Sepolia),
            validity_window_slots: Some(7200),
        };

        let result = wrap_starknet_proof(bundle, config).expect("should succeed");

        assert_eq!(result.bundle.rail_id, RAIL_ID_MINA);
        assert_eq!(result.starknet_metadata.chain_id, "SN_SEPOLIA");
        assert_eq!(result.attestation_info.source_chain, "starknet");
        assert_eq!(result.attestation_info.mina_slot, 500000);
        assert_eq!(result.attestation_info.expires_at_slot, 500000 + 7200);
    }

    #[test]
    fn test_wrap_starknet_proof_missing_holder() {
        let bundle = sample_starknet_bundle();
        let config = StarknetWrapConfig {
            holder_id: "".to_string(), // Empty holder_id
            mina_slot: 500000,
            ..Default::default()
        };

        let result = wrap_starknet_proof(bundle, config);
        assert!(result.is_err());
    }

    #[test]
    fn test_wrap_multiple_starknet_proofs() {
        let bundle1 = sample_starknet_bundle();
        let mut bundle2 = sample_starknet_bundle();
        bundle2.public_inputs.snapshot_block_height = Some(123457);

        let config = StarknetWrapConfig {
            holder_id: "test-holder-123".to_string(),
            mina_slot: 500000,
            zkapp_address: None,
            chain_id: Some(StarknetChainId::Mainnet),
            validity_window_slots: None,
        };

        let result =
            wrap_starknet_proofs(vec![bundle1, bundle2], config).expect("should succeed");

        assert_eq!(result.bundle.rail_id, RAIL_ID_MINA);
        assert_eq!(result.starknet_metadata.chain_id, "SN_MAIN");
    }

    #[test]
    fn test_wrap_starknet_proofs_policy_mismatch() {
        let bundle1 = sample_starknet_bundle();
        let mut bundle2 = sample_starknet_bundle();
        bundle2.public_inputs.policy_id = 999; // Different policy

        let config = StarknetWrapConfig {
            holder_id: "test-holder-123".to_string(),
            mina_slot: 500000,
            ..Default::default()
        };

        let result = wrap_starknet_proofs(vec![bundle1, bundle2], config);
        assert!(result.is_err());
    }
}

