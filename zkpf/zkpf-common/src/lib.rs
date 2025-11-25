use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{anyhow, ensure, Context, Result};
use halo2_proofs_axiom::{
    plonk::{self, Circuit},
    poly::{commitment::Params, kzg::commitment::ParamsKZG},
    SerdeFormat,
};
use halo2curves_axiom::{
    bn256::{Bn256, Fr, G1Affine},
    ff::{Field, PrimeField},
};
use once_cell::sync::OnceCell;
use poseidon_primitives::poseidon::primitives::{ConstantLength, Hash as PoseidonHash, Spec};
use serde::{Deserialize, Serialize};
use zkpf_circuit::{
    gadgets::attestation::{AttestationWitness, EcdsaSignature, Secp256k1Pubkey},
    public_instances, PublicInputs, ZkpfCircuit,
};

/// Number of public inputs in the legacy custodial circuit layout (V1).
pub const PUBLIC_INPUT_COUNT: usize = 7;
/// Number of public inputs in the Orchard layout (V2_ORCHARD): V1 prefix + 3 Orchard fields.
pub const PUBLIC_INPUT_COUNT_V2_ORCHARD: usize = 10;
/// Number of public inputs in the Starknet layout (V3_STARKNET): V1 prefix + 4 Starknet fields.
/// Fields: chain_id_numeric, block_number, account_commitment, holder_binding
pub const PUBLIC_INPUT_COUNT_V3_STARKNET: usize = 11;

// Re-export Poseidon parameters from zkpf-circuit (the canonical source)
// to maintain backward compatibility for crates that import from zkpf-common.
pub use zkpf_circuit::gadgets::poseidon::{
    POSEIDON_FULL_ROUNDS, POSEIDON_PARTIAL_ROUNDS, POSEIDON_RATE, POSEIDON_T,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VerifierPublicInputs {
    pub threshold_raw: u64,
    pub required_currency_code: u32,
    pub current_epoch: u64,
    pub verifier_scope_id: u64,
    pub policy_id: u64,
    pub nullifier: [u8; 32],
    pub custodian_pubkey_hash: [u8; 32],
    /// Optional snapshot metadata for non-custodial rails (e.g. Zcash Orchard).
    ///
    /// For the legacy custodial rail this will be `None`, and the corresponding
    /// public-input layout (V1) does not include these fields.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot_block_height: Option<u64>,
    /// Orchard anchor (Merkle root) at `snapshot_block_height`, if applicable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot_anchor_orchard: Option<[u8; 32]>,
    /// Optional binding between holder identity and rail-specific key material.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub holder_binding: Option<[u8; 32]>,
    /// Optional proven sum for transparency (Starknet rail).
    /// The actual aggregated balance value that was proven to meet the threshold.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proven_sum: Option<u128>,
}

/// Logical public-input layouts supported by the verifier.
///
/// - `V1` – legacy custodial attestation rail (8 public inputs).
/// - `V2Orchard` – Orchard rail layout: V1 prefix plus Orchard snapshot fields.
/// - `V3Starknet` – Starknet L2 rail layout: V1 prefix plus Starknet-specific fields.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub enum PublicInputLayout {
    #[serde(rename = "V1")]
    V1,
    #[serde(rename = "V2_ORCHARD")]
    V2Orchard,
    #[serde(rename = "V3_STARKNET")]
    V3Starknet,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProofBundle {
    /// Logical rail identifier for this proof bundle.
    ///
    /// For legacy custodial proofs that predate rail-awareness, this may be the
    /// empty string or omitted entirely in JSON, in which case verifiers should
    /// treat it as the default custodial rail.
    #[serde(default)]
    pub rail_id: String,
    pub circuit_version: u32,
    pub proof: Vec<u8>,
    pub public_inputs: VerifierPublicInputs,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Attestation {
    pub balance_raw: u64,
    pub currency_code_int: u32,
    pub custodian_id: u32,
    pub attestation_id: u64,
    pub issued_at: u64,
    pub valid_until: u64,
    #[serde(with = "serde_bytes32")]
    pub account_id_hash: [u8; 32],
    pub custodian_pubkey: Secp256k1Pubkey,
    pub signature: EcdsaSignature,
    #[serde(with = "serde_bytes32")]
    pub message_hash: [u8; 32],
}

#[derive(Clone, Debug)]
pub struct AttestationFields<'a> {
    pub balance_raw: u64,
    pub currency_code_int: u32,
    pub custodian_id: u32,
    pub attestation_id: u64,
    pub issued_at: u64,
    pub valid_until: u64,
    pub account_id_hash: &'a [u8; 32],
}

impl<'a> From<&'a Attestation> for AttestationFields<'a> {
    fn from(att: &'a Attestation) -> Self {
        Self {
            balance_raw: att.balance_raw,
            currency_code_int: att.currency_code_int,
            custodian_id: att.custodian_id,
            attestation_id: att.attestation_id,
            issued_at: att.issued_at,
            valid_until: att.valid_until,
            account_id_hash: &att.account_id_hash,
        }
    }
}

impl Attestation {
    pub fn to_witness(&self) -> AttestationWitness {
        AttestationWitness {
            balance_raw: self.balance_raw,
            currency_code_int: self.currency_code_int,
            custodian_id: self.custodian_id,
            attestation_id: self.attestation_id,
            issued_at: self.issued_at,
            valid_until: self.valid_until,
            account_id_hash: reduce_be_bytes_to_fr(&self.account_id_hash),
            custodian_pubkey: self.custodian_pubkey,
            signature: self.signature.clone(),
            message_hash: self.message_hash,
        }
    }

    pub fn verify_message_hash(&self) -> Result<()> {
        let expected = attestation_message_hash(&AttestationFields::from(self));
        ensure!(
            expected == self.message_hash,
            "message_hash does not match canonical attestation digest"
        );
        Ok(())
    }
}

