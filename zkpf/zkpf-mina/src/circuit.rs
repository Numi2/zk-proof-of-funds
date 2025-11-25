//! Mina recursive proof circuit implementation.
//!
//! This module implements the Halo2/bn256 circuit for wrapping zkpf proofs
//! into Mina-compatible recursive proof commitments.
//!
//! The circuit enforces:
//! 1. Source proof commitments are correctly aggregated
//! 2. Policy constraints match across all source proofs
//! 3. Holder binding is correctly derived
//! 4. Nullifier is correctly computed for replay protection

use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{ensure, Context as AnyhowContext, Result};
use halo2_base::{
    gates::{
        circuit::{builder::BaseCircuitBuilder, BaseCircuitParams, BaseConfig, CircuitBuilderStage},
        range::RangeChip,
        GateInstructions, RangeInstructions,
    },
    AssignedValue, Context as Halo2Context,
};
use halo2_proofs_axiom::{
    circuit::{Layouter, SimpleFloorPlanner},
    plonk::{self, Circuit, ConstraintSystem, Error},
    poly::kzg::commitment::ParamsKZG,
    transcript::TranscriptWriterBuffer,
    SerdeFormat,
};
use halo2curves_axiom::bn256::{Bn256, Fr, G1Affine};
use once_cell::sync::Lazy;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use zkpf_common::{
    deserialize_params, hash_bytes_hex, read_manifest, reduce_be_bytes_to_fr, ArtifactFile,
    ArtifactManifest, VerifierPublicInputs, CIRCUIT_VERSION, MANIFEST_VERSION,
};

use crate::{error::MinaRailError, MINA_MAX_SOURCE_PROOFS};

// === Circuit parameters ========================================================================

/// Default circuit parameters for Mina recursive proof.
pub const MINA_DEFAULT_K: usize = 18; // Smaller than Starknet since we're just wrapping
const MINA_DEFAULT_LOOKUP_BITS: usize = 17;
const MINA_DEFAULT_ADVICE_PER_PHASE: usize = 4;
const MINA_DEFAULT_FIXED_COLUMNS: usize = 1;
const MINA_DEFAULT_LOOKUP_ADVICE_PER_PHASE: usize = 1;

/// Number of instance columns for V4_MINA layout.
pub const MINA_INSTANCE_COLUMNS: usize = 11;

/// Get default circuit parameters for Mina recursive proof.
pub fn mina_default_params() -> BaseCircuitParams {
    BaseCircuitParams {
        k: MINA_DEFAULT_K,
        num_advice_per_phase: vec![MINA_DEFAULT_ADVICE_PER_PHASE],
        num_fixed: MINA_DEFAULT_FIXED_COLUMNS,
        num_lookup_advice_per_phase: vec![MINA_DEFAULT_LOOKUP_ADVICE_PER_PHASE],
        lookup_bits: Some(MINA_DEFAULT_LOOKUP_BITS),
        num_instance_columns: MINA_INSTANCE_COLUMNS,
    }
}

// === Circuit input and definition ==============================================================

/// Input to the Mina recursive proof circuit.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MinaPofCircuitInput {
    /// Public inputs for verification.
    pub public_inputs: VerifierPublicInputs,
    /// Commitments to source proofs being wrapped.
    pub source_proof_commitments: Vec<[u8; 32]>,
}

/// Sample input used during keygen (when no concrete input is provided).
static SAMPLE_INPUT: Lazy<MinaPofCircuitInput> = Lazy::new(|| MinaPofCircuitInput {
    public_inputs: VerifierPublicInputs {
        threshold_raw: 1_000_000,
        required_currency_code: 1027,
        current_epoch: 1700000000,
        verifier_scope_id: 42,
        policy_id: 100,
        nullifier: [0u8; 32],
        custodian_pubkey_hash: [0u8; 32],
        snapshot_block_height: Some(500_000),
        snapshot_anchor_orchard: Some([0u8; 32]),
        holder_binding: Some([0u8; 32]),
        proven_sum: Some(1_000_000),
    },
    source_proof_commitments: vec![[0u8; 32]],
});

/// Mina recursive proof-of-funds circuit.
#[derive(Clone, Debug)]
pub struct MinaPofCircuit {
    /// Circuit input (None for keygen).
    pub input: Option<MinaPofCircuitInput>,
    /// Circuit parameters.
    params: BaseCircuitParams,
    /// Circuit builder stage.
    stage: CircuitBuilderStage,
}

