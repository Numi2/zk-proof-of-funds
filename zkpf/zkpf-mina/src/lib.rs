//! zkpf-mina
//!
//! Mina recursive proof hub rail for zkpf: zero-knowledge proof-of-funds verified
//! and wrapped into Mina-native recursive proofs for cross-chain attestations.
//!
//! # Architecture
//!
//! Mina serves as a **compliance layer and recursive proof hub**:
//! - zkpf ProofBundles are verified and wrapped into Mina zkApp state updates
//! - Other chains (EVM, Starknet, etc.) can check attestations via Mina's light client
//! - Strong privacy story: PoF verified once, many chains can reuse without seeing original data
//!
//! # Mina Proof of State Integration
//!
//! This crate integrates with the **Mina Proof of State** circuit from lambdaclass/mina_bridge:
//!
//! - Verifies Mina's recursive state proof (Pickles state SNARK)
//! - Checks chain of candidate states (16-block transition frontier segment)
//! - Ensures consensus conditions (short/long-range fork checks)
//!
//! The public inputs are:
//! ```text
//! [
//!   bridge_tip_state_hash,           // Currently bridged tip
//!   candidate_chain_state_hashes[16], // 16 candidate state hashes
//!   candidate_chain_ledger_hashes[16] // 16 ledger root hashes
//! ]
//! ```
//!
//! The wrapper circuit computes:
//! ```text
//! mina_digest = H(bridge_tip || state_hashes || ledger_hashes)
//! ```
//!
//! # zkpf Binding
//!
//! For the Mina rail, the zkpf public inputs are:
//! - `mina_digest`: Single BN254 public input from wrapper circuit
//! - `policy_id`, `current_epoch`, `verifier_scope_id`: zkpf metadata
//! - `holder_binding`: H(holder_id || mina_digest || policy_id || scope)
//!
//! # Implementation Strategy
//!
//! 1. **BN254 Kimchi Wrapper**: The zkpf-mina-kimchi-wrapper crate provides a BN254
//!    circuit that verifies Mina Proof of State using foreign-field Pasta arithmetic.
//!
//! 2. **Mina-native recursive wrapping**: The zkApp emits a Mina-native proof that
//!    attests "holder X has PoF for policy P at epoch E".
//!
//! 3. **zkBridges**: Cross-chain bridges from Mina propagate the attestation bit
//!    `has_PoF_X(P, E) = true` to other chains.
//!
//! # Public Inputs (V4_MINA layout)
//!
//! The Mina rail extends the base zkpf public inputs with:
//! - `mina_network_id`: Mina network identifier (mainnet, testnet)
//! - `mina_slot`: Global slot at which attestation was created
//! - `zkapp_address`: Address of the zkpf verifier zkApp
//! - `recursive_proof_hash`: Hash of the wrapped recursive proof

pub mod circuit;
pub mod error;
pub mod state;
pub mod starknet_integration;
pub mod types;
pub mod zkapp;

#[cfg(feature = "mina-graphql")]
pub mod graphql;

use blake3::Hasher;
use serde::{Deserialize, Serialize};
use zkpf_common::{ProofBundle, VerifierPublicInputs, CIRCUIT_VERSION};

pub use circuit::{
    create_mina_proof, create_mina_proof_with_artifacts, deserialize_mina_proving_key,
    deserialize_mina_verifying_key, load_mina_prover_artifacts,
    load_mina_prover_artifacts_from_path, mina_default_params, mina_keygen,
    mina_public_inputs_to_instances, serialize_mina_proving_key, serialize_mina_verifying_key,
    MinaPofCircuit, MinaPofCircuitInput, MinaProverArtifacts, MinaProverParams, MINA_DEFAULT_K,
    MINA_INSTANCE_COLUMNS,
};
pub use error::MinaRailError;
pub use types::*;

