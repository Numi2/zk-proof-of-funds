use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::Path,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use tower_http::cors::{Any, CorsLayer};
use once_cell::sync::Lazy;
use blake3;
use sled::Db;
use tokio::net::TcpListener;
use zkpf_circuit::ZkpfCircuitInput;
use zkpf_common::{
    allowlisted_custodian_hash_bytes, deserialize_verifier_public_inputs, load_prover_artifacts,
    load_verifier_artifacts, public_inputs_to_instances_with_layout, public_to_verifier_inputs,
    ProofBundle, ProverArtifacts, PublicInputLayout, VerifierArtifacts, VerifierPublicInputs,
};
use zkpf_prover::prove_bundle;
use zkpf_zcash_orchard_circuit::{load_orchard_verifier_artifacts, RAIL_ID_ZCASH_ORCHARD};
use zkpf_verifier::verify;

const DEFAULT_MANIFEST_PATH: &str = "artifacts/manifest.json";
const MANIFEST_ENV: &str = "ZKPF_MANIFEST_PATH";
const EPOCH_OVERRIDE_ENV: &str = "ZKPF_VERIFIER_EPOCH";
const EPOCH_DRIFT_ENV: &str = "ZKPF_VERIFIER_MAX_DRIFT_SECS";
const DEFAULT_MAX_EPOCH_DRIFT_SECS: u64 = 300;
const POLICY_PATH_ENV: &str = "ZKPF_POLICY_PATH";
const DEFAULT_POLICY_PATH: &str = "config/policies.json";
const NULLIFIER_DB_ENV: &str = "ZKPF_NULLIFIER_DB";
const DEFAULT_NULLIFIER_DB_PATH: &str = "data/nullifiers.db";
const MULTIRAIL_MANIFEST_ENV: &str = "ZKPF_MULTI_RAIL_MANIFEST_PATH";
const ATTESTATION_ENABLED_ENV: &str = "ZKPF_ATTESTATION_ENABLED";
const ATTESTATION_RPC_URL_ENV: &str = "ZKPF_ATTESTATION_RPC_URL";
const ATTESTATION_CHAIN_ID_ENV: &str = "ZKPF_ATTESTATION_CHAIN_ID";
const ATTESTATION_REGISTRY_ADDRESS_ENV: &str = "ZKPF_ATTESTATION_REGISTRY_ADDRESS";
const ATTESTOR_PRIVATE_KEY_ENV: &str = "ZKPF_ATTESTOR_PRIVATE_KEY";
const NULLIFIER_SPENT_ERR: &str = "nullifier already spent for this scope/policy";
const CODE_CIRCUIT_VERSION: &str = "CIRCUIT_VERSION_MISMATCH";
const CODE_PUBLIC_INPUTS: &str = "PUBLIC_INPUTS_INVALID";
const CODE_POLICY_NOT_FOUND: &str = "POLICY_NOT_FOUND";
const CODE_POLICY_MISMATCH: &str = "POLICY_MISMATCH";
const CODE_CUSTODIAN_MISMATCH: &str = "CUSTODIAN_MISMATCH";
const CODE_EPOCH_DRIFT: &str = "EPOCH_DRIFT";
const CODE_NULLIFIER_REPLAY: &str = "NULLIFIER_REPLAY";
const CODE_NULLIFIER_STORE_ERROR: &str = "NULLIFIER_STORE_ERROR";
const CODE_PROOF_INVALID: &str = "PROOF_INVALID";
const CODE_RAIL_UNKNOWN: &str = "RAIL_UNKNOWN";
const CODE_ATTESTATION_DISABLED: &str = "ATTESTATION_DISABLED";
const CODE_ATTESTATION_VERIFICATION_FAILED: &str = "ATTESTATION_VERIFICATION_FAILED";
const CODE_ATTESTATION_ONCHAIN_ERROR: &str = "ATTESTATION_ONCHAIN_ERROR";
const DEFAULT_RAIL_ID: &str = "CUSTODIAL_ATTESTATION";

static ARTIFACTS: Lazy<Arc<ProverArtifacts>> = Lazy::new(|| Arc::new(load_artifacts()));
static POLICIES: Lazy<PolicyStore> = Lazy::new(PolicyStore::from_env);
static RAILS: Lazy<RailRegistry> = Lazy::new(RailRegistry::from_env);
static ATTESTATION_SERVICE: Lazy<Option<OnchainAttestationService>> =
    Lazy::new(OnchainAttestationService::from_env);

