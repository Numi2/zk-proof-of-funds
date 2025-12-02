// zkpf/zkpf-wasm/src/lib.rs
// Numan Thabit 2025

use std::cell::RefCell;

use halo2_proofs_axiom::{
    plonk,
    plonk::Circuit as _,
    poly::kzg::commitment::ParamsKZG,
    transcript::TranscriptWriterBuffer as _,
};
use halo2curves_axiom::{
    bn256::{Bn256, Fr, G1Affine},
    ff::{Field, PrimeField},
};
use poseidon_primitives::poseidon::primitives::{ConstantLength, Hash, Spec};
use serde_wasm_bindgen::{from_value, to_value};
use wasm_bindgen::prelude::*;
use zkpf_circuit::ZkpfCircuitInput;
use zkpf_common::{
    custodian_pubkey_hash, deserialize_params, deserialize_proving_key,
    deserialize_verifier_public_inputs, deserialize_verifying_key, public_inputs_to_instances,
    public_inputs_to_instances_with_layout, serialize_verifier_public_inputs,
    ProofBundle, PublicInputLayout, VerifierPublicInputs, CIRCUIT_VERSION,
    // Poseidon parameters imported from canonical source (zkpf-circuit via zkpf-common)
    POSEIDON_FULL_ROUNDS, POSEIDON_PARTIAL_ROUNDS, POSEIDON_RATE, POSEIDON_T,
};
use zkpf_prover::{prove, prove_bundle_result, prove_with_public_inputs};
use zkpf_verifier::verify;
use zkpf_zcash_orchard_circuit::{
    deserialize_break_points, OrchardBreakPoints, OrchardPofCircuit, OrchardPofCircuitInput,
    ORCHARD_DEFAULT_K, RAIL_ID_ZCASH_ORCHARD,
};

// Initialize panic hook at WASM module load time for better error messages
#[wasm_bindgen(start)]
pub fn wasm_start() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub struct VerifyingKeyWasm {
    vk: plonk::VerifyingKey<G1Affine>,
    serialized: Vec<u8>,
}

#[wasm_bindgen]
pub struct ParamsWasm {
    params: ParamsKZG<Bn256>,
    serialized: Vec<u8>,
}

#[wasm_bindgen]
pub struct ProvingKeyWasm {
    pk: plonk::ProvingKey<G1Affine>,
    serialized: Vec<u8>,
}

#[wasm_bindgen]
pub struct PublicInputsWasm {
    inputs: VerifierPublicInputs,
}

thread_local! {
    static CACHED_PARAMS: RefCell<Option<ParamsWasm>> = const { RefCell::new(None) };
    static CACHED_VK: RefCell<Option<VerifyingKeyWasm>> = const { RefCell::new(None) };
    static CACHED_PK: RefCell<Option<ProvingKeyWasm>> = const { RefCell::new(None) };
    // Orchard-specific artifacts (k=19, 10 instance columns)
    static CACHED_ORCHARD_PARAMS: RefCell<Option<ParamsWasm>> = const { RefCell::new(None) };
    static CACHED_ORCHARD_PK: RefCell<Option<OrchardProvingKeyWasm>> = const { RefCell::new(None) };
    // Orchard break points - REQUIRED for proof generation
    static CACHED_ORCHARD_BREAK_POINTS: RefCell<Option<OrchardBreakPoints>> = const { RefCell::new(None) };
}

#[wasm_bindgen]
impl VerifyingKeyWasm {
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8]) -> Result<VerifyingKeyWasm, JsValue> {
        let vk = deserialize_verifying_key(bytes).map_err(js_error)?;
        Ok(Self {
            vk,
            serialized: bytes.to_vec(),
        })
    }

    #[wasm_bindgen(js_name = toBytes)]
    pub fn to_bytes(&self) -> Vec<u8> {
        self.serialized.clone()
    }
}

#[wasm_bindgen]
impl ParamsWasm {
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8]) -> Result<ParamsWasm, JsValue> {
        let params = deserialize_params(bytes).map_err(js_error)?;
        Ok(Self {
            params,
            serialized: bytes.to_vec(),
        })
    }

    #[wasm_bindgen(js_name = toBytes)]
    pub fn to_bytes(&self) -> Vec<u8> {
        self.serialized.clone()
    }
}

#[wasm_bindgen]
impl ProvingKeyWasm {
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8]) -> Result<ProvingKeyWasm, JsValue> {
        let pk = deserialize_proving_key(bytes).map_err(js_error)?;
        Ok(Self {
            pk,
            serialized: bytes.to_vec(),
        })
    }

    #[wasm_bindgen(js_name = toBytes)]
    pub fn to_bytes(&self) -> Vec<u8> {
        self.serialized.clone()
    }
}