pub fn attestation_from_json(json: &str) -> Result<Attestation> {
    serde_json::from_str(json).context("failed to parse attestation JSON")
}

pub fn attestation_message_hash(fields: &AttestationFields<'_>) -> [u8; 32] {
    let digest = poseidon_hash(&[
        Fr::from(fields.balance_raw),
        Fr::from(fields.attestation_id),
        Fr::from(fields.currency_code_int as u64),
        Fr::from(fields.custodian_id as u64),
        Fr::from(fields.issued_at),
        Fr::from(fields.valid_until),
        reduce_be_bytes_to_fr(fields.account_id_hash),
    ]);
    fr_to_be_bytes(&digest)
}

pub const CIRCUIT_VERSION: u32 = 3;
pub const MANIFEST_VERSION: u32 = 1;
pub const MANIFEST_FILE: &str = "manifest.json";

// ============================================================
// Artifact Integrity & Security Notes
// ============================================================
//
// The artifact manifest system provides **integrity verification** through
// BLAKE3 hashes: if any artifact file is corrupted or truncated, loading
// will fail with a hash mismatch error.
//
// However, the manifest itself is NOT cryptographically signed. This means:
//
// **Threat Model Considerations:**
//
// 1. **Filesystem Access Attack**: An attacker with filesystem write access
//    could replace both the manifest AND the artifact files consistently,
//    potentially substituting malicious proving/verifying keys.
//
// 2. **Supply Chain Attack**: Artifacts distributed over insecure channels
//    (HTTP, unverified CDN) could be replaced in transit.
//
// **Recommended Mitigations for High-Security Deployments:**
//
// 1. **Manifest Signing**: Sign the manifest with a long-term key (e.g., Ed25519)
//    and verify the signature before loading artifacts.
//
// 2. **Embedded VK Commitment**: Embed the expected verifying key commitment
//    (e.g., BLAKE3 hash of vk_bytes) directly in application code. This acts
//    as a "trust anchor" that cannot be modified without recompiling.
//
//    ```ignore
//    const EXPECTED_VK_HASH: &str = "abc123..."; // from trusted source
//    assert_eq!(hash_bytes_hex(&vk_bytes), EXPECTED_VK_HASH);
//    ```
//
// 3. **Content-Addressed Storage**: Distribute artifacts via IPFS or similar
//    systems where the CID (content identifier) serves as an immutable reference.
//
// 4. **Reproducible Builds**: Publish build scripts that allow independent
//    verification of artifact generation from source code.
//
// For most use cases, BLAKE3 hash verification is sufficient. The above
// measures are recommended for deployments where artifact compromise would
// have severe consequences (e.g., financial systems, regulatory compliance).

/// Metadata for a single artifact file (params, vk, or pk).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ArtifactFile {
    pub path: String,
    /// BLAKE3 hash of the file contents (hex-encoded).
    pub blake3: String,
    pub size: u64,
}

impl ArtifactFile {
    pub fn from_bytes(path: impl Into<String>, bytes: &[u8]) -> Self {
        Self {
            path: path.into(),
            blake3: hash_bytes_hex(bytes),
            size: bytes.len() as u64,
        }
    }

    fn resolve_path(&self, base_dir: &Path) -> PathBuf {
        base_dir.join(&self.path)
    }
}

/// Circuit artifact manifest describing the params, verifying key, and proving key.
///
/// The manifest provides integrity verification via BLAKE3 hashes of each artifact.
/// See the module-level security notes for discussion of manifest signing and
/// additional protections for high-security deployments.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ArtifactManifest {
    pub manifest_version: u32,
    pub circuit_version: u32,
    /// Circuit size parameter (number of rows = 2^k).
    pub k: u32,
    pub created_at_unix: u64,
    pub params: ArtifactFile,
    pub vk: ArtifactFile,
    pub pk: ArtifactFile,
}

#[derive(Clone, Debug)]
pub struct VerifierArtifacts {
    pub manifest: ArtifactManifest,
    pub params_bytes: Vec<u8>,
    pub vk_bytes: Vec<u8>,
    pub params: ParamsKZG<Bn256>,
    pub vk: plonk::VerifyingKey<G1Affine>,
}

#[derive(Clone, Debug)]
pub struct ProverArtifacts {
    pub manifest: ArtifactManifest,
    pub artifact_dir: PathBuf,
    pub params: ParamsKZG<Bn256>,
    pub vk: plonk::VerifyingKey<G1Affine>,
    pk: OnceCell<Arc<plonk::ProvingKey<G1Affine>>>,
    prover_enabled: bool,
}

impl ProverArtifacts {
    pub fn from_parts(
        manifest: ArtifactManifest,
        artifact_dir: PathBuf,
        params: ParamsKZG<Bn256>,
        vk: plonk::VerifyingKey<G1Affine>,
        pk: Option<plonk::ProvingKey<G1Affine>>,
    ) -> Self {
        let pk_cell = OnceCell::new();
        let prover_enabled = if let Some(pk) = pk {
            pk_cell
                .set(Arc::new(pk))
                .expect("pk OnceCell should be empty on initialization");
            true
        } else {
            false
        };

        Self {
            manifest,
            artifact_dir,
            params,
            vk,
            pk: pk_cell,
            prover_enabled,
        }
    }

    pub fn params_blob(&self) -> Result<Vec<u8>> {
        match read_artifact_file(&self.artifact_dir, &self.manifest.params, "params") {
            Ok(bytes) => Ok(bytes),
            Err(err) => {
                // In test environments or ephemeral setups the params blob may
                // not be present on disk. Fall back to serializing the in-memory
                // KZG params so callers can still obtain a canonical blob.
                serialize_params(&self.params)
                    .with_context(|| format!("failed to load params blob: {err}"))
            }
        }
    }

