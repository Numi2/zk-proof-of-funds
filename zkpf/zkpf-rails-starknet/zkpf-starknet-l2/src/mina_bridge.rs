//! Mina Bridge Integration for Starknet
//!
//! This module provides Rust types and helpers for interacting with the
//! MinaStateVerifier Cairo contract on Starknet.
//!
//! # Overview
//!
//! The Mina bridge enables Starknet DeFi protocols to verify proof-of-funds
//! attestations that were verified and wrapped on Mina. This creates a
//! cross-chain compliance layer where:
//!
//! 1. User generates zkpf proof on any supported rail (Starknet, Zcash, custodial)
//! 2. Proof is wrapped into Mina recursive proof via zkpf-mina
//! 3. Attestation is bridged to Starknet via an authorized relayer
//! 4. Starknet DeFi protocols query MinaStateVerifier to check cross-chain PoF
//!
//! # Usage
//!
//! ```ignore
//! use zkpf_starknet_l2::mina_bridge::{MinaAttestationSubmitter, MinaPublicInputs};
//!
//! // Create submitter with RPC client
//! let submitter = MinaAttestationSubmitter::new(
//!     rpc_client,
//!     verifier_address,
//!     relayer_private_key,
//! );
//!
//! // Submit attestation from Mina bundle
//! let result = submitter.submit_from_mina_bundle(&mina_bundle).await?;
//! ```

use serde::{Deserialize, Serialize};

use crate::error::StarknetRailError;

/// Rail ID for Mina recursive proofs.
/// This must match `zkpf_mina::RAIL_ID_MINA` but is defined locally to avoid
/// creating a dependency between zkpf-starknet-l2 and zkpf-mina.
const RAIL_ID_MINA: &str = "MINA_RECURSIVE";

/// Source rail bit positions for the source_rails_mask field.
/// These match the SourceRails module in MinaStateVerifier.cairo.
#[allow(non_snake_case)]
pub mod SourceRails {
    /// Custodial rail (bank attestations)
    pub const CUSTODIAL: u8 = 0;
    /// Zcash Orchard shielded pool
    pub const ORCHARD: u8 = 1;
    /// Starknet L2 accounts
    pub const STARKNET_L2: u8 = 2;
    /// Mina native accounts
    pub const MINA_NATIVE: u8 = 3;
}

/// Get the bit mask for a source rail.
pub fn source_rail_mask(rail: u8) -> u8 {
    1u8 << rail
}

/// Combine multiple source rails into a mask.
pub fn combine_source_rails(rails: &[u8]) -> u8 {
    rails.iter().fold(0u8, |acc, &rail| acc | source_rail_mask(rail))
}

/// Mina attestation public inputs for submission to MinaStateVerifier.
/// These are derived from the Mina recursive proof public inputs.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MinaPublicInputs {
    /// Mina digest from the wrapper circuit
    /// H(bridge_tip || state_hashes || ledger_hashes)
    pub mina_digest: [u8; 32],
    /// Holder binding: H(holder_id || mina_digest || policy_id || scope)
    pub holder_binding: [u8; 32],
    /// Policy ID from zkpf
    pub policy_id: u64,
    /// Current epoch (Unix timestamp)
    pub current_epoch: u64,
    /// Verifier scope ID
    pub verifier_scope_id: u64,
    /// Mina global slot at attestation time
    pub mina_slot: u64,
    /// Nullifier for replay protection
    pub nullifier: [u8; 32],
    /// Optional: threshold that was proven
    pub threshold: Option<u64>,
    /// Optional: currency code that was checked
    pub currency_code: Option<u32>,
}

impl MinaPublicInputs {
    /// Convert a 32-byte array to a felt252 representation (hex string).
    pub fn bytes_to_felt(&self, bytes: &[u8; 32]) -> String {
        format!("0x{}", hex::encode(bytes))
    }