#[wasm_bindgen]
impl PublicInputsWasm {
    #[wasm_bindgen(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        threshold_raw: u64,
        required_currency_code: u32,
        current_epoch: u64,
        verifier_scope_id: u64,
        policy_id: u64,
        nullifier: &[u8],
        custodian_pubkey_hash: &[u8],
    ) -> Result<PublicInputsWasm, JsValue> {
        Ok(Self {
            inputs: VerifierPublicInputs {
                threshold_raw,
                required_currency_code,
                current_epoch,
                verifier_scope_id,
                policy_id,
                nullifier: into_field_bytes("nullifier", nullifier)?,
                custodian_pubkey_hash: into_field_bytes(
                    "custodianPubkeyHash",
                    custodian_pubkey_hash,
                )?,
                snapshot_block_height: None,
                snapshot_anchor_orchard: None,
                holder_binding: None,
                proven_sum: None,
            },
        })
    }

    #[wasm_bindgen(js_name = fromJson)]
    pub fn from_json(json: &str) -> Result<PublicInputsWasm, JsValue> {
        let inputs: VerifierPublicInputs = serde_json::from_str(json).map_err(js_error)?;
        Ok(Self { inputs })
    }

    #[wasm_bindgen(js_name = fromBytes)]
    pub fn from_bytes(bytes: &[u8]) -> Result<PublicInputsWasm, JsValue> {
        let inputs = deserialize_verifier_public_inputs(bytes).map_err(js_error)?;
        Ok(Self { inputs })
    }

    #[wasm_bindgen(js_name = toJson)]
    pub fn to_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.inputs).map_err(js_error)
    }

    #[wasm_bindgen(js_name = toBytes)]
    pub fn to_bytes(&self) -> Result<Vec<u8>, JsValue> {
        serialize_verifier_public_inputs(self.inner()).map_err(js_error)
    }

    #[wasm_bindgen(getter)]
    pub fn threshold_raw(&self) -> u64 {
        self.inputs.threshold_raw
    }

    #[wasm_bindgen(getter)]
    pub fn required_currency_code(&self) -> u32 {
        self.inputs.required_currency_code
    }

    #[wasm_bindgen(getter)]
    pub fn current_epoch(&self) -> u64 {
        self.inputs.current_epoch
    }

    #[wasm_bindgen(getter)]
    pub fn verifier_scope_id(&self) -> u64 {
        self.inputs.verifier_scope_id
    }

    #[wasm_bindgen(getter)]
    pub fn policy_id(&self) -> u64 {
        self.inputs.policy_id
    }

    #[wasm_bindgen(js_name = nullifierBytes)]
    pub fn nullifier_bytes(&self) -> Vec<u8> {
        self.inputs.nullifier.to_vec()
    }

    #[wasm_bindgen(js_name = custodianPubkeyHashBytes)]
    pub fn custodian_pubkey_hash_bytes(&self) -> Vec<u8> {
        self.inputs.custodian_pubkey_hash.to_vec()
    }
}

#[wasm_bindgen(js_name = initVerifierArtifacts)]
pub fn init_verifier_artifacts(params_bytes: &[u8], vk_bytes: &[u8]) -> Result<(), JsValue> {
    let params = ParamsWasm::new(params_bytes)?;
    let vk = VerifyingKeyWasm::new(vk_bytes)?;
    cache_params(params);
    cache_vk(vk);
    Ok(())
}

#[wasm_bindgen(js_name = initProverArtifacts)]
pub fn init_prover_artifacts(params_bytes: &[u8], pk_bytes: &[u8]) -> Result<(), JsValue> {
    let artifact_key = compute_artifact_key(params_bytes, pk_bytes);
    
    web_sys::console::log_1(&"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━".into());
    web_sys::console::log_1(&"[ZKPF Custodial WASM] initProverArtifacts called".into());
    web_sys::console::log_1(&"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━".into());
    web_sys::console::log_1(&format!(
        "[ZKPF Custodial WASM] params={} bytes, pk={} bytes",
        params_bytes.len(),
        pk_bytes.len()
    ).into());
    web_sys::console::log_1(&format!(
        "[ZKPF Custodial WASM] *** ARTIFACT_KEY={} ***",
        artifact_key
    ).into());
    
    let params = ParamsWasm::new(params_bytes)?;
    let pk = ProvingKeyWasm::new(pk_bytes)?;
    cache_params(params);
    cache_pk(pk);
    
    web_sys::console::log_1(&"[ZKPF Custodial WASM] ✓ Custodial prover artifacts initialized successfully".into());
    web_sys::console::log_1(&"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━".into());
    Ok(())
}

#[wasm_bindgen(js_name = resetCachedArtifacts)]
pub fn reset_cached_artifacts() {
    CACHED_PARAMS.with(|cell| {
        cell.borrow_mut().take();
    });
    CACHED_VK.with(|cell| {
        cell.borrow_mut().take();
    });
    CACHED_PK.with(|cell| {
        cell.borrow_mut().take();
    });
}

#[wasm_bindgen]
pub fn generate_proof(
    attestation_json: &str,
    params_bytes: &[u8],
    pk_bytes: &[u8],
) -> Result<Vec<u8>, JsValue> {
    let params = ParamsWasm::new(params_bytes)?;
    let pk = ProvingKeyWasm::new(pk_bytes)?;
    let input = parse_input(attestation_json)?;
    let (proof, _) = prove_with_public_inputs(params.inner(), pk.inner(), input);
    Ok(proof)
}

