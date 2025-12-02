//! zkpf-zcash-orchard-circuit
//!
//! This crate defines the public API for the ZCASH_ORCHARD rail in the zkpf stack
//! and a minimal **bn256 wrapper circuit** used to prove Orchard-style
//! proof-of-funds statements.
//!
//! The current circuit focuses on:
//! - enforcing that the sum of private Orchard note values is >= the public threshold,
//! - exposing Orchard snapshot metadata (height, anchor, holder binding) as public inputs,
//! - wiring into the shared `ProofBundle` / artifact tooling used by the backend.
//!
//! It does **not** reimplement the full Orchard protocol inside bn256 (note
//! commitment hash, Orchard Merkle tree, UFVK ownership). The canonical
//! Orchard PoF semantics live in a separate Pasta-field circuit that uses the
//! official Orchard gadgets; this crate is intended to act as a wrapper around
//! that inner circuit (via recursion) for environments that require bn256/EVM
//! compatibility.

use std::{
    cell::RefCell,
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::Context as _;
use anyhow::{ensure, Result};
use blake3::Hasher;
use halo2_base::{
    gates::{
        circuit::builder::BaseCircuitBuilder,
        circuit::{BaseCircuitParams, BaseConfig, CircuitBuilderStage},
        flex_gate::MultiPhaseThreadBreakPoints,
        range::RangeChip,
        GateInstructions, RangeInstructions,
    },
    AssignedValue, Context as Halo2Context,
};

/// Re-export breakpoints type for use by callers (keygen tools, WASM layer).
pub type OrchardBreakPoints = MultiPhaseThreadBreakPoints;
use halo2_proofs_axiom::transcript::TranscriptWriterBuffer;
use halo2_proofs_axiom::{
    circuit::{Layouter, SimpleFloorPlanner},
    plonk::{self, Circuit, ConstraintSystem, Error},
    SerdeFormat,
};
use halo2curves_axiom::bn256::{Bn256, Fr, G1Affine};
use once_cell::sync::Lazy;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use zkpf_circuit::gadgets::compare;
use zkpf_common::{
    deserialize_params, hash_bytes_hex, public_inputs_to_instances_with_layout, read_manifest,
    reduce_be_bytes_to_fr, ArtifactFile, ArtifactManifest, ProverArtifacts, PublicInputLayout,
    VerifierArtifacts, VerifierPublicInputs, CIRCUIT_VERSION, MANIFEST_VERSION,
};
use zkpf_orchard_inner::OrchardInnerPublicInputs;
use zkpf_zcash_orchard_wallet::{OrchardFvk, OrchardSnapshot};

// Re-export the shared `ProofBundle` type so downstream crates (e.g. WASM
// wrappers) can depend only on this crate for Orchard PoF bundles.
pub use zkpf_common::ProofBundle;

/// Constant rail identifier for the Orchard rail.
pub const RAIL_ID_ZCASH_ORCHARD: &str = "ZCASH_ORCHARD";

/// Metadata fields specific to the Zcash Orchard rail that are not yet part of
/// the global `VerifierPublicInputs` struct.
///
/// In a future circuit version these would likely be folded into the public-input
/// vector and/or serialized alongside `VerifierPublicInputs`.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OrchardPublicMeta {
    /// Chain identifier, e.g. "ZEC".
    pub chain_id: String,
    /// Pool identifier, e.g. "ORCHARD".
    pub pool_id: String,
    /// Height B at which the Orchard anchor was taken.
    pub block_height: u32,
    /// Orchard anchor (Merkle root) at height B.
    pub anchor_orchard: [u8; 32],
    /// Holder binding, e.g. H(holder_id || fvk_bytes).
    pub holder_binding: [u8; 32],
}

/// Aggregated error type for the Orchard rail circuit/prover wrapper.
#[derive(Debug, Error)]
pub enum OrchardRailError {
    /// Error coming from the Orchard wallet/snapshot builder.
    #[error("wallet error: {0}")]
    Wallet(String),

    /// Validation error in the inputs (e.g. threshold, snapshot height).
    #[error("invalid input: {0}")]
    InvalidInput(String),

    /// Placeholder while the actual circuit implementation is not yet wired.
    #[error("Orchard circuit not implemented")]
    NotImplemented,
}

impl From<zkpf_zcash_orchard_wallet::WalletError> for OrchardRailError {
    fn from(err: zkpf_zcash_orchard_wallet::WalletError) -> Self {
        OrchardRailError::Wallet(err.to_string())
    }
}

/// Holder identifier type; in practice this can be a UUID, hash of KYC record, etc.
pub type HolderId = String;

/// Public meta inputs that are shared with the existing zkpf stack (policy, scope, epoch).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PublicMetaInputs {
    pub policy_id: u64,
    pub verifier_scope_id: u64,
    pub current_epoch: u64,
    /// Currency code for ZEC in your policy catalog (e.g. ISO-4217-style numeric).
    pub required_currency_code: u32,
}

// === Orchard PoF Halo2 circuit ================================================================

/// Circuit size parameter k for the Orchard PoF circuit (2^k rows).
pub const ORCHARD_DEFAULT_K: usize = 19;
const ORCHARD_DEFAULT_LOOKUP_BITS: usize = 18;
const ORCHARD_DEFAULT_ADVICE_PER_PHASE: usize = 4;
const ORCHARD_DEFAULT_FIXED_COLUMNS: usize = 1;
const ORCHARD_DEFAULT_LOOKUP_ADVICE_PER_PHASE: usize = 1;
const ORCHARD_MAX_NOTES: usize = 16;

fn orchard_default_params() -> BaseCircuitParams {
    BaseCircuitParams {
        k: ORCHARD_DEFAULT_K,
        num_advice_per_phase: vec![ORCHARD_DEFAULT_ADVICE_PER_PHASE],
        num_fixed: ORCHARD_DEFAULT_FIXED_COLUMNS,
        num_lookup_advice_per_phase: vec![ORCHARD_DEFAULT_LOOKUP_ADVICE_PER_PHASE],
        lookup_bits: Some(ORCHARD_DEFAULT_LOOKUP_BITS),
        // V2_ORCHARD layout: 8 legacy fields + 3 Orchard snapshot fields.
        num_instance_columns: zkpf_common::PUBLIC_INPUT_COUNT_V2_ORCHARD,
    }
}