    /// Build calldata for submit_attestation function.
    /// Returns the calldata as a vector of felt252 strings.
    pub fn to_calldata(&self, validity_window_slots: u64, source_rails_mask: u8) -> Vec<String> {
        vec![
            // MinaPublicInputs struct fields
            self.bytes_to_felt(&self.mina_digest),
            self.bytes_to_felt(&self.holder_binding),
            self.policy_id.to_string(),
            self.current_epoch.to_string(),
            self.verifier_scope_id.to_string(),
            self.mina_slot.to_string(),
            self.bytes_to_felt(&self.nullifier),
            self.threshold.unwrap_or(0).to_string(),
            self.currency_code.unwrap_or(0).to_string(),
            // Additional parameters
            validity_window_slots.to_string(),
            source_rails_mask.to_string(),
        ]
    }

    /// Create from a zkpf Mina proof bundle's public inputs.
    pub fn from_mina_bundle(
        bundle: &zkpf_common::ProofBundle,
    ) -> Result<Self, StarknetRailError> {
        // Verify this is a Mina rail bundle
        if bundle.rail_id != RAIL_ID_MINA {
            return Err(StarknetRailError::InvalidInput(format!(
                "expected {} rail_id, got {}",
                RAIL_ID_MINA, bundle.rail_id
            )));
        }

        // Extract mina_digest from snapshot_anchor_orchard
        let mina_digest = bundle.public_inputs.snapshot_anchor_orchard.ok_or_else(|| {
            StarknetRailError::InvalidInput(
                "missing mina_digest (snapshot_anchor_orchard) in Mina bundle".into(),
            )
        })?;

        // Extract holder_binding
        let holder_binding = bundle.public_inputs.holder_binding.ok_or_else(|| {
            StarknetRailError::InvalidInput("missing holder_binding in Mina bundle".into())
        })?;

        // Extract mina_slot from snapshot_block_height
        let mina_slot = bundle.public_inputs.snapshot_block_height.ok_or_else(|| {
            StarknetRailError::InvalidInput(
                "missing mina_slot (snapshot_block_height) in Mina bundle".into(),
            )
        })?;

        Ok(MinaPublicInputs {
            mina_digest,
            holder_binding,
            policy_id: bundle.public_inputs.policy_id,
            current_epoch: bundle.public_inputs.current_epoch,
            verifier_scope_id: bundle.public_inputs.verifier_scope_id,
            mina_slot,
            nullifier: bundle.public_inputs.nullifier,
            threshold: Some(bundle.public_inputs.threshold_raw),
            currency_code: Some(bundle.public_inputs.required_currency_code),
        })
    }
}

/// Result from attestation submission.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SubmitResult {
    /// Whether submission succeeded
    pub success: bool,
    /// Attestation ID (if successful)
    pub attestation_id: Option<String>,
    /// Error code (if failed)
    pub error_code: Option<String>,
    /// Transaction hash (if submitted)
    pub tx_hash: Option<String>,
}

/// Result from attestation query.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AttestationQueryResult {
    /// Whether a valid attestation exists
    pub has_valid_attestation: bool,
    /// Attestation details (if exists)
    pub attestation: Option<MinaAttestation>,
    /// Starknet block at query time
    pub starknet_block: u64,
}

/// Mina attestation record (matches Cairo struct).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MinaAttestation {
    /// Mina digest
    pub mina_digest: String,
    /// Holder binding
    pub holder_binding: String,
    /// Policy ID
    pub policy_id: u64,
    /// Epoch at attestation time
    pub epoch: u64,
    /// Mina slot at attestation time
    pub mina_slot: u64,
    /// Expiration Mina slot
    pub expires_at_slot: u64,
    /// Source rails bitmask
    pub source_rails_mask: u8,
    /// Unix timestamp when bridged
    pub bridged_at: u64,
    /// Relayer address
    pub relayer: String,
    /// Is the attestation still valid
    pub is_valid: bool,
}

impl MinaAttestation {
    /// Check if the attestation includes a specific source rail.
    pub fn has_source_rail(&self, rail: u8) -> bool {
        (self.source_rails_mask & source_rail_mask(rail)) != 0
    }

    /// Get list of source rails as human-readable names.
    pub fn source_rail_names(&self) -> Vec<&'static str> {
        let mut names = Vec::new();
        if self.has_source_rail(SourceRails::CUSTODIAL) {
            names.push("CUSTODIAL");
        }
        if self.has_source_rail(SourceRails::ORCHARD) {
            names.push("ORCHARD");
        }
        if self.has_source_rail(SourceRails::STARKNET_L2) {
            names.push("STARKNET_L2");
        }
        if self.has_source_rail(SourceRails::MINA_NATIVE) {
            names.push("MINA_NATIVE");
        }
        names
    }
}