#[derive(Clone, Debug, serde::Deserialize)]
struct RailManifestEntry {
    rail_id: String,
    circuit_version: u32,
    /// Path to a per-rail artifact manifest (params + vk, pk optional).
    manifest_path: String,
    /// Public-input layout identifier, e.g. "V1" or "V2_ORCHARD".
    layout: String,
}

#[derive(Clone, Debug, serde::Deserialize)]
struct MultiRailManifest {
    rails: Vec<RailManifestEntry>,
}

#[derive(Clone)]
enum RailArtifacts {
    Prover(Arc<ProverArtifacts>),
    Verifier(Arc<VerifierArtifacts>),
}

#[derive(Clone)]
struct RailVerifier {
    rail_id: String,
    circuit_version: u32,
    layout: PublicInputLayout,
    artifacts: RailArtifacts,
}

#[derive(Clone)]
struct RailRegistry {
    rails: Arc<HashMap<String, RailVerifier>>,
}

impl RailRegistry {
    fn from_env() -> Self {
        // Start with the legacy custodial rail backed by the full prover artifacts.
        let mut map = HashMap::new();

        let default = RailVerifier {
            rail_id: String::new(),
            circuit_version: ARTIFACTS.manifest.circuit_version,
            layout: PublicInputLayout::V1,
            artifacts: RailArtifacts::Prover(ARTIFACTS.clone()),
        };

        // Empty rail_id is used for backward-compat bundles; DEFAULT_RAIL_ID is a
        // stable explicit identifier for the same rail.
        map.insert(String::new(), default.clone());
        map.insert(DEFAULT_RAIL_ID.to_string(), default);

        if let Ok(path) = env::var(MULTIRAIL_MANIFEST_ENV) {
            let bytes = fs::read(&path).unwrap_or_else(|err| {
                panic!(
                    "failed to read multi-rail manifest from {}: {}",
                    path, err
                )
            });
            let manifest: MultiRailManifest =
                serde_json::from_slice(&bytes).unwrap_or_else(|err| {
                    panic!(
                        "failed to parse multi-rail manifest from {}: {}",
                        path, err
                    )
                });

            for rail in manifest.rails {
                if map.contains_key(&rail.rail_id) {
                    panic!("duplicate rail_id {} in multi-rail manifest", rail.rail_id);
                }

                let layout = match rail.layout.as_str() {
                    "V1" => PublicInputLayout::V1,
                    "V2_ORCHARD" => PublicInputLayout::V2Orchard,
                    other => panic!("unsupported public-input layout '{}'", other),
                };

                let artifacts = if rail.rail_id == RAIL_ID_ZCASH_ORCHARD {
                    load_orchard_verifier_artifacts(&rail.manifest_path).unwrap_or_else(|err| {
                        panic!(
                            "failed to load Orchard verifier artifacts for rail {} from {}: {}",
                            rail.rail_id, rail.manifest_path, err
                        )
                    })
                } else {
                    load_verifier_artifacts(&rail.manifest_path).unwrap_or_else(|err| {
                        panic!(
                            "failed to load verifier artifacts for rail {} from {}: {}",
                            rail.rail_id, rail.manifest_path, err
                        )
                    })
                };

                if artifacts.manifest.circuit_version != rail.circuit_version {
                    panic!(
                        "circuit_version mismatch for rail {}: manifest {} vs config {}",
                        rail.rail_id,
                        artifacts.manifest.circuit_version,
                        rail.circuit_version
                    );
                }

                map.insert(
                    rail.rail_id.clone(),
                    RailVerifier {
                        rail_id: rail.rail_id,
                        circuit_version: rail.circuit_version,
                        layout,
                        artifacts: RailArtifacts::Verifier(Arc::new(artifacts)),
                    },
                );
            }
        }

        RailRegistry {
            rails: Arc::new(map),
        }
    }

    fn get(&self, rail_id: &str) -> Option<&RailVerifier> {
        if rail_id.is_empty() {
            self.rails.get("")
        } else {
            self.rails.get(rail_id)
        }
    }
}

#[derive(Clone)]
struct OnchainAttestationService;

#[derive(Clone)]
struct OnchainAttestationResult {
    tx_hash: String,
    attestation_id: String,
    chain_id: u64,
}