#[wasm_bindgen(js_name = generateProofWithCache)]
pub fn generate_proof_with_cache(
    attestation_json: &str,
    params: &ParamsWasm,
    pk: &ProvingKeyWasm,
) -> Result<Vec<u8>, JsValue> {
    let input = parse_input(attestation_json)?;
    Ok(prove(params.inner(), pk.inner(), input))
}

#[wasm_bindgen(js_name = generateProofBundle)]
pub fn generate_proof_bundle(
    attestation_json: &str,
    params_bytes: &[u8],
    pk_bytes: &[u8],
) -> Result<JsValue, JsValue> {
    let params = ParamsWasm::new(params_bytes)?;
    let pk = ProvingKeyWasm::new(pk_bytes)?;
    generate_proof_bundle_with_cache(attestation_json, &params, &pk)
}

#[wasm_bindgen(js_name = generateProofBundleWithCache)]
pub fn generate_proof_bundle_with_cache(
    attestation_json: &str,
    params: &ParamsWasm,
    pk: &ProvingKeyWasm,
) -> Result<JsValue, JsValue> {
    let bundle = prove_bundle_with_structs(attestation_json, params, pk)?;
    to_value(&bundle).map_err(js_error)
}

#[wasm_bindgen(js_name = generateProofCached)]
pub fn generate_proof_cached(attestation_json: &str) -> Result<Vec<u8>, JsValue> {
    with_cached_prover(|params, pk| {
        let input = parse_input(attestation_json)?;
        Ok(prove(params.inner(), pk.inner(), input))
    })
}

#[wasm_bindgen(js_name = generateProofBundleCached)]
pub fn generate_proof_bundle_cached(attestation_json: &str) -> Result<JsValue, JsValue> {
    with_cached_prover(|params, pk| {
        let bundle = prove_bundle_with_structs(attestation_json, params, pk)?;
        to_value(&bundle).map_err(js_error)
    })
}

#[wasm_bindgen(js_name = computeAttestationMessageHash)]
pub fn compute_attestation_message_hash(attestation_json: &str) -> Result<Vec<u8>, JsValue> {
    let input: ZkpfCircuitInput = serde_json::from_str(attestation_json).map_err(js_error)?;
    let att = input.attestation;
    let digest = poseidon_hash([
        Fr::from(att.balance_raw),
        Fr::from(att.attestation_id),
        Fr::from(att.currency_code_int as u64),
        Fr::from(att.custodian_id as u64),
        Fr::from(att.issued_at),
        Fr::from(att.valid_until),
        att.account_id_hash,
    ]);
    Ok(fr_to_be_bytes(&digest).to_vec())
}

#[wasm_bindgen(js_name = computeNullifier)]
pub fn compute_nullifier(
    account_id_hash_bytes: &[u8],
    verifier_scope_id: u64,
    policy_id: u64,
    current_epoch: u64,
) -> Result<Vec<u8>, JsValue> {
    let account_id_hash = fr_from_le_bytes(account_id_hash_bytes)?;
    let digest = poseidon_hash([
        account_id_hash,
        Fr::from(verifier_scope_id),
        Fr::from(policy_id),
        Fr::from(current_epoch),
    ]);
    Ok(fr_to_le_bytes(&digest).to_vec())
}

#[wasm_bindgen(js_name = computeCustodianPubkeyHash)]
pub fn compute_custodian_pubkey_hash(pubkey_x: &[u8], pubkey_y: &[u8]) -> Result<Vec<u8>, JsValue> {
    if pubkey_x.len() != 32 || pubkey_y.len() != 32 {
        return Err(js_error("custodian pubkey coordinates must be 32 bytes"));
    }
    let mut x = [0u8; 32];
    x.copy_from_slice(pubkey_x);
    let mut y = [0u8; 32];
    y.copy_from_slice(pubkey_y);
    let pubkey = zkpf_circuit::gadgets::attestation::Secp256k1Pubkey { x, y };
    let hash = custodian_pubkey_hash(&pubkey);
    Ok(fr_to_le_bytes(&hash).to_vec())
}

#[wasm_bindgen]
pub fn verify_proof(
    proof_bytes: &[u8],
    public_inputs_json: &str,
    vk_bytes: &[u8],
    params_bytes: &[u8],
) -> Result<bool, JsValue> {
    let public_inputs = PublicInputsWasm::from_json(public_inputs_json)?;
    let vk = VerifyingKeyWasm::new(vk_bytes)?;
    let params = ParamsWasm::new(params_bytes)?;
    verify_with_structs(proof_bytes, &public_inputs, &vk, &params)
}

#[wasm_bindgen(js_name = verifyProofWithCache)]
pub fn verify_proof_with_cache(
    proof_bytes: &[u8],
    public_inputs: &PublicInputsWasm,
    vk: &VerifyingKeyWasm,
    params: &ParamsWasm,
) -> Result<bool, JsValue> {
    verify_with_structs(proof_bytes, public_inputs, vk, params)
}

