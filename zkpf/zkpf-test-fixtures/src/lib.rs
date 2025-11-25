use std::{path::PathBuf, sync::Arc};

use anyhow::{anyhow, Context, Result};
use halo2curves_axiom::{
    bn256::Fr,
    ff::{Field, PrimeField},
};
use k256::{
    ecdsa::{hazmat::SignPrimitive, SigningKey, VerifyingKey},
    FieldBytes,
};
use once_cell::sync::OnceCell;
use poseidon_primitives::poseidon::primitives::{Hash as PoseidonHash, Spec, VariableLengthIden3};
use sha2::Sha256;
use zkpf_circuit::{
    gadgets::attestation::{AttestationWitness, EcdsaSignature, Secp256k1Pubkey},
    PublicInputs, ZkpfCircuitInput,
};
use zkpf_common::{
    custodian_pubkey_hash, serialize_params, serialize_proving_key,
    serialize_verifier_public_inputs, serialize_verifying_key, ArtifactFile, ArtifactManifest,
    ProofBundle, ProverArtifacts, VerifierPublicInputs, CIRCUIT_VERSION, MANIFEST_VERSION,
    // Poseidon parameters from canonical source (zkpf-circuit)
    POSEIDON_FULL_ROUNDS, POSEIDON_PARTIAL_ROUNDS, POSEIDON_RATE,
    POSEIDON_T as POSEIDON_WIDTH, // alias for compatibility
};
use zkpf_prover::{prove_with_public_inputs, setup, ProverParams};

const TEST_K: u32 = 19;
const CREATED_AT_UNIX: u64 = 1_700_000_000;
const POSEIDON_CAPACITY: u128 = 1u128 << 64;

static FIXTURES: OnceCell<TestFixtures> = OnceCell::new();

/// Pre-generated proving artifacts, witness inputs, and proof bundles reused across tests.
pub struct TestFixtures {
    artifacts: Arc<ProverArtifacts>,
    params_bytes: Vec<u8>,
    vk_bytes: Vec<u8>,
    pk_bytes: Vec<u8>,
    proof: Vec<u8>,
    bundle: ProofBundle,
    public_inputs: VerifierPublicInputs,
    public_inputs_bytes: Vec<u8>,
    public_inputs_json: String,
    attestation_json: String,
    /// Orchard rail sample bundle + artifacts (optional).
    orchard_bundle: Option<ProofBundle>,
}

impl TestFixtures {
    /// Clone the prover artifacts so each test can own an `Arc`.
    pub fn artifacts(&self) -> Arc<ProverArtifacts> {
        Arc::clone(&self.artifacts)
    }

    pub fn params_bytes(&self) -> &[u8] {
        &self.params_bytes
    }

    pub fn vk_bytes(&self) -> &[u8] {
        &self.vk_bytes
    }

    pub fn pk_bytes(&self) -> &[u8] {
        &self.pk_bytes
    }

    pub fn proof(&self) -> &[u8] {
        &self.proof
    }

    pub fn bundle(&self) -> &ProofBundle {
        &self.bundle
    }

    pub fn public_inputs(&self) -> &VerifierPublicInputs {
        &self.public_inputs
    }

    pub fn public_inputs_bytes(&self) -> &[u8] {
        &self.public_inputs_bytes
    }

    pub fn public_inputs_json(&self) -> &str {
        &self.public_inputs_json
    }

    pub fn attestation_json(&self) -> &str {
        &self.attestation_json
    }

    /// Optional Orchard rail bundle generated using the Orchard PoF circuit.
    pub fn orchard_bundle(&self) -> Option<&ProofBundle> {
        self.orchard_bundle.as_ref()
    }
}

/// Return lazily constructed test fixtures shared across crates.
pub fn fixtures() -> &'static TestFixtures {
    FIXTURES.get_or_init(|| build_fixtures().expect("failed to build zkpf test fixtures"))
}

fn build_fixtures() -> Result<TestFixtures> {
    let prepared = prepare_input()?;
    let ProverParams { params, vk, pk } = setup(TEST_K);

    let params_bytes = serialize_params(&params).context("serialize params")?;
    let vk_bytes = serialize_verifying_key(&vk).context("serialize vk")?;
    let pk_bytes = serialize_proving_key(&pk).context("serialize pk")?;

    let manifest = ArtifactManifest {
        manifest_version: MANIFEST_VERSION,
        circuit_version: CIRCUIT_VERSION,
        k: TEST_K,
        created_at_unix: CREATED_AT_UNIX,
        params: ArtifactFile::from_bytes("params.bin", &params_bytes),
        vk: ArtifactFile::from_bytes("vk.bin", &vk_bytes),
        pk: ArtifactFile::from_bytes("pk.bin", &pk_bytes),
    };

    let artifacts = ProverArtifacts::from_parts(manifest, PathBuf::from("."), params, vk, Some(pk));

    let (proof, verifier_inputs) = prove_with_public_inputs(
        &artifacts.params,
        artifacts
            .proving_key()
            .expect("test fixtures should have prover enabled")
            .as_ref(),
        prepared.input.clone(),
    );

    let public_inputs_bytes =
        serialize_verifier_public_inputs(&verifier_inputs).context("serialize public inputs")?;
    let public_inputs_json =
        serde_json::to_string(&verifier_inputs).context("encode public inputs json")?;

    Ok(TestFixtures {
        artifacts: Arc::new(artifacts),
        params_bytes,
        vk_bytes,
        pk_bytes,
        proof: proof.clone(),
        bundle: ProofBundle::new(proof, verifier_inputs.clone()),
        public_inputs: verifier_inputs,
        public_inputs_bytes,
        public_inputs_json,
        attestation_json: prepared.attestation_json,
        orchard_bundle: None,
    })
}