impl OnchainAttestationService {
    fn from_env() -> Option<Self> {
        let enabled = env::var(ATTESTATION_ENABLED_ENV)
            .ok()
            .map(|v| v.to_ascii_lowercase())
            .map(|v| matches!(v.as_str(), "1" | "true" | "yes"))
            .unwrap_or(false);

        if enabled {
            eprintln!(
                "ATTESTATION_ENABLED is set, but the lightweight binary build does not ship \
                 the on-chain attestation client. Disable {} or build with the full feature \
                 set to submit attestations on-chain.",
                ATTESTATION_ENABLED_ENV
            );
        }

        None
    }

    async fn attest(
        &self,
        _holder_id: [u8; 32],
        _policy_id: u64,
        _snapshot_id: [u8; 32],
        _nullifier: [u8; 32],
    ) -> Result<OnchainAttestationResult, String> {
        Err("on-chain attestation is not available in this build".into())
    }
}

#[derive(Clone)]
pub struct AppState {
    artifacts: Arc<ProverArtifacts>,
    epoch: EpochConfig,
    nullifiers: NullifierStore,
    policies: PolicyStore,
}

impl AppState {
    pub fn new(artifacts: Arc<ProverArtifacts>) -> Self {
        Self::with_components(
            artifacts,
            EpochConfig::from_env(),
            NullifierStore::from_env(),
            POLICIES.clone(),
        )
    }

    pub fn with_components(
        artifacts: Arc<ProverArtifacts>,
        epoch: EpochConfig,
        nullifiers: NullifierStore,
        policies: PolicyStore,
    ) -> Self {
        Self {
            artifacts,
            epoch,
            nullifiers,
            policies,
        }
    }

    pub fn with_epoch_config(artifacts: Arc<ProverArtifacts>, epoch: EpochConfig) -> Self {
        Self::with_components(
            artifacts,
            epoch,
            NullifierStore::from_env(),
            POLICIES.clone(),
        )
    }

    pub fn global() -> Self {
        Self::new(ARTIFACTS.clone())
    }

    pub fn artifacts(&self) -> &ProverArtifacts {
        &self.artifacts
    }

    pub fn epoch_config(&self) -> &EpochConfig {
        &self.epoch
    }

    pub fn nullifier_store(&self) -> &NullifierStore {
        &self.nullifiers
    }

    pub fn policy_store(&self) -> &PolicyStore {
        &self.policies
    }
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
        }
    }

    fn bad_request(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, code, message)
    }

    fn policy_not_found(policy_id: u64) -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            CODE_POLICY_NOT_FOUND,
            format!("policy_id {} not found", policy_id),
        )
    }

    fn nullifier_store(err: impl Into<String>) -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            CODE_NULLIFIER_STORE_ERROR,
            err,
        )
    }
}

#[derive(serde::Serialize)]
struct ErrorResponse {
    error: String,
    error_code: &'static str,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = ErrorResponse {
            error: self.message,
            error_code: self.code,
        };
        (self.status, Json(body)).into_response()
    }
}

pub async fn serve() {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = app_router(AppState::global()).layer(cors);
    let listener = TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app.into_make_service())
        .await
        .unwrap();
}

pub fn app_router(state: AppState) -> Router {
    Router::new()
        .route("/zkpf/policies", get(list_policies))
        .route("/zkpf/params", get(get_params))
        .route("/zkpf/epoch", get(get_epoch))
        .route("/zkpf/prove-bundle", post(prove_bundle_handler))
        .route("/zkpf/verify", post(verify_handler))
        .route("/zkpf/verify-bundle", post(verify_bundle_handler))
        .route("/zkpf/attest", post(attest_handler))
        .with_state(state)
}

async fn get_params(State(state): State<AppState>) -> Json<ParamsResponse> {
    let manifest = &state.artifacts().manifest;
    Json(ParamsResponse {
        circuit_version: manifest.circuit_version,
        manifest_version: manifest.manifest_version,
        params_hash: manifest.params.blake3.clone(),
        vk_hash: manifest.vk.blake3.clone(),
        pk_hash: manifest.pk.blake3.clone(),
        params: state.artifacts().params_bytes.clone(),
        vk: state.artifacts().vk_bytes.clone(),
        pk: state.artifacts().pk_bytes.clone(),
    })
}

async fn list_policies(State(state): State<AppState>) -> Json<PoliciesResponse> {
    Json(PoliciesResponse {
        policies: state.policy_store().all(),
    })
}