#[wasm_bindgen(js_name = verifyProofBytes)]
pub fn verify_proof_bytes(
    proof_bytes: &[u8],
    public_inputs_bytes: &[u8],
    vk_bytes: &[u8],
    params_bytes: &[u8],
) -> Result<bool, JsValue> {
    let public_inputs = PublicInputsWasm::from_bytes(public_inputs_bytes)?;
    let vk = VerifyingKeyWasm::new(vk_bytes)?;
    let params = ParamsWasm::new(params_bytes)?;
    verify_with_structs(proof_bytes, &public_inputs, &vk, &params)
}

#[wasm_bindgen(js_name = verifyProofWithCacheBytes)]
pub fn verify_proof_with_cache_bytes(
    proof_bytes: &[u8],
    public_inputs_bytes: &[u8],
    vk: &VerifyingKeyWasm,
    params: &ParamsWasm,
) -> Result<bool, JsValue> {
    let public_inputs = PublicInputsWasm::from_bytes(public_inputs_bytes)?;
    verify_with_structs(proof_bytes, &public_inputs, vk, params)
}

#[wasm_bindgen(js_name = verifyProofBundle)]
pub fn verify_proof_bundle(
    bundle: &JsValue,
    vk_bytes: &[u8],
    params_bytes: &[u8],
) -> Result<bool, JsValue> {
    let vk = VerifyingKeyWasm::new(vk_bytes)?;
    let params = ParamsWasm::new(params_bytes)?;
    verify_proof_bundle_with_cache(bundle, &vk, &params)
}

#[wasm_bindgen(js_name = verifyProofBundleWithCache)]
pub fn verify_proof_bundle_with_cache(
    bundle: &JsValue,
    vk: &VerifyingKeyWasm,
    params: &ParamsWasm,
) -> Result<bool, JsValue> {
    let parsed: ProofBundle = from_value(bundle.clone()).map_err(js_error)?;
    ensure_bundle_version(&parsed)?;
    verify_bundle(&parsed, vk, params)
}

#[wasm_bindgen(js_name = verifyProofCachedJson)]
pub fn verify_proof_cached_json(
    proof_bytes: &[u8],
    public_inputs_json: &str,
) -> Result<bool, JsValue> {
    let public_inputs = PublicInputsWasm::from_json(public_inputs_json)?;
    with_cached_verifier(|params, vk| verify_with_structs(proof_bytes, &public_inputs, vk, params))
}

#[wasm_bindgen(js_name = verifyProofCachedBytes)]
pub fn verify_proof_cached_bytes(
    proof_bytes: &[u8],
    public_inputs_bytes: &[u8],
) -> Result<bool, JsValue> {
    let public_inputs = PublicInputsWasm::from_bytes(public_inputs_bytes)?;
    with_cached_verifier(|params, vk| verify_with_structs(proof_bytes, &public_inputs, vk, params))
}

#[wasm_bindgen(js_name = verifyProofBundleCached)]
pub fn verify_proof_bundle_cached(bundle: &JsValue) -> Result<bool, JsValue> {
    let parsed: ProofBundle = from_value(bundle.clone()).map_err(js_error)?;
    ensure_bundle_version(&parsed)?;
    with_cached_verifier(|params, vk| verify_bundle(&parsed, vk, params))
}

impl VerifyingKeyWasm {
    fn inner(&self) -> &plonk::VerifyingKey<G1Affine> {
        &self.vk
    }
}

impl ParamsWasm {
    fn inner(&self) -> &ParamsKZG<Bn256> {
        &self.params
    }
}

impl ProvingKeyWasm {
    fn inner(&self) -> &plonk::ProvingKey<G1Affine> {
        &self.pk
    }
}

impl PublicInputsWasm {
    fn inner(&self) -> &VerifierPublicInputs {
        &self.inputs
    }

    fn instances(&self) -> Result<Vec<Vec<Fr>>, JsValue> {
        public_inputs_to_instances(self.inner()).map_err(js_error)
    }
}

fn verify_with_structs(
    proof_bytes: &[u8],
    public_inputs: &PublicInputsWasm,
    vk: &VerifyingKeyWasm,
    params: &ParamsWasm,
) -> Result<bool, JsValue> {
    let instances = public_inputs.instances()?;
    Ok(verify(params.inner(), vk.inner(), proof_bytes, &instances))
}