/// Example (ignored) test that can be used to generate Orchard rail artifacts and a
/// sample `ProofBundle` for local experimentation. This does not run in CI by default.
#[cfg(test)]
mod orchard_fixtures {

    use zkpf_common::{serialize_params, serialize_proving_key, serialize_verifying_key};

    #[test]
    #[ignore]
    fn generate_orchard_artifacts_and_bundle() {
        // This test is a placeholder hook for generating Orchard artifacts in a
        // real environment. The exact wiring (UFVK, snapshot) is left to the
        // operator; here we only demonstrate the artifact generation flow.
        let _ = (
            serialize_params as fn(&_) -> _,
            serialize_verifying_key as fn(&_) -> _,
            serialize_proving_key as fn(&_) -> _,
        );
        // Intentionally left minimal to avoid pulling in wallet dependencies into CI.
    }
}

struct PreparedInput {
    input: ZkpfCircuitInput,
    attestation_json: String,
}

fn prepare_input() -> Result<PreparedInput> {
    // Deterministic values make it easier to reason about fixtures.
    let signing_key = SigningKey::from_bytes(&[7u8; 32]).context("invalid signing key bytes")?;
    let balance_raw = 5_000_000u64;
    let threshold_raw = 1_000_000u64;
    let currency_code_int = 840u32;
    let custodian_id = 42u32;
    let attestation_id = 77u64;
    let issued_at = 1_700_000_000u64;
    let valid_until = issued_at + 86_400;
    let current_epoch = issued_at;
    let verifier_scope_id = 31_415u64;
    let policy_id = 27_1828u64;
    let account_id_hash = Fr::from(987_654_321u64);

    let attestation_poseidon_inputs = vec![
        Fr::from(balance_raw),
        Fr::from(attestation_id),
        Fr::from(currency_code_int as u64),
        Fr::from(custodian_id as u64),
        Fr::from(issued_at),
        Fr::from(valid_until),
        account_id_hash,
    ];
    let digest_fr = poseidon_hash(&attestation_poseidon_inputs);
    let message_hash = fr_to_be_bytes(&digest_fr);

    let (sig_r, sig_s) = sign_digest(&signing_key, &message_hash)?;
    let derived_pubkey = derive_pubkey(&signing_key)?;
    let nullifier_inputs = vec![
        account_id_hash,
        Fr::from(verifier_scope_id),
        Fr::from(policy_id),
        Fr::from(current_epoch),
    ];
    let nullifier = poseidon_hash(&nullifier_inputs);
    let custodian_pubkey_hash_fr = custodian_pubkey_hash(&derived_pubkey);

    let public_inputs = PublicInputs {
        threshold_raw,
        required_currency_code: currency_code_int,
        current_epoch,
        verifier_scope_id,
        policy_id,
        nullifier,
        custodian_pubkey_hash: custodian_pubkey_hash_fr,
    };

    let attestation = AttestationWitness {
        balance_raw,
        currency_code_int,
        custodian_id,
        attestation_id,
        issued_at,
        valid_until,
        account_id_hash,
        custodian_pubkey: derived_pubkey,
        signature: EcdsaSignature { r: sig_r, s: sig_s },
        message_hash,
    };

    let circuit_input = ZkpfCircuitInput {
        attestation,
        public: public_inputs,
    };

    let attestation_json =
        serde_json::to_string(&circuit_input).context("serialize attestation json")?;

    Ok(PreparedInput {
        input: circuit_input,
        attestation_json,
    })
}

fn poseidon_hash(inputs: &[Fr]) -> Fr {
    PoseidonHash::<Fr, ZkPoseidonSpec, VariableLengthIden3, POSEIDON_WIDTH, POSEIDON_RATE>::init()
        .hash_with_cap(inputs, POSEIDON_CAPACITY)
}

#[derive(Debug)]
struct ZkPoseidonSpec;

impl Spec<Fr, POSEIDON_WIDTH, POSEIDON_RATE> for ZkPoseidonSpec {
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

fn sign_digest(signing_key: &SigningKey, digest: &[u8; 32]) -> Result<([u8; 32], [u8; 32])> {
    let scalar = signing_key.as_nonzero_scalar();
    let mut field_bytes = FieldBytes::default();
    field_bytes.copy_from_slice(digest);
    let (signature, _) = scalar
        .try_sign_prehashed_rfc6979::<Sha256>(field_bytes, b"")
        .context("sign digest")?;
    let bytes = signature.to_bytes();
    let mut r = [0u8; 32];
    let mut s = [0u8; 32];
    r.copy_from_slice(&bytes[..32]);
    s.copy_from_slice(&bytes[32..]);
    Ok((r, s))
}

fn derive_pubkey(signing_key: &SigningKey) -> Result<Secp256k1Pubkey> {
    let verifying_key = VerifyingKey::from(signing_key);
    let encoded = verifying_key.to_encoded_point(false);
    let mut x = [0u8; 32];
    let mut y = [0u8; 32];
    x.copy_from_slice(encoded.x().ok_or_else(|| anyhow!("missing x coordinate"))?);
    y.copy_from_slice(encoded.y().ok_or_else(|| anyhow!("missing y coordinate"))?);
    Ok(Secp256k1Pubkey { x, y })
}

fn fr_to_be_bytes(fr: &Fr) -> [u8; 32] {
    let repr = fr.to_repr();
    let mut be = [0u8; 32];
    let repr_bytes = repr.as_ref();
    for (i, byte) in repr_bytes.iter().enumerate() {
        be[31 - i] = *byte;
    }
    be
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore]
    fn dump_sample_input() {
        let prepared = prepare_input().expect("prepare input");
        println!(
            "{}",
            serde_json::to_string_pretty(&prepared.input).expect("serialize input")
        );
    }
}