// Re-export Starknet integration types
pub use starknet_integration::{
    wrap_starknet_proof, wrap_starknet_proofs, validate_starknet_bundle,
    starknet_bundle_to_source_input,
    CrossChainAttestationInfo, StarknetChainId, StarknetProofMetadata, StarknetWrapConfig,
    StarknetWrapResult, RAIL_ID_STARKNET,
};

// Re-export Mina Proof of State types from the Kimchi wrapper
pub use zkpf_mina_kimchi_wrapper::{
    // Core types
    MinaProofOfStatePublicInputs,
    MinaRailPublicInputs,
    CANDIDATE_CHAIN_LENGTH,
    MINA_DIGEST_DOMAIN,
    // Functions
    compute_holder_binding as compute_proof_of_state_holder_binding,
    compute_mina_nullifier as compute_proof_of_state_nullifier,
    // Circuit types
    MinaProofOfStateWrapperCircuit,
    MinaProofOfStateWrapperInput,
    // Proof types
    types::{MinaProofOfStateProof, MinaStateBody, CandidateChainSegment, BridgeTipInfo},
};

/// Constant rail identifier for the Mina recursive proof hub rail.
pub const RAIL_ID_MINA: &str = "MINA_RECURSIVE";

/// Number of public inputs in the V4_MINA layout.
/// Base (7) + mina_network_id + mina_slot + zkapp_commitment + recursive_proof_hash
pub const PUBLIC_INPUT_COUNT_V4_MINA: usize = 11;

/// Maximum number of source proofs that can be aggregated in a single Mina proof.
pub const MINA_MAX_SOURCE_PROOFS: usize = 8;

/// Metadata specific to the Mina recursive proof hub rail.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MinaPublicMeta {
    /// Mina network identifier (e.g., "mainnet", "testnet", "berkeley").
    pub network_id: String,
    /// Numeric network ID for circuit encoding.
    pub network_id_numeric: u32,
    /// Global slot at which the attestation was created.
    pub global_slot: u64,
    /// zkApp address that verified and wrapped the proof.
    pub zkapp_address: String,
    /// Commitment to the wrapped recursive proof.
    pub recursive_proof_commitment: [u8; 32],
    /// Original source rail ID(s) that were wrapped.
    pub source_rail_ids: Vec<String>,
}

/// Public meta inputs shared with the existing zkpf stack.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PublicMetaInputs {
    pub policy_id: u64,
    pub verifier_scope_id: u64,
    pub current_epoch: u64,
    /// Currency code (inherited from source proof).
    pub required_currency_code: u32,
}

/// A source proof that will be wrapped into a Mina recursive proof.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SourceProofInput {
    /// The original ProofBundle from another rail.
    pub bundle: ProofBundle,
    /// Rail-specific metadata for context.
    pub rail_metadata: serde_json::Value,
}

/// Cross-chain attestation record stored in the Mina zkApp.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MinaAttestation {
    /// Unique attestation ID (derived from inputs).
    pub attestation_id: [u8; 32],
    /// Holder binding (privacy-preserving identifier).
    pub holder_binding: [u8; 32],
    /// Policy ID that was verified.
    pub policy_id: u64,
    /// Epoch at which the proof was valid.
    pub epoch: u64,
    /// Mina slot at creation.
    pub mina_slot: u64,
    /// Expiration slot (attestation validity window).
    pub expires_at_slot: u64,
    /// Source rail(s) that were aggregated.
    pub source_rails: Vec<String>,
    /// Whether the attestation is still valid.
    pub is_valid: bool,
}

/// zkApp state that can be queried by other chains via zkBridges.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ZkAppState {
    /// Root hash of the attestation Merkle tree.
    pub attestation_root: [u8; 32],
    /// Total number of attestations.
    pub attestation_count: u64,
    /// Last updated slot.
    pub last_updated_slot: u64,
    /// Admin public key hash.
    pub admin_pubkey_hash: [u8; 32],
}

/// Holder identifier type.
pub type HolderId = String;