    pub fn vk_blob(&self) -> Result<Vec<u8>> {
        match read_artifact_file(&self.artifact_dir, &self.manifest.vk, "verifying key") {
            Ok(bytes) => Ok(bytes),
            Err(err) => {
                // Mirror the params fallback: if the verifying key blob is not
                // available on disk, serialize it from the in-memory structure.
                serialize_verifying_key(&self.vk)
                    .with_context(|| format!("failed to load verifying key blob: {err}"))
            }
        }
    }

    pub fn pk_blob(&self) -> Result<Vec<u8>> {
        match read_artifact_file(&self.artifact_dir, &self.manifest.pk, "proving key") {
            Ok(bytes) => Ok(bytes),
            Err(err) => {
                // When the prover is enabled but the proving key blob is not
                // available on disk, serialize it from the in-memory proving
                // key (if present). This keeps tests and ephemeral setups from
                // depending on an on-disk pk.bin.
                let pk = self.proving_key().with_context(|| {
                    format!("failed to recover proving key after disk read error: {err}")
                })?;
                serialize_proving_key(pk.as_ref()).with_context(|| {
                    format!("failed to serialize proving key after disk read error: {err}")
                })
            }
        }
    }

    pub fn prover_enabled(&self) -> bool {
        self.prover_enabled
    }

    pub fn proving_key(&self) -> Result<Arc<plonk::ProvingKey<G1Affine>>> {
        if !self.prover_enabled {
            anyhow::bail!("prover support is disabled for this deployment");
        }

        self.pk
            .get_or_try_init(|| {
                let bytes = self.pk_blob()?;
                deserialize_proving_key(&bytes).map(Arc::new)
            })
            .map(Arc::clone)
    }

    /// On-disk path to the params blob.
    pub fn params_path(&self) -> PathBuf {
        self.manifest.params.resolve_path(&self.artifact_dir)
    }

    /// On-disk path to the verifying key blob.
    pub fn vk_path(&self) -> PathBuf {
        self.manifest.vk.resolve_path(&self.artifact_dir)
    }

    /// On-disk path to the proving key blob.
    pub fn pk_path(&self) -> PathBuf {
        self.manifest.pk.resolve_path(&self.artifact_dir)
    }
}

pub fn serialize_params(params: &ParamsKZG<Bn256>) -> Result<Vec<u8>> {
    let mut buf = vec![];
    params
        .write(&mut buf)
        .context("failed to serialize KZG params")?;
    Ok(buf)
}

pub fn deserialize_params(bytes: &[u8]) -> Result<ParamsKZG<Bn256>> {
    let mut reader = Cursor::new(bytes);
    ParamsKZG::<Bn256>::read(&mut reader).context("failed to deserialize KZG params")
}

pub fn serialize_verifying_key(vk: &plonk::VerifyingKey<G1Affine>) -> Result<Vec<u8>> {
    let mut buf = vec![];
    vk.write(&mut buf, SerdeFormat::Processed)
        .context("failed to serialize verifying key")?;
    Ok(buf)
}

pub fn deserialize_verifying_key(bytes: &[u8]) -> Result<plonk::VerifyingKey<G1Affine>> {
    let params = ZkpfCircuit::default().params();
    let mut reader = Cursor::new(bytes);
    plonk::VerifyingKey::read::<_, ZkpfCircuit>(&mut reader, SerdeFormat::Processed, params)
        .context("failed to deserialize verifying key")
}

pub fn verifier_inputs_to_public(inputs: &VerifierPublicInputs) -> Result<PublicInputs> {
    Ok(PublicInputs {
        threshold_raw: inputs.threshold_raw,
        required_currency_code: inputs.required_currency_code,
        current_epoch: inputs.current_epoch,
        verifier_scope_id: inputs.verifier_scope_id,
        policy_id: inputs.policy_id,
        nullifier: fr_from_bytes(&inputs.nullifier)?,
        custodian_pubkey_hash: fr_from_bytes(&inputs.custodian_pubkey_hash)?,
    })
}

pub fn public_to_verifier_inputs(public: &PublicInputs) -> VerifierPublicInputs {
    VerifierPublicInputs {
        threshold_raw: public.threshold_raw,
        required_currency_code: public.required_currency_code,
        current_epoch: public.current_epoch,
        verifier_scope_id: public.verifier_scope_id,
        policy_id: public.policy_id,
        nullifier: fr_to_bytes(&public.nullifier),
        custodian_pubkey_hash: fr_to_bytes(&public.custodian_pubkey_hash),
        snapshot_block_height: None,
        snapshot_anchor_orchard: None,
        holder_binding: None,
        proven_sum: None,
    }
}

pub fn public_inputs_to_instances(inputs: &VerifierPublicInputs) -> Result<Vec<Vec<Fr>>> {
    let public = verifier_inputs_to_public(inputs)?;
    Ok(public_instances(&public))
}