/// Private inputs to the Orchard PoF circuit: the public-input vector plus a bounded
/// set of Orchard note values whose sum must exceed the threshold.
#[derive(Clone, Debug)]
pub struct OrchardPofCircuitInput {
    pub public_inputs: VerifierPublicInputs,
    pub note_values: Vec<u64>,
}

#[derive(Clone, Debug)]
pub struct OrchardPofCircuit {
    pub input: Option<OrchardPofCircuitInput>,
    params: BaseCircuitParams,
    /// Circuit builder stage. Determines optimization level during synthesis:
    /// - `Keygen`: Used during proving key generation (no witness values)
    /// - `Prover`: Optimized for real proof generation (witness-gen only, skips constraints)
    /// - `Mock`: For MockProver tests (stores constraints for verification)
    stage: CircuitBuilderStage,
    /// Break points from keygen, required for Prover stage.
    /// These are computed during keygen and must be reused during proving
    /// for halo2-base circuits to correctly assign witnesses.
    break_points: Option<MultiPhaseThreadBreakPoints>,
    /// Break points computed during synthesize (for keygen/mock stages).
    /// Used with interior mutability so we can capture break_points from synthesize.
    computed_break_points: RefCell<Option<MultiPhaseThreadBreakPoints>>,
}

impl Default for OrchardPofCircuit {
    fn default() -> Self {
        Self {
            input: None,
            params: orchard_default_params(),
            stage: CircuitBuilderStage::Keygen,
            break_points: None,
            computed_break_points: RefCell::new(None),
        }
    }
}

impl OrchardPofCircuit {
    /// Creates a new circuit for MockProver testing.
    /// Use `new_prover` for production proof generation.
    pub fn new(input: Option<OrchardPofCircuitInput>) -> Self {
        let stage = if input.is_some() {
            CircuitBuilderStage::Mock
        } else {
            CircuitBuilderStage::Keygen
        };
        Self {
            input,
            params: orchard_default_params(),
            stage,
            break_points: None,
            computed_break_points: RefCell::new(None),
        }
    }

    /// Creates a circuit optimized for production proof generation with break points.
    /// 
    /// Uses `CircuitBuilderStage::Prover` which enables `witness_gen_only` mode,
    /// skipping constraint storage since constraints are already in the proving key.
    /// This provides better performance than `new()` which uses Mock stage.
    ///
    /// # Arguments
    /// * `input` - The circuit input with witness data
    /// * `break_points` - Break points from keygen (obtained via `extract_break_points_after_keygen`)
    ///
    /// # Important
    /// The `break_points` **must** be obtained from the keygen circuit after key generation.
    /// Without break points, the prover will panic with "break points not set".
    pub fn new_prover(input: OrchardPofCircuitInput, break_points: MultiPhaseThreadBreakPoints) -> Self {
        Self {
            input: Some(input),
            params: orchard_default_params(),
            stage: CircuitBuilderStage::Prover,
            break_points: Some(break_points),
            computed_break_points: RefCell::new(None),
        }
    }

    /// Extract break points after keygen for use in prover circuits.
    ///
    /// This runs a MockProver pass to compute the break_points that are needed
    /// for witness assignment in Prover mode. The break_points are determined by
    /// the circuit's thread layout during synthesis.
    ///
    /// # Returns
    /// Break points needed for proof generation.
    ///
    /// # Panics
    /// Panics if the circuit doesn't have sample input.
    pub fn extract_break_points_after_keygen(&self) -> MultiPhaseThreadBreakPoints {
        // First check if we already computed break_points (e.g., from a previous call)
        if let Some(bp) = self.computed_break_points.borrow().as_ref() {
            if !bp.is_empty() && !bp.iter().all(|v| v.is_empty()) {
                return bp.clone();
            }
        }
        
        // Need to compute break_points by running MockProver
        let input = self.input.as_ref().expect(
            "extract_break_points_after_keygen requires circuit to have sample input"
        );
        extract_break_points_from_synthesis(input, &self.params)
    }
}

impl Circuit<Fr> for OrchardPofCircuit {
    type Config = BaseConfig<Fr>;
    type FloorPlanner = SimpleFloorPlanner;
    type Params = BaseCircuitParams;

    fn params(&self) -> Self::Params {
        self.params.clone()
    }

    fn without_witnesses(&self) -> Self {
        Self {
            input: None,
            params: self.params.clone(),
            stage: CircuitBuilderStage::Keygen,
            break_points: None,
            computed_break_points: RefCell::new(None),
        }
    }

    fn configure_with_params(
        meta: &mut ConstraintSystem<Fr>,
        params: Self::Params,
    ) -> Self::Config {
        BaseConfig::configure(meta, params)
    }

    fn configure(_: &mut ConstraintSystem<Fr>) -> Self::Config {
        unreachable!("OrchardPofCircuit must be configured with explicit parameters")
    }

    fn synthesize(&self, config: Self::Config, layouter: impl Layouter<Fr>) -> Result<(), Error> {
        // Use the pre-configured stage:
        // - Keygen: Key generation phase, uses sample input with `unknown(true)`
        // - Mock: MockProver testing, stores constraints for verification  
        // - Prover: Production proving, `witness_gen_only(true)` for performance
        let input = self
            .input
            .as_ref()
            .expect("OrchardPofCircuit requires concrete input for synthesis");

        // Create builder based on whether we have break points
        let mut builder = if let Some(ref bp) = self.break_points {
            // Prover stage with cached break points - this is the critical path
            // that requires break points to be set for witness assignment
            BaseCircuitBuilder::<Fr>::prover(self.params.clone(), bp.clone())
                .use_instance_columns(self.params.num_instance_columns)
        } else {
            // Keygen or Mock stage - break points will be computed during assign_raw
            BaseCircuitBuilder::<Fr>::from_stage(self.stage)
                .use_params(self.params.clone())
                .use_instance_columns(self.params.num_instance_columns)
        };

        // Set lookup bits for both paths
        if let Some(bits) = self.params.lookup_bits {
            builder = builder.use_lookup_bits(bits);
        }

        build_orchard_constraints(&mut builder, input)?;
        
        // Run the inner synthesize which handles actual cell assignment.
        // For keygen/mock stages, this calculates break_points during assign_raw.
        let result = <BaseCircuitBuilder<Fr> as Circuit<Fr>>::synthesize(&builder, config, layouter);
        
        // After successful synthesis in keygen/mock mode, capture break_points.
        // These are needed for prover mode later.
        if result.is_ok() && self.break_points.is_none() {
            *self.computed_break_points.borrow_mut() = Some(builder.break_points());
        }
        
        result
    }
}

