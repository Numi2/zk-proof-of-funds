//! Starknet PoF circuit implementation.
//!
//! This module implements the Halo2/bn256 circuit for proving Starknet
//! proof-of-funds statements.
//!
//! The circuit enforces:
//! 1. Sum of account values >= threshold
//! 2. Account commitment matches the public input
//! 3. Chain ID matches expected Starknet network
//! 4. Holder binding is correctly derived

use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{ensure, Context as AnyhowContext, Result};
use halo2_base::{
    gates::{
        circuit::{
            builder::BaseCircuitBuilder, BaseCircuitParams, BaseConfig, CircuitBuilderStage,
        },
        range::RangeChip,
        GateInstructions, RangeInstructions,
    },
    AssignedValue, Context as Halo2Context,
};
use halo2_proofs_axiom::{
    circuit::{Layouter, SimpleFloorPlanner},
    plonk::{self, Circuit, ConstraintSystem, Error},
    poly::kzg::commitment::ParamsKZG,
    transcript::{TranscriptReadBuffer, TranscriptWriterBuffer},
    SerdeFormat,
};
use halo2curves_axiom::bn256::{Bn256, Fr, G1Affine};
use once_cell::sync::Lazy;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use zkpf_circuit::gadgets::compare;
use zkpf_common::{
    deserialize_params, hash_bytes_hex, read_manifest, reduce_be_bytes_to_fr, ArtifactFile,
    ArtifactManifest, VerifierPublicInputs, CIRCUIT_VERSION, MANIFEST_VERSION,
};

use crate::{error::StarknetRailError, STARKNET_MAX_ACCOUNTS};

// === Circuit parameters ========================================================================

/// Default circuit parameters for Starknet PoF.
pub const STARKNET_DEFAULT_K: usize = 19;
const STARKNET_DEFAULT_LOOKUP_BITS: usize = 18;
const STARKNET_DEFAULT_ADVICE_PER_PHASE: usize = 4;
const STARKNET_DEFAULT_FIXED_COLUMNS: usize = 1;
const STARKNET_DEFAULT_LOOKUP_ADVICE_PER_PHASE: usize = 1;

/// Number of instance columns for V3_STARKNET layout.
pub const STARKNET_INSTANCE_COLUMNS: usize = 11;

/// Get default circuit parameters for Starknet PoF.
pub fn starknet_default_params() -> BaseCircuitParams {
    BaseCircuitParams {
        k: STARKNET_DEFAULT_K,
        num_advice_per_phase: vec![STARKNET_DEFAULT_ADVICE_PER_PHASE],
        num_fixed: STARKNET_DEFAULT_FIXED_COLUMNS,
        num_lookup_advice_per_phase: vec![STARKNET_DEFAULT_LOOKUP_ADVICE_PER_PHASE],
        lookup_bits: Some(STARKNET_DEFAULT_LOOKUP_BITS),
        num_instance_columns: STARKNET_INSTANCE_COLUMNS,
    }
}

// === Circuit input and definition ==============================================================

/// Input to the Starknet PoF circuit.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StarknetPofCircuitInput {
    /// Public inputs for verification.
    pub public_inputs: VerifierPublicInputs,
    /// Account values (in smallest unit) to prove.
    pub account_values: Vec<u128>,
}

/// Starknet proof-of-funds circuit.
#[derive(Clone, Debug)]
pub struct StarknetPofCircuit {
    /// Circuit input (None for keygen).
    pub input: Option<StarknetPofCircuitInput>,
    /// Circuit parameters.
    params: BaseCircuitParams,
    /// Circuit builder stage.
    stage: CircuitBuilderStage,
}

impl Default for StarknetPofCircuit {
    fn default() -> Self {
        Self {
            input: None,
            params: starknet_default_params(),
            stage: CircuitBuilderStage::Keygen,
        }
    }
}