/// Convert verifier-facing public inputs into Halo2 instances for a specific layout.
///
/// - `PublicInputLayout::V1` uses the legacy custodial layout (8 public inputs).
/// - `PublicInputLayout::V2Orchard` appends Orchard snapshot metadata as additional
///   instance columns while preserving the V1 prefix ordering.
pub fn public_inputs_to_instances_with_layout(
    layout: PublicInputLayout,
    inputs: &VerifierPublicInputs,
) -> Result<Vec<Vec<Fr>>> {
    match layout {
        PublicInputLayout::V1 => public_inputs_to_instances(inputs),
        PublicInputLayout::V2Orchard => {
            let snapshot_height = inputs.snapshot_block_height.ok_or_else(|| {
                anyhow!("snapshot_block_height is required for V2_ORCHARD public-input layout")
            })?;
            let snapshot_anchor_bytes = inputs.snapshot_anchor_orchard.ok_or_else(|| {
                anyhow!("snapshot_anchor_orchard is required for V2_ORCHARD public-input layout")
            })?;

            // For now we treat a missing holder_binding as zero; rails that require a
            // binding can enforce its presence at a higher layer.
            let holder_binding_bytes = inputs.holder_binding.unwrap_or([0u8; 32]);

            // Reuse the existing PublicInputs conversion for the V1 prefix.
            let public = verifier_inputs_to_public(inputs)?;
            let mut cols = public_instances(&public);

            // Orchard-specific trailing fields.
            let snapshot_height_fr = Fr::from(snapshot_height);
            let anchor_fr = reduce_be_bytes_to_fr(&snapshot_anchor_bytes);
            let holder_binding_fr = reduce_be_bytes_to_fr(&holder_binding_bytes);

            cols.push(vec![snapshot_height_fr]);
            cols.push(vec![anchor_fr]);
            cols.push(vec![holder_binding_fr]);

            Ok(cols)
        }
        PublicInputLayout::V3Starknet => {
            // Starknet L2 layout: V1 prefix + 4 Starknet-specific fields = 11 columns total
            let block_number = inputs.snapshot_block_height.ok_or_else(|| {
                anyhow!("snapshot_block_height (block_number) is required for V3_STARKNET public-input layout")
            })?;
            // Reuse snapshot_anchor_orchard field for account_commitment
            let account_commitment_bytes = inputs.snapshot_anchor_orchard.ok_or_else(|| {
                anyhow!("snapshot_anchor_orchard (account_commitment) is required for V3_STARKNET public-input layout")
            })?;
            let holder_binding_bytes = inputs.holder_binding.unwrap_or([0u8; 32]);
            // proven_sum is required for V3_STARKNET to match circuit's 11-column layout
            let proven_sum = inputs.proven_sum.ok_or_else(|| {
                anyhow!("proven_sum is required for V3_STARKNET public-input layout")
            })?;

            // Reuse the existing PublicInputs conversion for the V1 prefix (7 columns).
            let public = verifier_inputs_to_public(inputs)?;
            let mut cols = public_instances(&public);

            // Starknet-specific trailing fields (4 columns: 7+4=11 total).
            let block_number_fr = Fr::from(block_number);
            let account_commitment_fr = reduce_be_bytes_to_fr(&account_commitment_bytes);
            let holder_binding_fr = reduce_be_bytes_to_fr(&holder_binding_bytes);
            // proven_sum as u128 -> split into two u64 limbs and pack into Fr
            // For simplicity, we truncate to u64 here; full u128 support would need
            // more complex encoding or multiple field elements
            let proven_sum_fr = Fr::from(proven_sum as u64);

            cols.push(vec![block_number_fr]);
            cols.push(vec![account_commitment_fr]);
            cols.push(vec![holder_binding_fr]);
            cols.push(vec![proven_sum_fr]);

            Ok(cols)
        }
    }
}

pub fn public_inputs_vector(public: &PublicInputs) -> [Fr; PUBLIC_INPUT_COUNT] {
    [
        Fr::from(public.threshold_raw),
        Fr::from(public.required_currency_code as u64),
        Fr::from(public.current_epoch),
        Fr::from(public.verifier_scope_id),
        Fr::from(public.policy_id),
        public.nullifier,
        public.custodian_pubkey_hash,
    ]
}

pub fn verifier_inputs_vector(inputs: &VerifierPublicInputs) -> Result<[Fr; PUBLIC_INPUT_COUNT]> {
    Ok(public_inputs_vector(&verifier_inputs_to_public(inputs)?))
}

pub fn instances_to_public_inputs(instances: &[Vec<Fr>]) -> Result<PublicInputs> {
    ensure!(
        instances.len() == PUBLIC_INPUT_COUNT,
        "expected {} instance columns, got {}",
        PUBLIC_INPUT_COUNT,
        instances.len()
    );
    Ok(PublicInputs {
        threshold_raw: fr_to_u64(&first_instance(instances, 0, "threshold_raw")?)?,
        required_currency_code: fr_to_u32(&first_instance(
            instances,
            1,
            "required_currency_code",
        )?)?,
        current_epoch: fr_to_u64(&first_instance(instances, 2, "current_epoch")?)?,
        verifier_scope_id: fr_to_u64(&first_instance(instances, 3, "verifier_scope_id")?)?,
        policy_id: fr_to_u64(&first_instance(instances, 4, "policy_id")?)?,
        nullifier: first_instance(instances, 5, "nullifier")?,
        custodian_pubkey_hash: first_instance(instances, 6, "custodian_pubkey_hash")?,
    })
}

pub fn instances_to_verifier_inputs(instances: &[Vec<Fr>]) -> Result<VerifierPublicInputs> {
    let public = instances_to_public_inputs(instances)?;
    Ok(public_to_verifier_inputs(&public))
}

pub fn serialize_verifier_public_inputs(inputs: &VerifierPublicInputs) -> Result<Vec<u8>> {
    serde_json::to_vec(inputs).context("failed to serialize public inputs")
}

pub fn deserialize_verifier_public_inputs(bytes: &[u8]) -> Result<VerifierPublicInputs> {
    serde_json::from_slice(bytes).context("failed to deserialize public inputs")
}

impl ProofBundle {
    pub fn new(proof: Vec<u8>, public_inputs: VerifierPublicInputs) -> Self {
        Self {
            rail_id: String::new(),
            circuit_version: CIRCUIT_VERSION,
            proof,
            public_inputs,
        }
    }
}

pub fn write_manifest(path: impl AsRef<Path>, manifest: &ArtifactManifest) -> Result<()> {
    let json = serde_json::to_vec_pretty(manifest).context("failed to serialize manifest")?;
    fs::write(path.as_ref(), json).context("failed to write manifest")
}