fn build_orchard_constraints(
    builder: &mut BaseCircuitBuilder<Fr>,
    input: &OrchardPofCircuitInput,
) -> Result<(), Error> {
    let range = builder.range_chip();
    let gate = range.gate();

    let pub_in = &input.public_inputs;
    let ctx = builder.main(0);

    // Core public fields (V1 prefix)
    let threshold = assign_u64(ctx, &range, pub_in.threshold_raw);
    let req_currency = assign_u32(ctx, &range, pub_in.required_currency_code);
    let current_epoch = assign_u64(ctx, &range, pub_in.current_epoch);
    let verifier_scope = assign_u64(ctx, &range, pub_in.verifier_scope_id);
    let policy_id = assign_u64(ctx, &range, pub_in.policy_id);

    // Nullifier and custodian_pubkey_hash are treated as opaque scalars; the rail
    // ensures their encoding via off-circuit hashing.
    let nullifier_fr =
        zkpf_common::fr_from_bytes(&pub_in.nullifier).map_err(|_| Error::Synthesis)?;
    let custodian_hash_fr =
        zkpf_common::fr_from_bytes(&pub_in.custodian_pubkey_hash).map_err(|_| Error::Synthesis)?;
    let public_nullifier = ctx.load_witness(nullifier_fr);
    let public_custodian_hash = ctx.load_witness(custodian_hash_fr);

    // Orchard-specific snapshot metadata.
    let snapshot_height = pub_in
        .snapshot_block_height
        .ok_or(Error::Synthesis)?;
    let snapshot_anchor_bytes = pub_in
        .snapshot_anchor_orchard
        .ok_or(Error::Synthesis)?;
    let holder_binding_bytes = pub_in.holder_binding.ok_or(Error::Synthesis)?;

    let snapshot_height_cell = assign_u64(ctx, &range, snapshot_height);
    let anchor_fr = reduce_be_bytes_to_fr(&snapshot_anchor_bytes);
    let holder_binding_fr = reduce_be_bytes_to_fr(&holder_binding_bytes);
    let anchor_cell = ctx.load_witness(anchor_fr);
    let holder_binding_cell = ctx.load_witness(holder_binding_fr);

    // Sum Orchard note values and enforce Σ v_i >= threshold.
    let mut sum = ctx.load_constant(Fr::zero());
    for (idx, value) in input.note_values.iter().enumerate() {
        if idx >= ORCHARD_MAX_NOTES {
            return Err(Error::Synthesis);
        }
        let note_val = assign_u64(ctx, &range, *value);
        sum = gate.add(ctx, sum, note_val);
    }
    compare::enforce_geq(ctx, gate, &range, sum, threshold);

    // Expose all public inputs in the V2_ORCHARD order expected by
    // `public_inputs_to_instances_with_layout`.
    expose_orchard_public_inputs(
        builder,
        [
            threshold,
            req_currency,
            current_epoch,
            verifier_scope,
            policy_id,
            public_nullifier,
            public_custodian_hash,
            snapshot_height_cell,
            anchor_cell,
            holder_binding_cell,
        ],
    );

    Ok(())
}

fn assign_u64(ctx: &mut Halo2Context<Fr>, range: &RangeChip<Fr>, value: u64) -> AssignedValue<Fr> {
    let cell = ctx.load_witness(Fr::from(value));
    range.range_check(ctx, cell, 64);
    cell
}

fn assign_u32(ctx: &mut Halo2Context<Fr>, range: &RangeChip<Fr>, value: u32) -> AssignedValue<Fr> {
    let cell = ctx.load_witness(Fr::from(value as u64));
    range.range_check(ctx, cell, 32);
    cell
}

fn expose_orchard_public_inputs(
    builder: &mut BaseCircuitBuilder<Fr>,
    values: [AssignedValue<Fr>; zkpf_common::PUBLIC_INPUT_COUNT_V2_ORCHARD],
) {
    for (idx, value) in values.into_iter().enumerate() {
        builder.assigned_instances[idx].push(value);
    }
}

