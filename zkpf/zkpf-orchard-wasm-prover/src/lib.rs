use once_cell::sync::OnceCell;
use wasm_bindgen::prelude::*;

use zkpf_zcash_orchard_circuit::{
    prove_orchard_pof_wasm, OrchardPublicMeta, OrchardWasmArtifacts, PublicMetaInputs, ProofBundle,
};
use zkpf_zcash_orchard_wallet::{OrchardFvk, OrchardSnapshot};

static ORCHARD_ARTIFACTS: OnceCell<OrchardWasmArtifacts> = OnceCell::new();

#[wasm_bindgen(start)]
pub fn wasm_start() {
    console_error_panic_hook::set_once();
}

/// Convert a Rust error into a JsValue carrying a readable message.
fn js_err(e: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&e.to_string())
}

/// Initialise in-memory Orchard proving artifacts (params, vk, pk) for use in
/// the browser. This must be called exactly once before `prove_pof_json`.
#[wasm_bindgen]
pub fn init_orchard_artifacts(
    params: &[u8],
    vk: &[u8],
    pk: &[u8],
) -> Result<(), JsValue> {
    let artifacts = OrchardWasmArtifacts {
        params_bytes: params.to_vec(),
        vk_bytes: vk.to_vec(),
        pk_bytes: pk.to_vec(),
    };

    ORCHARD_ARTIFACTS
        .set(artifacts)
        .map_err(|_| js_err("Orchard artifacts already initialised"))?;

    Ok(())
}

/// JSON payload for Orchard PoF proving in WASM.
///
/// This mirrors the high-level Orchard rail API:
/// - `snapshot`: Orchard notes + anchor at a given height.
/// - `fvk`: encoded Orchard FVK / UFVK string.
/// - `holder_id`: application-level holder identifier.
/// - `threshold_zats`: required minimum balance in zatoshi.
/// - `orchard_meta`: chain / pool / snapshot metadata.
/// - `meta`: shared zkpf policy/scope/epoch metadata.
#[derive(serde::Serialize, serde::Deserialize)]
pub struct WasmOrchardProveRequest {
    pub snapshot: OrchardSnapshot,
    pub fvk: OrchardFvk,
    pub holder_id: String,
    pub threshold_zats: u64,
    pub orchard_meta: OrchardPublicMeta,
    pub meta: PublicMetaInputs,
}

/// Prove Orchard PoF from a JSON-encoded `WasmOrchardProveRequest`.
///
/// The return value is a JSON-encoded `ProofBundle` usable with the backend
/// `/zkpf/verify-bundle` endpoint.
#[wasm_bindgen]
pub fn prove_pof_json(request_json: String) -> Result<JsValue, JsValue> {
    let req: WasmOrchardProveRequest = serde_json::from_str(&request_json)
        .map_err(|e| js_err(format!("request JSON error: {e}")))?;

    let artifacts = ORCHARD_ARTIFACTS
        .get()
        .ok_or_else(|| js_err("Orchard artifacts not initialised; call init_orchard_artifacts() first"))?;

    let bundle: ProofBundle = prove_orchard_pof_wasm(
        &req.snapshot,
        &req.fvk,
        &req.holder_id,
        req.threshold_zats,
        &req.orchard_meta,
        &req.meta,
        artifacts,
    )
    .map_err(js_err)?;

    JsValue::from_serde(&bundle)
        .map_err(|e| js_err(format!("bundle serialization error: {e}")))
}