#[derive(serde::Serialize)]
struct ParamsResponse {
    circuit_version: u32,
    manifest_version: u32,
    params_hash: String,
    vk_hash: String,
    pk_hash: String,
    params: Vec<u8>,
    vk: Vec<u8>,
    pk: Vec<u8>,
}

#[derive(serde::Serialize)]
struct EpochResponse {
    current_epoch: u64,
    max_drift_secs: u64,
}

#[derive(serde::Serialize)]
struct PoliciesResponse {
    policies: Vec<PolicyExpectations>,
}

#[derive(serde::Deserialize)]
struct VerifyRequest {
    circuit_version: u32,
    proof: Vec<u8>,
    public_inputs: Vec<u8>,
    policy_id: u64,
}

#[derive(serde::Serialize)]
struct VerifyResponse {
    valid: bool,
    circuit_version: u32,
    error: Option<String>,
    error_code: Option<&'static str>,
}

impl VerifyResponse {
    fn success(circuit_version: u32) -> Self {
        Self {
            valid: true,
            circuit_version,
            error: None,
            error_code: None,
        }
    }

    fn failure(circuit_version: u32, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            valid: false,
            circuit_version,
            error: Some(message.into()),
            error_code: Some(code),
        }
    }
}

#[derive(serde::Deserialize)]
struct VerifyBundleRequest {
    policy_id: u64,
    bundle: ProofBundle,
}

#[derive(serde::Deserialize)]
struct AttestRequest {
    holder_id: String,
    snapshot_id: String,
    policy_id: u64,
    bundle: ProofBundle,
}

#[derive(Clone)]
struct AttestResponseBase {
    holder_id: String,
    policy_id: u64,
    snapshot_id: String,
}

#[derive(serde::Serialize)]
struct AttestResponse {
    valid: bool,
    tx_hash: Option<String>,
    attestation_id: Option<String>,
    chain_id: Option<u64>,
    holder_id: String,
    policy_id: u64,
    snapshot_id: String,
    error: Option<String>,
    error_code: Option<&'static str>,
}

impl AttestResponse {
    fn success(base: AttestResponseBase, tx_hash: String, attestation_id: String, chain_id: u64) -> Self {
        Self {
            valid: true,
            tx_hash: Some(tx_hash),
            attestation_id: Some(attestation_id),
            chain_id: Some(chain_id),
            holder_id: base.holder_id,
            policy_id: base.policy_id,
            snapshot_id: base.snapshot_id,
            error: None,
            error_code: None,
        }
    }

    fn failure(base: AttestResponseBase, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            valid: false,
            tx_hash: None,
            attestation_id: None,
            chain_id: None,
            holder_id: base.holder_id,
            policy_id: base.policy_id,
            snapshot_id: base.snapshot_id,
            error: Some(message.into()),
            error_code: Some(code),
        }
    }
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct PolicyExpectations {
    pub threshold_raw: u64,
    pub required_currency_code: u32,
    pub required_custodian_id: u32,
    pub verifier_scope_id: u64,
    pub policy_id: u64,
}

impl PolicyExpectations {
    fn validate_against(&self, inputs: &VerifierPublicInputs) -> Result<(), String> {
        if inputs.threshold_raw != self.threshold_raw {
            return Err(format!(
                "threshold_raw mismatch: expected {}, got {}",
                self.threshold_raw, inputs.threshold_raw
            ));
        }
        if inputs.required_currency_code != self.required_currency_code {
            return Err(format!(
                "required_currency_code mismatch: expected {}, got {}",
                self.required_currency_code, inputs.required_currency_code
            ));
        }
        if inputs.required_custodian_id != self.required_custodian_id {
            return Err(format!(
                "required_custodian_id mismatch: expected {}, got {}",
                self.required_custodian_id, inputs.required_custodian_id
            ));
        }
        if inputs.verifier_scope_id != self.verifier_scope_id {
            return Err(format!(
                "verifier_scope_id mismatch: expected {}, got {}",
                self.verifier_scope_id, inputs.verifier_scope_id
            ));
        }
        if inputs.policy_id != self.policy_id {
            return Err(format!(
                "policy_id mismatch: expected {}, got {}",
                self.policy_id, inputs.policy_id
            ));
        }
        Ok(())
    }
}

#[derive(Clone)]
pub struct PolicyStore {
    policies: Arc<HashMap<u64, PolicyExpectations>>,
}

impl PolicyStore {
    fn from_env() -> Self {
        let path = env::var(POLICY_PATH_ENV).unwrap_or_else(|_| DEFAULT_POLICY_PATH.to_string());
        Self::from_path(path)
    }