pub fn read_manifest(path: impl AsRef<Path>) -> Result<ArtifactManifest> {
    let bytes = fs::read(path.as_ref()).context("failed to read manifest file")?;
    serde_json::from_slice(&bytes).context("failed to parse manifest json")
}

pub fn load_verifier_artifacts(path: impl AsRef<Path>) -> Result<VerifierArtifacts> {
    let manifest_path = path.as_ref();
    let (manifest, params_bytes, vk_bytes, _) = load_artifact_bytes(manifest_path)?;

    let params = deserialize_params(&params_bytes)?;
    let vk = deserialize_verifying_key(&vk_bytes)?;

    Ok(VerifierArtifacts {
        manifest,
        params_bytes,
        vk_bytes,
        params,
        vk,
    })
}

pub fn load_prover_artifacts(path: impl AsRef<Path>) -> Result<ProverArtifacts> {
    load_prover_artifacts_with_mode(path, true)
}

pub fn load_prover_artifacts_without_pk(path: impl AsRef<Path>) -> Result<ProverArtifacts> {
    load_prover_artifacts_with_mode(path, false)
}

fn load_prover_artifacts_with_mode(
    path: impl AsRef<Path>,
    load_pk: bool,
) -> Result<ProverArtifacts> {
    let manifest_path = path.as_ref();
    let manifest = read_manifest(manifest_path)?;
    ensure_manifest_compat(&manifest)?;
    let artifact_dir = manifest_dir(manifest_path);

    let params_bytes = read_artifact_file(&artifact_dir, &manifest.params, "params")?;
    let vk_bytes = read_artifact_file(&artifact_dir, &manifest.vk, "verifying key")?;
    let pk_bytes = if load_pk {
        Some(read_artifact_file(
            &artifact_dir,
            &manifest.pk,
            "proving key",
        )?)
    } else {
        None
    };

    let params = deserialize_params(&params_bytes)?;
    let vk = deserialize_verifying_key(&vk_bytes)?;
    let pk = if let Some(bytes) = pk_bytes {
        Some(deserialize_proving_key(&bytes)?)
    } else {
        None
    };

    Ok(ProverArtifacts::from_parts(
        manifest,
        artifact_dir,
        params,
        vk,
        pk,
    ))
}

pub fn serialize_proving_key(pk: &plonk::ProvingKey<G1Affine>) -> Result<Vec<u8>> {
    let mut buf = vec![];
    pk.write(&mut buf, SerdeFormat::Processed)
        .context("failed to serialize proving key")?;
    Ok(buf)
}

pub fn deserialize_proving_key(bytes: &[u8]) -> Result<plonk::ProvingKey<G1Affine>> {
    let params = ZkpfCircuit::default().params();
    let mut reader = Cursor::new(bytes);
    plonk::ProvingKey::read::<_, ZkpfCircuit>(&mut reader, SerdeFormat::Processed, params)
        .context("failed to deserialize proving key")
}