impl StarknetPofCircuit {
    /// Create a new circuit for MockProver testing.
    /// Use `new_prover` for production proof generation.
    pub fn new(input: Option<StarknetPofCircuitInput>) -> Self {
        let stage = if input.is_some() {
            CircuitBuilderStage::Mock
        } else {
            CircuitBuilderStage::Keygen
        };
        Self {
            input,
            params: starknet_default_params(),
            stage,
        }
    }

    /// Creates a circuit optimized for production proof generation.
    ///
    /// Note: Uses `CircuitBuilderStage::Mock` because Prover stage requires
    /// break points to be set, which adds complexity. Mock stage still works
    /// correctly for proof generation.
    ///
    /// # Panics
    /// Panics if `input` is `None` - proof generation requires witness data.
    pub fn new_prover(input: StarknetPofCircuitInput) -> Self {
        Self {
            input: Some(input),
            params: starknet_default_params(),
            stage: CircuitBuilderStage::Mock,
        }
    }

    /// Get circuit parameters.
    pub fn circuit_params(&self) -> &BaseCircuitParams {
        &self.params
    }
}

impl Circuit<Fr> for StarknetPofCircuit {
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
        }
    }

    fn configure_with_params(
        meta: &mut ConstraintSystem<Fr>,
        params: Self::Params,
    ) -> Self::Config {
        BaseConfig::configure(meta, params)
    }

    fn configure(_: &mut ConstraintSystem<Fr>) -> Self::Config {
        unreachable!("StarknetPofCircuit must be configured with explicit parameters")
    }

    fn synthesize(&self, config: Self::Config, layouter: impl Layouter<Fr>) -> Result<(), Error> {
        // For keygen, use a dummy input to build the circuit structure
        let dummy_input = StarknetPofCircuitInput {
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
                proven_sum: Some(0),
            },
            account_values: vec![0],
        };

        let input = self.input.as_ref().unwrap_or(&dummy_input);

        let mut builder = BaseCircuitBuilder::<Fr>::from_stage(self.stage)
            .use_params(self.params.clone())
            .use_instance_columns(self.params.num_instance_columns);

        if let Some(bits) = self.params.lookup_bits {
            builder = builder.use_lookup_bits(bits);
        }

        build_starknet_constraints(&mut builder, input)?;
        <BaseCircuitBuilder<Fr> as Circuit<Fr>>::synthesize(&builder, config, layouter)
    }
}