    pub fn from_path(path: impl AsRef<Path>) -> Self {
        let path_ref = path.as_ref();
        let bytes = fs::read(path_ref).unwrap_or_else(|err| {
            panic!(
                "failed to read policy configuration from {}: {}",
                path_ref.display(),
                err
            )
        });
        let policies: Vec<PolicyExpectations> =
            serde_json::from_slice(&bytes).unwrap_or_else(|err| {
                panic!(
                    "failed to parse policy configuration from {}: {}",
                    path_ref.display(),
                    err
                )
            });
        Self::from_policies(policies)
    }

    pub fn from_policies(policies: Vec<PolicyExpectations>) -> Self {
        let mut map = HashMap::new();
        for policy in policies {
            let id = policy.policy_id;
            if map.insert(id, policy).is_some() {
                panic!("duplicate policy_id {} in policy configuration", id);
            }
        }
        Self {
            policies: Arc::new(map),
        }
    }

    pub fn get(&self, policy_id: u64) -> Option<PolicyExpectations> {
        self.policies.get(&policy_id).cloned()
    }

    pub fn all(&self) -> Vec<PolicyExpectations> {
        self.policies.values().cloned().collect()
    }
}

async fn verify_handler(
    State(state): State<AppState>,
    Json(req): Json<VerifyRequest>,
) -> Result<Json<VerifyResponse>, ApiError> {
    // Legacy /zkpf/verify endpoint is bound to the default custodial rail.
    let rail = RAILS
        .get("")
        .expect("default custodial rail not configured in RailRegistry");
    if req.circuit_version != rail.circuit_version {
        return Err(ApiError::bad_request(
            CODE_CIRCUIT_VERSION,
            format!(
                "circuit_version mismatch: expected {}, got {}",
                rail.circuit_version, req.circuit_version
            ),
        ));
    }

    let policy = state
        .policy_store()
        .get(req.policy_id)
        .ok_or_else(|| ApiError::policy_not_found(req.policy_id))?;

    let public_inputs = deserialize_verifier_public_inputs(&req.public_inputs).map_err(|err| {
        ApiError::bad_request(
            CODE_PUBLIC_INPUTS,
            format!("invalid public_inputs encoding: {err}"),
        )
    })?;

    let response = process_verification(&state, rail, &policy, &public_inputs, &req.proof)?;
    Ok(Json(response))
}

async fn verify_bundle_handler(
    State(state): State<AppState>,
    Json(req): Json<VerifyBundleRequest>,
) -> Result<Json<VerifyResponse>, ApiError> {
    let rail = RAILS
        .get(&req.bundle.rail_id)
        .ok_or_else(|| {
            ApiError::bad_request(
                CODE_RAIL_UNKNOWN,
                format!(
                    "unknown rail_id '{}'; configure it via {}",
                    req.bundle.rail_id, MULTIRAIL_MANIFEST_ENV
                ),
            )
        })?;

    if req.bundle.circuit_version != rail.circuit_version {
        return Err(ApiError::bad_request(
            CODE_CIRCUIT_VERSION,
            format!(
                "circuit_version mismatch for rail {}: expected {}, got {}",
                if req.bundle.rail_id.is_empty() {
                    DEFAULT_RAIL_ID
                } else {
                    &req.bundle.rail_id
                },
                rail.circuit_version,
                req.bundle.circuit_version
            ),
        ));
    }

    let policy = state
        .policy_store()
        .get(req.policy_id)
        .ok_or_else(|| ApiError::policy_not_found(req.policy_id))?;

    let response = process_verification(
        &state,
        rail,
        &policy,
        &req.bundle.public_inputs,
        &req.bundle.proof,
    )?;
    Ok(Json(response))
}