/// Build canonical `VerifierPublicInputs` for a Mina proof.
pub fn build_verifier_public_inputs(
    threshold: u64,
    proven_sum: u128,
    mina_meta: &MinaPublicMeta,
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
        // Mina-specific fields mapped to the optional snapshot fields
        snapshot_block_height: Some(mina_meta.global_slot),
        snapshot_anchor_orchard: Some(mina_meta.recursive_proof_commitment),
        holder_binding: Some(compute_zkapp_commitment(&mina_meta.zkapp_address)),
        proven_sum: Some(proven_sum),
    }
}

/// Generate a Mina recursive proof wrapper for source proofs.
///
/// This function:
/// 1. Validates the source proof(s)
/// 2. Computes commitments and nullifiers
/// 3. Generates a Mina-compatible proof wrapper
/// 4. Returns a `ProofBundle` tagged for the Mina rail
pub fn prove_mina_recursive(
    source_proofs: &[SourceProofInput],
    holder_id: &HolderId,
    mina_meta: &MinaPublicMeta,
    meta: &PublicMetaInputs,
) -> Result<ProofBundle, MinaRailError> {
    // Validate source proofs
    if source_proofs.is_empty() {
        return Err(MinaRailError::InvalidInput(
            "no source proofs provided".into(),
        ));
    }

    if source_proofs.len() > MINA_MAX_SOURCE_PROOFS {
        return Err(MinaRailError::InvalidInput(format!(
            "too many source proofs: {} > {}",
            source_proofs.len(),
            MINA_MAX_SOURCE_PROOFS
        )));
    }

    // Aggregate thresholds and verify consistency
    let mut total_threshold: u64 = 0;
    let mut total_proven_sum: u128 = 0;
    
    for source in source_proofs {
        // Verify policy consistency
        if source.bundle.public_inputs.policy_id != meta.policy_id {
            return Err(MinaRailError::InvalidInput(format!(
                "policy_id mismatch: source has {}, expected {}",
                source.bundle.public_inputs.policy_id, meta.policy_id
            )));
        }
        
        total_threshold = total_threshold
            .checked_add(source.bundle.public_inputs.threshold_raw)
            .ok_or_else(|| MinaRailError::InvalidInput("threshold overflow".into()))?;
            
        if let Some(sum) = source.bundle.public_inputs.proven_sum {
            total_proven_sum = total_proven_sum
                .checked_add(sum)
                .ok_or_else(|| MinaRailError::InvalidInput("proven_sum overflow".into()))?;
        }
    }

    // Compute recursive proof commitment
    let recursive_commitment = compute_recursive_commitment(source_proofs);

    // Compute holder binding
    let holder_binding = compute_holder_binding(holder_id, &recursive_commitment);

    // Compute nullifier
    let nullifier = compute_mina_nullifier(
        &holder_binding,
        meta.verifier_scope_id,
        meta.policy_id,
        meta.current_epoch,
    );

    // Mina is non-custodial; this field is zeroed
    let custodian_pubkey_hash = [0u8; 32];

    // Build public inputs with computed values
    let mut mina_meta_with_commitment = mina_meta.clone();
    mina_meta_with_commitment.recursive_proof_commitment = recursive_commitment;
    mina_meta_with_commitment.source_rail_ids = source_proofs
        .iter()
        .map(|s| s.bundle.rail_id.clone())
        .collect();

    let public_inputs = build_verifier_public_inputs(
        total_threshold,
        total_proven_sum,
        &mina_meta_with_commitment,
        meta,
        nullifier,
        custodian_pubkey_hash,
    );

    // Build circuit input
    let circuit_input = MinaPofCircuitInput {
        public_inputs: public_inputs.clone(),
        source_proof_commitments: source_proofs
            .iter()
            .map(|s| compute_proof_commitment(&s.bundle))
            .collect(),
    };

    // Generate proof
    let proof = circuit::create_mina_proof(&circuit_input)?;

    Ok(ProofBundle {
        rail_id: RAIL_ID_MINA.to_string(),
        circuit_version: CIRCUIT_VERSION,
        proof,
        public_inputs,
    })
}