/// Compute break points for a given circuit size k.
///
/// This is a public API for tools that need to regenerate break_points.json
/// without regenerating the full keygen artifacts.
///
/// For the Orchard circuit, break_points are deterministic based on the
/// circuit structure. The circuit has ~136 advice cells in phase 0, which
/// fits in a single column for any k >= 10.
///
/// # Arguments
/// * `k` - Circuit size parameter (2^k rows). Should match the k used for keygen.
///
/// # Returns
/// Break points needed for proof generation.
pub fn compute_break_points_for_k(k: u32) -> Result<MultiPhaseThreadBreakPoints> {
    use zkpf_common::VerifierPublicInputs;
    
    // Create sample input for computing break points
    let sample_input = OrchardPofCircuitInput {
        public_inputs: VerifierPublicInputs {
            threshold_raw: 0,
            required_currency_code: 0,
            current_epoch: 0,
            verifier_scope_id: 0,
            policy_id: 0,
            nullifier: [0u8; 32],
            custodian_pubkey_hash: [0u8; 32],
            snapshot_block_height: Some(0),
            snapshot_anchor_orchard: Some([0u8; 32]),
            holder_binding: Some([0u8; 32]),
            proven_sum: None,
        },
        note_values: vec![100u64],
    };
    
    // Create circuit params with the specified k
    let mut params = orchard_default_params();
    params.k = k as usize;
    
    // Build constraints in a fresh builder to compute thread layout
    let mut builder = BaseCircuitBuilder::<Fr>::from_stage(CircuitBuilderStage::Keygen)
        .use_params(params.clone())
        .use_instance_columns(params.num_instance_columns);
    
    if let Some(bits) = params.lookup_bits {
        builder = builder.use_lookup_bits(bits);
    }
    
    // Build the circuit constraints - this populates the thread layout
    build_orchard_constraints(&mut builder, &sample_input)
        .context("failed to build orchard constraints for break_points computation")?;
    
    // Calculate params to get accurate circuit statistics
    builder.calculate_params(Some(10)); // 10 reserved rows for blinding
    
    // Get thread statistics to compute break_points
    let stats = builder.statistics();
    
    // For the Orchard circuit, the thread layout is simple:
    // - Phase 0: One main thread with all the constraint operations
    // - The thread ends at the total number of advice cells
    // 
    // Since we have ~136 cells and 2^k rows (k >= 10), everything fits
    // in a single column. The break_point is where the thread ends.
    //
    // Format: Vec<Vec<usize>> where break_points[phase][column] = end_row
    // For single column: [[end_row]]
    let phase0_cells = stats.gate.total_advice_per_phase.first().copied().unwrap_or(0);
    
    // Break points indicate where each thread ends in each column.
    // For this simple circuit with one thread per phase, it's just the cell count.
    let break_points: MultiPhaseThreadBreakPoints = vec![vec![phase0_cells]];
    
    println!("Computed break_points from thread statistics: {:?}", break_points);
    
    Ok(break_points)
}

/// Extract break points by building circuit constraints.
///
/// This function builds the circuit in Keygen mode and computes break_points
/// based on the thread layout without running the full MockProver.
///
/// This is a fallback for when break_points.json is not available.
/// Production deployments should always use pre-computed break_points.
fn extract_break_points_from_synthesis(
    input: &OrchardPofCircuitInput,
    params: &BaseCircuitParams,
) -> MultiPhaseThreadBreakPoints {
    // Build constraints in a fresh builder to compute thread layout
    let mut builder = BaseCircuitBuilder::<Fr>::from_stage(CircuitBuilderStage::Keygen)
        .use_params(params.clone())
        .use_instance_columns(params.num_instance_columns);
    
    if let Some(bits) = params.lookup_bits {
        builder = builder.use_lookup_bits(bits);
    }
    
    // Build the circuit constraints - this populates the thread layout
    build_orchard_constraints(&mut builder, input)
        .expect("failed to build orchard constraints for break_points extraction");
    
    // Calculate params to get accurate circuit statistics
    builder.calculate_params(Some(10)); // 10 reserved rows for blinding
    
    // Get thread statistics to compute break_points
    let stats = builder.statistics();
    let phase0_cells = stats.gate.total_advice_per_phase.first().copied().unwrap_or(0);
    
    // Break points indicate where each thread ends.
    // For this simple circuit with one thread per phase, it's just the cell count.
    vec![vec![phase0_cells]]
}

/// Serialize break points to bytes for storage.
///
/// The format is JSON for simplicity and debuggability.
pub fn serialize_break_points(break_points: &MultiPhaseThreadBreakPoints) -> Result<Vec<u8>> {
    serde_json::to_vec(break_points).context("failed to serialize break points")
}

/// Deserialize break points from bytes.
pub fn deserialize_break_points(bytes: &[u8]) -> Result<MultiPhaseThreadBreakPoints> {
    serde_json::from_slice(bytes).context("failed to deserialize break points")
}

/// Convenience function for computing the canonical `VerifierPublicInputs` for an Orchard
/// proof-of-funds statement, given the Orchard-specific meta and threshold.
///
/// This encodes both the **legacy** public-input prefix (threshold, policy, scope, nullifier)
/// and the Orchard-specific snapshot metadata (block height, anchor, holder binding) that
/// V2_ORCHARD rails expect.
pub fn build_verifier_public_inputs(
    threshold_zats: u64,
    orchard_meta: &OrchardPublicMeta,
    meta: &PublicMetaInputs,
    nullifier: [u8; 32],
    custodian_pubkey_hash: [u8; 32],
) -> VerifierPublicInputs {
    let mut inputs = VerifierPublicInputs {
        threshold_raw: threshold_zats,
        required_currency_code: meta.required_currency_code,
        current_epoch: meta.current_epoch,
        verifier_scope_id: meta.verifier_scope_id,
        policy_id: meta.policy_id,
        nullifier,
        custodian_pubkey_hash,
        snapshot_block_height: None,
        snapshot_anchor_orchard: None,
        holder_binding: None,
        proven_sum: None,
    };

    inputs.snapshot_block_height = Some(orchard_meta.block_height as u64);
    inputs.snapshot_anchor_orchard = Some(orchard_meta.anchor_orchard);
    inputs.holder_binding = Some(orchard_meta.holder_binding);

    inputs
}

/// Map the public inputs of the **inner** Orchard PoF circuit into the
/// canonical `VerifierPublicInputs` structure used by the outer bn256 circuit
/// and backend.
///
/// This function is intended to be called by the recursive/outer circuit
/// wrapper once it has verified an inner Orchard proof. It ensures that:
/// - `threshold_raw` matches `inner.threshold_zats`,
/// - `snapshot_block_height` and `snapshot_anchor_orchard` match the Orchard
///   public inputs,
/// - policy / scope / epoch metadata match the zkpf rail configuration, and
/// - nullifier / custodian fields are wired consistently with the other rails.
pub fn map_inner_to_verifier_public_inputs(
    inner: &OrchardInnerPublicInputs,
    meta: &PublicMetaInputs,
    nullifier: [u8; 32],
    custodian_pubkey_hash: [u8; 32],
    holder_binding: [u8; 32],
) -> VerifierPublicInputs {
    VerifierPublicInputs {
        threshold_raw: inner.threshold_zats,
        required_currency_code: meta.required_currency_code,
        current_epoch: meta.current_epoch,
        verifier_scope_id: meta.verifier_scope_id,
        policy_id: meta.policy_id,
        nullifier,
        custodian_pubkey_hash,
        snapshot_block_height: Some(inner.height as u64),
        snapshot_anchor_orchard: Some(inner.anchor_orchard),
        holder_binding: Some(holder_binding),
        proven_sum: None,
    }
}