fn prove_bundle_with_structs(
    attestation_json: &str,
    params: &ParamsWasm,
    pk: &ProvingKeyWasm,
) -> Result<ProofBundle, JsValue> {
    let input = parse_input(attestation_json)?;
    
    // Log public inputs for debugging (matches backend verifier logging)
    web_sys::console::log_1(&"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━".into());
    web_sys::console::log_1(&"[ZKPF WASM] PROOF GENERATION REQUEST".into());
    web_sys::console::log_1(&"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━".into());
    web_sys::console::log_1(&format!(
        "[ZKPF WASM] Public inputs:\n  threshold_raw: {}\n  currency_code: {}\n  epoch: {}\n  scope_id: {}\n  policy_id: {}",
        input.public.threshold_raw,
        input.public.required_currency_code,
        input.public.current_epoch,
        input.public.verifier_scope_id,
        input.public.policy_id
    ).into());
    
    // Log nullifier and custodian hash first 8 bytes as hex
    let nullifier_bytes = fr_to_le_bytes(&input.public.nullifier);
    let custodian_bytes = fr_to_le_bytes(&input.public.custodian_pubkey_hash);
    web_sys::console::log_1(&format!(
        "[ZKPF WASM] Nullifier (first 8 bytes): {:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        nullifier_bytes[0], nullifier_bytes[1], nullifier_bytes[2], nullifier_bytes[3],
        nullifier_bytes[4], nullifier_bytes[5], nullifier_bytes[6], nullifier_bytes[7]
    ).into());
    web_sys::console::log_1(&format!(
        "[ZKPF WASM] Custodian hash (first 8 bytes): {:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        custodian_bytes[0], custodian_bytes[1], custodian_bytes[2], custodian_bytes[3],
        custodian_bytes[4], custodian_bytes[5], custodian_bytes[6], custodian_bytes[7]
    ).into());
    
    // Log instance column layout (V1: 7 public inputs)
    web_sys::console::log_1(&format!(
        "[ZKPF WASM] Circuit: ZkpfCircuit (custodial), k=14, instance_columns=7, circuit_version={}",
        CIRCUIT_VERSION
    ).into());
    web_sys::console::log_1(&"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━".into());
    
    // Use the error-returning API instead of catch_unwind.
    // In WASM, panic = "abort" is the default, so catch_unwind doesn't work and
    // panics become opaque "unreachable" traps. By using prove_bundle_result,
    // we get proper error messages instead of aborts.
    let bundle = prove_bundle_result(params.inner(), pk.inner(), input).map_err(|e| {
        js_error(format!(
            "Proof generation failed: {}. This may indicate: (1) circuit parameters/proving key \
             mismatch, (2) invalid attestation values that violate constraints, or (3) insufficient \
             memory. Try refreshing and re-downloading artifacts.",
            e
        ))
    })?;
    
    web_sys::console::log_1(&format!(
        "[ZKPF WASM] ✓ Proof generated successfully, proof_len={} bytes",
        bundle.proof.len()
    ).into());
    
    Ok(bundle)
}

fn verify_bundle(
    bundle: &ProofBundle,
    vk: &VerifyingKeyWasm,
    params: &ParamsWasm,
) -> Result<bool, JsValue> {
    let instances = public_inputs_to_instances(&bundle.public_inputs).map_err(js_error)?;
    Ok(verify(
        params.inner(),
        vk.inner(),
        &bundle.proof,
        &instances,
    ))
}

fn ensure_bundle_version(bundle: &ProofBundle) -> Result<(), JsValue> {
    if bundle.circuit_version != CIRCUIT_VERSION {
        return Err(js_error(format!(
            "bundle circuit_version {} does not match wasm crate {}",
            bundle.circuit_version, CIRCUIT_VERSION
        )));
    }
    Ok(())
}

fn cache_params(params: ParamsWasm) {
    CACHED_PARAMS.with(|cell| {
        *cell.borrow_mut() = Some(params);
    });
}

fn cache_vk(vk: VerifyingKeyWasm) {
    CACHED_VK.with(|cell| {
        *cell.borrow_mut() = Some(vk);
    });
}

fn cache_pk(pk: ProvingKeyWasm) {
    CACHED_PK.with(|cell| {
        *cell.borrow_mut() = Some(pk);
    });
}

// === Orchard Proving Support ===
// The Orchard circuit (k=19, 10 instance columns) uses a different proving key
// than the custodial circuit (k=14, 7 instance columns).

#[wasm_bindgen]
pub struct OrchardProvingKeyWasm {
    pk: plonk::ProvingKey<G1Affine>,
    serialized: Vec<u8>,
}

#[wasm_bindgen]
impl OrchardProvingKeyWasm {
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8]) -> Result<OrchardProvingKeyWasm, JsValue> {
        use halo2_proofs_axiom::SerdeFormat;
        use std::io::Cursor;
        
        // Deserialize with Orchard circuit params
        let params = OrchardPofCircuit::default().params();
        let mut reader = Cursor::new(bytes);
        let pk = plonk::ProvingKey::<G1Affine>::read::<_, OrchardPofCircuit>(
            &mut reader,
            SerdeFormat::Processed,
            params,
        )
        .map_err(|e| js_error(format!("failed to deserialize Orchard proving key: {:?}", e)))?;
        
        Ok(Self {
            pk,
            serialized: bytes.to_vec(),
        })
    }

    #[wasm_bindgen(js_name = toBytes)]
    pub fn to_bytes(&self) -> Vec<u8> {
        self.serialized.clone()
    }
}

impl OrchardProvingKeyWasm {
    fn inner(&self) -> &plonk::ProvingKey<G1Affine> {
        &self.pk
    }
}

fn cache_orchard_params(params: ParamsWasm) {
    CACHED_ORCHARD_PARAMS.with(|cell| {
        *cell.borrow_mut() = Some(params);
    });
}

fn cache_orchard_pk(pk: OrchardProvingKeyWasm) {
    CACHED_ORCHARD_PK.with(|cell| {
        *cell.borrow_mut() = Some(pk);
    });
}