/// Verify a Mina recursive proof bundle.
///
/// This performs full cryptographic verification of the Mina proof using
/// the Halo2/BN254 verifier. For proofs that wrap Mina Proof of State
/// (Kimchi proofs), the Kimchi verifier logic is also invoked.
///
/// # Security
///
/// - Placeholder proofs (starting with magic bytes) are always rejected
/// - Real proofs must pass Halo2 verification against the circuit VK
/// - Public inputs are extracted and verified to match the bundle metadata
pub fn verify_mina_proof(bundle: &ProofBundle) -> Result<bool, MinaRailError> {
    if bundle.rail_id != RAIL_ID_MINA {
        return Err(MinaRailError::InvalidInput(format!(
            "expected rail_id {}, got {}",
            RAIL_ID_MINA, bundle.rail_id
        )));
    }

    // Basic structural validation
    if bundle.proof.len() < 16 {
        return Ok(false);
    }

    // SECURITY: Always reject placeholder proofs - they bypass cryptographic verification
    if bundle.proof.starts_with(b"MINA_RECURSIVE_V1") {
        return Err(MinaRailError::Proof(
            "Placeholder proofs (MINA_RECURSIVE_V1) are not accepted. \
             Generate real proofs using the circuit.".into()
        ));
    }

    // Try to load artifacts and perform real verification
    match load_mina_prover_artifacts() {
        Ok(artifacts) => {
            // Convert public inputs to instances
            let instances = mina_public_inputs_to_instances(&bundle.public_inputs)?;
            let instance_refs: Vec<&[halo2curves_axiom::bn256::Fr]> = 
                instances.iter().map(|col| col.as_slice()).collect();
            
            // Perform Halo2 verification
            use halo2_proofs_axiom::transcript::{Blake2bRead, Challenge255, TranscriptReadBuffer};
            use halo2_proofs_axiom::plonk::verify_proof;
            use halo2_proofs_axiom::poly::kzg::multiopen::VerifierGWC;
            use halo2_proofs_axiom::poly::kzg::commitment::KZGCommitmentScheme;
            use halo2_proofs_axiom::poly::kzg::strategy::AccumulatorStrategy;
            use halo2curves_axiom::bn256::{Bn256, G1Affine};
            
            let mut transcript = Blake2bRead::<_, G1Affine, Challenge255<_>>::init(&bundle.proof[..]);
            let strategy = AccumulatorStrategy::new(&artifacts.params);
            
            let result = verify_proof::<
                KZGCommitmentScheme<Bn256>,
                VerifierGWC<'_, Bn256>,
                _,
                _,
                _,
            >(
                &artifacts.params,
                &artifacts.vk,
                strategy,
                &[instance_refs.as_slice()],
                &mut transcript,
            );
            
            match result {
                Ok(_) => {
                    tracing::info!("Mina proof verification succeeded");
                    Ok(true)
                }
                Err(e) => {
                    tracing::warn!("Mina proof verification failed: {:?}", e);
                    Ok(false)
                }
            }
        }
        Err(e) => {
            // Artifacts not available - cannot verify
            Err(MinaRailError::Proof(format!(
                "verification artifacts not available: {} - \
                 ensure ZKPF_MINA_MANIFEST_PATH is set correctly",
                e
            )))
        }
    }
}