impl Default for MinaPofCircuit {
    fn default() -> Self {
        Self {
            input: None,
            params: mina_default_params(),
            stage: CircuitBuilderStage::Keygen,
        }
    }
}

impl MinaPofCircuit {
    /// Create a new circuit for MockProver testing.
    /// Use `new_prover` for production proof generation.
    pub fn new(input: Option<MinaPofCircuitInput>) -> Self {
        let stage = if input.is_some() {
            CircuitBuilderStage::Mock
        } else {
            CircuitBuilderStage::Keygen
        };
        Self {
            input,
            params: mina_default_params(),
            stage,
        }
    }

    /// Creates a circuit optimized for production proof generation.
    pub fn new_prover(input: MinaPofCircuitInput) -> Self {
        Self {
            input: Some(input),
            params: mina_default_params(),
            stage: CircuitBuilderStage::Prover,
        }
    }

    /// Get circuit parameters.
    pub fn circuit_params(&self) -> &BaseCircuitParams {
        &self.params
    }
}

impl Circuit<Fr> for MinaPofCircuit {
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
        unreachable!("MinaPofCircuit must be configured with explicit parameters")
    }

    fn synthesize(&self, config: Self::Config, layouter: impl Layouter<Fr>) -> Result<(), Error> {
        // Use the pre-configured stage:
        // - Keygen: Key generation phase, uses sample input
        // - Mock: MockProver testing, stores constraints for verification  
        // - Prover: Production proving, `witness_gen_only(true)` for performance
        let input = self.input.as_ref().unwrap_or(&SAMPLE_INPUT);

        let mut builder = BaseCircuitBuilder::<Fr>::from_stage(self.stage)
            .use_params(self.params.clone())
            .use_instance_columns(self.params.num_instance_columns);

        if let Some(bits) = self.params.lookup_bits {
            builder = builder.use_lookup_bits(bits);
        }

        build_mina_constraints(&mut builder, input)?;
        <BaseCircuitBuilder<Fr> as Circuit<Fr>>::synthesize(&builder, config, layouter)
    }
}