fn cache_orchard_break_points(break_points: OrchardBreakPoints) {
    CACHED_ORCHARD_BREAK_POINTS.with(|cell| {
        *cell.borrow_mut() = Some(break_points);
    });
}

/// Compute artifact key from raw bytes (blake3 hash prefix).
fn compute_artifact_key(params_bytes: &[u8], pk_bytes: &[u8]) -> String {
    let params_hash = blake3::hash(params_bytes);
    let pk_hash = blake3::hash(pk_bytes);
    format!(
        "params={:.8}+pk={:.8}",
        hex::encode(&params_hash.as_bytes()[..4]),
        hex::encode(&pk_hash.as_bytes()[..4])
    )
}

/// Initialize Orchard prover artifacts (k=19, 10 instance columns).
/// These are separate from the custodial artifacts.
///
/// # Arguments
/// * `params_bytes` - Serialized KZG parameters
/// * `pk_bytes` - Serialized proving key
/// * `break_points_bytes` - Serialized break points (REQUIRED for proof generation)
///
/// # Important
/// The `break_points_bytes` parameter is **required**. Without it, proof generation will
/// panic with "break points not set". Break points are computed during keygen and must
/// be loaded from the `break_points.json` artifact file.
#[wasm_bindgen(js_name = initOrchardProverArtifacts)]
pub fn init_orchard_prover_artifacts(
    params_bytes: &[u8],
    pk_bytes: &[u8],
    break_points_bytes: &[u8],
) -> Result<(), JsValue> {
    let artifact_key = compute_artifact_key(params_bytes, pk_bytes);
    
    web_sys::console::log_1(&"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━".into());
    web_sys::console::log_1(&"[ZKPF Orchard WASM] initOrchardProverArtifacts called".into());
    web_sys::console::log_1(&"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━".into());
    web_sys::console::log_1(&format!(
        "[ZKPF Orchard WASM] params={} bytes, pk={} bytes, break_points={} bytes, k={}",
        params_bytes.len(),
        pk_bytes.len(),
        break_points_bytes.len(),
        ORCHARD_DEFAULT_K
    ).into());
    web_sys::console::log_1(&format!(
        "[ZKPF Orchard WASM] *** ARTIFACT_KEY={} ***",
        artifact_key
    ).into());
    
    let params = ParamsWasm::new(params_bytes)?;
    let pk = OrchardProvingKeyWasm::new(pk_bytes)?;
    
    // Deserialize break points - these are REQUIRED for proof generation
    let break_points = deserialize_break_points(break_points_bytes)
        .map_err(|e| js_error(format!("failed to deserialize Orchard break points: {}", e)))?;
    
    web_sys::console::log_1(&format!(
        "[ZKPF Orchard WASM] Break points loaded: {} phases",
        break_points.len()
    ).into());
    
    cache_orchard_params(params);
    cache_orchard_pk(pk);
    cache_orchard_break_points(break_points);
    
    web_sys::console::log_1(&"[ZKPF Orchard WASM] ✓ Orchard prover artifacts initialized successfully".into());
    web_sys::console::log_1(&"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━".into());
    Ok(())
}

/// Generate an Orchard proof bundle using the cached Orchard artifacts.
#[wasm_bindgen(js_name = generateOrchardProofBundleCached)]
pub fn generate_orchard_proof_bundle_cached(
    public_inputs_json: &str,
    note_values_json: &str,
) -> Result<JsValue, JsValue> {
    web_sys::console::log_1(&"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━".into());
    web_sys::console::log_1(&"[ZKPF Orchard WASM] generateOrchardProofBundleCached called".into());
    web_sys::console::log_1(&"━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━".into());
    
    with_cached_orchard_prover(|params, pk, break_points| {
        let public_inputs: VerifierPublicInputs =
            serde_json::from_str(public_inputs_json).map_err(js_error)?;
        let note_values: Vec<u64> =
            serde_json::from_str(note_values_json).map_err(js_error)?;
        
        // Log artifact key from cached artifacts
        let artifact_key = compute_artifact_key(&params.serialized, &pk.serialized);
        web_sys::console::log_1(&format!(
            "[ZKPF Orchard WASM] *** Using ARTIFACT_KEY={} ***",
            artifact_key
        ).into());
        web_sys::console::log_1(&format!(
            "[ZKPF Orchard WASM] Break points: {} phases",
            break_points.len()
        ).into());
        
        let bundle = prove_orchard_bundle_with_structs(
            public_inputs,
            note_values,
            params,
            pk,
            break_points,
        )?;
        
        to_value(&bundle).map_err(js_error)
    })
}