/// High-level entrypoint that the prover rail calls to generate a `ProofBundle` for
/// the ZCASH_ORCHARD rail.
///
/// In this reference implementation, the function:
/// - validates the snapshot and meta-parameters,
/// - derives a simple Orchard-specific PoF nullifier and holder binding,
/// - builds the canonical `VerifierPublicInputs`, and
/// - returns a `ProofBundle` tagged for the Orchard rail with **placeholder proof bytes**.
///
/// The Halo2 Orchard circuit and real proof generation are still TODO; however callers
/// can already exercise the full HTTP + backend + UI flow using the structured bundle.
pub fn prove_orchard_pof(
    snapshot: &OrchardSnapshot,
    fvk: &OrchardFvk,
    holder_id: &HolderId,
    threshold_zats: u64,
    orchard_meta: &OrchardPublicMeta,
    meta: &PublicMetaInputs,
) -> Result<ProofBundle, OrchardRailError> {
    if snapshot.notes.is_empty() {
        return Err(OrchardRailError::InvalidInput(
            "no Orchard notes discovered for this FVK at the requested height".into(),
        ));
    }

    if threshold_zats == 0 {
        return Err(OrchardRailError::InvalidInput(
            "threshold_zats must be > 0".into(),
        ));
    }

    if snapshot.notes.len() > ORCHARD_MAX_NOTES {
        return Err(OrchardRailError::InvalidInput(format!(
            "too many Orchard notes in snapshot: got {}, max supported is {}",
            snapshot.notes.len(),
            ORCHARD_MAX_NOTES
        )));
    }

    // Enforce Σ v_i ≥ threshold_zats based on the snapshot notes.
    let total_zats: u64 = snapshot.notes.iter().map(|n| n.value_zats).sum();
    if total_zats < threshold_zats {
        return Err(OrchardRailError::InvalidInput(format!(
            "insufficient Orchard funds: total_zats {} < threshold_zats {}",
            total_zats, threshold_zats
        )));
    }

    // Compute a simple holder binding H(holder_id || fvk_bytes) using BLAKE3.
    let holder_binding = compute_holder_binding(holder_id, &fvk.encoded);

    // Derive a PoF nullifier that mixes the binding with the policy/scope/epoch tuple.
    let nullifier = compute_pof_nullifier(
        &holder_binding,
        meta.verifier_scope_id,
        meta.policy_id,
        meta.current_epoch,
    );

    // Orchard is non-custodial; this field is still required by the shared
    // `VerifierPublicInputs` struct but is not enforced for V2_ORCHARD rails.
    let custodian_pubkey_hash = [0u8; 32];

    let mut orchard_meta_with_binding = orchard_meta.clone();
    orchard_meta_with_binding.holder_binding = holder_binding;

    let public_inputs = build_verifier_public_inputs(
        threshold_zats,
        &orchard_meta_with_binding,
        meta,
        nullifier,
        custodian_pubkey_hash,
    );

    // Build the circuit input using the discovered note values.
    let circuit_input = OrchardPofCircuitInput {
        public_inputs: public_inputs.clone(),
        note_values: snapshot.notes.iter().map(|n| n.value_zats).collect(),
    };

    let (proof, _) = create_orchard_proof_with_public_inputs(&circuit_input)?;

    let bundle = ProofBundle {
        rail_id: RAIL_ID_ZCASH_ORCHARD.to_string(),
        circuit_version: CIRCUIT_VERSION,
        proof,
        public_inputs,
    };

    Ok(bundle)
}

// === Orchard keygen for artifact generation ====================================================

use halo2_proofs_axiom::poly::kzg::commitment::ParamsKZG;

/// Result of Orchard circuit key generation.
pub struct OrchardKeygenResult {
    /// KZG parameters (shared across circuits of the same k).
    pub params: ParamsKZG<Bn256>,
    /// Verifying key for the Orchard PoF circuit.
    pub vk: plonk::VerifyingKey<G1Affine>,
    /// Proving key for the Orchard PoF circuit.
    pub pk: plonk::ProvingKey<G1Affine>,
    /// Break points computed during keygen - MUST be saved and reused during proving.
    /// Without these, the prover will panic with "break points not set".
    pub break_points: MultiPhaseThreadBreakPoints,
}

/// Generate proving and verifying keys for the Orchard PoF circuit.
///
/// This function creates new KZG parameters and keys for the OrchardPofCircuit.
/// The resulting artifacts can be serialized and used for production proving/verification.
///
/// # Arguments
/// * `k` - Circuit size parameter (2^k rows). Default is 19.
///
/// # Important
/// The returned `break_points` MUST be serialized and stored alongside the proving key.
/// They are required for proof generation - without them, the prover will panic.
pub fn orchard_keygen(k: u32) -> OrchardKeygenResult {
    // Generate KZG parameters
    let params = ParamsKZG::<Bn256>::setup(k, OsRng);
    
    // Create a sample circuit input for keygen (values don't matter, just structure)
    let sample_input = OrchardPofCircuitInput {
        public_inputs: VerifierPublicInputs {
            threshold_raw: 0,
            required_currency_code: 0,
            current_epoch: 0,
            verifier_scope_id: 0,
            policy_id: 0,
            nullifier: [0u8; 32],
            custodian_pubkey_hash: [0u8; 32],
            snapshot_block_height: Some(0),
            snapshot_anchor_orchard: Some([0u8; 32]),
            holder_binding: Some([0u8; 32]),
            proven_sum: None,
        },
        note_values: vec![100u64], // At least one note for the circuit
    };
    
    // Create circuit in keygen mode
    let circuit = OrchardPofCircuit::new(Some(sample_input.clone()));
    
    // Generate verifying key
    let vk = plonk::keygen_vk_custom(&params, &circuit, false)
        .expect("failed to generate Orchard verifying key");
    
    // Generate proving key
    let pk = plonk::keygen_pk(&params, vk.clone(), &circuit)
        .expect("failed to generate Orchard proving key");
    
    // Extract break points from the keygen circuit - these are critical for proving
    let break_points = circuit.extract_break_points_after_keygen();
    
    OrchardKeygenResult { params, vk, pk, break_points }
}

