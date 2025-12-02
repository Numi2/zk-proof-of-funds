// zkpf/zkpf-wasm/src/lib.rs
// Numan Thabit 2025

use std::cell::RefCell;

use halo2_proofs_axiom::{plonk, poly::kzg::commitment::ParamsKZG};
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
    serialize_verifier_public_inputs, ProofBundle, VerifierPublicInputs, CIRCUIT_VERSION,
    // Poseidon parameters imported from canonical source (zkpf-circuit via zkpf-common)
    POSEIDON_FULL_ROUNDS, POSEIDON_PARTIAL_ROUNDS, POSEIDON_RATE, POSEIDON_T,
};
use zkpf_prover::{prove, prove_bundle_result, prove_with_public_inputs};
use zkpf_verifier::verify;
#[cfg(target_arch = "wasm32")]
use zkpf_zcash_orchard_circuit::{
    prove_orchard_pof_wasm, OrchardPublicMeta, OrchardSnapshot, OrchardWasmArtifacts,
    PublicMetaInputs, HolderId,
};
#[cfg(target_arch = "wasm32")]
use zkpf_zcash_orchard_wallet::OrchardFvk;

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
    #[cfg(target_arch = "wasm32")]
    static CACHED_ORCHARD_ARTIFACTS: RefCell<Option<OrchardWasmArtifacts>> = const { RefCell::new(None) };
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
    let params = ParamsWasm::new(params_bytes)?;
    let pk = ProvingKeyWasm::new(pk_bytes)?;
    cache_params(params);
    cache_pk(pk);
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
    #[cfg(target_arch = "wasm32")]
    CACHED_ORCHARD_ARTIFACTS.with(|cell| {
        cell.borrow_mut().take();
    });
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub struct OrchardWasmArtifactsWasm {
    artifacts: OrchardWasmArtifacts,
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
impl OrchardWasmArtifactsWasm {
    #[wasm_bindgen(constructor)]
    pub fn new(params_bytes: &[u8], vk_bytes: &[u8], pk_bytes: &[u8]) -> Result<OrchardWasmArtifactsWasm, JsValue> {
        Ok(Self {
            artifacts: OrchardWasmArtifacts {
                params_bytes: params_bytes.to_vec(),
                vk_bytes: vk_bytes.to_vec(),
                pk_bytes: pk_bytes.to_vec(),
            },
        })
    }
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = initOrchardProverArtifacts)]
pub fn init_orchard_prover_artifacts(
    params_bytes: &[u8],
    vk_bytes: &[u8],
    pk_bytes: &[u8],
) -> Result<(), JsValue> {
    let artifacts = OrchardWasmArtifacts {
        params_bytes: params_bytes.to_vec(),
        vk_bytes: vk_bytes.to_vec(),
        pk_bytes: pk_bytes.to_vec(),
    };
    cache_orchard_artifacts(artifacts);
    Ok(())
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = hasOrchardArtifacts)]
pub fn has_orchard_artifacts() -> bool {
    CACHED_ORCHARD_ARTIFACTS.with(|cell| {
        cell.borrow().is_some()
    })
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(js_name = generateOrchardProofBundle)]
pub fn generate_orchard_proof_bundle(
    snapshot_json: &str,
    fvk_encoded: &str,
    holder_id: &str,
    threshold_zats: u64,
    orchard_meta_json: &str,
    public_meta_json: &str,
) -> Result<JsValue, JsValue> {
    // Deserialize inputs
    let snapshot: OrchardSnapshot = serde_json::from_str(snapshot_json)
        .map_err(|e| js_error(format!("Failed to parse snapshot JSON: {}", e)))?;
    
    let fvk = OrchardFvk {
        encoded: fvk_encoded.to_string(),
    };
    
    let holder_id: HolderId = holder_id.to_string();
    
    let orchard_meta: OrchardPublicMeta = serde_json::from_str(orchard_meta_json)
        .map_err(|e| js_error(format!("Failed to parse orchard_meta JSON: {}", e)))?;
    
    let public_meta: PublicMetaInputs = serde_json::from_str(public_meta_json)
        .map_err(|e| js_error(format!("Failed to parse public_meta JSON: {}", e)))?;
    
    // Get cached artifacts
    let artifacts = CACHED_ORCHARD_ARTIFACTS.with(|cell| {
        cell.borrow().clone().ok_or_else(|| {
            js_error("Orchard prover artifacts not initialized; call initOrchardProverArtifacts first")
        })
    })?;
    
    // Generate proof
    let bundle = prove_orchard_pof_wasm(
        &snapshot,
        &fvk,
        &holder_id,
        threshold_zats,
        &orchard_meta,
        &public_meta,
        &artifacts,
    ).map_err(|e| js_error(format!("Orchard proof generation failed: {}", e)))?;
    
    to_value(&bundle).map_err(js_error)
}

#[cfg(not(target_arch = "wasm32"))]
#[wasm_bindgen(js_name = initOrchardProverArtifacts)]
pub fn init_orchard_prover_artifacts(
    _params_bytes: &[u8],
    _vk_bytes: &[u8],
    _pk_bytes: &[u8],
) -> Result<(), JsValue> {
    Err(js_error("Orchard prover is only available in WASM builds"))
}

#[cfg(not(target_arch = "wasm32"))]
#[wasm_bindgen(js_name = hasOrchardArtifacts)]
pub fn has_orchard_artifacts() -> bool {
    false
}

#[cfg(not(target_arch = "wasm32"))]
#[wasm_bindgen(js_name = generateOrchardProofBundle)]
pub fn generate_orchard_proof_bundle(
    _snapshot_json: &str,
    _fvk_encoded: &str,
    _holder_id: &str,
    _threshold_zats: u64,
    _orchard_meta_json: &str,
    _public_meta_json: &str,
) -> Result<JsValue, JsValue> {
    Err(js_error("Orchard prover is only available in WASM builds"))
}

#[cfg(target_arch = "wasm32")]
fn cache_orchard_artifacts(artifacts: OrchardWasmArtifacts) {
    CACHED_ORCHARD_ARTIFACTS.with(|cell| {
        *cell.borrow_mut() = Some(artifacts);
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
    // Use the error-returning API instead of catch_unwind.
    // In WASM, panic = "abort" is the default, so catch_unwind doesn't work and
    // panics become opaque "unreachable" traps. By using prove_bundle_result,
    // we get proper error messages instead of aborts.
    prove_bundle_result(params.inner(), pk.inner(), input).map_err(|e| {
        js_error(format!(
            "Proof generation failed: {}. This may indicate: (1) circuit parameters/proving key \
             mismatch, (2) invalid attestation values that violate constraints, or (3) insufficient \
             memory. Try refreshing and re-downloading artifacts.",
            e
        ))
    })
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