pub fn hash_bytes_hex(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

pub fn fr_from_bytes(bytes: &[u8; 32]) -> Result<Fr> {
    Fr::from_bytes(bytes)
        .into_option()
        .ok_or_else(|| anyhow!("invalid bn256 scalar encoding"))
}

pub fn fr_to_bytes(fr: &Fr) -> [u8; 32] {
    let repr = fr.to_repr();
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(repr.as_ref());
    bytes
}

pub fn fr_to_be_bytes(fr: &Fr) -> [u8; 32] {
    let mut bytes = fr_to_bytes(fr);
    bytes.reverse();
    bytes
}

/// BN256 scalar field modulus r (approximately 2^254):
/// r = 21888242871839275222246405745257275088548364400416034343698204186575808495617
///
/// This is the maximum value that can be represented exactly in the BN256 scalar field.
/// Values >= r will be implicitly reduced modulo r during field operations.
const BN256_SCALAR_FIELD_MODULUS: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
    0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91,
    0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

/// Convert big-endian bytes to a field element with **modular reduction**.
///
/// # Security Warning
///
/// This function performs **implicit modular reduction**. A 32-byte value can represent
/// integers up to 2^256 - 1, but the BN256 scalar field modulus is approximately 2^254.
/// This means:
///
/// - **Values >= field modulus will wrap around** (reduced mod r)
/// - **Two different byte inputs can produce the same field element** (collision)
///
/// # When to Use
///
/// Use this function when:
/// - You're hashing external data where the output will be further processed (e.g., Poseidon hash)
/// - Collisions don't matter because the result is used in a collision-resistant hash
/// - You explicitly want modular reduction behavior
///
/// # When NOT to Use
///
/// Do NOT use this function when:
/// - The 32-byte value must be uniquely recoverable from the field element
/// - You need to verify that the original value fits in the field exactly
/// - You're processing untrusted inputs that could exploit collisions
///
/// For those cases, use [`try_be_bytes_to_fr_exact`] which will error on overflow.
///
/// # Example
///
/// ```ignore
/// // Safe: hashing pubkey coordinates for Poseidon - result goes into hash, collisions don't matter
/// let x_fr = reduce_be_bytes_to_fr(&pubkey.x);
/// let y_fr = reduce_be_bytes_to_fr(&pubkey.y);
/// let hash = poseidon_hash(&[x_fr, y_fr]);
///
/// // Unsafe without validation: if you need to recover the original bytes
/// // let value = reduce_be_bytes_to_fr(&untrusted_input); // May lose information!
/// ```
pub fn reduce_be_bytes_to_fr(bytes: &[u8; 32]) -> Fr {
    let mut acc = Fr::zero();
    let base = Fr::from(256);
    for byte in bytes.iter() {
        acc = acc * base + Fr::from(*byte as u64);
    }
    acc
}

/// Convert big-endian bytes to a field element with **exact representation check**.
///
/// Returns an error if the 32-byte value is >= the BN256 scalar field modulus,
/// meaning it cannot be represented exactly without modular reduction.
///
/// # Security
///
/// Use this function when you need to ensure:
/// - The input value fits in the field without any reduction
/// - The original 32-byte value can be uniquely recovered from the field element
/// - No two different inputs will map to the same field element
///
/// # Errors
///
/// Returns `Err` if `bytes` represents an integer >= the field modulus r, where:
/// r = 21888242871839275222246405745257275088548364400416034343698204186575808495617
///
/// # Example
///
/// ```ignore
/// // This will succeed for values < field modulus
/// let small_value = [0u8; 32];
/// assert!(try_be_bytes_to_fr_exact(&small_value).is_ok());
///
/// // This will fail for values >= field modulus
/// let large_value = [0xFF; 32]; // 2^256 - 1, much larger than field modulus
/// assert!(try_be_bytes_to_fr_exact(&large_value).is_err());
/// ```
pub fn try_be_bytes_to_fr_exact(bytes: &[u8; 32]) -> Result<Fr> {
    // Check if the value is >= field modulus (comparing big-endian bytes)
    if bytes_ge_modulus(bytes) {
        return Err(anyhow!(
            "value exceeds BN256 scalar field modulus; \
             use reduce_be_bytes_to_fr() if modular reduction is intentional"
        ));
    }
    // Safe to reduce - we've verified no reduction will occur
    Ok(reduce_be_bytes_to_fr(bytes))
}

/// Check if a big-endian byte array represents a value >= the BN256 scalar field modulus.
///
/// Returns `true` if the value would be reduced when converted to a field element.
pub fn bytes_exceeds_field_modulus(bytes: &[u8; 32]) -> bool {
    bytes_ge_modulus(bytes)
}

/// Compare big-endian bytes against the BN256 scalar field modulus.
/// Returns true if bytes >= modulus.
fn bytes_ge_modulus(bytes: &[u8; 32]) -> bool {
    for (byte, &modulus_byte) in bytes.iter().zip(BN256_SCALAR_FIELD_MODULUS.iter()) {
        match byte.cmp(&modulus_byte) {
            std::cmp::Ordering::Greater => return true,
            std::cmp::Ordering::Less => return false,
            std::cmp::Ordering::Equal => continue,
        }
    }
    // bytes == modulus, which is >= modulus (since field is [0, r-1])
    true
}

/// Hash secp256k1 public key coordinates using Poseidon.
///
/// # Security Note
///
/// The secp256k1 base field prime (~2^256) is larger than the BN256 scalar field modulus
/// (~2^254), so pubkey coordinates could theoretically exceed the BN256 field and undergo
/// modular reduction. However, this is acceptable here because:
///
/// 1. The reduced values are immediately fed into a Poseidon hash, which is collision-resistant
/// 2. The hash output (not the intermediate field elements) is what matters for security
/// 3. Two different pubkeys producing the same intermediate x_fr/y_fr would still produce
///    different hashes (with overwhelming probability) due to Poseidon's collision resistance
///
/// In other words, the collision domain is "compressed" into the hash function, where
/// collision resistance is preserved.
pub fn custodian_pubkey_hash(pubkey: &Secp256k1Pubkey) -> Fr {
    let x = reduce_be_bytes_to_fr(&pubkey.x);
    let y = reduce_be_bytes_to_fr(&pubkey.y);
    poseidon_hash(&[x, y])
}

pub fn custodian_pubkey_hash_bytes(pubkey: &Secp256k1Pubkey) -> [u8; 32] {
    fr_to_bytes(&custodian_pubkey_hash(pubkey))
}

/// Compute the canonical nullifier field element used by the custodial circuit
/// from the private `account_id_hash` and the public policy metadata.
///
/// This mirrors the in-circuit `compute_nullifier` gadget, which applies the
/// shared Poseidon parameters over four field elements:
/// `(account_id_hash, verifier_scope_id, policy_id, current_epoch)`.
pub fn nullifier_fr(account_id_hash: Fr, verifier_scope_id: u64, policy_id: u64, epoch: u64) -> Fr {
    let scope_fr = Fr::from(verifier_scope_id);
    let policy_fr = Fr::from(policy_id);
    let epoch_fr = Fr::from(epoch);
    poseidon_hash(&[account_id_hash, scope_fr, policy_fr, epoch_fr])
}

pub fn compute_nullifier_fr(
    account_id_hash: &Fr,
    scope_id: u64,
    policy_id: u64,
    current_epoch: u64,
) -> Fr {
    poseidon_hash(&[
        *account_id_hash,
        Fr::from(scope_id),
        Fr::from(policy_id),
        Fr::from(current_epoch),
    ])
}

pub fn compute_nullifier_bytes(
    account_id_hash: &Fr,
    scope_id: u64,
    policy_id: u64,
    current_epoch: u64,
) -> [u8; 32] {
    fr_to_bytes(&compute_nullifier_fr(
        account_id_hash,
        scope_id,
        policy_id,
        current_epoch,
    ))
}

fn poseidon_hash<const L: usize>(values: &[Fr; L]) -> Fr {
    PoseidonHash::<Fr, ZkPoseidonSpec, ConstantLength<L>, POSEIDON_T, POSEIDON_RATE>::init()
        .hash(*values)
}

#[derive(Debug)]
struct ZkPoseidonSpec;

impl Spec<Fr, POSEIDON_T, POSEIDON_RATE> for ZkPoseidonSpec {
    fn full_rounds() -> usize {
        POSEIDON_FULL_ROUNDS
    }

    fn partial_rounds() -> usize {
        POSEIDON_PARTIAL_ROUNDS
    }

    fn sbox(val: Fr) -> Fr {
        val.pow_vartime([5])
    }

    fn secure_mds() -> usize {
        0
    }
}

fn first_instance(instances: &[Vec<Fr>], column: usize, label: &str) -> Result<Fr> {
    let col = instances
        .get(column)
        .with_context(|| format!("missing instance column '{}'", label))?;
    col.first()
        .copied()
        .with_context(|| format!("column '{}' has no rows", label))
}

fn fr_to_u64(fr: &Fr) -> Result<u64> {
    let repr = fr.to_repr();
    let bytes = repr.as_ref();
    ensure!(
        bytes[8..].iter().all(|&b| b == 0),
        "field element does not fit in u64"
    );
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&bytes[..8]);
    Ok(u64::from_le_bytes(buf))
}