#[cfg(test)]
mod tests {
    use super::*;
    use zkpf_zcash_orchard_wallet::{OrchardMerklePath, OrchardNoteWitness};

    fn sample_snapshot() -> OrchardSnapshot {
        OrchardSnapshot {
            height: 123_456,
            anchor: [1u8; 32],
            notes: vec![OrchardNoteWitness {
                value_zats: 5_000_000,
                commitment: [2u8; 32],
                merkle_path: OrchardMerklePath {
                    siblings: vec![[3u8; 32]; 4],
                    position: 0,
                },
            }],
        }
    }

    #[test]
    fn prove_orchard_pof_builds_public_inputs_and_bundle() {
        let snapshot = sample_snapshot();
        let fvk = OrchardFvk {
            encoded: "uview-sample".to_string(),
        };
        let holder_id = "holder-123".to_string();
        let threshold_zats = 1_000_000;
        let orchard_meta = OrchardPublicMeta {
            chain_id: "ZEC".to_string(),
            pool_id: "ORCHARD".to_string(),
            block_height: snapshot.height,
            anchor_orchard: snapshot.anchor,
            holder_binding: [0u8; 32],
        };
        let public_meta = PublicMetaInputs {
            policy_id: 42,
            verifier_scope_id: 7,
            current_epoch: 1_700_000_000,
            required_currency_code: 1337,
        };

        let bundle = prove_orchard_pof(
            &snapshot,
            &fvk,
            &holder_id,
            threshold_zats,
            &orchard_meta,
            &public_meta,
        )
        .expect("bundle");

        assert_eq!(bundle.rail_id, RAIL_ID_ZCASH_ORCHARD);
        assert_eq!(bundle.circuit_version, CIRCUIT_VERSION);
        assert_eq!(bundle.public_inputs.threshold_raw, threshold_zats);
        assert_eq!(
            bundle.public_inputs.snapshot_block_height,
            Some(snapshot.height as u64)
        );
        assert_eq!(
            bundle.public_inputs.snapshot_anchor_orchard,
            Some(snapshot.anchor)
        );
        assert!(bundle.public_inputs.holder_binding.is_some());
    }
}

fn compute_holder_binding(holder_id: &str, fvk_encoded: &str) -> [u8; 32] {
    let mut hasher = Hasher::new();
    hasher.update(holder_id.as_bytes());
    hasher.update(b"||");
    hasher.update(fvk_encoded.as_bytes());
    let hash = hasher.finalize();
    *hash.as_bytes()
}

fn compute_pof_nullifier(
    holder_binding: &[u8; 32],
    scope_id: u64,
    policy_id: u64,
    epoch: u64,
) -> [u8; 32] {
    let mut hasher = Hasher::new();
    hasher.update(holder_binding);
    hasher.update(&scope_id.to_be_bytes());
    hasher.update(&policy_id.to_be_bytes());
    hasher.update(&epoch.to_be_bytes());
    let hash = hasher.finalize();
    *hash.as_bytes()
}

// === Orchard-specific artifact loading and prover =============================================

const ORCHARD_MANIFEST_ENV: &str = "ZKPF_ORCHARD_MANIFEST_PATH";
const ORCHARD_DEFAULT_MANIFEST_PATH: &str = "artifacts/zcash-orchard/manifest.json";
const BREAK_POINTS_FILENAME: &str = "break_points.json";

/// Native Orchard prover artifacts including break points.
struct OrchardNativeArtifacts {
    prover: ProverArtifacts,
    break_points: MultiPhaseThreadBreakPoints,
}

static ORCHARD_PROVER_ARTIFACTS: Lazy<Arc<OrchardNativeArtifacts>> =
    Lazy::new(|| Arc::new(load_orchard_prover_artifacts().expect("load Orchard prover artifacts")));

fn orchard_manifest_path() -> PathBuf {
    std::env::var(ORCHARD_MANIFEST_ENV)
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(ORCHARD_DEFAULT_MANIFEST_PATH))
}

fn load_orchard_prover_artifacts() -> Result<OrchardNativeArtifacts> {
    let manifest_path = orchard_manifest_path();
    let (manifest, params_bytes, vk_bytes, pk_bytes) = load_orchard_artifact_bytes(&manifest_path)?;
    let params = deserialize_params(&params_bytes)?;
    let vk = deserialize_orchard_verifying_key(&vk_bytes)?;
    let pk = deserialize_orchard_proving_key(&pk_bytes)?;

    // Load break points from break_points.json alongside the manifest
    let break_points_path = orchard_manifest_dir(&manifest_path).join(BREAK_POINTS_FILENAME);
    let break_points = if break_points_path.exists() {
        let bp_bytes = fs::read(&break_points_path)
            .with_context(|| format!("failed to read break_points from {}", break_points_path.display()))?;
        deserialize_break_points(&bp_bytes)?
    } else {
        // If break_points.json doesn't exist, compute them from the circuit
        // This is a fallback for older artifacts - production should always have the file
        eprintln!(
            "⚠️ break_points.json not found at {}, computing from circuit (this may take a while)...",
            break_points_path.display()
        );
        let sample_input = OrchardPofCircuitInput {
            public_inputs: VerifierPublicInputs {
                threshold_raw: 0,
                required_currency_code: 0,
                current_epoch: 0,
                verifier_scope_id: 0,
                policy_id: 0,
                nullifier: [0u8; 32],
                custodian_pubkey_hash: [0u8; 32],
                snapshot_block_height: Some(0),
                snapshot_anchor_orchard: Some([0u8; 32]),
                holder_binding: Some([0u8; 32]),
                proven_sum: None,
            },
            note_values: vec![100u64],
        };
        extract_break_points_from_synthesis(&sample_input, &orchard_default_params())
    };

    let prover = ProverArtifacts::from_parts(
        manifest,
        orchard_manifest_dir(&manifest_path),
        params,
        vk,
        Some(pk),
    );

    Ok(OrchardNativeArtifacts { prover, break_points })
}