async fn attest_handler(
    State(state): State<AppState>,
    Json(req): Json<AttestRequest>,
) -> Json<AttestResponse> {
    let base = AttestResponseBase {
        holder_id: req.holder_id.clone(),
        policy_id: req.policy_id,
        snapshot_id: req.snapshot_id.clone(),
    };

    let service = match ATTESTATION_SERVICE.as_ref() {
        Some(service) => service,
        None => {
            return Json(AttestResponse::failure(
                base,
                CODE_ATTESTATION_DISABLED,
                format!(
                    "on-chain attestation is not configured; set {}=1 and related environment variables",
                    ATTESTATION_ENABLED_ENV
                ),
            ))
        }
    };

    let rail = match RAILS.get(&req.bundle.rail_id) {
        Some(rail) => rail,
        None => {
            return Json(AttestResponse::failure(
                base,
                CODE_RAIL_UNKNOWN,
                format!(
                    "unknown rail_id '{}'; configure it via {}",
                    req.bundle.rail_id, MULTIRAIL_MANIFEST_ENV
                ),
            ))
        }
    };

    if req.bundle.circuit_version != rail.circuit_version {
        return Json(AttestResponse::failure(
            base,
            CODE_CIRCUIT_VERSION,
            format!(
                "circuit_version mismatch for rail {}: expected {}, got {}",
                if req.bundle.rail_id.is_empty() {
                    DEFAULT_RAIL_ID
                } else {
                    &req.bundle.rail_id
                },
                rail.circuit_version,
                req.bundle.circuit_version
            ),
        ));
    }

    let policy = match state.policy_store().get(req.policy_id) {
        Some(policy) => policy,
        None => {
            return Json(AttestResponse::failure(
                base,
                CODE_POLICY_NOT_FOUND,
                format!("policy_id {} not found", req.policy_id),
            ))
        }
    };

    let verification = match process_verification(
        &state,
        rail,
        &policy,
        &req.bundle.public_inputs,
        &req.bundle.proof,
    ) {
        Ok(response) => response,
        Err(err) => {
            return Json(AttestResponse::failure(base, err.code, err.message));
        }
    };

    if !verification.valid {
        let code = verification
            .error_code
            .unwrap_or(CODE_ATTESTATION_VERIFICATION_FAILED);
        let message = verification
            .error
            .unwrap_or_else(|| "verification failed".to_string());
        return Json(AttestResponse::failure(base, code, message));
    }

    // At this point the bundle has been fully verified and the nullifier recorded.
    //
    // Identifiers are hashed to 32-byte values off-chain before being sent on-chain.
    // We intentionally use BLAKE3 here; the EVM contracts only see opaque `bytes32`
    // values and do not rely on Keccak for these particular identifiers.
    let holder_hash = blake3_32(req.holder_id.as_bytes());
    let snapshot_hash = blake3_32(req.snapshot_id.as_bytes());

    let mut holder_id_bytes = [0u8; 32];
    holder_id_bytes.copy_from_slice(&holder_hash);

    let mut snapshot_id_bytes = [0u8; 32];
    snapshot_id_bytes.copy_from_slice(&snapshot_hash);

    let nullifier = req.bundle.public_inputs.nullifier;

    let attest_result = match service
        .attest(holder_id_bytes, req.policy_id, snapshot_id_bytes, nullifier)
        .await
    {
        Ok(result) => result,
        Err(err) => {
            return Json(AttestResponse::failure(
                base,
                CODE_ATTESTATION_ONCHAIN_ERROR,
                err,
            ))
        }
    };

    Json(AttestResponse::success(
        base,
        attest_result.tx_hash,
        attest_result.attestation_id,
        attest_result.chain_id,
    ))
}

async fn prove_bundle_handler(
    State(state): State<AppState>,
    Json(input): Json<ZkpfCircuitInput>,
) -> Result<Json<ProofBundle>, ApiError> {
    let verifier_inputs = public_to_verifier_inputs(&input.public);

    let policy = state
        .policy_store()
        .get(verifier_inputs.policy_id)
        .ok_or_else(|| ApiError::policy_not_found(verifier_inputs.policy_id))?;

    if let Err(err) = policy.validate_against(&verifier_inputs) {
        return Err(ApiError::bad_request(CODE_POLICY_MISMATCH, err));
    }

    if let Err(err) = validate_custodian_hash(&verifier_inputs) {
        return Err(ApiError::bad_request(CODE_CUSTODIAN_MISMATCH, err));
    }

    if let Err(err) = validate_epoch(state.epoch_config(), &verifier_inputs) {
        return Err(ApiError::bad_request(CODE_EPOCH_DRIFT, err));
    }

    let nullifier_key = NullifierKey::from_inputs(&verifier_inputs);
    match state.nullifier_store().already_spent(&nullifier_key) {
        Ok(true) => {
            return Err(ApiError::bad_request(
                CODE_NULLIFIER_REPLAY,
                NULLIFIER_SPENT_ERR,
            ))
        }
        Ok(false) => {}
        Err(err) => return Err(ApiError::nullifier_store(err)),
    }

    let artifacts = state.artifacts();
    let bundle = prove_bundle(&artifacts.params, &artifacts.pk, input);

    Ok(Json(bundle))
}