fn with_cached_orchard_prover<R>(
    f: impl FnOnce(&ParamsWasm, &OrchardProvingKeyWasm, &OrchardBreakPoints) -> Result<R, JsValue>,
) -> Result<R, JsValue> {
    CACHED_ORCHARD_PARAMS.with(|params_cell| {
        let params = params_cell.borrow();
        let params_ref = params
            .as_ref()
            .ok_or_else(|| js_error("Orchard params not initialized; call initOrchardProverArtifacts"))?;
        CACHED_ORCHARD_PK.with(|pk_cell| {
            let pk = pk_cell.borrow();
            let pk_ref = pk
                .as_ref()
                .ok_or_else(|| js_error("Orchard proving key not initialized; call initOrchardProverArtifacts"))?;
            CACHED_ORCHARD_BREAK_POINTS.with(|bp_cell| {
                let bp = bp_cell.borrow();
                let bp_ref = bp
                    .as_ref()
                    .ok_or_else(|| js_error("Orchard break points not initialized; call initOrchardProverArtifacts with break_points_bytes"))?;
                f(params_ref, pk_ref, bp_ref)
            })
        })
    })
}

fn prove_orchard_bundle_with_structs(
    public_inputs: VerifierPublicInputs,
    note_values: Vec<u64>,
    params: &ParamsWasm,
    pk: &OrchardProvingKeyWasm,
    break_points: &OrchardBreakPoints,
) -> Result<ProofBundle, JsValue> {
    use halo2_proofs_axiom::poly::kzg::{
        commitment::KZGCommitmentScheme,
        multiopen::ProverGWC,
    };
    use rand::rngs::OsRng;
    
    // Log V2_ORCHARD public input fields
    web_sys::console::log_1(&"[ZKPF Orchard WASM] V2_ORCHARD Public Input Fields (10 columns):".into());
    web_sys::console::log_1(&format!(
        "[ZKPF Orchard WASM]   col[0] threshold_raw: {}",
        public_inputs.threshold_raw
    ).into());
    web_sys::console::log_1(&format!(
        "[ZKPF Orchard WASM]   col[1] required_currency_code: {}",
        public_inputs.required_currency_code
    ).into());
    web_sys::console::log_1(&format!(
        "[ZKPF Orchard WASM]   col[2] current_epoch: {}",
        public_inputs.current_epoch
    ).into());
    web_sys::console::log_1(&format!(
        "[ZKPF Orchard WASM]   col[3] verifier_scope_id: {}",
        public_inputs.verifier_scope_id
    ).into());
    web_sys::console::log_1(&format!(
        "[ZKPF Orchard WASM]   col[4] policy_id: {}",
        public_inputs.policy_id
    ).into());
    
    // Log nullifier first 8 bytes
    web_sys::console::log_1(&format!(
        "[ZKPF Orchard WASM]   col[5] nullifier: {:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}...",
        public_inputs.nullifier[0], public_inputs.nullifier[1],
        public_inputs.nullifier[2], public_inputs.nullifier[3],
        public_inputs.nullifier[4], public_inputs.nullifier[5],
        public_inputs.nullifier[6], public_inputs.nullifier[7]
    ).into());
    
    // Log custodian hash first 8 bytes  
    web_sys::console::log_1(&format!(
        "[ZKPF Orchard WASM]   col[6] custodian_pubkey_hash: {:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}...",
        public_inputs.custodian_pubkey_hash[0], public_inputs.custodian_pubkey_hash[1],
        public_inputs.custodian_pubkey_hash[2], public_inputs.custodian_pubkey_hash[3],
        public_inputs.custodian_pubkey_hash[4], public_inputs.custodian_pubkey_hash[5],
        public_inputs.custodian_pubkey_hash[6], public_inputs.custodian_pubkey_hash[7]
    ).into());
    
    // Log Orchard-specific fields
    web_sys::console::log_1(&format!(
        "[ZKPF Orchard WASM]   col[7] snapshot_block_height: {:?}",
        public_inputs.snapshot_block_height
    ).into());
    
    if let Some(anchor) = &public_inputs.snapshot_anchor_orchard {
        web_sys::console::log_1(&format!(
            "[ZKPF Orchard WASM]   col[8] snapshot_anchor_orchard: {:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}...",
            anchor[0], anchor[1], anchor[2], anchor[3],
            anchor[4], anchor[5], anchor[6], anchor[7]
        ).into());
    } else {
        web_sys::console::log_1(&"[ZKPF Orchard WASM]   col[8] snapshot_anchor_orchard: None".into());
    }
    
    if let Some(binding) = &public_inputs.holder_binding {
        web_sys::console::log_1(&format!(
            "[ZKPF Orchard WASM]   col[9] holder_binding: {:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}...",
            binding[0], binding[1], binding[2], binding[3],
            binding[4], binding[5], binding[6], binding[7]
        ).into());
    } else {
        web_sys::console::log_1(&"[ZKPF Orchard WASM]   col[9] holder_binding: None".into());
    }
    
    web_sys::console::log_1(&format!(
        "[ZKPF Orchard WASM] note_values: {:?}",
        note_values
    ).into());
    
    web_sys::console::log_1(&format!(
        "[ZKPF Orchard WASM] Circuit: OrchardPofCircuit, k={}, layout=V2_ORCHARD, circuit_version={}",
        ORCHARD_DEFAULT_K, CIRCUIT_VERSION
    ).into());
    
    // Build circuit input
    let circuit_input = OrchardPofCircuitInput {
        public_inputs: public_inputs.clone(),
        note_values,
    };
    
    // Create circuit in prover mode WITH break points - this is the critical fix
    // Without break points, the prover panics with "break points not set"
    let circuit = OrchardPofCircuit::new_prover(circuit_input, break_points.clone());
    
    // Convert public inputs to instances using V2Orchard layout
    let instances = public_inputs_to_instances_with_layout(
        PublicInputLayout::V2Orchard,
        &public_inputs,
    ).map_err(|e| js_error(format!("failed to convert public inputs: {}", e)))?;
    
    let instance_refs: Vec<&[Fr]> = instances.iter().map(|col| col.as_slice()).collect();
    
    // Generate the proof
    let mut transcript =
        halo2_proofs_axiom::transcript::Blake2bWrite::<_, G1Affine, _>::init(vec![]);
    
    halo2_proofs_axiom::plonk::create_proof::<
        KZGCommitmentScheme<halo2curves_axiom::bn256::Bn256>,
        ProverGWC<'_, halo2curves_axiom::bn256::Bn256>,
        _,
        _,
        _,
        _,
    >(
        params.inner(),
        pk.inner(),
        &[circuit],
        &[instance_refs.as_slice()],
        OsRng,
        &mut transcript,
    )
    .map_err(|e| js_error(format!("Orchard proof generation failed: {:?}", e)))?;
    
    let proof = transcript.finalize();
    
    web_sys::console::log_1(&format!(
        "[ZKPF WASM] ✓ Orchard proof generated successfully, proof_len={} bytes",
        proof.len()
    ).into());
    
    Ok(ProofBundle {
        rail_id: RAIL_ID_ZCASH_ORCHARD.to_string(),
        circuit_version: CIRCUIT_VERSION,
        proof,
        public_inputs,
    })
}