pub fn load_orchard_verifier_artifacts(
    manifest_path: impl AsRef<Path>,
) -> Result<VerifierArtifacts> {
    let (manifest, params_bytes, vk_bytes, _) =
        load_orchard_artifact_bytes(manifest_path.as_ref())?;

    let params = deserialize_params(&params_bytes)?;
    let vk = deserialize_orchard_verifying_key(&vk_bytes)?;

    Ok(VerifierArtifacts {
        manifest,
        params_bytes,
        vk_bytes,
        params,
        vk,
    })
}

#[allow(clippy::type_complexity)]
fn load_orchard_artifact_bytes(
    manifest_path: &Path,
) -> Result<(ArtifactManifest, Vec<u8>, Vec<u8>, Vec<u8>)> {
    let manifest = read_manifest(manifest_path)?;
    ensure_manifest_compat_orchard(&manifest)?;
    let base_dir = orchard_manifest_dir(manifest_path);

    let params_bytes = read_orchard_artifact_file(&base_dir, &manifest.params, "params")?;
    let vk_bytes = read_orchard_artifact_file(&base_dir, &manifest.vk, "verifying key")?;
    let pk_bytes = read_orchard_artifact_file(&base_dir, &manifest.pk, "proving key")?;

    Ok((manifest, params_bytes, vk_bytes, pk_bytes))
}

fn read_orchard_artifact_file(
    base_dir: &Path,
    entry: &ArtifactFile,
    label: &str,
) -> Result<Vec<u8>> {
    let path = base_dir.join(&entry.path);
    let bytes = fs::read(&path)
        .with_context(|| format!("failed to read {} at {}", label, path.display()))?;
    ensure!(
        bytes.len() as u64 == entry.size,
        "{} size mismatch, manifest recorded {} bytes but found {}",
        label,
        entry.size,
        bytes.len(),
    );
    ensure_orchard_hash(&bytes, &entry.blake3, label)?;
    Ok(bytes)
}

fn ensure_orchard_hash(bytes: &[u8], expected_hex: &str, label: &str) -> Result<()> {
    let actual = hash_bytes_hex(bytes);
    ensure!(
        actual == expected_hex,
        "{} hash mismatch, expected {} but computed {}",
        label,
        expected_hex,
        actual
    );
    Ok(())
}