/// Configuration for Mina bridge operations.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MinaBridgeConfig {
    /// MinaStateVerifier contract address
    pub verifier_address: String,
    /// Default validity window in Mina slots (~24 hours = 7200)
    pub default_validity_window: u64,
    /// Chain ID for transaction signing
    pub chain_id: String,
}

impl Default for MinaBridgeConfig {
    fn default() -> Self {
        Self {
            verifier_address: String::new(),
            default_validity_window: 7200, // ~24 hours at 12s slots
            chain_id: "SN_SEPOLIA".to_string(),
        }
    }
}

/// Builder for MinaPublicInputs from various sources.
pub struct MinaPublicInputsBuilder {
    mina_digest: Option<[u8; 32]>,
    holder_binding: Option<[u8; 32]>,
    policy_id: Option<u64>,
    current_epoch: Option<u64>,
    verifier_scope_id: Option<u64>,
    mina_slot: Option<u64>,
    nullifier: Option<[u8; 32]>,
    threshold: Option<u64>,
    currency_code: Option<u32>,
}

impl MinaPublicInputsBuilder {
    /// Create a new builder.
    pub fn new() -> Self {
        Self {
            mina_digest: None,
            holder_binding: None,
            policy_id: None,
            current_epoch: None,
            verifier_scope_id: None,
            mina_slot: None,
            nullifier: None,
            threshold: None,
            currency_code: None,
        }
    }

    /// Set mina_digest.
    pub fn mina_digest(mut self, digest: [u8; 32]) -> Self {
        self.mina_digest = Some(digest);
        self
    }

    /// Set mina_digest from hex string.
    pub fn mina_digest_hex(mut self, hex_str: &str) -> Result<Self, StarknetRailError> {
        let bytes = parse_hex_32(hex_str)?;
        self.mina_digest = Some(bytes);
        Ok(self)
    }

    /// Set holder_binding.
    pub fn holder_binding(mut self, binding: [u8; 32]) -> Self {
        self.holder_binding = Some(binding);
        self
    }

    /// Set holder_binding from hex string.
    pub fn holder_binding_hex(mut self, hex_str: &str) -> Result<Self, StarknetRailError> {
        let bytes = parse_hex_32(hex_str)?;
        self.holder_binding = Some(bytes);
        Ok(self)
    }

    /// Set policy_id.
    pub fn policy_id(mut self, id: u64) -> Self {
        self.policy_id = Some(id);
        self
    }

    /// Set current_epoch.
    pub fn current_epoch(mut self, epoch: u64) -> Self {
        self.current_epoch = Some(epoch);
        self
    }

    /// Set verifier_scope_id.
    pub fn verifier_scope_id(mut self, scope: u64) -> Self {
        self.verifier_scope_id = Some(scope);
        self
    }

    /// Set mina_slot.
    pub fn mina_slot(mut self, slot: u64) -> Self {
        self.mina_slot = Some(slot);
        self
    }

    /// Set nullifier.
    pub fn nullifier(mut self, nullifier: [u8; 32]) -> Self {
        self.nullifier = Some(nullifier);
        self
    }

    /// Set threshold.
    pub fn threshold(mut self, threshold: u64) -> Self {
        self.threshold = Some(threshold);
        self
    }

    /// Set currency_code.
    pub fn currency_code(mut self, code: u32) -> Self {
        self.currency_code = Some(code);
        self
    }

    /// Build the MinaPublicInputs.
    pub fn build(self) -> Result<MinaPublicInputs, StarknetRailError> {
        Ok(MinaPublicInputs {
            mina_digest: self.mina_digest.ok_or_else(|| {
                StarknetRailError::InvalidInput("mina_digest is required".into())
            })?,
            holder_binding: self.holder_binding.ok_or_else(|| {
                StarknetRailError::InvalidInput("holder_binding is required".into())
            })?,
            policy_id: self.policy_id.ok_or_else(|| {
                StarknetRailError::InvalidInput("policy_id is required".into())
            })?,
            current_epoch: self.current_epoch.ok_or_else(|| {
                StarknetRailError::InvalidInput("current_epoch is required".into())
            })?,
            verifier_scope_id: self.verifier_scope_id.ok_or_else(|| {
                StarknetRailError::InvalidInput("verifier_scope_id is required".into())
            })?,
            mina_slot: self.mina_slot.ok_or_else(|| {
                StarknetRailError::InvalidInput("mina_slot is required".into())
            })?,
            nullifier: self.nullifier.ok_or_else(|| {
                StarknetRailError::InvalidInput("nullifier is required".into())
            })?,
            threshold: self.threshold,
            currency_code: self.currency_code,
        })
    }
}