fn fr_to_u32(fr: &Fr) -> Result<u32> {
    let repr = fr.to_repr();
    let bytes = repr.as_ref();
    ensure!(
        bytes[4..].iter().all(|&b| b == 0),
        "field element does not fit in u32"
    );
    let mut buf = [0u8; 4];
    buf.copy_from_slice(&bytes[..4]);
    Ok(u32::from_le_bytes(buf))
}

#[allow(clippy::type_complexity)]
fn load_artifact_bytes(
    manifest_path: &Path,
) -> Result<(ArtifactManifest, Vec<u8>, Vec<u8>, Vec<u8>)> {
    let manifest = read_manifest(manifest_path)?;
    ensure_manifest_compat(&manifest)?;
    let base_dir = manifest_dir(manifest_path);

    let params_bytes = read_artifact_file(&base_dir, &manifest.params, "params")?;
    let vk_bytes = read_artifact_file(&base_dir, &manifest.vk, "verifying key")?;
    let pk_bytes = read_artifact_file(&base_dir, &manifest.pk, "proving key")?;

    Ok((manifest, params_bytes, vk_bytes, pk_bytes))
}

fn read_artifact_file(base_dir: &Path, entry: &ArtifactFile, label: &str) -> Result<Vec<u8>> {
    let path = entry.resolve_path(base_dir);
    let bytes = fs::read(&path)
        .with_context(|| format!("failed to read {} at {}", label, path.display()))?;
    ensure!(
        bytes.len() as u64 == entry.size,
        "{} size mismatch, manifest recorded {} bytes but found {}",
        label,
        entry.size,
        bytes.len(),
    );
    ensure_hash(&bytes, &entry.blake3, label)?;
    Ok(bytes)
}