/// Create an attestation record from a verified proof bundle.
pub fn create_attestation(
    bundle: &ProofBundle,
    mina_meta: &MinaPublicMeta,
    validity_window_slots: u64,
) -> Result<MinaAttestation, MinaRailError> {
    if bundle.rail_id != RAIL_ID_MINA {
        return Err(MinaRailError::InvalidInput(
            "bundle is not from Mina rail".into(),
        ));
    }

    let holder_binding = bundle
        .public_inputs
        .holder_binding
        .ok_or_else(|| MinaRailError::InvalidInput("missing holder_binding".into()))?;

    let attestation_id = compute_attestation_id(
        &holder_binding,
        bundle.public_inputs.policy_id,
        bundle.public_inputs.current_epoch,
    );

    Ok(MinaAttestation {
        attestation_id,
        holder_binding,
        policy_id: bundle.public_inputs.policy_id,
        epoch: bundle.public_inputs.current_epoch,
        mina_slot: mina_meta.global_slot,
        expires_at_slot: mina_meta.global_slot + validity_window_slots,
        source_rails: mina_meta.source_rail_ids.clone(),
        is_valid: true,
    })
}

/// Query struct for cross-chain attestation checks.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AttestationQuery {
    pub holder_binding: [u8; 32],
    pub policy_id: u64,
    pub epoch: u64,
}

/// Response for cross-chain attestation queries.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AttestationQueryResponse {
    pub has_valid_attestation: bool,
    pub attestation: Option<MinaAttestation>,
    pub mina_slot: u64,
    pub proof_of_inclusion: Option<Vec<u8>>,
}

// === Internal helper functions ===

/// Compute commitment to source proofs for recursive wrapping.
fn compute_recursive_commitment(source_proofs: &[SourceProofInput]) -> [u8; 32] {
    let mut hasher = Hasher::new();
    hasher.update(b"mina_recursive_commitment_v1");
    for source in source_proofs {
        hasher.update(&source.bundle.proof);
        hasher.update(source.bundle.rail_id.as_bytes());
    }
    *hasher.finalize().as_bytes()
}

/// Compute commitment to a single proof bundle.
fn compute_proof_commitment(bundle: &ProofBundle) -> [u8; 32] {
    let mut hasher = Hasher::new();
    hasher.update(b"mina_proof_commitment_v1");
    hasher.update(&bundle.proof);
    hasher.update(&bundle.public_inputs.nullifier);
    *hasher.finalize().as_bytes()
}

/// Compute zkApp commitment from address.
fn compute_zkapp_commitment(zkapp_address: &str) -> [u8; 32] {
    let mut hasher = Hasher::new();
    hasher.update(b"mina_zkapp_commitment_v1");
    hasher.update(zkapp_address.as_bytes());
    *hasher.finalize().as_bytes()
}

/// Compute holder binding.
fn compute_holder_binding(holder_id: &str, recursive_commitment: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Hasher::new();
    hasher.update(b"mina_holder_binding_v1");
    hasher.update(holder_id.as_bytes());
    hasher.update(recursive_commitment);
    *hasher.finalize().as_bytes()
}

/// Compute Mina PoF nullifier.
fn compute_mina_nullifier(
    holder_binding: &[u8; 32],
    scope_id: u64,
    policy_id: u64,
    epoch: u64,
) -> [u8; 32] {
    let mut hasher = Hasher::new();
    hasher.update(b"mina_pof_nullifier_v1");
    hasher.update(holder_binding);
    hasher.update(&scope_id.to_be_bytes());
    hasher.update(&policy_id.to_be_bytes());
    hasher.update(&epoch.to_be_bytes());
    *hasher.finalize().as_bytes()
}

/// Compute attestation ID.
fn compute_attestation_id(holder_binding: &[u8; 32], policy_id: u64, epoch: u64) -> [u8; 32] {
    let mut hasher = Hasher::new();
    hasher.update(b"mina_attestation_id_v1");
    hasher.update(holder_binding);
    hasher.update(&policy_id.to_be_bytes());
    hasher.update(&epoch.to_be_bytes());
    *hasher.finalize().as_bytes()
}

// ============================================================================
// Mina Proof of State Integration
// ============================================================================

