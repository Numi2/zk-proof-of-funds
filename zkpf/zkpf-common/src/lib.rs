use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
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
use poseidon_primitives::poseidon::primitives::{ConstantLength, Hash as PoseidonHash, Spec};
use serde::{Deserialize, Serialize};
use zkpf_circuit::{
    custodians, gadgets::attestation::Secp256k1Pubkey, public_instances, PublicInputs, ZkpfCircuit,
};

/// Number of public inputs in the legacy custodial circuit layout (V1).
pub const PUBLIC_INPUT_COUNT: usize = 8;
/// Number of public inputs in the Orchard layout (V2_ORCHARD): V1 prefix + 3 Orchard fields.
pub const PUBLIC_INPUT_COUNT_V2_ORCHARD: usize = 11;
const POSEIDON_T: usize = 6;
const POSEIDON_RATE: usize = 5;
const POSEIDON_FULL_ROUNDS: usize = 8;
const POSEIDON_PARTIAL_ROUNDS: usize = 57;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VerifierPublicInputs {
    pub threshold_raw: u64,
    pub required_currency_code: u32,
    pub required_custodian_id: u32,
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
}

/// Logical public-input layouts supported by the verifier.
///
/// - `V1` – legacy custodial attestation rail (8 public inputs).
/// - `V2Orchard` – Orchard rail layout: V1 prefix plus Orchard snapshot fields.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub enum PublicInputLayout {
    #[serde(rename = "V1")]
    V1,
    #[serde(rename = "V2_ORCHARD")]
    V2Orchard,
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

pub const CIRCUIT_VERSION: u32 = 3;
pub const MANIFEST_VERSION: u32 = 1;
pub const MANIFEST_FILE: &str = "manifest.json";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ArtifactFile {
    pub path: String,
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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ArtifactManifest {
    pub manifest_version: u32,
    pub circuit_version: u32,
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
    pub params_bytes: Vec<u8>,
    pub vk_bytes: Vec<u8>,
    pub pk_bytes: Vec<u8>,
    pub params: ParamsKZG<Bn256>,
    pub vk: plonk::VerifyingKey<G1Affine>,
    pub pk: plonk::ProvingKey<G1Affine>,
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
        required_custodian_id: inputs.required_custodian_id,
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
        required_custodian_id: public.required_custodian_id,
        current_epoch: public.current_epoch,
        verifier_scope_id: public.verifier_scope_id,
        policy_id: public.policy_id,
        nullifier: fr_to_bytes(&public.nullifier),
        custodian_pubkey_hash: fr_to_bytes(&public.custodian_pubkey_hash),
        snapshot_block_height: None,
        snapshot_anchor_orchard: None,
        holder_binding: None,
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
    }
}

pub fn public_inputs_vector(public: &PublicInputs) -> [Fr; PUBLIC_INPUT_COUNT] {
    [
        Fr::from(public.threshold_raw),
        Fr::from(public.required_currency_code as u64),
        Fr::from(public.required_custodian_id as u64),
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
        required_custodian_id: fr_to_u32(&first_instance(instances, 2, "required_custodian_id")?)?,
        current_epoch: fr_to_u64(&first_instance(instances, 3, "current_epoch")?)?,
        verifier_scope_id: fr_to_u64(&first_instance(instances, 4, "verifier_scope_id")?)?,
        policy_id: fr_to_u64(&first_instance(instances, 5, "policy_id")?)?,
        nullifier: first_instance(instances, 6, "nullifier")?,
        custodian_pubkey_hash: first_instance(instances, 7, "custodian_pubkey_hash")?,
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
    let manifest_path = path.as_ref();
    let (manifest, params_bytes, vk_bytes, pk_bytes) = load_artifact_bytes(manifest_path)?;

    let params = deserialize_params(&params_bytes)?;
    let vk = deserialize_verifying_key(&vk_bytes)?;
    let pk = deserialize_proving_key(&pk_bytes)?;

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

pub fn reduce_be_bytes_to_fr(bytes: &[u8; 32]) -> Fr {
    let mut acc = Fr::zero();
    let base = Fr::from(256);
    for byte in bytes.iter() {
        acc = acc * base + Fr::from(*byte as u64);
    }
    acc
}

pub fn custodian_pubkey_hash(pubkey: &Secp256k1Pubkey) -> Fr {
    let x = reduce_be_bytes_to_fr(&pubkey.x);
    let y = reduce_be_bytes_to_fr(&pubkey.y);
    poseidon_hash(&[x, y])
}

pub fn custodian_pubkey_hash_bytes(pubkey: &Secp256k1Pubkey) -> [u8; 32] {
    fr_to_bytes(&custodian_pubkey_hash(pubkey))
}

pub fn allowlisted_custodian_hash(custodian_id: u32) -> Option<Fr> {
    custodians::lookup_pubkey(custodian_id).map(|pk| custodian_pubkey_hash(pk))
}

pub fn allowlisted_custodian_hash_bytes(custodian_id: u32) -> Option<[u8; 32]> {
    allowlisted_custodian_hash(custodian_id).map(|fr| fr_to_bytes(&fr))
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
    col.get(0)
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

#[cfg(test)]
mod tests {
    use super::*;
    use halo2curves_axiom::bn256::Fr as BnFr;

    fn sample_public_inputs() -> PublicInputs {
        PublicInputs {
            threshold_raw: 1000,
            required_currency_code: 840,
            required_custodian_id: 42,
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
        assert_eq!(
            reconstructed_public.required_custodian_id,
            public.required_custodian_id
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
}