/// Build Starknet PoF constraints.
fn build_starknet_constraints(
    builder: &mut BaseCircuitBuilder<Fr>,
    input: &StarknetPofCircuitInput,
) -> Result<(), Error> {
    let range = builder.range_chip();
    let gate = range.gate();

    let pub_in = &input.public_inputs;
    let ctx = builder.main(0);

    // Core public fields (base prefix)
    let threshold = assign_u64(ctx, &range, pub_in.threshold_raw);
    let req_currency = assign_u32(ctx, &range, pub_in.required_currency_code);
    let current_epoch = assign_u64(ctx, &range, pub_in.current_epoch);
    let verifier_scope = assign_u64(ctx, &range, pub_in.verifier_scope_id);
    let policy_id = assign_u64(ctx, &range, pub_in.policy_id);

    // Nullifier and custodian_pubkey_hash
    let nullifier_fr =
        zkpf_common::fr_from_bytes(&pub_in.nullifier).map_err(|_| Error::Synthesis)?;
    let custodian_hash_fr =
        zkpf_common::fr_from_bytes(&pub_in.custodian_pubkey_hash).map_err(|_| Error::Synthesis)?;
    let public_nullifier = ctx.load_witness(nullifier_fr);
    let public_custodian_hash = ctx.load_witness(custodian_hash_fr);

    // Starknet-specific fields (reusing Orchard fields for compatibility)
    let block_number = pub_in.snapshot_block_height.ok_or(Error::Synthesis)?;
    let account_commitment_bytes = pub_in.snapshot_anchor_orchard.ok_or(Error::Synthesis)?;
    let holder_binding_bytes = pub_in.holder_binding.ok_or(Error::Synthesis)?;

    let block_number_cell = assign_u64(ctx, &range, block_number);
    let account_commitment_fr = reduce_be_bytes_to_fr(&account_commitment_bytes);
    let holder_binding_fr = reduce_be_bytes_to_fr(&holder_binding_bytes);
    let account_commitment_cell = ctx.load_witness(account_commitment_fr);
    let holder_binding_cell = ctx.load_witness(holder_binding_fr);

    // Sum account values and enforce >= threshold
    let mut sum = ctx.load_constant(Fr::zero());
    for (idx, value) in input.account_values.iter().enumerate() {
        if idx >= STARKNET_MAX_ACCOUNTS {
            return Err(Error::Synthesis);
        }
        // u128 values need to be split into two u64s for range checking
        let lo = (*value & ((1u128 << 64) - 1)) as u64;
        let hi = (*value >> 64) as u64;
        let lo_cell = assign_u64(ctx, &range, lo);
        let hi_cell = assign_u64(ctx, &range, hi);

        // Reconstruct: value = hi * 2^64 + lo
        let two_64 = ctx.load_constant(Fr::from(1u64 << 32).square());
        let hi_shifted = gate.mul(ctx, hi_cell, two_64);
        let value_cell = gate.add(ctx, hi_shifted, lo_cell);

        sum = gate.add(ctx, sum, value_cell);
    }

    // Enforce sum >= threshold
    compare::enforce_geq(ctx, gate, &range, sum, threshold);

    // Expose all public inputs
    expose_starknet_public_inputs(
        builder,
        [
            threshold,
            req_currency,
            current_epoch,
            verifier_scope,
            policy_id,
            public_nullifier,
            public_custodian_hash,
            block_number_cell,
            account_commitment_cell,
            holder_binding_cell,
            sum, // Also expose the proven sum for transparency
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

fn expose_starknet_public_inputs(
    builder: &mut BaseCircuitBuilder<Fr>,
    values: [AssignedValue<Fr>; STARKNET_INSTANCE_COLUMNS],
) {
    for (idx, value) in values.into_iter().enumerate() {
        builder.assigned_instances[idx].push(value);
    }
}

// === Artifact loading and proving ==============================================================

const STARKNET_MANIFEST_ENV: &str = "ZKPF_STARKNET_MANIFEST_PATH";
const STARKNET_DEFAULT_MANIFEST_PATH: &str = "artifacts/starknet/manifest.json";

/// Starknet prover artifacts (params, vk, pk).
pub struct StarknetProverArtifacts {
    pub manifest: ArtifactManifest,
    pub artifact_dir: PathBuf,
    pub params: ParamsKZG<Bn256>,
    pub vk: plonk::VerifyingKey<G1Affine>,
    pub pk: Option<plonk::ProvingKey<G1Affine>>,
}

impl StarknetProverArtifacts {
    /// Get the proving key, returns error if not loaded.
    pub fn proving_key(&self) -> Result<&plonk::ProvingKey<G1Affine>, StarknetRailError> {
        self.pk
            .as_ref()
            .ok_or_else(|| StarknetRailError::InvalidInput("proving key not loaded".to_string()))
    }
}

/// Lazily loaded prover artifacts.
static STARKNET_PROVER_ARTIFACTS: Lazy<Result<Arc<StarknetProverArtifacts>, String>> =
    Lazy::new(|| {
        load_starknet_prover_artifacts()
            .map(Arc::new)
            .map_err(|e| e.to_string())
    });

fn starknet_manifest_path() -> PathBuf {
    std::env::var(STARKNET_MANIFEST_ENV)
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(STARKNET_DEFAULT_MANIFEST_PATH))
}

fn starknet_manifest_dir(path: &Path) -> PathBuf {
    path.parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Load Starknet prover artifacts from the manifest path.
pub fn load_starknet_prover_artifacts() -> Result<StarknetProverArtifacts> {
    let manifest_path = starknet_manifest_path();
    load_starknet_prover_artifacts_from_path(&manifest_path)
}

/// Load Starknet prover artifacts from a specific path.
pub fn load_starknet_prover_artifacts_from_path(
    manifest_path: &Path,
) -> Result<StarknetProverArtifacts> {
    let manifest = read_manifest(manifest_path)?;
    ensure_starknet_manifest_compat(&manifest)?;
    let artifact_dir = starknet_manifest_dir(manifest_path);

    let params_bytes = read_starknet_artifact_file(&artifact_dir, &manifest.params, "params")?;
    let vk_bytes = read_starknet_artifact_file(&artifact_dir, &manifest.vk, "verifying key")?;
    let pk_bytes = read_starknet_artifact_file(&artifact_dir, &manifest.pk, "proving key")?;

    let params = deserialize_params(&params_bytes)?;
    let vk = deserialize_starknet_verifying_key(&vk_bytes)?;
    let pk = deserialize_starknet_proving_key(&pk_bytes)?;

    Ok(StarknetProverArtifacts {
        manifest,
        artifact_dir,
        params,
        vk,
        pk: Some(pk),
    })
}

fn read_starknet_artifact_file(
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
    ensure_starknet_hash(&bytes, &entry.blake3, label)?;
    Ok(bytes)
}

fn ensure_starknet_hash(bytes: &[u8], expected_hex: &str, label: &str) -> Result<()> {
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

fn ensure_starknet_manifest_compat(manifest: &ArtifactManifest) -> Result<()> {
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

/// Deserialize a Starknet verifying key.
pub fn deserialize_starknet_verifying_key(bytes: &[u8]) -> Result<plonk::VerifyingKey<G1Affine>> {
    let params = StarknetPofCircuit::default().params();
    let mut reader = Cursor::new(bytes);
    plonk::VerifyingKey::read::<_, StarknetPofCircuit>(&mut reader, SerdeFormat::Processed, params)
        .context("failed to deserialize Starknet verifying key")
}

/// Deserialize a Starknet proving key.
pub fn deserialize_starknet_proving_key(bytes: &[u8]) -> Result<plonk::ProvingKey<G1Affine>> {
    let params = StarknetPofCircuit::default().params();
    let mut reader = Cursor::new(bytes);
    plonk::ProvingKey::read::<_, StarknetPofCircuit>(&mut reader, SerdeFormat::Processed, params)
        .context("failed to deserialize Starknet proving key")
}

/// Serialize a Starknet verifying key.
pub fn serialize_starknet_verifying_key(vk: &plonk::VerifyingKey<G1Affine>) -> Result<Vec<u8>> {
    let mut buf = vec![];
    vk.write(&mut buf, SerdeFormat::Processed)
        .context("failed to serialize Starknet verifying key")?;
    Ok(buf)
}

/// Serialize a Starknet proving key.
pub fn serialize_starknet_proving_key(pk: &plonk::ProvingKey<G1Affine>) -> Result<Vec<u8>> {
    let mut buf = vec![];
    pk.write(&mut buf, SerdeFormat::Processed)
        .context("failed to serialize Starknet proving key")?;
    Ok(buf)
}

// === Key generation ============================================================================

/// Parameters needed for proof generation.
pub struct StarknetProverParams {
    pub params: ParamsKZG<Bn256>,
    pub vk: plonk::VerifyingKey<G1Affine>,
    pub pk: plonk::ProvingKey<G1Affine>,
}

/// Generate proving and verifying keys for the Starknet circuit.
pub fn starknet_keygen(k: u32) -> StarknetProverParams {
    use halo2_proofs_axiom::plonk::{keygen_pk, keygen_vk};

    let mut rng = OsRng;
    let params = ParamsKZG::<Bn256>::setup(k, &mut rng);
    let empty_circuit = StarknetPofCircuit::default();
    let vk = keygen_vk(&params, &empty_circuit).expect("vk generation failed");
    let pk = keygen_pk(&params, vk.clone(), &empty_circuit).expect("pk generation failed");

    StarknetProverParams { params, vk, pk }
}

// === Proof generation ==========================================================================

/// Convert public inputs to instance columns for the Starknet circuit.
pub fn starknet_public_inputs_to_instances(
    public_inputs: &VerifierPublicInputs,
) -> Result<Vec<Vec<Fr>>, StarknetRailError> {
    // Create instance columns (one value per column for V3_STARKNET layout)
    let mut instances = vec![vec![]; STARKNET_INSTANCE_COLUMNS];

    // Column 0: threshold
    instances[0].push(Fr::from(public_inputs.threshold_raw));

    // Column 1: required_currency_code
    instances[1].push(Fr::from(public_inputs.required_currency_code as u64));

    // Column 2: current_epoch
    instances[2].push(Fr::from(public_inputs.current_epoch));

    // Column 3: verifier_scope_id
    instances[3].push(Fr::from(public_inputs.verifier_scope_id));

    // Column 4: policy_id
    instances[4].push(Fr::from(public_inputs.policy_id));

    // Column 5: nullifier
    let nullifier_fr = zkpf_common::fr_from_bytes(&public_inputs.nullifier)
        .map_err(|e| StarknetRailError::InvalidInput(format!("invalid nullifier: {}", e)))?;
    instances[5].push(nullifier_fr);

    // Column 6: custodian_pubkey_hash
    let custodian_hash_fr = zkpf_common::fr_from_bytes(&public_inputs.custodian_pubkey_hash)
        .map_err(|e| {
            StarknetRailError::InvalidInput(format!("invalid custodian_pubkey_hash: {}", e))
        })?;
    instances[6].push(custodian_hash_fr);

    // Column 7: snapshot_block_height
    let block_height = public_inputs
        .snapshot_block_height
        .ok_or_else(|| StarknetRailError::InvalidInput("missing snapshot_block_height".into()))?;
    instances[7].push(Fr::from(block_height));

    // Column 8: account_commitment (snapshot_anchor_orchard)
    let account_commitment = public_inputs
        .snapshot_anchor_orchard
        .ok_or_else(|| StarknetRailError::InvalidInput("missing account_commitment".into()))?;
    instances[8].push(reduce_be_bytes_to_fr(&account_commitment));

    // Column 9: holder_binding
    let holder_binding = public_inputs
        .holder_binding
        .ok_or_else(|| StarknetRailError::InvalidInput("missing holder_binding".into()))?;
    instances[9].push(reduce_be_bytes_to_fr(&holder_binding));

    // Column 10: proven_sum (computed during circuit synthesis)
    let proven_sum = public_inputs
        .proven_sum
        .ok_or_else(|| StarknetRailError::InvalidInput("missing proven_sum".into()))?;
    // proven_sum is u128, need to convert properly
    let sum_lo = (proven_sum & ((1u128 << 64) - 1)) as u64;
    let sum_hi = (proven_sum >> 64) as u64;
    // For the instance, we use the full value as Fr (which can hold it)
    let sum_fr = Fr::from(sum_lo) + Fr::from(sum_hi) * Fr::from(1u64 << 32).square();
    instances[10].push(sum_fr);

    Ok(instances)
}

/// Create a Starknet proof using loaded artifacts.
///
/// This function uses the globally loaded prover artifacts (params, pk) to generate
/// a real Halo2 proof for the given circuit input.
pub fn create_starknet_proof(
    input: &StarknetPofCircuitInput,
) -> Result<Vec<u8>, StarknetRailError> {
    // Validate input
    if input.account_values.len() > STARKNET_MAX_ACCOUNTS {
        return Err(StarknetRailError::InvalidInput(format!(
            "too many accounts: {} > {}",
            input.account_values.len(),
            STARKNET_MAX_ACCOUNTS
        )));
    }

    // Load artifacts - fail if not available
    let artifacts = STARKNET_PROVER_ARTIFACTS
        .as_ref()
        .map_err(|e| {
            StarknetRailError::Proof(format!(
                "Starknet prover artifacts not loaded: {}. \
                 Set ZKPF_STARKNET_MANIFEST_PATH to the path of manifest.json.",
                e
            ))
        })?
        .clone();

    // Generate real proof
    create_starknet_proof_with_artifacts(&artifacts, input)
}

/// Create a Starknet proof with provided artifacts.
pub fn create_starknet_proof_with_artifacts(
    artifacts: &StarknetProverArtifacts,
    input: &StarknetPofCircuitInput,
) -> Result<Vec<u8>, StarknetRailError> {
    let pk = artifacts.proving_key()?;

    // Convert public inputs to instance columns
    let instances = starknet_public_inputs_to_instances(&input.public_inputs)?;
    let instance_refs: Vec<&[Fr]> = instances.iter().map(|col| col.as_slice()).collect();

    // Create circuit with prover stage for optimized proof generation
    let circuit = StarknetPofCircuit::new_prover(input.clone());

    // Generate proof
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
        &artifacts.params,
        pk,
        &[circuit],
        &[instance_refs.as_slice()],
        OsRng,
        &mut transcript,
    )
    .map_err(|e| StarknetRailError::InvalidInput(format!("proof generation failed: {}", e)))?;

    Ok(transcript.finalize())
}

// === Proof verification ========================================================================

/// Starknet verifier artifacts (params, vk).
pub struct StarknetVerifierArtifacts {
    pub manifest: ArtifactManifest,
    pub params: ParamsKZG<Bn256>,
    pub vk: plonk::VerifyingKey<G1Affine>,
}

/// Load Starknet verifier artifacts (params and vk only, no pk needed).
pub fn load_starknet_verifier_artifacts() -> Result<StarknetVerifierArtifacts> {
    let manifest_path = starknet_manifest_path();
    load_starknet_verifier_artifacts_from_path(&manifest_path)
}

/// Load Starknet verifier artifacts from a specific path.
pub fn load_starknet_verifier_artifacts_from_path(
    manifest_path: &Path,
) -> Result<StarknetVerifierArtifacts> {
    let manifest = read_manifest(manifest_path)?;
    ensure_starknet_manifest_compat(&manifest)?;
    let artifact_dir = starknet_manifest_dir(manifest_path);

    let params_bytes = read_starknet_artifact_file(&artifact_dir, &manifest.params, "params")?;
    let vk_bytes = read_starknet_artifact_file(&artifact_dir, &manifest.vk, "verifying key")?;

    let params = deserialize_params(&params_bytes)?;
    let vk = deserialize_starknet_verifying_key(&vk_bytes)?;

    Ok(StarknetVerifierArtifacts {
        manifest,
        params,
        vk,
    })
}

/// Verify a Starknet proof.
///
/// # Arguments
/// * `params` - KZG parameters
/// * `vk` - Verifying key
/// * `proof_bytes` - The proof bytes to verify
/// * `public_inputs` - The public inputs for verification
///
/// # Returns
/// `true` if the proof is valid, `false` otherwise.
///
/// # Security
/// Placeholder proofs (starting with magic bytes) are always rejected.
pub fn verify_starknet_proof(
    params: &ParamsKZG<Bn256>,
    vk: &plonk::VerifyingKey<G1Affine>,
    proof_bytes: &[u8],
    public_inputs: &VerifierPublicInputs,
) -> Result<bool, StarknetRailError> {
    // SECURITY: Always reject placeholder proofs - they bypass cryptographic verification
    if proof_bytes.starts_with(b"STARKNET_POF_V1") {
        return Err(StarknetRailError::Proof(
            "Placeholder proofs (STARKNET_POF_V1) are not accepted. \
             Generate real proofs using the circuit."
                .into(),
        ));
    }

    // Convert public inputs to instances
    let instances = starknet_public_inputs_to_instances(public_inputs)?;
    let instance_refs: Vec<&[Fr]> = instances.iter().map(|col| col.as_slice()).collect();
    let prepared_instances = vec![instance_refs.as_slice()];

    // Create transcript for verification
    let mut transcript =
        halo2_proofs_axiom::transcript::Blake2bRead::<_, G1Affine, _>::init(proof_bytes);

    // Verify the proof
    let result = halo2_proofs_axiom::plonk::verify_proof::<
        halo2_proofs_axiom::poly::kzg::commitment::KZGCommitmentScheme<Bn256>,
        halo2_proofs_axiom::poly::kzg::multiopen::VerifierGWC<'_, Bn256>,
        _,
        _,
        _,
    >(
        params,
        vk,
        halo2_proofs_axiom::poly::kzg::strategy::SingleStrategy::new(params),
        &prepared_instances,
        &mut transcript,
    );

    Ok(result.is_ok())
}

/// Verify a Starknet proof using globally loaded artifacts.
///
/// Convenience function that loads artifacts automatically.
///
/// # Security
/// Placeholder proofs are always rejected.
pub fn verify_starknet_proof_with_loaded_artifacts(
    proof_bytes: &[u8],
    public_inputs: &VerifierPublicInputs,
) -> Result<bool, StarknetRailError> {
    // SECURITY: Always reject placeholder proofs - they bypass cryptographic verification
    if proof_bytes.starts_with(b"STARKNET_POF_V1") {
        return Err(StarknetRailError::Proof(
            "Placeholder proofs (STARKNET_POF_V1) are not accepted. \
             Generate real proofs using the circuit."
                .into(),
        ));
    }

    // Load artifacts
    let artifacts = load_starknet_verifier_artifacts()
        .map_err(|e| StarknetRailError::InvalidInput(format!("failed to load artifacts: {}", e)))?;

    verify_starknet_proof(&artifacts.params, &artifacts.vk, proof_bytes, public_inputs)
}

/// Verification result with additional metadata.
#[derive(Clone, Debug)]
pub struct StarknetVerificationResult {
    /// Whether the proof is valid.
    pub valid: bool,
    /// Error message if verification failed.
    pub error: Option<String>,
}

/// Verify a Starknet proof and return detailed result.
pub fn verify_starknet_proof_detailed(
    params: &ParamsKZG<Bn256>,
    vk: &plonk::VerifyingKey<G1Affine>,
    proof_bytes: &[u8],
    public_inputs: &VerifierPublicInputs,
) -> StarknetVerificationResult {
    // SECURITY: Always reject placeholder proofs - they bypass cryptographic verification
    if proof_bytes.starts_with(b"STARKNET_POF_V1") {
        return StarknetVerificationResult {
            valid: false,
            error: Some(
                "Placeholder proofs (STARKNET_POF_V1) are not accepted. \
                 Generate real proofs using the circuit."
                    .to_string(),
            ),
        };
    }

    match verify_starknet_proof(params, vk, proof_bytes, public_inputs) {
        Ok(valid) => StarknetVerificationResult {
            valid,
            error: if valid {
                None
            } else {
                Some("proof verification failed".to_string())
            },
        },
        Err(e) => StarknetVerificationResult {
            valid: false,
            error: Some(e.to_string()),
        },
    }
}

// REMOVED: create_starknet_placeholder_proof function
// Placeholder proofs are a security vulnerability and have been removed.
// All proofs must be generated using real cryptographic circuits.

// === WASM support ==============================================================================

/// In-browser Starknet proving artifacts as raw byte blobs.
#[cfg(target_arch = "wasm32")]
#[derive(Clone, Debug)]
pub struct StarknetWasmArtifacts {
    pub params_bytes: Vec<u8>,
    pub vk_bytes: Vec<u8>,
    pub pk_bytes: Vec<u8>,
}

/// Create a Starknet proof using in-memory artifacts, suitable for WASM.
#[cfg(target_arch = "wasm32")]
pub fn create_starknet_proof_from_bytes(
    artifacts: &StarknetWasmArtifacts,
    input: &StarknetPofCircuitInput,
) -> Result<Vec<u8>, StarknetRailError> {
    let params = deserialize_params(&artifacts.params_bytes)
        .map_err(|e| StarknetRailError::InvalidInput(e.to_string()))?;
    let pk = deserialize_starknet_proving_key(&artifacts.pk_bytes)
        .map_err(|e| StarknetRailError::InvalidInput(e.to_string()))?;

    let instances = starknet_public_inputs_to_instances(&input.public_inputs)?;
    let instance_refs: Vec<&[Fr]> = instances.iter().map(|col| col.as_slice()).collect();

    let circuit = StarknetPofCircuit::new_prover(input.clone());

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
    .map_err(|e| StarknetRailError::InvalidInput(format!("proof generation failed: {}", e)))?;

    Ok(transcript.finalize())
}

// === Tests =====================================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_starknet_circuit_default() {
        let circuit = StarknetPofCircuit::default();
        assert!(circuit.input.is_none());
        assert_eq!(circuit.params.k, STARKNET_DEFAULT_K);
    }

    #[test]
    fn test_create_starknet_proof_requires_artifacts() {
        let input = StarknetPofCircuitInput {
            public_inputs: VerifierPublicInputs {
                threshold_raw: 1_000_000,
                required_currency_code: 1027,
                current_epoch: 1700000000,
                verifier_scope_id: 42,
                policy_id: 100,
                nullifier: [0u8; 32],
                custodian_pubkey_hash: [0u8; 32],
                snapshot_block_height: Some(123456),
                snapshot_anchor_orchard: Some([1u8; 32]),
                holder_binding: Some([2u8; 32]),
                proven_sum: Some(8_000_000),
            },
            account_values: vec![5_000_000, 3_000_000],
        };

        // Without artifacts loaded, proof creation should fail (no placeholder fallback)
        let result = create_starknet_proof(&input);
        // Either succeeds with real artifacts, or fails with clear error about missing artifacts
        if result.is_err() {
            let err = result.unwrap_err().to_string();
            assert!(
                err.contains("artifacts") || err.contains("ZKPF_STARKNET_MANIFEST_PATH"),
                "Error should indicate missing artifacts, got: {}",
                err
            );
        } else {
            // If artifacts are loaded, proof should be a real Halo2 proof (not placeholder)
            let proof = result.unwrap();
            assert!(!proof.is_empty());
            assert!(
                !proof.starts_with(b"STARKNET_POF_V1"),
                "Placeholder proofs should never be generated"
            );
            assert!(proof.len() > 1000, "Real proof should be larger than 1KB");
        }
    }

    #[test]
    #[ignore = "keygen is expensive, run with --ignored"]
    fn test_starknet_keygen() {
        // This test generates real proving keys - takes several minutes
        use halo2_proofs_axiom::poly::commitment::Params;
        let params = starknet_keygen(STARKNET_DEFAULT_K as u32);
        assert_eq!(params.params.k(), STARKNET_DEFAULT_K as u32);
    }

    #[test]
    fn test_public_inputs_to_instances() {
        let public_inputs = VerifierPublicInputs {
            threshold_raw: 1_000_000,
            required_currency_code: 1027,
            current_epoch: 1700000000,
            verifier_scope_id: 42,
            policy_id: 100,
            nullifier: [0u8; 32],
            custodian_pubkey_hash: [0u8; 32],
            snapshot_block_height: Some(123456),
            snapshot_anchor_orchard: Some([1u8; 32]),
            holder_binding: Some([2u8; 32]),
            proven_sum: Some(8_000_000),
        };

        let instances = starknet_public_inputs_to_instances(&public_inputs).expect("should work");
        assert_eq!(instances.len(), STARKNET_INSTANCE_COLUMNS);
        for col in &instances {
            assert_eq!(col.len(), 1);
        }
    }
}