fn ensure_hash(bytes: &[u8], expected_hex: &str, label: &str) -> Result<()> {
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

fn manifest_dir(path: &Path) -> PathBuf {
    path.parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn ensure_manifest_compat(manifest: &ArtifactManifest) -> Result<()> {
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

mod serde_bytes32 {
    use serde::de::{self, SeqAccess, Visitor};
    use serde::{Deserializer, Serializer};
    use std::fmt::{self, Write as FmtWrite};

    pub fn serialize<S>(value: &[u8; 32], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut buf = String::with_capacity(66);
        buf.push_str("0x");
        for byte in value {
            FmtWrite::write_fmt(&mut buf, format_args!("{:02x}", byte)).unwrap();
        }
        serializer.serialize_str(&buf)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<[u8; 32], D::Error>
    where
        D: Deserializer<'de>,
    {
        struct BytesVisitor;

        impl<'de> Visitor<'de> for BytesVisitor {
            type Value = [u8; 32];

            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("32-byte value encoded as hex, byte array, or byte string")
            }

            fn visit_str<E>(self, v: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                decode_hex(v).map_err(E::custom)
            }

            fn visit_bytes<E>(self, v: &[u8]) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                copy_slice(v).map_err(E::custom)
            }

            fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
            where
                A: SeqAccess<'de>,
            {
                let mut buf = Vec::with_capacity(32);
                while let Some(byte) = seq.next_element::<u8>()? {
                    buf.push(byte);
                    if buf.len() > 32 {
                        return Err(de::Error::invalid_length(buf.len(), &self));
                    }
                }
                copy_slice(&buf).map_err(de::Error::custom)
            }
        }

        fn copy_slice(bytes: &[u8]) -> Result<[u8; 32], String> {
            if bytes.len() != 32 {
                return Err(format!("expected 32 bytes, got {}", bytes.len()));
            }
            let mut arr = [0u8; 32];
            arr.copy_from_slice(bytes);
            Ok(arr)
        }

        fn decode_hex(input: &str) -> Result<[u8; 32], String> {
            let hex = input
                .strip_prefix("0x")
                .or_else(|| input.strip_prefix("0X"))
                .unwrap_or(input);
            if hex.len() != 64 {
                return Err(format!("expected 64 hex chars, got {}", hex.len()));
            }
            let mut out = [0u8; 32];
            for (i, chunk) in hex.as_bytes().chunks(2).enumerate() {
                let hi = (chunk[0] as char)
                    .to_digit(16)
                    .ok_or_else(|| format!("invalid hex {}", input))?;
                let lo = (chunk[1] as char)
                    .to_digit(16)
                    .ok_or_else(|| format!("invalid hex {}", input))?;
                out[i] = ((hi << 4) | lo) as u8;
            }
            Ok(out)
        }

        deserializer.deserialize_any(BytesVisitor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use halo2curves_axiom::bn256::Fr as BnFr;

    fn sample_public_inputs() -> PublicInputs {
        PublicInputs {
            threshold_raw: 1000,
            required_currency_code: 840,
            current_epoch: 1_700_000_000,
            verifier_scope_id: 99,
            policy_id: 7,
            nullifier: Fr::from(123456789u64),
            custodian_pubkey_hash: Fr::from(987654321u64),
        }
    }

    #[test]
    fn public_inputs_round_trip() {
        let public = sample_public_inputs();
        let verifier = public_to_verifier_inputs(&public);
        let instances = public_inputs_to_instances(&verifier).unwrap();

        let reconstructed_public = instances_to_public_inputs(&instances).unwrap();
        assert_eq!(reconstructed_public.threshold_raw, public.threshold_raw);
        assert_eq!(
            reconstructed_public.required_currency_code,
            public.required_currency_code
        );
        assert_eq!(reconstructed_public.nullifier, public.nullifier);

        let reconstructed_verifier = instances_to_verifier_inputs(&instances).unwrap();
        assert_eq!(reconstructed_verifier.threshold_raw, verifier.threshold_raw);
        assert_eq!(
            reconstructed_verifier.required_currency_code,
            verifier.required_currency_code
        );
    }

    #[test]
    fn fr_bytes_round_trip() {
        let value = Fr::from(2024u64);
        let bytes = fr_to_bytes(&value);
        let reconstructed = fr_from_bytes(&bytes).unwrap();
        assert_eq!(value, reconstructed);
    }

    #[test]
    fn verifier_public_inputs_bytes_round_trip() {
        let public = public_to_verifier_inputs(&sample_public_inputs());
        let bytes = serialize_verifier_public_inputs(&public).unwrap();
        let decoded = deserialize_verifier_public_inputs(&bytes).unwrap();
        assert_eq!(decoded.threshold_raw, public.threshold_raw);
        assert_eq!(
            decoded.required_currency_code,
            public.required_currency_code
        );
        assert_eq!(decoded.nullifier, public.nullifier);
    }

    #[test]
    fn instances_to_public_inputs_rejects_wrong_len() {
        let bad_instances = vec![vec![Fr::one()]; PUBLIC_INPUT_COUNT - 1];
        assert!(instances_to_public_inputs(&bad_instances).is_err());
    }

    #[test]
    fn instances_to_public_inputs_rejects_large_values() {
        let mut instances =
            public_inputs_to_instances(&public_to_verifier_inputs(&sample_public_inputs()))
                .unwrap();
        instances[0][0] = BnFr::from_raw([0, 0, 0, 1]);
        assert!(instances_to_public_inputs(&instances).is_err());
    }

    // ============================================================
    // Field element bounds checking tests
    // ============================================================

    #[test]
    fn try_be_bytes_to_fr_exact_accepts_zero() {
        let zero = [0u8; 32];
        let result = try_be_bytes_to_fr_exact(&zero);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), Fr::zero());
    }

    #[test]
    fn try_be_bytes_to_fr_exact_accepts_small_values() {
        // A small value (1) should be accepted
        let mut one = [0u8; 32];
        one[31] = 1;
        let result = try_be_bytes_to_fr_exact(&one);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), Fr::one());

        // A moderate value
        let mut moderate = [0u8; 32];
        moderate[28..32].copy_from_slice(&0xDEADBEEFu32.to_be_bytes());
        let result = try_be_bytes_to_fr_exact(&moderate);
        assert!(result.is_ok());
    }

    #[test]
    fn try_be_bytes_to_fr_exact_rejects_max_value() {
        // 2^256 - 1 is definitely larger than the field modulus (~2^254)
        let max_value = [0xFF; 32];
        let result = try_be_bytes_to_fr_exact(&max_value);
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("exceeds BN256 scalar field modulus"));
    }

    #[test]
    fn try_be_bytes_to_fr_exact_rejects_modulus() {
        // The modulus itself is not a valid field element (field is [0, r-1])
        let result = try_be_bytes_to_fr_exact(&BN256_SCALAR_FIELD_MODULUS);
        assert!(result.is_err());
    }

    #[test]
    fn try_be_bytes_to_fr_exact_accepts_modulus_minus_one() {
        // r - 1 is the largest valid field element
        let mut modulus_minus_one = BN256_SCALAR_FIELD_MODULUS;
        // Subtract 1 from the big-endian representation
        // The last byte of the modulus is 0x01, so subtracting 1 gives 0x00
        modulus_minus_one[31] = 0x00;
        let result = try_be_bytes_to_fr_exact(&modulus_minus_one);
        assert!(result.is_ok());
    }

    #[test]
    fn bytes_exceeds_field_modulus_detects_overflow() {
        // Values >= modulus should return true
        assert!(bytes_exceeds_field_modulus(&[0xFF; 32]));
        assert!(bytes_exceeds_field_modulus(&BN256_SCALAR_FIELD_MODULUS));

        // Values < modulus should return false
        assert!(!bytes_exceeds_field_modulus(&[0u8; 32]));
        let mut small = [0u8; 32];
        small[31] = 1;
        assert!(!bytes_exceeds_field_modulus(&small));
    }

    #[test]
    fn reduce_be_bytes_to_fr_handles_overflow_gracefully() {
        // Even values larger than the modulus should work (with reduction)
        let large_value = [0xFF; 32];
        let result = reduce_be_bytes_to_fr(&large_value);
        // The result should be a valid field element (not panic)
        // We can't easily predict the exact value after reduction, but it should be deterministic
        let result2 = reduce_be_bytes_to_fr(&large_value);
        assert_eq!(result, result2);
    }

    #[test]
    fn reduce_be_bytes_and_exact_agree_for_small_values() {
        // For values that fit in the field, both functions should return the same result
        let small_values = [
            [0u8; 32],                              // zero
            {
                let mut v = [0u8; 32];
                v[31] = 1;
                v
            }, // one
            {
                let mut v = [0u8; 32];
                v[24..32].copy_from_slice(&0x123456789ABCDEFu64.to_be_bytes());
                v
            }, // random small value
        ];

        for value in &small_values {
            let reduced = reduce_be_bytes_to_fr(value);
            let exact = try_be_bytes_to_fr_exact(value).unwrap();
            assert_eq!(reduced, exact, "Results differ for value {:?}", value);
        }
    }
}
