//! zkpf-zcash-orchard-circuit
//!
//! This crate defines the public API for the ZCASH_ORCHARD rail in the zkpf stack
//! and a minimal Halo2 circuit used to prove Orchard-style proof-of-funds statements.
//!
//! The current circuit focuses on:
//! - enforcing that the sum of private Orchard note values is >= the public threshold,
//! - exposing Orchard snapshot metadata (height, anchor, holder binding) as public inputs,
//! - wiring into the shared `ProofBundle` / artifact tooling used by the backend.
//!
//! It does **not yet** reimplement the full Orchard protocol inside the bn256 circuit
//! (note commitment hash, Orchard Merkle tree, UFVK ownership); those remain future,
//! protocol-level upgrades, but the pipeline (artifacts, prover, verifier) is complete.

use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{anyhow, ensure, Context, Result};
use blake3::Hasher;
use halo2_proofs_axiom::{
    circuit::{Layouter, SimpleFloorPlanner},
    plonk::{self, Circuit, ConstraintSystem, Error},
    poly::kzg::commitment::ParamsKZG,
    SerdeFormat,
};
use halo2_base::{
    gates::{
        circuit::builder::BaseCircuitBuilder,
        circuit::{BaseCircuitParams, BaseConfig, CircuitBuilderStage},
        range::RangeChip,
        GateChip, GateInstructions, RangeInstructions,
    },
    AssignedValue, Context,
    QuantumCell::Constant,
};
use halo2curves_axiom::bn256::{Bn256, Fr, G1Affine};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use zkpf_circuit::gadgets::compare;
use zkpf_common::{
    hash_bytes_hex, public_inputs_to_instances_with_layout, reduce_be_bytes_to_fr,
    deserialize_params, fr_from_bytes, read_manifest, ArtifactFile, ArtifactManifest, ProofBundle,
    ProverArtifacts, PublicInputLayout, VerifierArtifacts, VerifierPublicInputs, CIRCUIT_VERSION,
    MANIFEST_VERSION,
};
use zkpf_zcash_orchard_wallet::{OrchardFvk, OrchardSnapshot};

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

const ORCHARD_DEFAULT_K: usize = 19;
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
}

impl Default for OrchardPofCircuit {
    fn default() -> Self {
        Self {
            input: None,
            params: orchard_default_params(),
        }
    }
}

impl OrchardPofCircuit {
    pub fn new(input: Option<OrchardPofCircuitInput>) -> Self {
        Self {
            input,
            params: orchard_default_params(),
        }
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
        let stage = if self.input.is_some() {
            CircuitBuilderStage::Mock
        } else {
            CircuitBuilderStage::Keygen
        };

        let input = self
            .input
            .as_ref()
            .expect("OrchardPofCircuit requires concrete input for synthesis");

        let mut builder = BaseCircuitBuilder::<Fr>::from_stage(stage)
            .use_params(self.params.clone())
            .use_instance_columns(self.params.num_instance_columns);

        if let Some(bits) = self.params.lookup_bits {
            builder = builder.use_lookup_bits(bits);
        }

        build_orchard_constraints(&mut builder, input)?;
        <BaseCircuitBuilder<Fr> as Circuit<Fr>>::synthesize(&builder, config, layouter)
    }
}