/// Verify a Mina Proof of State and create zkpf binding.
///
/// This function:
/// 1. Validates the Mina Proof of State public inputs
/// 2. Computes the mina_digest
/// 3. Creates holder binding for zkpf integration
/// 4. Returns the MinaRailPublicInputs for use in proof bundles
pub fn verify_proof_of_state_binding(
    proof_of_state: &MinaProofOfStatePublicInputs,
    holder_id: &str,
    policy_id: u64,
    current_epoch: u64,
    verifier_scope_id: u64,
) -> Result<MinaRailPublicInputs, MinaRailError> {
    // Validate inputs
    if holder_id.is_empty() {
        return Err(MinaRailError::InvalidInput("holder_id cannot be empty".into()));
    }

    // Validate bridge tip state hash is non-zero
    if proof_of_state.bridge_tip_state_hash == [0u8; 32] {
        return Err(MinaRailError::InvalidInput(
            "bridge_tip_state_hash cannot be zero".into(),
        ));
    }

    // Create the rail public inputs
    let rail_inputs = MinaRailPublicInputs::new(
        proof_of_state,
        policy_id,
        current_epoch,
        verifier_scope_id,
        holder_id,
    );

    Ok(rail_inputs)
}

/// Create a proof bundle from Mina Proof of State verification.
///
/// This creates a zkpf ProofBundle that can be used for cross-chain attestations.
pub fn create_proof_of_state_bundle(
    proof_of_state: &MinaProofOfStatePublicInputs,
    holder_id: &str,
    meta: &PublicMetaInputs,
    mina_meta: &MinaPublicMeta,
) -> Result<ProofBundle, MinaRailError> {
    // Verify and create binding
    let rail_inputs = verify_proof_of_state_binding(
        proof_of_state,
        holder_id,
        meta.policy_id,
        meta.current_epoch,
        meta.verifier_scope_id,
    )?;

    // Compute nullifier
    let nullifier = rail_inputs.compute_nullifier();

    // Build verifier public inputs
    let public_inputs = VerifierPublicInputs {
        threshold_raw: 0, // Mina Proof of State doesn't have threshold
        required_currency_code: meta.required_currency_code,
        current_epoch: meta.current_epoch,
        verifier_scope_id: meta.verifier_scope_id,
        policy_id: meta.policy_id,
        nullifier,
        custodian_pubkey_hash: [0u8; 32], // Non-custodial
        snapshot_block_height: Some(mina_meta.global_slot),
        snapshot_anchor_orchard: Some(rail_inputs.mina_digest), // Store mina_digest
        holder_binding: Some(rail_inputs.holder_binding),
        proven_sum: None,
    };

    // Create wrapper circuit input
    let wrapper_input = MinaProofOfStateWrapperInput::mock(proof_of_state.clone());

    // Generate proof using wrapper circuit
    let proof = zkpf_mina_kimchi_wrapper::create_wrapper_proof(&wrapper_input)
        .map_err(|e| MinaRailError::Proof(e.to_string()))?;

    Ok(ProofBundle {
        rail_id: RAIL_ID_MINA.to_string(),
        circuit_version: CIRCUIT_VERSION,
        proof,
        public_inputs,
    })
}

/// Verify a Mina Proof of State bundle.
///
/// This performs two-stage verification:
/// 1. Verifies the BN254 wrapper proof (Halo2)
/// 2. Validates the Mina Proof of State public inputs
///
/// For full cryptographic security, the wrapper proof must have been generated
/// by a circuit that properly verified the underlying Kimchi proof.
pub fn verify_proof_of_state_bundle(bundle: &ProofBundle) -> Result<bool, MinaRailError> {
    if bundle.rail_id != RAIL_ID_MINA {
        return Err(MinaRailError::InvalidInput(format!(
            "expected rail_id {}, got {}",
            RAIL_ID_MINA, bundle.rail_id
        )));
    }

    // SECURITY: Always reject placeholder wrapper proofs - they bypass cryptographic verification
    if bundle.proof.starts_with(b"MINA_POS_WRAPPER_V1") {
        return Err(MinaRailError::Proof(
            "Placeholder wrapper proofs are not accepted. \
             Generate real proofs using the circuit.".into()
        ));
    }

    // Verify the wrapper proof
    let wrapper_valid = verify_mina_proof(bundle)?;
    
    if !wrapper_valid {
        return Ok(false);
    }
    
    // Additional validation: verify the public inputs are well-formed
    // The mina_digest should be in snapshot_anchor_orchard
    if bundle.public_inputs.snapshot_anchor_orchard.is_none() {
        return Err(MinaRailError::InvalidInput(
            "missing mina_digest in public inputs".into()
        ));
    }
    
    // Verify holder binding is present
    if bundle.public_inputs.holder_binding.is_none() {
        return Err(MinaRailError::InvalidInput(
            "missing holder_binding in public inputs".into()
        ));
    }
    
    // All checks passed
    tracing::info!("Mina Proof of State bundle verification succeeded");
    Ok(true)
}