fn process_verification(
    state: &AppState,
    rail: &RailVerifier,
    policy: &PolicyExpectations,
    public_inputs: &VerifierPublicInputs,
    proof: &[u8],
) -> Result<VerifyResponse, ApiError> {
    if let Err(err) = policy.validate_against(public_inputs) {
        return Ok(VerifyResponse::failure(
            rail.circuit_version,
            CODE_POLICY_MISMATCH,
            err,
        ));
    }

    // Custodial rails (V1 layout) enforce the custodian allowlist. Orchard and
    // other non-custodial rails may not use this field.
    if matches!(rail.layout, PublicInputLayout::V1) {
        if let Err(err) = validate_custodian_hash(public_inputs) {
            return Ok(VerifyResponse::failure(
                rail.circuit_version,
                CODE_CUSTODIAN_MISMATCH,
                err,
            ));
        }
    }

    if let Err(err) = validate_epoch(state.epoch_config(), public_inputs) {
        return Ok(VerifyResponse::failure(
            rail.circuit_version,
            CODE_EPOCH_DRIFT,
            err,
        ));
    }

    let nullifier_key = NullifierKey::from_inputs(public_inputs);
    match state.nullifier_store().already_spent(&nullifier_key) {
        Ok(true) => {
            return Ok(VerifyResponse::failure(
                rail.circuit_version,
                CODE_NULLIFIER_REPLAY,
                NULLIFIER_SPENT_ERR,
            ))
        }
        Ok(false) => {}
        Err(err) => return Err(ApiError::nullifier_store(err)),
    }

    let instances =
        public_inputs_to_instances_with_layout(rail.layout, public_inputs).map_err(|err| {
            ApiError::bad_request(CODE_PUBLIC_INPUTS, format!("invalid public inputs: {err}"))
        })?;

    let (params, vk) = match &rail.artifacts {
        RailArtifacts::Prover(a) => (&a.params, &a.vk),
        RailArtifacts::Verifier(a) => (&a.params, &a.vk),
    };

    if !verify(params, vk, proof, &instances) {
        return Ok(VerifyResponse::failure(
            rail.circuit_version,
            CODE_PROOF_INVALID,
            "proof verification failed",
        ));
    }

    match state.nullifier_store().record(nullifier_key) {
        Ok(()) => Ok(VerifyResponse::success(rail.circuit_version)),
        Err(err) if err == NULLIFIER_SPENT_ERR => Ok(VerifyResponse::failure(
            rail.circuit_version,
            CODE_NULLIFIER_REPLAY,
            err,
        )),
        Err(err) => Err(ApiError::nullifier_store(err)),
    }
}

fn load_artifacts() -> ProverArtifacts {
    let path = env::var(MANIFEST_ENV).unwrap_or_else(|_| DEFAULT_MANIFEST_PATH.to_string());
    load_prover_artifacts(&path)
        .unwrap_or_else(|err| panic!("failed to load artifacts from {path}: {err}"))
}

fn validate_custodian_hash(inputs: &zkpf_common::VerifierPublicInputs) -> Result<(), String> {
    let expected =
        allowlisted_custodian_hash_bytes(inputs.required_custodian_id).ok_or_else(|| {
            format!(
                "custodian_id {} is not allow-listed",
                inputs.required_custodian_id
            )
        })?;
    if expected != inputs.custodian_pubkey_hash {
        return Err("custodian_pubkey_hash does not match allow-listed key".into());
    }
    Ok(())
}

fn validate_epoch(config: &EpochConfig, inputs: &VerifierPublicInputs) -> Result<(), String> {
    let server_epoch = config.current_epoch();
    let drift = config.max_drift_secs();
    let epoch = inputs.current_epoch;
    if epoch > server_epoch {
        let delta = epoch - server_epoch;
        if delta > drift {
            return Err(format!(
                "current_epoch {} is {} seconds ahead of verifier epoch {}",
                epoch, delta, server_epoch
            ));
        }
    } else {
        let delta = server_epoch - epoch;
        if delta > drift {
            return Err(format!(
                "current_epoch {} lags verifier epoch {} by {} seconds",
                epoch, server_epoch, delta
            ));
        }
    }
    Ok(())
}