fn orchard_manifest_dir(path: &Path) -> PathBuf {
    path.parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn ensure_manifest_compat_orchard(manifest: &ArtifactManifest) -> Result<()> {
    ensure!(
        manifest.manifest_version == MANIFEST_VERSION,
        "unsupported manifest version {}, expected {}",
        manifest.manifest_version,
        MANIFEST_VERSION
    );
    ensure!(
        manifest.circuit_version == CIRCUIT_VERSION,
        "circuit version mismatch: manifest {} vs crate {}",
        manifest.circuit_version,
        CIRCUIT_VERSION
    );
    Ok(())
}

fn deserialize_orchard_verifying_key(bytes: &[u8]) -> Result<plonk::VerifyingKey<G1Affine>> {
    let params = OrchardPofCircuit::default().params();
    let mut reader = Cursor::new(bytes);
    plonk::VerifyingKey::read::<_, OrchardPofCircuit>(&mut reader, SerdeFormat::Processed, params)
        .context("failed to deserialize Orchard verifying key")
}

fn deserialize_orchard_proving_key(bytes: &[u8]) -> Result<plonk::ProvingKey<G1Affine>> {
    let params = OrchardPofCircuit::default().params();
    let mut reader = Cursor::new(bytes);
    plonk::ProvingKey::read::<_, OrchardPofCircuit>(&mut reader, SerdeFormat::Processed, params)
        .context("failed to deserialize Orchard proving key")
}

fn create_orchard_proof_with_public_inputs(
    input: &OrchardPofCircuitInput,
) -> Result<(Vec<u8>, VerifierPublicInputs), OrchardRailError> {
    let artifacts = ORCHARD_PROVER_ARTIFACTS.clone();
    let public_inputs = input.public_inputs.clone();

    let instances =
        public_inputs_to_instances_with_layout(PublicInputLayout::V2Orchard, &public_inputs)
            .map_err(|e| OrchardRailError::InvalidInput(format!("{e}")))?;

    let instance_refs: Vec<&[Fr]> = instances.iter().map(|col| col.as_slice()).collect();
    
    // Use new_prover for optimized production proof generation WITH break points.
    // This uses CircuitBuilderStage::Prover which enables witness_gen_only mode.
    // Without break points, this will panic with "break points not set".
    let circuit = OrchardPofCircuit::new_prover(input.clone(), artifacts.break_points.clone());

    let mut transcript =
        halo2_proofs_axiom::transcript::Blake2bWrite::<_, G1Affine, _>::init(vec![]);

    halo2_proofs_axiom::plonk::create_proof::<
        halo2_proofs_axiom::poly::kzg::commitment::KZGCommitmentScheme<Bn256>,
        halo2_proofs_axiom::poly::kzg::multiopen::ProverGWC<'_, Bn256>,
        _,
        _,
        _,
        _,
    >(
        &artifacts.prover.params,
        artifacts.prover
            .proving_key()
            .map_err(|err| OrchardRailError::InvalidInput(err.to_string()))?
            .as_ref(),
        &[circuit],
        &[instance_refs.as_slice()],
        OsRng,
        &mut transcript,
    )
    .map_err(|e| OrchardRailError::InvalidInput(format!("proof generation failed: {e}")))?;

    let proof = transcript.finalize();
    Ok((proof, public_inputs))
}

// === WASM-friendly proving helpers ==============================================================

/// In-browser Orchard proving artifacts (params, verifying key, proving key, break points) as
/// raw byte blobs.
///
/// These are deserialized on-demand under `wasm32` targets without touching the
/// filesystem or reading environment variables.
///
/// # Important
/// The `break_points_bytes` field is **required** for proof generation. Without it,
/// the prover will panic with "break points not set". Break points are computed during
/// keygen and must be loaded alongside the proving key.
#[cfg(target_arch = "wasm32")]
#[derive(Clone, Debug)]
pub struct OrchardWasmArtifacts {
    pub params_bytes: Vec<u8>,
    pub vk_bytes: Vec<u8>,
    pub pk_bytes: Vec<u8>,
    /// Break points computed during keygen - required for proof generation.
    pub break_points_bytes: Vec<u8>,
}

/// Create a Orchard PoF proof using in-memory artifacts, suitable for WASM.
#[cfg(target_arch = "wasm32")]
pub fn create_orchard_proof_with_public_inputs_from_bytes(
    artifacts: &OrchardWasmArtifacts,
    input: &OrchardPofCircuitInput,
) -> Result<(Vec<u8>, VerifierPublicInputs), OrchardRailError> {
    let params = deserialize_params(&artifacts.params_bytes)
        .map_err(|e| OrchardRailError::InvalidInput(e.to_string()))?;
    // We do not currently need the verifying key for proof creation; it is
    // included in `vk_bytes` for completeness and potential future use.
    let pk = deserialize_orchard_proving_key(&artifacts.pk_bytes)
        .map_err(|e| OrchardRailError::InvalidInput(e.to_string()))?;
    
    // Deserialize break points - these are REQUIRED for proof generation
    let break_points = deserialize_break_points(&artifacts.break_points_bytes)
        .map_err(|e| OrchardRailError::InvalidInput(format!("failed to deserialize break points: {e}")))?;

    let public_inputs = input.public_inputs.clone();

    let instances =
        public_inputs_to_instances_with_layout(PublicInputLayout::V2Orchard, &public_inputs)
            .map_err(|e| OrchardRailError::InvalidInput(format!("{e}")))?;

    let instance_refs: Vec<&[Fr]> = instances.iter().map(|col| col.as_slice()).collect();
    
    // Use new_prover for optimized production proof generation WITH break points.
    // Without break points, this will panic with "break points not set".
    let circuit = OrchardPofCircuit::new_prover(input.clone(), break_points);

    let mut transcript =
        halo2_proofs_axiom::transcript::Blake2bWrite::<_, G1Affine, _>::init(vec![]);

    halo2_proofs_axiom::plonk::create_proof::<
        halo2_proofs_axiom::poly::kzg::commitment::KZGCommitmentScheme<Bn256>,
        halo2_proofs_axiom::poly::kzg::multiopen::ProverGWC<'_, Bn256>,
        _,
        _,
        _,
        _,
    >(
        &params,
        &pk,
        &[circuit],
        &[instance_refs.as_slice()],
        OsRng,
        &mut transcript,
    )
    .map_err(|e| OrchardRailError::InvalidInput(format!("proof generation failed: {e}")))?;

    let proof = transcript.finalize();
    Ok((proof, public_inputs))
}

/// WASM-specific variant of `prove_orchard_pof` that uses in-memory artifacts
/// instead of loading them from disk.
#[cfg(target_arch = "wasm32")]
pub fn prove_orchard_pof_wasm(
    snapshot: &OrchardSnapshot,
    fvk: &OrchardFvk,
    holder_id: &HolderId,
    threshold_zats: u64,
    orchard_meta: &OrchardPublicMeta,
    meta: &PublicMetaInputs,
    artifacts: &OrchardWasmArtifacts,
) -> Result<ProofBundle, OrchardRailError> {
    if snapshot.notes.is_empty() {
        return Err(OrchardRailError::InvalidInput(
            "no Orchard notes discovered for this FVK at the requested height".into(),
        ));
    }

    if threshold_zats == 0 {
        return Err(OrchardRailError::InvalidInput(
            "threshold_zats must be > 0".into(),
        ));
    }

    if snapshot.notes.len() > ORCHARD_MAX_NOTES {
        return Err(OrchardRailError::InvalidInput(format!(
            "too many Orchard notes in snapshot: got {}, max supported is {}",
            snapshot.notes.len(),
            ORCHARD_MAX_NOTES
        )));
    }

    // Enforce Σ v_i ≥ threshold_zats based on the snapshot notes.
    let total_zats: u64 = snapshot.notes.iter().map(|n| n.value_zats).sum();
    if total_zats < threshold_zats {
        return Err(OrchardRailError::InvalidInput(format!(
            "insufficient Orchard funds: total_zats {} < threshold_zats {}",
            total_zats, threshold_zats
        )));
    }

    // Compute a simple holder binding H(holder_id || fvk_bytes) using BLAKE3.
    let holder_binding = compute_holder_binding(holder_id, &fvk.encoded);

    // Derive a PoF nullifier that mixes the binding with the policy/scope/epoch tuple.
    let nullifier = compute_pof_nullifier(
        &holder_binding,
        meta.verifier_scope_id,
        meta.policy_id,
        meta.current_epoch,
    );

    // Orchard is non-custodial; this field is still required by the shared
    // `VerifierPublicInputs` struct but is not enforced for V2_ORCHARD rails.
    let custodian_pubkey_hash = [0u8; 32];

    let mut orchard_meta_with_binding = orchard_meta.clone();
    orchard_meta_with_binding.holder_binding = holder_binding;

    let public_inputs = build_verifier_public_inputs(
        threshold_zats,
        &orchard_meta_with_binding,
        meta,
        nullifier,
        custodian_pubkey_hash,
    );

    let circuit_input = OrchardPofCircuitInput {
        public_inputs: public_inputs.clone(),
        note_values: snapshot.notes.iter().map(|n| n.value_zats).collect(),
    };

    let (proof, _) = create_orchard_proof_with_public_inputs_from_bytes(artifacts, &circuit_input)?;

    let bundle = ProofBundle {
        rail_id: RAIL_ID_ZCASH_ORCHARD.to_string(),
        circuit_version: CIRCUIT_VERSION,
        proof,
        public_inputs,
    };

    Ok(bundle)
}