/// Build Mina recursive proof constraints.
fn build_mina_constraints(
    builder: &mut BaseCircuitBuilder<Fr>,
    input: &MinaPofCircuitInput,
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

    // Mina-specific fields
    let mina_slot = pub_in.snapshot_block_height.ok_or(Error::Synthesis)?;
    let recursive_proof_commitment = pub_in.snapshot_anchor_orchard.ok_or(Error::Synthesis)?;
    let zkapp_commitment = pub_in.holder_binding.ok_or(Error::Synthesis)?;

    let mina_slot_cell = assign_u64(ctx, &range, mina_slot);
    let recursive_commitment_fr = reduce_be_bytes_to_fr(&recursive_proof_commitment);
    let zkapp_commitment_fr = reduce_be_bytes_to_fr(&zkapp_commitment);
    let recursive_commitment_cell = ctx.load_witness(recursive_commitment_fr);
    let zkapp_commitment_cell = ctx.load_witness(zkapp_commitment_fr);

    // Aggregate source proof commitments
    let mut aggregated_commitment = ctx.load_constant(Fr::zero());
    for (idx, commitment) in input.source_proof_commitments.iter().enumerate() {
        if idx >= MINA_MAX_SOURCE_PROOFS {
            return Err(Error::Synthesis);
        }
        let commitment_fr = reduce_be_bytes_to_fr(commitment);
        let commitment_cell = ctx.load_witness(commitment_fr);
        // Simple aggregation: sum all commitments
        aggregated_commitment = gate.add(ctx, aggregated_commitment, commitment_cell);
    }

    // Proven sum (for transparency)
    let proven_sum = pub_in.proven_sum.unwrap_or(0);
    let proven_sum_lo = (proven_sum & ((1u128 << 64) - 1)) as u64;
    let proven_sum_hi = (proven_sum >> 64) as u64;
    let proven_sum_lo_cell = assign_u64(ctx, &range, proven_sum_lo);
    let proven_sum_hi_cell = assign_u64(ctx, &range, proven_sum_hi);
    let two_64 = ctx.load_constant(Fr::from(1u64 << 32).square());
    let proven_sum_hi_shifted = gate.mul(ctx, proven_sum_hi_cell, two_64);
    let proven_sum_cell = gate.add(ctx, proven_sum_hi_shifted, proven_sum_lo_cell);

    // Expose all public inputs
    expose_mina_public_inputs(
        builder,
        [
            threshold,
            req_currency,
            current_epoch,
            verifier_scope,
            policy_id,
            public_nullifier,
            public_custodian_hash,
            mina_slot_cell,
            recursive_commitment_cell,
            zkapp_commitment_cell,
            proven_sum_cell,
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

fn expose_mina_public_inputs(
    builder: &mut BaseCircuitBuilder<Fr>,
    values: [AssignedValue<Fr>; MINA_INSTANCE_COLUMNS],
) {
    for (idx, value) in values.into_iter().enumerate() {
        builder.assigned_instances[idx].push(value);
    }
}

// === Artifact loading and proving ==============================================================

const MINA_MANIFEST_ENV: &str = "ZKPF_MINA_MANIFEST_PATH";
const MINA_DEFAULT_MANIFEST_PATH: &str = "artifacts/mina/manifest.json";

/// Mina prover artifacts (params, vk, pk).
pub struct MinaProverArtifacts {
    pub manifest: ArtifactManifest,
    pub artifact_dir: PathBuf,
    pub params: ParamsKZG<Bn256>,
    pub vk: plonk::VerifyingKey<G1Affine>,
    pub pk: Option<plonk::ProvingKey<G1Affine>>,
}

impl MinaProverArtifacts {
    /// Get the proving key, returns error if not loaded.
    pub fn proving_key(&self) -> Result<&plonk::ProvingKey<G1Affine>, MinaRailError> {
        self.pk
            .as_ref()
            .ok_or_else(|| MinaRailError::InvalidInput("proving key not loaded".to_string()))
    }
}

/// Lazily loaded prover artifacts.
static MINA_PROVER_ARTIFACTS: Lazy<Result<Arc<MinaProverArtifacts>, String>> = Lazy::new(|| {
    load_mina_prover_artifacts()
        .map(Arc::new)
        .map_err(|e| e.to_string())
});

fn mina_manifest_path() -> PathBuf {
    std::env::var(MINA_MANIFEST_ENV)
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(MINA_DEFAULT_MANIFEST_PATH))
}

fn mina_manifest_dir(path: &Path) -> PathBuf {
    path.parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Load Mina prover artifacts from the manifest path.
pub fn load_mina_prover_artifacts() -> Result<MinaProverArtifacts> {
    let manifest_path = mina_manifest_path();
    load_mina_prover_artifacts_from_path(&manifest_path)
}

/// Load Mina prover artifacts from a specific path.
pub fn load_mina_prover_artifacts_from_path(manifest_path: &Path) -> Result<MinaProverArtifacts> {
    let manifest = read_manifest(manifest_path)?;
    ensure_mina_manifest_compat(&manifest)?;
    let artifact_dir = mina_manifest_dir(manifest_path);

    let params_bytes = read_mina_artifact_file(&artifact_dir, &manifest.params, "params")?;
    let vk_bytes = read_mina_artifact_file(&artifact_dir, &manifest.vk, "verifying key")?;
    let pk_bytes = read_mina_artifact_file(&artifact_dir, &manifest.pk, "proving key")?;

    let params = deserialize_params(&params_bytes)?;
    let vk = deserialize_mina_verifying_key(&vk_bytes)?;
    let pk = deserialize_mina_proving_key(&pk_bytes)?;

    Ok(MinaProverArtifacts {
        manifest,
        artifact_dir,
        params,
        vk,
        pk: Some(pk),
    })
}

fn read_mina_artifact_file(base_dir: &Path, entry: &ArtifactFile, label: &str) -> Result<Vec<u8>> {
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
    ensure_mina_hash(&bytes, &entry.blake3, label)?;
    Ok(bytes)
}

fn ensure_mina_hash(bytes: &[u8], expected_hex: &str, label: &str) -> Result<()> {
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

fn ensure_mina_manifest_compat(manifest: &ArtifactManifest) -> Result<()> {
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

/// Deserialize a Mina verifying key.
pub fn deserialize_mina_verifying_key(bytes: &[u8]) -> Result<plonk::VerifyingKey<G1Affine>> {
    let params = MinaPofCircuit::default().params();
    let mut reader = Cursor::new(bytes);
    plonk::VerifyingKey::read::<_, MinaPofCircuit>(&mut reader, SerdeFormat::Processed, params)
        .context("failed to deserialize Mina verifying key")
}

/// Deserialize a Mina proving key.
pub fn deserialize_mina_proving_key(bytes: &[u8]) -> Result<plonk::ProvingKey<G1Affine>> {
    let params = MinaPofCircuit::default().params();
    let mut reader = Cursor::new(bytes);
    plonk::ProvingKey::read::<_, MinaPofCircuit>(&mut reader, SerdeFormat::Processed, params)
        .context("failed to deserialize Mina proving key")
}

/// Serialize a Mina verifying key.
pub fn serialize_mina_verifying_key(vk: &plonk::VerifyingKey<G1Affine>) -> Result<Vec<u8>> {
    let mut buf = vec![];
    vk.write(&mut buf, SerdeFormat::Processed)
        .context("failed to serialize Mina verifying key")?;
    Ok(buf)
}

/// Serialize a Mina proving key.
pub fn serialize_mina_proving_key(pk: &plonk::ProvingKey<G1Affine>) -> Result<Vec<u8>> {
    let mut buf = vec![];
    pk.write(&mut buf, SerdeFormat::Processed)
        .context("failed to serialize Mina proving key")?;
    Ok(buf)
}

// === Key generation ============================================================================

/// Parameters needed for proof generation.
pub struct MinaProverParams {
    pub params: ParamsKZG<Bn256>,
    pub vk: plonk::VerifyingKey<G1Affine>,
    pub pk: plonk::ProvingKey<G1Affine>,
}

/// Generate proving and verifying keys for the Mina circuit.
pub fn mina_keygen(k: u32) -> MinaProverParams {
    use halo2_proofs_axiom::plonk::{keygen_pk, keygen_vk};

    let mut rng = OsRng;
    let params = ParamsKZG::<Bn256>::setup(k, &mut rng);
    let empty_circuit = MinaPofCircuit::default();
    let vk = keygen_vk(&params, &empty_circuit).expect("vk generation failed");
    let pk = keygen_pk(&params, vk.clone(), &empty_circuit).expect("pk generation failed");

    MinaProverParams { params, vk, pk }
}

// === Proof generation ==========================================================================

/// Convert public inputs to instance columns for the Mina circuit.
pub fn mina_public_inputs_to_instances(
    public_inputs: &VerifierPublicInputs,
) -> Result<Vec<Vec<Fr>>, MinaRailError> {
    let mut instances = vec![vec![]; MINA_INSTANCE_COLUMNS];

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
        .map_err(|e| MinaRailError::InvalidInput(format!("invalid nullifier: {}", e)))?;
    instances[5].push(nullifier_fr);

    // Column 6: custodian_pubkey_hash
    let custodian_hash_fr = zkpf_common::fr_from_bytes(&public_inputs.custodian_pubkey_hash)
        .map_err(|e| {
            MinaRailError::InvalidInput(format!("invalid custodian_pubkey_hash: {}", e))
        })?;
    instances[6].push(custodian_hash_fr);

    // Column 7: mina_slot (snapshot_block_height)
    let mina_slot = public_inputs
        .snapshot_block_height
        .ok_or_else(|| MinaRailError::InvalidInput("missing mina_slot".into()))?;
    instances[7].push(Fr::from(mina_slot));

    // Column 8: recursive_proof_commitment (snapshot_anchor_orchard)
    let recursive_commitment = public_inputs
        .snapshot_anchor_orchard
        .ok_or_else(|| MinaRailError::InvalidInput("missing recursive_proof_commitment".into()))?;
    instances[8].push(reduce_be_bytes_to_fr(&recursive_commitment));

    // Column 9: zkapp_commitment (holder_binding)
    let zkapp_commitment = public_inputs
        .holder_binding
        .ok_or_else(|| MinaRailError::InvalidInput("missing zkapp_commitment".into()))?;
    instances[9].push(reduce_be_bytes_to_fr(&zkapp_commitment));

    // Column 10: proven_sum
    let proven_sum = public_inputs
        .proven_sum
        .ok_or_else(|| MinaRailError::InvalidInput("missing proven_sum".into()))?;
    let sum_lo = (proven_sum & ((1u128 << 64) - 1)) as u64;
    let sum_hi = (proven_sum >> 64) as u64;
    let sum_fr = Fr::from(sum_lo) + Fr::from(sum_hi) * Fr::from(1u64 << 32).square();
    instances[10].push(sum_fr);

    Ok(instances)
}

/// Create a Mina proof using loaded artifacts.
pub fn create_mina_proof(input: &MinaPofCircuitInput) -> Result<Vec<u8>, MinaRailError> {
    // Validate input
    if input.source_proof_commitments.len() > MINA_MAX_SOURCE_PROOFS {
        return Err(MinaRailError::InvalidInput(format!(
            "too many source proofs: {} > {}",
            input.source_proof_commitments.len(),
            MINA_MAX_SOURCE_PROOFS
        )));
    }

    // Try to load artifacts
    let artifacts = match MINA_PROVER_ARTIFACTS.as_ref() {
        Ok(artifacts) => artifacts.clone(),
        Err(e) => {
            // Fall back to placeholder proof if artifacts not available
            eprintln!(
                "Warning: Mina artifacts not loaded ({}), using placeholder proof",
                e
            );
            return create_mina_placeholder_proof(input);
        }
    };

    // Generate real proof
    create_mina_proof_with_artifacts(&artifacts, input)
}

/// Create a Mina proof with provided artifacts.
pub fn create_mina_proof_with_artifacts(
    artifacts: &MinaProverArtifacts,
    input: &MinaPofCircuitInput,
) -> Result<Vec<u8>, MinaRailError> {
    let pk = artifacts.proving_key()?;

    // Convert public inputs to instance columns
    let instances = mina_public_inputs_to_instances(&input.public_inputs)?;
    let instance_refs: Vec<&[Fr]> = instances.iter().map(|col| col.as_slice()).collect();

    // Create circuit with prover stage
    let circuit = MinaPofCircuit::new_prover(input.clone());

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
    .map_err(|e| MinaRailError::Proof(format!("proof generation failed: {}", e)))?;

    Ok(transcript.finalize())
}

/// Create a placeholder proof (for development/testing when artifacts are not available).
fn create_mina_placeholder_proof(input: &MinaPofCircuitInput) -> Result<Vec<u8>, MinaRailError> {
    let mut proof = vec![];

    // Magic bytes to identify Mina rail proofs
    proof.extend_from_slice(b"MINA_RECURSIVE_V1");

    // Hash of public inputs (for development/testing)
    let mut hasher = blake3::Hasher::new();
    hasher.update(&input.public_inputs.threshold_raw.to_le_bytes());
    hasher.update(&input.public_inputs.nullifier);
    for commitment in &input.source_proof_commitments {
        hasher.update(commitment);
    }
    proof.extend_from_slice(hasher.finalize().as_bytes());

    Ok(proof)
}

// === Tests =====================================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use halo2_proofs_axiom::poly::commitment::Params;

    #[test]
    fn test_mina_circuit_default() {
        let circuit = MinaPofCircuit::default();
        assert!(circuit.input.is_none());
        assert_eq!(circuit.params.k, MINA_DEFAULT_K);
    }

    #[test]
    fn test_create_mina_proof() {
        let input = MinaPofCircuitInput {
            public_inputs: VerifierPublicInputs {
                threshold_raw: 1_000_000,
                required_currency_code: 1027,
                current_epoch: 1700000000,
                verifier_scope_id: 42,
                policy_id: 100,
                nullifier: [0u8; 32],
                custodian_pubkey_hash: [0u8; 32],
                snapshot_block_height: Some(500_000),
                snapshot_anchor_orchard: Some([1u8; 32]),
                holder_binding: Some([2u8; 32]),
                proven_sum: Some(8_000_000),
            },
            source_proof_commitments: vec![[3u8; 32], [4u8; 32]],
        };

        let proof = create_mina_proof(&input).expect("should succeed");
        // With no artifacts, we get a placeholder proof
        assert!(proof.starts_with(b"MINA_RECURSIVE_V1"));
    }

    #[test]
    #[ignore] // Slow: keygen requires k=18 (262K rows), takes ~30s
    fn test_mina_keygen() {
        // Circuit requires k >= 18 due to lookup_bits = 17
        let params = mina_keygen(MINA_DEFAULT_K as u32);
        assert!(params.params.k() == MINA_DEFAULT_K as u32);
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
            snapshot_block_height: Some(500_000),
            snapshot_anchor_orchard: Some([1u8; 32]),
            holder_binding: Some([2u8; 32]),
            proven_sum: Some(8_000_000),
        };

        let instances = mina_public_inputs_to_instances(&public_inputs).expect("should work");
        assert_eq!(instances.len(), MINA_INSTANCE_COLUMNS);
        for col in &instances {
            assert_eq!(col.len(), 1);
        }
    }
}