#[derive(Clone)]
pub struct EpochConfig {
    epoch_override: Option<u64>,
    max_drift_secs: u64,
}

impl EpochConfig {
    fn from_env() -> Self {
        Self {
            epoch_override: parse_env_u64(EPOCH_OVERRIDE_ENV),
            max_drift_secs: parse_env_u64(EPOCH_DRIFT_ENV).unwrap_or(DEFAULT_MAX_EPOCH_DRIFT_SECS),
        }
    }

    pub fn fixed(epoch: u64) -> Self {
        Self {
            epoch_override: Some(epoch),
            max_drift_secs: 0,
        }
    }

    fn current_epoch(&self) -> u64 {
        if let Some(epoch) = self.epoch_override {
            epoch
        } else {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
        }
    }

    fn max_drift_secs(&self) -> u64 {
        self.max_drift_secs
    }
}

fn parse_env_u64(var: &str) -> Option<u64> {
    env::var(var)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
}

fn blake3_32(input: &[u8]) -> [u8; 32] {
    let hash = blake3::hash(input);
    *hash.as_bytes()
}

async fn get_epoch(State(state): State<AppState>) -> Json<EpochResponse> {
    let epoch = state.epoch_config().current_epoch();
    let drift = state.epoch_config().max_drift_secs();
    Json(EpochResponse {
        current_epoch: epoch,
        max_drift_secs: drift,
    })
}

#[derive(Clone)]
pub struct NullifierStore {
    backend: Arc<NullifierBackend>,
}

enum NullifierBackend {
    InMemory(Mutex<HashSet<NullifierKey>>),
    Persistent(Db),
}

impl NullifierStore {
    pub fn in_memory() -> Self {
        Self {
            backend: Arc::new(NullifierBackend::InMemory(Mutex::new(HashSet::new()))),
        }
    }

    pub fn persistent(path: impl AsRef<Path>) -> Self {
        let path_ref = path.as_ref();
        if let Some(parent) = path_ref.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent).unwrap_or_else(|err| {
                    panic!(
                        "failed to create directory for nullifier db at {}: {}",
                        path_ref.display(),
                        err
                    )
                });
            }
        }
        let db = sled::open(path_ref).unwrap_or_else(|err| {
            panic!(
                "failed to open nullifier db at {}: {}",
                path_ref.display(),
                err
            )
        });
        Self {
            backend: Arc::new(NullifierBackend::Persistent(db)),
        }
    }

    pub fn from_env() -> Self {
        let path =
            env::var(NULLIFIER_DB_ENV).unwrap_or_else(|_| DEFAULT_NULLIFIER_DB_PATH.to_string());
        Self::persistent(path)
    }

    fn already_spent(&self, key: &NullifierKey) -> Result<bool, String> {
        match &*self.backend {
            NullifierBackend::InMemory(store) => Ok(store
                .lock()
                .expect("nullifier store poisoned")
                .contains(key)),
            NullifierBackend::Persistent(db) => db
                .contains_key(key.storage_key())
                .map_err(|err| format!("nullifier db contains_key error: {err}")),
        }
    }

    fn record(&self, key: NullifierKey) -> Result<(), String> {
        match &*self.backend {
            NullifierBackend::InMemory(store) => {
                let mut guard = store.lock().expect("nullifier store poisoned");
                if !guard.insert(key) {
                    return Err(NULLIFIER_SPENT_ERR.into());
                }
                Ok(())
            }
            NullifierBackend::Persistent(db) => {
                let inserted = db
                    .insert(key.storage_key(), &[])
                    .map_err(|err| format!("nullifier db insert error: {err}"))?;
                if inserted.is_some() {
                    return Err(NULLIFIER_SPENT_ERR.into());
                }
                Ok(())
            }
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Hash)]
struct NullifierKey {
    scope_id: u64,
    policy_id: u64,
    nullifier: [u8; 32],
}

impl NullifierKey {
    fn from_inputs(inputs: &VerifierPublicInputs) -> Self {
        Self {
            scope_id: inputs.verifier_scope_id,
            policy_id: inputs.policy_id,
            nullifier: inputs.nullifier,
        }
    }

    fn storage_key(&self) -> [u8; 48] {
        let mut buf = [0u8; 48];
        buf[..8].copy_from_slice(&self.scope_id.to_be_bytes());
        buf[8..16].copy_from_slice(&self.policy_id.to_be_bytes());
        buf[16..].copy_from_slice(&self.nullifier);
        buf
    }
}