impl Default for MinaPublicInputsBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Parse a hex string (with or without 0x prefix) into a 32-byte array.
fn parse_hex_32(hex_str: &str) -> Result<[u8; 32], StarknetRailError> {
    let hex_str = hex_str.strip_prefix("0x").unwrap_or(hex_str);
    let bytes = hex::decode(hex_str)
        .map_err(|e| StarknetRailError::InvalidInput(format!("invalid hex: {}", e)))?;

    if bytes.len() != 32 {
        return Err(StarknetRailError::InvalidInput(format!(
            "expected 32 bytes, got {}",
            bytes.len()
        )));
    }

    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

/// Verify that a holder binding matches expected inputs.
/// 
/// This recomputes the holder binding using the same algorithm as zkpf-mina
/// and verifies it matches the provided value.
pub fn verify_holder_binding(
    holder_id: &str,
    mina_digest: &[u8; 32],
    policy_id: u64,
    scope_id: u64,
    expected_binding: &[u8; 32],
) -> bool {
    use blake3::Hasher;
    
    let mut hasher = Hasher::new();
    hasher.update(b"mina_holder_binding_v1");
    hasher.update(holder_id.as_bytes());
    hasher.update(mina_digest);
    hasher.update(&policy_id.to_be_bytes());
    hasher.update(&scope_id.to_be_bytes());
    
    let computed = hasher.finalize();
    computed.as_bytes() == expected_binding
}

/// Compute a holder binding (for testing/verification purposes).
pub fn compute_holder_binding(
    holder_id: &str,
    mina_digest: &[u8; 32],
    policy_id: u64,
    scope_id: u64,
) -> [u8; 32] {
    use blake3::Hasher;
    
    let mut hasher = Hasher::new();
    hasher.update(b"mina_holder_binding_v1");
    hasher.update(holder_id.as_bytes());
    hasher.update(mina_digest);
    hasher.update(&policy_id.to_be_bytes());
    hasher.update(&scope_id.to_be_bytes());
    
    *hasher.finalize().as_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use zkpf_common::{ProofBundle, VerifierPublicInputs, CIRCUIT_VERSION};

    fn sample_mina_bundle() -> ProofBundle {
        ProofBundle {
            rail_id: RAIL_ID_MINA.to_string(),
            circuit_version: CIRCUIT_VERSION,
            proof: vec![0u8; 64],
            public_inputs: VerifierPublicInputs {
                threshold_raw: 1_000_000_000_000_000_000,
                required_currency_code: 1027,
                current_epoch: 1700000000,
                verifier_scope_id: 42,
                policy_id: 100,
                nullifier: [1u8; 32],
                custodian_pubkey_hash: [0u8; 32],
                snapshot_block_height: Some(500000), // mina_slot
                snapshot_anchor_orchard: Some([2u8; 32]), // mina_digest
                holder_binding: Some([3u8; 32]),
                proven_sum: Some(5_000_000_000_000_000_000),
            },
        }
    }

    #[test]
    fn test_source_rail_mask() {
        assert_eq!(source_rail_mask(SourceRails::CUSTODIAL), 1);
        assert_eq!(source_rail_mask(SourceRails::ORCHARD), 2);
        assert_eq!(source_rail_mask(SourceRails::STARKNET_L2), 4);
        assert_eq!(source_rail_mask(SourceRails::MINA_NATIVE), 8);
    }

    #[test]
    fn test_combine_source_rails() {
        let mask = combine_source_rails(&[SourceRails::STARKNET_L2, SourceRails::ORCHARD]);
        assert_eq!(mask, 6); // 4 + 2
    }

    #[test]
    fn test_from_mina_bundle() {
        let bundle = sample_mina_bundle();
        let inputs = MinaPublicInputs::from_mina_bundle(&bundle).expect("should succeed");

        assert_eq!(inputs.mina_digest, [2u8; 32]);
        assert_eq!(inputs.holder_binding, [3u8; 32]);
        assert_eq!(inputs.policy_id, 100);
        assert_eq!(inputs.mina_slot, 500000);
    }

    #[test]
    fn test_from_mina_bundle_wrong_rail() {
        let mut bundle = sample_mina_bundle();
        bundle.rail_id = "STARKNET_L2".to_string();

        let result = MinaPublicInputs::from_mina_bundle(&bundle);
        assert!(result.is_err());
    }

    #[test]
    fn test_builder() {
        let inputs = MinaPublicInputsBuilder::new()
            .mina_digest([1u8; 32])
            .holder_binding([2u8; 32])
            .policy_id(100)
            .current_epoch(1700000000)
            .verifier_scope_id(42)
            .mina_slot(500000)
            .nullifier([3u8; 32])
            .threshold(1_000_000)
            .build()
            .expect("should succeed");

        assert_eq!(inputs.policy_id, 100);
        assert_eq!(inputs.mina_slot, 500000);
    }

    #[test]
    fn test_builder_missing_required() {
        let result = MinaPublicInputsBuilder::new()
            .mina_digest([1u8; 32])
            .build();

        assert!(result.is_err());
    }

    #[test]
    fn test_attestation_source_rails() {
        let attestation = MinaAttestation {
            mina_digest: "0x01".to_string(),
            holder_binding: "0x02".to_string(),
            policy_id: 100,
            epoch: 1700000000,
            mina_slot: 500000,
            expires_at_slot: 507200,
            source_rails_mask: 6, // ORCHARD + STARKNET_L2
            bridged_at: 1700001000,
            relayer: "0x123".to_string(),
            is_valid: true,
        };

        assert!(!attestation.has_source_rail(SourceRails::CUSTODIAL));
        assert!(attestation.has_source_rail(SourceRails::ORCHARD));
        assert!(attestation.has_source_rail(SourceRails::STARKNET_L2));
        assert!(!attestation.has_source_rail(SourceRails::MINA_NATIVE));

        let names = attestation.source_rail_names();
        assert_eq!(names, vec!["ORCHARD", "STARKNET_L2"]);
    }

    #[test]
    fn test_to_calldata() {
        let inputs = MinaPublicInputs {
            mina_digest: [1u8; 32],
            holder_binding: [2u8; 32],
            policy_id: 100,
            current_epoch: 1700000000,
            verifier_scope_id: 42,
            mina_slot: 500000,
            nullifier: [3u8; 32],
            threshold: Some(1_000_000),
            currency_code: Some(1027),
        };

        let calldata = inputs.to_calldata(7200, 4);
        assert_eq!(calldata.len(), 11);
        assert_eq!(calldata[2], "100"); // policy_id
        assert_eq!(calldata[9], "7200"); // validity_window
        assert_eq!(calldata[10], "4"); // source_rails_mask
    }

    #[test]
    fn test_holder_binding_verification() {
        let holder_id = "test-holder";
        let mina_digest = [1u8; 32];
        let policy_id = 100u64;
        let scope_id = 42u64;

        let binding = compute_holder_binding(holder_id, &mina_digest, policy_id, scope_id);
        
        assert!(verify_holder_binding(
            holder_id,
            &mina_digest,
            policy_id,
            scope_id,
            &binding
        ));

        // Wrong holder_id should fail
        assert!(!verify_holder_binding(
            "wrong-holder",
            &mina_digest,
            policy_id,
            scope_id,
            &binding
        ));
    }

    #[test]
    fn test_parse_hex_32() {
        let hex = "0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
        let bytes = parse_hex_32(hex).unwrap();
        assert_eq!(bytes[0], 0x01);
        assert_eq!(bytes[31], 0x20);

        // Without prefix
        let hex_no_prefix = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
        let bytes2 = parse_hex_32(hex_no_prefix).unwrap();
        assert_eq!(bytes, bytes2);

        // Wrong length
        assert!(parse_hex_32("0x0102").is_err());
    }
}