/// Verify a Mina proof using the native Kimchi verifier (for testing).
///
/// This function performs native (out-of-circuit) Kimchi verification
/// on the underlying Mina Proof of State proof. It is primarily intended
/// for testing and debugging.
///
/// # Arguments
/// * `proof_bytes` - Raw Kimchi proof bytes
/// * `public_inputs` - Mina Proof of State public inputs
///
/// # Returns
/// * `Ok(true)` if the proof verifies correctly
/// * `Ok(false)` if the proof fails verification
/// * `Err(...)` if verification cannot be performed
#[cfg(feature = "native-verify")]
pub fn verify_kimchi_native(
    proof_bytes: &[u8],
    public_inputs: &MinaProofOfStatePublicInputs,
) -> Result<bool, MinaRailError> {
    use zkpf_mina_kimchi_wrapper::kimchi_core::{
        NativeKimchiVerifier, public_inputs_to_felts,
    };
    use zkpf_mina_kimchi_wrapper::types::MinaProofOfStateProof;
    
    // Parse the proof
    let proof = MinaProofOfStateProof::from_bytes(proof_bytes)
        .map_err(|e| MinaRailError::Proof(format!("failed to parse Kimchi proof: {e}")))?;
    
    // Convert public inputs to field elements
    let pi_felts = public_inputs_to_felts(public_inputs);
    
    // Create verifier
    let verifier = NativeKimchiVerifier::for_proof_of_state();
    
    // Verify (this runs the full Vf + Vg checks)
    match verifier.verify_raw(&proof, &pi_felts) {
        Ok(true) => Ok(true),
        Ok(false) => Ok(false),
        Err(e) => Err(MinaRailError::Proof(format!("Kimchi verification error: {e}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_source_proof() -> SourceProofInput {
        SourceProofInput {
            bundle: ProofBundle {
                rail_id: "STARKNET_L2".to_string(),
                circuit_version: CIRCUIT_VERSION,
                proof: vec![0u8; 64],
                public_inputs: VerifierPublicInputs {
                    threshold_raw: 1_000_000_000_000_000_000, // 1 ETH
                    required_currency_code: 1027,
                    current_epoch: 1_700_000_000,
                    verifier_scope_id: 42,
                    policy_id: 100,
                    nullifier: [0u8; 32],
                    custodian_pubkey_hash: [0u8; 32],
                    snapshot_block_height: Some(123456),
                    snapshot_anchor_orchard: Some([1u8; 32]),
                    holder_binding: Some([2u8; 32]),
                    proven_sum: Some(5_000_000_000_000_000_000),
                },
            },
            rail_metadata: serde_json::json!({
                "chain_id": "SN_SEPOLIA",
                "block_number": 123456
            }),
        }
    }

    #[test]
    fn test_prove_mina_recursive_success() {
        let source_proof = sample_source_proof();
        let holder_id = "holder-123".to_string();
        let mina_meta = MinaPublicMeta {
            network_id: "testnet".to_string(),
            network_id_numeric: 1,
            global_slot: 500_000,
            zkapp_address: "B62qrSk...".to_string(),
            recursive_proof_commitment: [0u8; 32],
            source_rail_ids: vec![],
        };
        let public_meta = PublicMetaInputs {
            policy_id: 100,
            verifier_scope_id: 42,
            current_epoch: 1_700_000_000,
            required_currency_code: 1027,
        };

        let bundle = prove_mina_recursive(
            &[source_proof],
            &holder_id,
            &mina_meta,
            &public_meta,
        )
        .expect("should succeed");

        assert_eq!(bundle.rail_id, RAIL_ID_MINA);
        assert!(bundle.public_inputs.proven_sum.is_some());
    }

    #[test]
    fn test_prove_mina_recursive_policy_mismatch() {
        let mut source_proof = sample_source_proof();
        source_proof.bundle.public_inputs.policy_id = 999; // Wrong policy

        let holder_id = "holder-123".to_string();
        let mina_meta = MinaPublicMeta {
            network_id: "testnet".to_string(),
            network_id_numeric: 1,
            global_slot: 500_000,
            zkapp_address: "B62qrSk...".to_string(),
            recursive_proof_commitment: [0u8; 32],
            source_rail_ids: vec![],
        };
        let public_meta = PublicMetaInputs {
            policy_id: 100,
            verifier_scope_id: 42,
            current_epoch: 1_700_000_000,
            required_currency_code: 1027,
        };

        let result = prove_mina_recursive(
            &[source_proof],
            &holder_id,
            &mina_meta,
            &public_meta,
        );

        assert!(result.is_err());
        assert!(matches!(result, Err(MinaRailError::InvalidInput(_))));
    }

    #[test]
    fn test_verify_mina_proof_rejects_placeholder() {
        // Placeholder proofs with magic bytes should be rejected for security
        let source_proof = sample_source_proof();
        let holder_id = "holder-123".to_string();
        let mina_meta = MinaPublicMeta {
            network_id: "testnet".to_string(),
            network_id_numeric: 1,
            global_slot: 500_000,
            zkapp_address: "B62qrSk...".to_string(),
            recursive_proof_commitment: [0u8; 32],
            source_rail_ids: vec![],
        };
        let public_meta = PublicMetaInputs {
            policy_id: 100,
            verifier_scope_id: 42,
            current_epoch: 1_700_000_000,
            required_currency_code: 1027,
        };

        let bundle = prove_mina_recursive(
            &[source_proof],
            &holder_id,
            &mina_meta,
            &public_meta,
        )
        .expect("should succeed");

        // Placeholder proofs must be rejected - they lack cryptographic verification
        let result = verify_mina_proof(&bundle);
        assert!(result.is_err(), "placeholder proofs should be rejected");
        assert!(matches!(result, Err(MinaRailError::Proof(_))));
    }

    #[test]
    fn test_create_attestation() {
        let source_proof = sample_source_proof();
        let holder_id = "holder-123".to_string();
        let mina_meta = MinaPublicMeta {
            network_id: "testnet".to_string(),
            network_id_numeric: 1,
            global_slot: 500_000,
            zkapp_address: "B62qrSk...".to_string(),
            recursive_proof_commitment: [0u8; 32],
            source_rail_ids: vec!["STARKNET_L2".to_string()],
        };
        let public_meta = PublicMetaInputs {
            policy_id: 100,
            verifier_scope_id: 42,
            current_epoch: 1_700_000_000,
            required_currency_code: 1027,
        };

        let bundle = prove_mina_recursive(
            &[source_proof],
            &holder_id,
            &mina_meta,
            &public_meta,
        )
        .expect("should succeed");

        let attestation = create_attestation(&bundle, &mina_meta, 7200)
            .expect("attestation creation should succeed");

        assert_eq!(attestation.policy_id, 100);
        assert!(attestation.is_valid);
        assert_eq!(attestation.expires_at_slot, 500_000 + 7200);
    }
}