fn build_orchard_constraints(
    builder: &mut BaseCircuitBuilder<Fr>,
    input: &OrchardPofCircuitInput,
) -> Result<(), Error> {
    let range = builder.range_chip();
    let gate = range.gate();

    let pub_in = &input.public_inputs;
    let mut ctx = builder.main(0);

    // Core public fields (V1 prefix)
    let threshold = assign_u64(&mut ctx, &range, pub_in.threshold_raw);
    let req_currency = assign_u32(&mut ctx, &range, pub_in.required_currency_code);
    let req_custodian = assign_u32(&mut ctx, &range, pub_in.required_custodian_id);
    let current_epoch = assign_u64(&mut ctx, &range, pub_in.current_epoch);
    let verifier_scope = assign_u64(&mut ctx, &range, pub_in.verifier_scope_id);
    let policy_id = assign_u64(&mut ctx, &range, pub_in.policy_id);

    // Nullifier and custodian_pubkey_hash are treated as opaque scalars; the rail
    // ensures their encoding via off-circuit hashing.
    let nullifier_fr = zkpf_common::fr_from_bytes(&pub_in.nullifier)
        .map_err(|_| Error::Synthesis)?;
    let custodian_hash_fr = zkpf_common::fr_from_bytes(&pub_in.custodian_pubkey_hash)
        .map_err(|_| Error::Synthesis)?;
    let public_nullifier = ctx.load_witness(nullifier_fr);
    let public_custodian_hash = ctx.load_witness(custodian_hash_fr);

    // Orchard-specific snapshot metadata.
    let snapshot_height = pub_in
        .snapshot_block_height
        .ok_or_else(|| Error::Synthesis)?;
    let snapshot_anchor_bytes = pub_in
        .snapshot_anchor_orchard
        .ok_or_else(|| Error::Synthesis)?;
    let holder_binding_bytes = pub_in
        .holder_binding
        .ok_or_else(|| Error::Synthesis)?;

    let snapshot_height_cell = assign_u64(&mut ctx, &range, snapshot_height);
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
        let note_val = assign_u64(&mut ctx, &range, *value);
        sum = gate.add(&mut ctx, sum, note_val);
    }
    compare::enforce_geq(&mut ctx, &gate, &range, sum, threshold);

    // Expose all public inputs in the V2_ORCHARD order expected by
    // `public_inputs_to_instances_with_layout`.
    expose_orchard_public_inputs(
        builder,
        [
            threshold,
            req_currency,
            req_custodian,
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

fn assign_u64(ctx: &mut Context<Fr>, range: &RangeChip<Fr>, value: u64) -> AssignedValue<Fr> {
    let cell = ctx.load_witness(Fr::from(value));
    range.range_check(ctx, cell, 64);
    cell
}

fn assign_u32(ctx: &mut Context<Fr>, range: &RangeChip<Fr>, value: u32) -> AssignedValue<Fr> {
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
        // For the Orchard rail, `required_custodian_id` can represent the
        // entity operating the rail (e.g. a specific Zcash lightwalletd/attestor).
        required_custodian_id: 0,
        current_epoch: meta.current_epoch,
        verifier_scope_id: meta.verifier_scope_id,
        policy_id: meta.policy_id,
        nullifier,
        custodian_pubkey_hash,
        snapshot_block_height: None,
        snapshot_anchor_orchard: None,
        holder_binding: None,
    };

    inputs.snapshot_block_height = Some(orchard_meta.block_height as u64);
    inputs.snapshot_anchor_orchard = Some(orchard_meta.anchor_orchard);
    inputs.holder_binding = Some(orchard_meta.holder_binding);

    inputs
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
    let total_zats: u64 = snapshot
        .notes
        .iter()
        .map(|n| n.value_zats)
        .sum();
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

    let mut bundle = ProofBundle {
        rail_id: RAIL_ID_ZCASH_ORCHARD.to_string(),
        circuit_version: CIRCUIT_VERSION,
        proof,
        public_inputs,
    };

    Ok(bundle)
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

static ORCHARD_PROVER_ARTIFACTS: Lazy<Arc<ProverArtifacts>> =
    Lazy::new(|| Arc::new(load_orchard_prover_artifacts().expect("load Orchard prover artifacts")));

fn orchard_manifest_path() -> PathBuf {
    std::env::var(ORCHARD_MANIFEST_ENV)
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(ORCHARD_DEFAULT_MANIFEST_PATH))
}

fn load_orchard_prover_artifacts() -> Result<ProverArtifacts> {
    let manifest_path = orchard_manifest_path();
    let (manifest, params_bytes, vk_bytes, pk_bytes) =
        load_orchard_artifact_bytes(&manifest_path)?;

    let params = deserialize_params(&params_bytes)?;
    let vk = deserialize_orchard_verifying_key(&vk_bytes)?;
    let pk = deserialize_orchard_proving_key(&pk_bytes)?;

    Ok(ProverArtifacts {
        manifest,
        params_bytes,
        vk_bytes,
        pk_bytes,
        params,
        vk,
        pk,
    })
}

pub fn load_orchard_verifier_artifacts(
    manifest_path: impl AsRef<Path>,
) -> Result<VerifierArtifacts> {
    let (manifest, params_bytes, vk_bytes, _) = load_orchard_artifact_bytes(manifest_path.as_ref())?;

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
    let circuit = OrchardPofCircuit::new(Some(input.clone()));

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
        &artifacts.pk,
        &[circuit],
        &[instance_refs.as_slice()],
        rand::rngs::OsRng,
        &mut transcript,
    )
    .map_err(|e| OrchardRailError::InvalidInput(format!("proof generation failed: {e}")))?;

    let proof = transcript.finalize();
    Ok((proof, public_inputs))
}