fn with_cached_verifier<R>(
    f: impl FnOnce(&ParamsWasm, &VerifyingKeyWasm) -> Result<R, JsValue>,
) -> Result<R, JsValue> {
    CACHED_PARAMS.with(|params_cell| {
        let params = params_cell.borrow();
        let params_ref = params.as_ref().ok_or_else(|| {
            js_error("verifier params not initialized; call initVerifierArtifacts")
        })?;
        CACHED_VK.with(|vk_cell| {
            let vk = vk_cell.borrow();
            let vk_ref = vk.as_ref().ok_or_else(|| {
                js_error("verifying key not initialized; call initVerifierArtifacts")
            })?;
            f(params_ref, vk_ref)
        })
    })
}

fn with_cached_prover<R>(
    f: impl FnOnce(&ParamsWasm, &ProvingKeyWasm) -> Result<R, JsValue>,
) -> Result<R, JsValue> {
    CACHED_PARAMS.with(|params_cell| {
        let params = params_cell.borrow();
        let params_ref = params
            .as_ref()
            .ok_or_else(|| js_error("prover params not initialized; call initProverArtifacts"))?;
        CACHED_PK.with(|pk_cell| {
            let pk = pk_cell.borrow();
            let pk_ref = pk
                .as_ref()
                .ok_or_else(|| js_error("proving key not initialized; call initProverArtifacts"))?;
            f(params_ref, pk_ref)
        })
    })
}

fn parse_input(attestation_json: &str) -> Result<ZkpfCircuitInput, JsValue> {
    serde_json::from_str(attestation_json).map_err(|e| {
        js_error(format!(
            "Failed to parse attestation JSON: {}. \
             Ensure the JSON has 'attestation' and 'public' objects with all required fields. \
             Common issues: nullifier/custodian_pubkey_hash must be 64-character hex strings, \
             pubkey x/y and signature r/s must be 32-element number arrays.",
            e
        ))
    })
}

fn js_error(err: impl ToString) -> JsValue {
    JsValue::from_str(&err.to_string())
}

fn into_field_bytes(label: &str, bytes: &[u8]) -> Result<[u8; 32], JsValue> {
    if bytes.len() != 32 {
        return Err(js_error(format!("{label} must be 32 bytes")));
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(bytes);
    Ok(arr)
}

fn poseidon_hash<const L: usize>(values: [Fr; L]) -> Fr {
    Hash::<Fr, PoseidonSpecImpl, ConstantLength<L>, POSEIDON_T, POSEIDON_RATE>::init().hash(values)
}

fn fr_to_be_bytes(value: &Fr) -> [u8; 32] {
    let mut le = fr_to_le_bytes(value);
    le.reverse();
    le
}

fn fr_to_le_bytes(value: &Fr) -> [u8; 32] {
    let repr = value.to_repr();
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(repr.as_ref());
    bytes
}

fn fr_from_le_bytes(bytes: &[u8]) -> Result<Fr, JsValue> {
    if bytes.len() != 32 {
        return Err(js_error("field elements must be 32 bytes"));
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(bytes);
    Fr::from_bytes(&arr)
        .into_option()
        .ok_or_else(|| js_error("invalid field element encoding"))
}

#[derive(Clone, Copy, Debug)]
struct PoseidonSpecImpl;

impl Spec<Fr, POSEIDON_T, POSEIDON_RATE> for PoseidonSpecImpl {
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
