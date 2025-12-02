use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::Path,
    sync::{Arc, Mutex, RwLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    body::Body,
    extract::{Path as AxumPath, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use once_cell::sync::Lazy;

pub mod personhood;
use serde_json::Value as JsonValue;
use sled::Db;
use tokio::{fs::File, net::TcpListener};
use tokio_util::io::ReaderStream;
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;
use zkpf_circuit::{
    gadgets::attestation::{AttestationWitness, EcdsaSignature, Secp256k1Pubkey},
    PublicInputs, ZkpfCircuitInput,
};
use zkpf_common::{
    compute_nullifier_fr, custodian_pubkey_hash, deserialize_verifier_public_inputs,
    load_prover_artifacts_lazy, load_prover_artifacts_without_pk, load_verifier_artifacts,
    nullifier_fr, public_inputs_to_instances_with_layout, public_to_verifier_inputs,
    reduce_be_bytes_to_fr, Attestation, ProofBundle, ProverArtifacts, PublicInputLayout,
    VerifierArtifacts, VerifierPublicInputs,
};
use zkpf_prover::prove_bundle;
use zkpf_verifier::verify;
use zkpf_zcash_orchard_circuit::{
    load_orchard_prover_artifacts_from_path, load_orchard_verifier_artifacts, RAIL_ID_ZCASH_ORCHARD,
};

// k256 for secp256k1 ECDSA signature verification
use k256::ecdsa::{
    signature::Verifier as K256Verifier,
    Signature as K256Signature,
    VerifyingKey as K256VerifyingKey,
};

const DEFAULT_MANIFEST_PATH: &str = "artifacts/manifest.json";
const MANIFEST_ENV: &str = "ZKPF_MANIFEST_PATH";
const SNAP_DIR_ENV: &str = "ZKPF_SNAP_DIR";
const DEFAULT_SNAP_DIR: &str = "snap";
const EPOCH_OVERRIDE_ENV: &str = "ZKPF_VERIFIER_EPOCH";
const EPOCH_DRIFT_ENV: &str = "ZKPF_VERIFIER_MAX_DRIFT_SECS";
const DEFAULT_MAX_EPOCH_DRIFT_SECS: u64 = 10000;
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
const ENABLE_PROVER_ENV: &str = "ZKPF_ENABLE_PROVER";
const NULLIFIER_SPENT_ERR: &str = "nullifier already spent for this scope/policy";
const CODE_CIRCUIT_VERSION: &str = "CIRCUIT_VERSION_MISMATCH";
const CODE_PUBLIC_INPUTS: &str = "PUBLIC_INPUTS_INVALID";
const CODE_POLICY_NOT_FOUND: &str = "POLICY_NOT_FOUND";
const CODE_POLICY_MISMATCH: &str = "POLICY_MISMATCH";
const CODE_EPOCH_DRIFT: &str = "EPOCH_DRIFT";
const CODE_NULLIFIER_REPLAY: &str = "NULLIFIER_REPLAY";
const CODE_NULLIFIER_STORE_ERROR: &str = "NULLIFIER_STORE_ERROR";
const CODE_PROOF_INVALID: &str = "PROOF_INVALID";
const CODE_RAIL_UNKNOWN: &str = "RAIL_UNKNOWN";
const CODE_ATTESTATION_DISABLED: &str = "ATTESTATION_DISABLED";
const CODE_ATTESTATION_VERIFICATION_FAILED: &str = "ATTESTATION_VERIFICATION_FAILED";
const CODE_ATTESTATION_ONCHAIN_ERROR: &str = "ATTESTATION_ONCHAIN_ERROR";
const CODE_INTERNAL: &str = "INTERNAL_SERVER_ERROR";
const CODE_PROVER_DISABLED: &str = "PROVER_DISABLED";
const CODE_POLICY_COMPOSE_INVALID: &str = "POLICY_COMPOSE_INVALID";
const CODE_SESSION_NOT_FOUND: &str = "SESSION_NOT_FOUND";
const CODE_SESSION_STATE: &str = "SESSION_STATE_INVALID";
const CODE_ARTIFACT_NOT_FOUND: &str = "ARTIFACT_NOT_FOUND";
const DEFAULT_RAIL_ID: &str = "CUSTODIAL_ATTESTATION";
const PROVIDER_BALANCE_RAIL_ID: &str = "PROVIDER_BALANCE_V2";
const PROVIDER_SESSION_TTL_SECS: u64 = 15 * 60;
const PROVIDER_SESSION_RETENTION_SECS: u64 = 60 * 60;
const DEFAULT_DEEP_LINK_SCHEME: &str = "zashi";
const ORCHARD_MANIFEST_ENV: &str = "ZKPF_ORCHARD_MANIFEST_PATH";
const ORCHARD_DEFAULT_MANIFEST_PATH: &str = "artifacts/zcash-orchard/manifest.json";

// ============================================================
// Input Validation Constants
// ============================================================
//
// These limits prevent denial-of-service attacks via excessively large inputs
// and help catch malformed requests early.

/// Maximum proof size in bytes (current circuit produces ~1.5KB proofs)
const MAX_PROOF_SIZE_BYTES: usize = 16 * 1024; // 16 KB - generous headroom

/// Maximum public inputs size in bytes
const MAX_PUBLIC_INPUTS_SIZE_BYTES: usize = 4 * 1024; // 4 KB

/// Maximum hex string length for 32-byte values (64 chars + optional "0x" prefix)
const MAX_HEX_32_LEN: usize = 66;

/// Maximum category/label/rail_id length in policy composition
const MAX_POLICY_STRING_LEN: usize = 256;

/// Maximum account tag length (hex string for 32 bytes)
const MAX_ACCOUNT_TAG_LEN: usize = 66;

static ARTIFACTS: Lazy<Arc<ProverArtifacts>> = Lazy::new(|| Arc::new(load_artifacts()));
static ORCHARD_ARTIFACTS: Lazy<Option<Arc<ProverArtifacts>>> =
    Lazy::new(|| load_orchard_artifacts().ok().map(Arc::new));
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
            circuit_version: ARTIFACTS.manifest.circuit_version,
            layout: PublicInputLayout::V1,
            artifacts: RailArtifacts::Prover(ARTIFACTS.clone()),
        };

        // Empty rail_id is used for backward-compat bundles; DEFAULT_RAIL_ID is a
        // stable explicit identifier for the same rail. We also expose a
        // PROVIDER_BALANCE_V2 rail identifier that uses the same artifacts and
        // public-input layout, so provider-style attestations can be routed
        // through the existing custodial circuit.
        map.insert(String::new(), default.clone());
        map.insert(DEFAULT_RAIL_ID.to_string(), default.clone());
        map.insert(PROVIDER_BALANCE_RAIL_ID.to_string(), default.clone());

        // Development mode: register common rail IDs so they are recognized even
        // without a full multi-rail manifest. This allows the verification flow
        // to proceed and return meaningful errors (e.g., public input layout
        // mismatch, cryptographic verification failure) instead of "unknown rail_id".
        //
        // For production use with real Orchard proofs, configure ZKPF_MULTI_RAIL_MANIFEST_PATH
        // to point to a manifest with proper Orchard circuit artifacts.
        let orchard_dev = RailVerifier {
            circuit_version: ARTIFACTS.manifest.circuit_version,
            layout: PublicInputLayout::V2Orchard,
            artifacts: RailArtifacts::Prover(ARTIFACTS.clone()),
        };
        map.insert(RAIL_ID_ZCASH_ORCHARD.to_string(), orchard_dev);

        if let Ok(path) = env::var(MULTIRAIL_MANIFEST_ENV) {
            let bytes = fs::read(&path).unwrap_or_else(|err| {
                panic!("failed to read multi-rail manifest from {}: {}", path, err)
            });
            let manifest: MultiRailManifest =
                serde_json::from_slice(&bytes).unwrap_or_else(|err| {
                    panic!("failed to parse multi-rail manifest from {}: {}", path, err)
                });

            for rail in manifest.rails {
                if map.contains_key(&rail.rail_id) {
                    panic!("duplicate rail_id {} in multi-rail manifest", rail.rail_id);
                }

                let layout = match rail.layout.as_str() {
                    "V1" => PublicInputLayout::V1,
                    "V2_ORCHARD" => PublicInputLayout::V2Orchard,
                    "V3_STARKNET" => PublicInputLayout::V3Starknet,
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
                        rail.rail_id, artifacts.manifest.circuit_version, rail.circuit_version
                    );
                }

                map.insert(
                    rail.rail_id.clone(),
                    RailVerifier {
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

fn policy_config_path() -> String {
    env::var(POLICY_PATH_ENV).unwrap_or_else(|_| DEFAULT_POLICY_PATH.to_string())
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
            let mut config_warnings = Vec::new();

            let rpc_url_ready = env::var(ATTESTATION_RPC_URL_ENV)
                .map(|v| !v.trim().is_empty())
                .unwrap_or(false);
            if !rpc_url_ready {
                config_warnings.push(format!("{} is missing", ATTESTATION_RPC_URL_ENV));
            }

            let chain_id_ready = env::var(ATTESTATION_CHAIN_ID_ENV)
                .ok()
                .and_then(|v| v.parse::<u64>().ok())
                .is_some();
            if !chain_id_ready {
                config_warnings.push(format!(
                    "{} is missing or invalid",
                    ATTESTATION_CHAIN_ID_ENV
                ));
            }

            let registry_ready = env::var(ATTESTATION_REGISTRY_ADDRESS_ENV)
                .map(|v| !v.trim().is_empty())
                .unwrap_or(false);
            if !registry_ready {
                config_warnings.push(format!(
                    "{} is missing",
                    ATTESTATION_REGISTRY_ADDRESS_ENV
                ));
            }

            let private_key_ready = env::var(ATTESTOR_PRIVATE_KEY_ENV)
                .map(|v| !v.trim().is_empty())
                .unwrap_or(false);
            if !private_key_ready {
                config_warnings.push(format!("{} is missing", ATTESTOR_PRIVATE_KEY_ENV));
            }

            if !config_warnings.is_empty() {
                eprintln!(
                    "Attestation config is incomplete: {}",
                    config_warnings.join(", ")
                );
            }

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
    provider_sessions: ProviderSessionStore,
}

impl AppState {
    pub fn new(artifacts: Arc<ProverArtifacts>) -> Self {
        Self::with_components(
            artifacts,
            EpochConfig::from_env(),
            NullifierStore::from_env(),
            POLICIES.clone(),
            ProviderSessionStore::default(),
        )
    }

    pub fn with_components(
        artifacts: Arc<ProverArtifacts>,
        epoch: EpochConfig,
        nullifiers: NullifierStore,
        policies: PolicyStore,
        provider_sessions: ProviderSessionStore,
    ) -> Self {
        Self {
            artifacts,
            epoch,
            nullifiers,
            policies,
            provider_sessions,
        }
    }

    pub fn with_epoch_config(artifacts: Arc<ProverArtifacts>, epoch: EpochConfig) -> Self {
        Self::with_components(
            artifacts,
            epoch,
            NullifierStore::from_env(),
            POLICIES.clone(),
            ProviderSessionStore::default(),
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

    pub fn provider_sessions(&self) -> &ProviderSessionStore {
        &self.provider_sessions
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

    fn internal(err: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, CODE_INTERNAL, err)
    }

    fn prover_disabled(err: impl Into<String>) -> Self {
        Self::new(StatusCode::SERVICE_UNAVAILABLE, CODE_PROVER_DISABLED, err)
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, CODE_ARTIFACT_NOT_FOUND, message)
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
    // Use PORT env var if set (Fly.io sets this), otherwise default to 3000
    let port = env::var("PORT").unwrap_or_else(|_| "3000".to_string());
    let addr = format!("0.0.0.0:{}", port);
    
    // IMPORTANT: Bind to the port FIRST so Fly.io sees us listening immediately.
    // This prevents "app is not listening" warnings during artifact loading.
    let listener = TcpListener::bind(&addr).await.unwrap_or_else(|err| {
        panic!("zkpf-backend: failed to bind to {}: {}", addr, err);
    });
    eprintln!("zkpf-backend: listening on {}", addr);
    
    // Now load artifacts (this may take time, but we're already accepting connections)
    eprintln!("zkpf-backend: loading artifacts (this may take a moment)...");
    let state = AppState::global();
    eprintln!("zkpf-backend: artifacts loaded successfully");
    
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = app_router(state).layer(cors);
    
    eprintln!("zkpf-backend: server ready");
    
    axum::serve(listener, app.into_make_service())
        .await
        .unwrap();
}

pub fn app_router(state: AppState) -> Router {
    let router = Router::new()
        // Health check endpoint - responds immediately, no state required
        .route("/health", get(health_check))
        .route("/zkpf/policies", get(list_policies))
        .route("/zkpf/policies/compose", post(compose_policy_handler))
        .route("/zkpf/params", get(get_params))
        .route("/zkpf/artifacts/:kind", get(get_artifact))
        .route("/zkpf/epoch", get(get_epoch))
        .route("/zkpf/verify", post(verify_handler))
        .route("/zkpf/verify-bundle", post(verify_bundle_handler))
        .route("/zkpf/attest", post(attest_handler))
        // MetaMask Snap hosting routes
        .route("/snap/snap.manifest.json", get(serve_snap_manifest))
        .route("/snap/dist/bundle.js", get(serve_snap_bundle))
        .route("/snap/images/logo.svg", get(serve_snap_logo));

    let router = if state.artifacts().prover_enabled() {
        router
            .route("/zkpf/prove-bundle", post(prove_bundle_handler))
            .route(
                "/zkpf/provider/prove-balance",
                post(provider_prove_balance_handler),
            )
            .route("/zkpf/zashi/session/start", post(zashi_session_start))
            .route("/zkpf/zashi/session/submit", post(zashi_session_submit))
            .route("/zkpf/zashi/session/:session_id", get(zashi_session_status))
    } else {
        router
    };

    let router = router.with_state(state);

    // Merge Personhood routes (has its own state)
    eprintln!("zkpf-backend: Personhood routes enabled at /api/personhood/*");
    Router::new()
        .merge(router)
        .merge(personhood::personhood_router_with_state())
}

async fn get_artifact(
    State(state): State<AppState>,
    AxumPath(kind): AxumPath<String>,
) -> Result<Response, ApiError> {
    // Check if this is an Orchard artifact request
    if kind.starts_with("orchard-") {
        return get_orchard_artifact(kind).await;
    }

    // Default to custodial artifacts
    let artifacts = state.artifacts();
    let path = match kind.as_str() {
        "params" => artifacts.params_path(),
        "vk" => artifacts.vk_path(),
        "pk" => artifacts.pk_path(),
        _ => {
            return Err(ApiError::bad_request(
                CODE_ARTIFACT_NOT_FOUND,
                "unknown artifact kind",
            ))
        }
    };

    let file = File::open(&path).await.map_err(|err| {
        // Log the actual error for debugging but don't expose to client
        if err.kind() == std::io::ErrorKind::NotFound {
            eprintln!("artifact '{}' not found at {}", kind, path.display());
            ApiError::not_found("artifact not available on this deployment")
        } else {
            eprintln!("failed to open artifact '{}': {}", kind, err);
            ApiError::internal("failed to load artifact")
        }
    })?;

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    // Get the artifact hash for ETag
    let etag = match kind.as_str() {
        "params" => &artifacts.manifest.params.blake3,
        "vk" => &artifacts.manifest.vk.blake3,
        "pk" => &artifacts.manifest.pk.blake3,
        _ => &artifacts.manifest.params.blake3,
    };

    let mut response = Response::new(body);
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    // Add ETag for cache validation
    response.headers_mut().insert(
        header::ETAG,
        HeaderValue::from_str(&format!("\"{}\"", etag)).unwrap_or_else(|_| HeaderValue::from_static("\"unknown\"")),
    );
    // Allow caching but require revalidation to ensure clients get fresh artifacts after updates
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=3600, must-revalidate"),
    );

    Ok(response)
}

async fn get_orchard_artifact(kind: String) -> Result<Response, ApiError> {
    let artifacts_opt = ORCHARD_ARTIFACTS.as_ref();
    let artifacts = artifacts_opt
        .ok_or_else(|| ApiError::not_found("Orchard artifacts not available on this deployment"))?;

    let (path, etag) = match kind.as_str() {
        "orchard-params" => {
            let path = artifacts.params_path();
            let etag = artifacts.manifest.params.blake3.clone();
            (path, etag)
        }
        "orchard-vk" => {
            let path = artifacts.vk_path();
            let etag = artifacts.manifest.vk.blake3.clone();
            (path, etag)
        }
        "orchard-pk" => {
            let path = artifacts.pk_path();
            let etag = artifacts.manifest.pk.blake3.clone();
            (path, etag)
        }
        _ => {
            return Err(ApiError::bad_request(
                CODE_ARTIFACT_NOT_FOUND,
                "unknown Orchard artifact kind",
            ))
        }
    };

    let file = File::open(&path).await.map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            eprintln!("Orchard artifact '{}' not found at {}", kind, path.display());
            ApiError::not_found("Orchard artifact not available on this deployment")
        } else {
            eprintln!("failed to open Orchard artifact '{}': {}", kind, err);
            ApiError::internal("failed to load Orchard artifact")
        }
    })?;

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    let mut response = Response::new(body);
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    response.headers_mut().insert(
        header::ETAG,
        HeaderValue::from_str(&format!("\"{}\"", etag)).unwrap_or_else(|_| HeaderValue::from_static("\"unknown\"")),
    );
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=3600, must-revalidate"),
    );

    Ok(response)
}

async fn get_params(State(state): State<AppState>) -> Result<Json<ParamsResponse>, ApiError> {
    let artifacts = state.artifacts();
    let manifest = &artifacts.manifest;
    // When the prover is disabled for this deployment we avoid loading large
    // blobs into memory for the params endpoint and instead expose streaming
    // artifact URLs. The frontend hydrates these lazily via /zkpf/artifacts/*.
    if !artifacts.prover_enabled() {
        // Only include artifact URLs for files that actually exist on this deployment.
        // The pk.bin (proving key) is ~700MB and may not be bundled in verifier-only
        // deployments. If it's missing, client-side proving won't be available.
        let params_path = artifacts.params_path();
        let vk_path = artifacts.vk_path();
        let pk_path = artifacts.pk_path();

        let artifact_urls = if params_path.exists() && vk_path.exists() && pk_path.exists() {
            Some(ArtifactUrls {
                params: "/zkpf/artifacts/params".to_string(),
                vk: "/zkpf/artifacts/vk".to_string(),
                pk: "/zkpf/artifacts/pk".to_string(),
            })
        } else {
            // Log which artifacts are missing for debugging
            if !pk_path.exists() {
                eprintln!(
                    "zkpf-backend: pk.bin not found at {} - client-side proving unavailable",
                    pk_path.display()
                );
            }
            None
        };

        return Ok(Json(ParamsResponse {
            circuit_version: manifest.circuit_version,
            manifest_version: manifest.manifest_version,
            params_hash: manifest.params.blake3.clone(),
            vk_hash: manifest.vk.blake3.clone(),
            pk_hash: manifest.pk.blake3.clone(),
            params: None,
            vk: None,
            pk: None,
            artifact_urls,
        }));
    }

    let params = artifacts
        .params_blob()
        .map_err(|err| ApiError::internal(format!("failed to load params blob: {err}")))?;
    let vk = artifacts
        .vk_blob()
        .map_err(|err| ApiError::internal(format!("failed to load vk blob: {err}")))?;
    let pk = artifacts
        .pk_blob()
        .map_err(|err| ApiError::internal(format!("failed to load pk blob: {err}")))?;

    Ok(Json(ParamsResponse {
        circuit_version: manifest.circuit_version,
        manifest_version: manifest.manifest_version,
        params_hash: manifest.params.blake3.clone(),
        vk_hash: manifest.vk.blake3.clone(),
        pk_hash: manifest.pk.blake3.clone(),
        params: Some(params),
        vk: Some(vk),
        pk: Some(pk),
        artifact_urls: None,
    }))
}

async fn list_policies(State(state): State<AppState>) -> Json<PoliciesResponse> {
    Json(PoliciesResponse {
        policies: state.policy_store().all(),
    })
}

async fn compose_policy_handler(
    State(state): State<AppState>,
    Json(req): Json<PolicyComposeRequest>,
) -> Result<Json<PolicyComposeResponse>, ApiError> {
    validate_policy_compose_request(&req)?;

    let path = policy_config_path();
    let path_ref = Path::new(&path);

    let mut entries: Vec<JsonValue> = if path_ref.exists() {
        let bytes = fs::read(path_ref).map_err(|err| {
            ApiError::internal(format!(
                "failed to read policy configuration from {}: {}",
                path_ref.display(),
                err
            ))
        })?;
        serde_json::from_slice(&bytes).map_err(|err| {
            ApiError::internal(format!(
                "failed to parse policy configuration from {}: {}",
                path_ref.display(),
                err
            ))
        })?
    } else {
        Vec::new()
    };

    let key_category = req.category.to_ascii_uppercase();
    let key_rail = req.rail_id.clone();
    let key_threshold = req.threshold_raw;
    let key_currency = req.required_currency_code as u64;
    let key_scope = req.verifier_scope_id;

    let mut max_policy_id: u64 = 0;
    let mut existing: Option<JsonValue> = None;

    for entry in &entries {
        let policy_id = entry.get("policy_id").and_then(|v| v.as_u64()).unwrap_or(0);
        if policy_id > max_policy_id {
            max_policy_id = policy_id;
        }

        let category = entry
            .get("category")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_ascii_uppercase();
        let rail = entry.get("rail_id").and_then(|v| v.as_str()).unwrap_or("");
        let threshold = entry
            .get("threshold_raw")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let currency = entry
            .get("required_currency_code")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let scope = entry
            .get("verifier_scope_id")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);

        if category == key_category
            && rail == key_rail
            && threshold == key_threshold
            && currency == key_currency
            && scope == key_scope
        {
            existing = Some(entry.clone());
            break;
        }
    }

    // Check if a specific policy_id was requested and if it already exists
    let requested_id_exists = req.policy_id.map(|id| {
        entries.iter().any(|e| e.get("policy_id").and_then(|v| v.as_u64()) == Some(id))
    }).unwrap_or(false);

    let (policy_value, created, policy_id) = if let Some(value) = existing {
        // Found existing policy with matching parameters
        let policy_id = value
            .get("policy_id")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| {
                ApiError::internal("existing policy entry missing policy_id field".to_string())
            })?;
        (value, false, policy_id)
    } else if let Some(requested_id) = req.policy_id {
        if requested_id_exists {
            // Requested policy_id exists but with different parameters
            return Err(ApiError::bad_request(
                CODE_POLICY_COMPOSE_INVALID,
                format!(
                    "policy_id {} already exists with different parameters",
                    requested_id
                ),
            ));
        }
        // Use the requested policy_id for the new policy
        let entry = serde_json::json!({
            "category": req.category,
            "label": req.label,
            "rail_id": req.rail_id,
            "options": req.options,
            "threshold_raw": req.threshold_raw,
            "required_currency_code": req.required_currency_code,
            "verifier_scope_id": req.verifier_scope_id,
            "policy_id": requested_id,
        });

        // Insert into in-memory store FIRST (before file write) so verification
        // can proceed even if file persistence fails (e.g., on read-only filesystems)
        let expectations = PolicyExpectations {
            threshold_raw: req.threshold_raw,
            required_currency_code: req.required_currency_code,
            verifier_scope_id: req.verifier_scope_id,
            policy_id: requested_id,
            category: Some(req.category.clone()),
            rail_id: Some(req.rail_id.clone()),
            label: Some(req.label.clone()),
            options: Some(req.options.clone()),
        };
        state.policy_store().insert(expectations);

        // Try to persist to file (best-effort, non-fatal on failure)
        entries.push(entry.clone());
        if let Ok(json_bytes) = serde_json::to_vec_pretty(&entries) {
            if let Err(err) = fs::write(path_ref, &json_bytes) {
                eprintln!(
                    "warning: failed to persist policy {} to {}: {} (in-memory store updated)",
                    requested_id,
                    path_ref.display(),
                    err
                );
            }
        }

        (entry, true, requested_id)
    } else {
        // Auto-assign a new policy_id
        let new_policy_id = max_policy_id.saturating_add(1);

        let entry = serde_json::json!({
            "category": req.category,
            "label": req.label,
            "rail_id": req.rail_id,
            "options": req.options,
            "threshold_raw": req.threshold_raw,
            "required_currency_code": req.required_currency_code,
            "verifier_scope_id": req.verifier_scope_id,
            "policy_id": new_policy_id,
        });

        // Insert into in-memory store FIRST (before file write) so verification
        // can proceed even if file persistence fails (e.g., on read-only filesystems)
        let expectations = PolicyExpectations {
            threshold_raw: req.threshold_raw,
            required_currency_code: req.required_currency_code,
            verifier_scope_id: req.verifier_scope_id,
            policy_id: new_policy_id,
            category: Some(req.category.clone()),
            rail_id: Some(req.rail_id.clone()),
            label: Some(req.label.clone()),
            options: Some(req.options.clone()),
        };
        state.policy_store().insert(expectations);

        // Try to persist to file (best-effort, non-fatal on failure)
        entries.push(entry.clone());
        if let Ok(json_bytes) = serde_json::to_vec_pretty(&entries) {
            if let Err(err) = fs::write(path_ref, &json_bytes) {
                eprintln!(
                    "warning: failed to persist policy {} to {}: {} (in-memory store updated)",
                    new_policy_id,
                    path_ref.display(),
                    err
                );
            }
        }

        (entry, true, new_policy_id)
    };

    // Policy was already inserted into store above for new policies.
    // For existing policies returned from the match, ensure store is also updated.
    if !created {
        let expectations = PolicyExpectations {
            threshold_raw: req.threshold_raw,
            required_currency_code: req.required_currency_code,
            verifier_scope_id: req.verifier_scope_id,
            policy_id,
            category: Some(req.category.clone()),
            rail_id: Some(req.rail_id.clone()),
            label: Some(req.label.clone()),
            options: Some(req.options.clone()),
        };
        if state.policy_store().get(policy_id).is_none() {
            state.policy_store().insert(expectations);
        }
    }

    let summary = req.label;

    Ok(Json(PolicyComposeResponse {
        policy: policy_value,
        summary,
        created,
    }))
}

fn validate_policy_compose_request(req: &PolicyComposeRequest) -> Result<(), ApiError> {
    // Non-empty checks
    if req.category.trim().is_empty() {
        return Err(ApiError::bad_request(
            CODE_POLICY_COMPOSE_INVALID,
            "category must not be empty",
        ));
    }
    if req.rail_id.trim().is_empty() {
        return Err(ApiError::bad_request(
            CODE_POLICY_COMPOSE_INVALID,
            "rail_id must not be empty",
        ));
    }
    if req.label.trim().is_empty() {
        return Err(ApiError::bad_request(
            CODE_POLICY_COMPOSE_INVALID,
            "label must not be empty",
        ));
    }

    // Length limits to prevent abuse
    if req.category.len() > MAX_POLICY_STRING_LEN {
        return Err(ApiError::bad_request(
            CODE_POLICY_COMPOSE_INVALID,
            "category exceeds maximum allowed length",
        ));
    }
    if req.rail_id.len() > MAX_POLICY_STRING_LEN {
        return Err(ApiError::bad_request(
            CODE_POLICY_COMPOSE_INVALID,
            "rail_id exceeds maximum allowed length",
        ));
    }
    if req.label.len() > MAX_POLICY_STRING_LEN {
        return Err(ApiError::bad_request(
            CODE_POLICY_COMPOSE_INVALID,
            "label exceeds maximum allowed length",
        ));
    }

    // Validate options JSON is not excessively large (limit to 10KB)
    let options_str = serde_json::to_string(&req.options).unwrap_or_default();
    if options_str.len() > 10 * 1024 {
        return Err(ApiError::bad_request(
            CODE_POLICY_COMPOSE_INVALID,
            "options exceeds maximum allowed size",
        ));
    }

    // Validate policy_id if provided (must be > 0)
    if let Some(policy_id) = req.policy_id {
        if policy_id == 0 {
            return Err(ApiError::bad_request(
                CODE_POLICY_COMPOSE_INVALID,
                "policy_id must be greater than 0",
            ));
        }
    }

    Ok(())
}

#[derive(serde::Serialize)]
struct ArtifactUrls {
    params: String,
    vk: String,
    pk: String,
}

#[derive(serde::Serialize)]
struct ParamsResponse {
    circuit_version: u32,
    manifest_version: u32,
    params_hash: String,
    vk_hash: String,
    pk_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Vec<u8>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    vk: Option<Vec<u8>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pk: Option<Vec<u8>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    artifact_urls: Option<ArtifactUrls>,
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
struct ZashiSessionStartRequest {
    policy_id: u64,
    #[serde(default)]
    deep_link_scheme: Option<String>,
}

#[derive(serde::Serialize)]
struct ZashiSessionStartResponse {
    session_id: Uuid,
    policy: SessionPolicyView,
    expires_at: u64,
    deep_link: String,
}

#[derive(serde::Deserialize)]
struct ZashiSessionSubmitRequest {
    session_id: Uuid,
    attestation: Attestation,
}

#[derive(serde::Deserialize)]
struct ProviderBalanceAttestation {
    balance_raw: u64,
    currency_code_int: u32,
    attestation_id: u64,
    issued_at: u64,
    valid_until: u64,
    /// Opaque account tag chosen by the provider; expected as a 32-byte hex
    /// string (with or without 0x prefix) that is stable per logical account.
    account_tag: String,
    custodian_pubkey: Secp256k1Pubkey,
    signature: EcdsaSignature,
    /// 32-byte message hash that the provider signed, encoded as a raw byte
    /// array in JSON (matching the existing circuit input conventions).
    message_hash: [u8; 32],
}

#[derive(serde::Deserialize)]
struct ProviderProveBalanceRequest {
    policy_id: u64,
    attestation: ProviderBalanceAttestation,
}

#[derive(serde::Deserialize)]
struct PolicyComposeRequest {
    category: String,
    rail_id: String,
    label: String,
    #[serde(default)]
    options: JsonValue,
    threshold_raw: u64,
    required_currency_code: u32,
    verifier_scope_id: u64,
    /// Optional policy ID. If provided and not already in use, this ID will be used.
    /// If omitted, a new ID will be auto-assigned.
    #[serde(default)]
    policy_id: Option<u64>,
}

#[derive(serde::Serialize)]
struct PolicyComposeResponse {
    policy: JsonValue,
    summary: String,
    created: bool,
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
    fn success(
        base: AttestResponseBase,
        tx_hash: String,
        attestation_id: String,
        chain_id: u64,
    ) -> Self {
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
    pub verifier_scope_id: u64,
    pub policy_id: u64,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub rail_id: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub options: Option<JsonValue>,
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
    policies: Arc<RwLock<HashMap<u64, PolicyExpectations>>>,
}

impl PolicyStore {
    fn from_env() -> Self {
        let path = policy_config_path();
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
            policies: Arc::new(RwLock::new(map)),
        }
    }

    pub fn get(&self, policy_id: u64) -> Option<PolicyExpectations> {
        self.policies
            .read()
            .expect("policy store poisoned")
            .get(&policy_id)
            .cloned()
    }

    pub fn all(&self) -> Vec<PolicyExpectations> {
        self.policies
            .read()
            .expect("policy store poisoned")
            .values()
            .cloned()
            .collect()
    }

    pub fn insert(&self, policy: PolicyExpectations) {
        let mut guard = self.policies.write().expect("policy store poisoned");
        let id = policy.policy_id;
        // Upsert - allows re-registering the same policy without panic
        guard.insert(id, policy);
    }
}

#[derive(Clone)]
pub struct ProviderSessionStore {
    ttl: Duration,
    retention: Duration,
    sessions: Arc<RwLock<HashMap<Uuid, ProviderSessionRecord>>>,
}

impl Default for ProviderSessionStore {
    fn default() -> Self {
        Self {
            ttl: Duration::from_secs(PROVIDER_SESSION_TTL_SECS),
            retention: Duration::from_secs(PROVIDER_SESSION_RETENTION_SECS),
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

impl ProviderSessionStore {
    pub(crate) fn start_session(&self, policy: PolicyExpectations) -> ProviderSessionStart {
        let mut guard = self.sessions.write().expect("provider sessions poisoned");
        self.purge_locked(&mut guard);
        let now = SystemTime::now();
        let expires_at = now + self.ttl;
        let session_id = Uuid::new_v4();
        guard.insert(
            session_id,
            ProviderSessionRecord {
                policy: policy.clone(),
                status: ProviderSessionStatus::Pending,
                bundle: None,
                last_error: None,
                created_at: now,
                updated_at: now,
                expires_at,
            },
        );
        ProviderSessionStart {
            session_id,
            policy: SessionPolicyView::from(&policy),
            expires_at,
        }
    }

    pub(crate) fn begin_submission(
        &self,
        session_id: &Uuid,
    ) -> Result<PolicyExpectations, SessionError> {
        let mut guard = self.sessions.write().expect("provider sessions poisoned");
        self.purge_locked(&mut guard);
        let record = guard.get_mut(session_id).ok_or(SessionError::NotFound)?;
        record.expire_if_needed();
        match record.status {
            ProviderSessionStatus::Pending | ProviderSessionStatus::Invalid => {
                record.status = ProviderSessionStatus::Proving;
                record.last_error = None;
                record.updated_at = SystemTime::now();
                Ok(record.policy.clone())
            }
            ProviderSessionStatus::Proving => Err(SessionError::State("session already proving")),
            ProviderSessionStatus::Ready => Err(SessionError::State("session already completed")),
            ProviderSessionStatus::Expired => Err(SessionError::Expired),
        }
    }

    pub(crate) fn finish_success(
        &self,
        session_id: &Uuid,
        bundle: ProofBundle,
    ) -> Result<ProviderSessionSnapshot, SessionError> {
        let mut guard = self.sessions.write().expect("provider sessions poisoned");
        let record = guard.get_mut(session_id).ok_or(SessionError::NotFound)?;
        record.expire_if_needed();
        if record.status != ProviderSessionStatus::Proving {
            return Err(SessionError::State("session is not proving"));
        }
        record.status = ProviderSessionStatus::Ready;
        record.bundle = Some(bundle);
        record.last_error = None;
        record.updated_at = SystemTime::now();
        Ok(ProviderSessionSnapshot::from_record(*session_id, record))
    }

    pub fn finish_failure(&self, session_id: &Uuid, message: String) {
        if let Ok(mut guard) = self.sessions.write() {
            if let Some(record) = guard.get_mut(session_id) {
                record.expire_if_needed();
                if matches!(
                    record.status,
                    ProviderSessionStatus::Ready | ProviderSessionStatus::Expired
                ) {
                    return;
                }
                record.status = ProviderSessionStatus::Invalid;
                record.last_error = Some(message);
                record.updated_at = SystemTime::now();
            }
        }
    }

    pub(crate) fn snapshot(&self, session_id: &Uuid) -> Option<ProviderSessionSnapshot> {
        let mut guard = self.sessions.write().expect("provider sessions poisoned");
        self.purge_locked(&mut guard);
        guard.get_mut(session_id).map(|record| {
            record.expire_if_needed();
            ProviderSessionSnapshot::from_record(*session_id, record)
        })
    }

    fn purge_locked(&self, sessions: &mut HashMap<Uuid, ProviderSessionRecord>) {
        let now = SystemTime::now();
        sessions.retain(|_, record| match now.duration_since(record.expires_at) {
            Ok(elapsed) => elapsed <= self.retention,
            Err(_) => true,
        });
    }
}

#[derive(Clone)]
struct ProviderSessionRecord {
    policy: PolicyExpectations,
    status: ProviderSessionStatus,
    bundle: Option<ProofBundle>,
    last_error: Option<String>,
    created_at: SystemTime,
    updated_at: SystemTime,
    expires_at: SystemTime,
}

impl ProviderSessionRecord {
    fn expire_if_needed(&mut self) {
        if self.status == ProviderSessionStatus::Expired {
            return;
        }
        if SystemTime::now().duration_since(self.expires_at).is_ok() {
            self.status = ProviderSessionStatus::Expired;
            self.updated_at = SystemTime::now();
        }
    }
}

#[derive(Clone, Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum ProviderSessionStatus {
    Pending,
    Proving,
    Ready,
    Invalid,
    Expired,
}

#[derive(Clone, Debug, serde::Serialize)]
struct SessionPolicyView {
    policy_id: u64,
    verifier_scope_id: u64,
    threshold_raw: u64,
    required_currency_code: u32,
    rail_id: String,
    label: Option<String>,
}

impl From<&PolicyExpectations> for SessionPolicyView {
    fn from(policy: &PolicyExpectations) -> Self {
        Self {
            policy_id: policy.policy_id,
            verifier_scope_id: policy.verifier_scope_id,
            threshold_raw: policy.threshold_raw,
            required_currency_code: policy.required_currency_code,
            rail_id: policy
                .rail_id
                .clone()
                .unwrap_or_else(|| DEFAULT_RAIL_ID.to_string()),
            label: policy.label.clone(),
        }
    }
}

#[derive(Clone, Debug, serde::Serialize)]
struct ProviderSessionSnapshot {
    session_id: Uuid,
    status: ProviderSessionStatus,
    policy: SessionPolicyView,
    bundle: Option<ProofBundle>,
    error: Option<String>,
    created_at: u64,
    expires_at: u64,
    updated_at: u64,
}

impl ProviderSessionSnapshot {
    fn from_record(id: Uuid, record: &ProviderSessionRecord) -> Self {
        Self {
            session_id: id,
            status: record.status.clone(),
            policy: SessionPolicyView::from(&record.policy),
            bundle: record.bundle.clone(),
            error: record.last_error.clone(),
            created_at: system_time_secs(record.created_at),
            expires_at: system_time_secs(record.expires_at),
            updated_at: system_time_secs(record.updated_at),
        }
    }
}

struct ProviderSessionStart {
    session_id: Uuid,
    policy: SessionPolicyView,
    expires_at: SystemTime,
}

impl ProviderSessionStart {
    fn into_response(self, deep_link: String) -> ZashiSessionStartResponse {
        ZashiSessionStartResponse {
            session_id: self.session_id,
            policy: self.policy,
            expires_at: system_time_secs(self.expires_at),
            deep_link,
        }
    }
}

#[derive(Debug)]
enum SessionError {
    NotFound,
    Expired,
    State(&'static str),
}

async fn verify_handler(
    State(state): State<AppState>,
    Json(req): Json<VerifyRequest>,
) -> Result<Json<VerifyResponse>, ApiError> {
    // Input size validation
    if req.proof.len() > MAX_PROOF_SIZE_BYTES {
        return Err(ApiError::bad_request(
            CODE_PROOF_INVALID,
            "proof exceeds maximum allowed size",
        ));
    }
    if req.public_inputs.len() > MAX_PUBLIC_INPUTS_SIZE_BYTES {
        return Err(ApiError::bad_request(
            CODE_PUBLIC_INPUTS,
            "public_inputs exceeds maximum allowed size",
        ));
    }

    // Legacy /zkpf/verify endpoint is bound to the default custodial rail.
    let rail = RAILS
        .get("")
        .expect("default custodial rail not configured in RailRegistry");
    if req.circuit_version != rail.circuit_version {
        return Err(ApiError::bad_request(
            CODE_CIRCUIT_VERSION,
            "circuit version mismatch",
        ));
    }

    let policy = state
        .policy_store()
        .get(req.policy_id)
        .ok_or_else(|| ApiError::policy_not_found(req.policy_id))?;

    let public_inputs = deserialize_verifier_public_inputs(&req.public_inputs).map_err(|_| {
        ApiError::bad_request(CODE_PUBLIC_INPUTS, "invalid public_inputs encoding")
    })?;

    let response = process_verification(&state, rail, &policy, &public_inputs, &req.proof)?;
    Ok(Json(response))
}

async fn verify_bundle_handler(
    State(state): State<AppState>,
    Json(req): Json<VerifyBundleRequest>,
) -> Result<Json<VerifyResponse>, ApiError> {
    // Input size validation
    if req.bundle.proof.len() > MAX_PROOF_SIZE_BYTES {
        return Err(ApiError::bad_request(
            CODE_PROOF_INVALID,
            "proof exceeds maximum allowed size",
        ));
    }
    // Validate rail_id length to prevent abuse
    if req.bundle.rail_id.len() > MAX_POLICY_STRING_LEN {
        return Err(ApiError::bad_request(
            CODE_RAIL_UNKNOWN,
            "rail_id exceeds maximum allowed length",
        ));
    }

    // Determine effective rail_id based on bundle content.
    // If bundle claims to be ZCASH_ORCHARD but lacks required Orchard fields,
    // fall back to V1 (custodial) layout to support legacy or demo bundles.
    let effective_rail_id = if req.bundle.rail_id == RAIL_ID_ZCASH_ORCHARD
        && (req.bundle.public_inputs.snapshot_block_height.is_none()
            || req.bundle.public_inputs.snapshot_anchor_orchard.is_none())
    {
        eprintln!(
            "[ZKPF Warning] Bundle claims rail_id={} but lacks required Orchard fields \
             (snapshot_block_height={:?}, snapshot_anchor_orchard={:?}). \
             Falling back to V1 (custodial) layout.",
            req.bundle.rail_id,
            req.bundle.public_inputs.snapshot_block_height,
            req.bundle.public_inputs.snapshot_anchor_orchard.as_ref().map(|_| "present"),
        );
        "" // Empty string maps to default custodial rail with V1 layout
    } else {
        req.bundle.rail_id.as_str()
    };

    let rail = RAILS.get(effective_rail_id).ok_or_else(|| {
        ApiError::bad_request(CODE_RAIL_UNKNOWN, "unknown rail_id")
    })?;

    if req.bundle.circuit_version != rail.circuit_version {
        return Err(ApiError::bad_request(
            CODE_CIRCUIT_VERSION,
            "circuit version mismatch",
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

    // Input validation
    if req.bundle.proof.len() > MAX_PROOF_SIZE_BYTES {
        return Json(AttestResponse::failure(
            base,
            CODE_PROOF_INVALID,
            "proof exceeds maximum allowed size",
        ));
    }
    if req.bundle.rail_id.len() > MAX_POLICY_STRING_LEN {
        return Json(AttestResponse::failure(
            base,
            CODE_RAIL_UNKNOWN,
            "rail_id exceeds maximum allowed length",
        ));
    }

    let service = match ATTESTATION_SERVICE.as_ref() {
        Some(service) => service,
        None => {
            return Json(AttestResponse::failure(
                base,
                CODE_ATTESTATION_DISABLED,
                "on-chain attestation is not configured",
            ))
        }
    };

    // Determine effective rail_id based on bundle content.
    // If bundle claims to be ZCASH_ORCHARD but lacks required Orchard fields,
    // fall back to V1 (custodial) layout to support legacy or demo bundles.
    let effective_rail_id = if req.bundle.rail_id == RAIL_ID_ZCASH_ORCHARD
        && (req.bundle.public_inputs.snapshot_block_height.is_none()
            || req.bundle.public_inputs.snapshot_anchor_orchard.is_none())
    {
        eprintln!(
            "[ZKPF Warning] Attest: Bundle claims rail_id={} but lacks required Orchard fields. \
             Falling back to V1 (custodial) layout.",
            req.bundle.rail_id,
        );
        "" // Empty string maps to default custodial rail with V1 layout
    } else {
        req.bundle.rail_id.as_str()
    };

    let rail = match RAILS.get(effective_rail_id) {
        Some(rail) => rail,
        None => {
            return Json(AttestResponse::failure(
                base,
                CODE_RAIL_UNKNOWN,
                "unknown rail_id",
            ))
        }
    };

    if req.bundle.circuit_version != rail.circuit_version {
        return Json(AttestResponse::failure(
            base,
            CODE_CIRCUIT_VERSION,
            "circuit version mismatch",
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
    let policy = state
        .policy_store()
        .get(input.public.policy_id)
        .ok_or_else(|| ApiError::policy_not_found(input.public.policy_id))?;

    let bundle = prove_with_policy(&state, &policy, input)?;
    Ok(Json(bundle))
}

/// Generate a proof bundle for a given circuit input.
///
/// # Nullifier Recording Design Decision
///
/// This function intentionally does NOT record the nullifier in the store.
/// Nullifiers are only recorded upon successful verification via `process_verification`.
///
/// Rationale:
/// 1. **Separation of concerns**: Proving generates the cryptographic proof, while
///    verification is the authoritative check that should record nullifier consumption.
/// 2. **Client-side proving support**: When clients generate proofs locally (WASM),
///    the backend prover is not involved, so recording here would be inconsistent.
/// 3. **Replay protection**: The verifier is the trust boundary - it's the entity
///    that decides whether a proof is valid and the nullifier should be consumed.
/// 4. **Idempotency**: Clients may call prove multiple times (retries, testing)
///    without permanently consuming their nullifier.
///
/// The `already_spent` check here is an optimization to fail-fast and avoid
/// generating a proof that will be rejected during verification anyway.
fn prove_with_policy(
    state: &AppState,
    policy: &PolicyExpectations,
    input: ZkpfCircuitInput,
) -> Result<ProofBundle, ApiError> {
    let verifier_inputs = public_to_verifier_inputs(&input.public);

    if policy.validate_against(&verifier_inputs).is_err() {
        return Err(ApiError::bad_request(CODE_POLICY_MISMATCH, "policy validation failed"));
    }

    if validate_epoch(state.epoch_config(), &verifier_inputs).is_err() {
        return Err(ApiError::bad_request(CODE_EPOCH_DRIFT, "epoch validation failed"));
    }

    // Optimistic pre-check: avoid generating a proof that will be rejected.
    // Note: Nullifier is NOT recorded here - see function doc comment.
    let nullifier_key = NullifierKey::from_inputs(&verifier_inputs);
    match state.nullifier_store().already_spent(&nullifier_key) {
        Ok(true) => {
            return Err(ApiError::bad_request(
                CODE_NULLIFIER_REPLAY,
                NULLIFIER_SPENT_ERR,
            ))
        }
        Ok(false) => {}
        Err(_) => return Err(ApiError::nullifier_store("nullifier store error")),
    }

    let artifacts = state.artifacts();
    let pk = artifacts
        .proving_key()
        .map_err(|_| ApiError::prover_disabled("prover is not available"))?;
    Ok(prove_bundle(&artifacts.params, pk.as_ref(), input))
}

fn parse_hex_32(value: &str) -> Result<[u8; 32], ApiError> {
    let trimmed = value.trim();
    // Length check before decoding to prevent DoS via extremely long strings
    if trimmed.len() > MAX_HEX_32_LEN {
        return Err(ApiError::bad_request(
            CODE_PUBLIC_INPUTS,
            "hex string exceeds maximum allowed length",
        ));
    }
    let without_prefix = trimmed.strip_prefix("0x").unwrap_or(trimmed);
    let bytes = hex::decode(without_prefix).map_err(|_| {
        ApiError::bad_request(CODE_PUBLIC_INPUTS, "invalid hex encoding")
    })?;
    if bytes.len() != 32 {
        return Err(ApiError::bad_request(
            CODE_PUBLIC_INPUTS,
            "expected 32 bytes",
        ));
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}

async fn zashi_session_start(
    State(state): State<AppState>,
    Json(req): Json<ZashiSessionStartRequest>,
) -> Result<Json<ZashiSessionStartResponse>, ApiError> {
    let policy = state
        .policy_store()
        .get(req.policy_id)
        .ok_or_else(|| ApiError::policy_not_found(req.policy_id))?;
    ensure_zashi_policy(&policy)?;
    let session = state.provider_sessions().start_session(policy);
    let scheme = req
        .deep_link_scheme
        .as_deref()
        .unwrap_or(DEFAULT_DEEP_LINK_SCHEME);
    let deep_link = format!(
        "{scheme}://zkpf-proof?session_id={}&policy_id={}",
        session.session_id, req.policy_id
    );
    Ok(Json(session.into_response(deep_link)))
}

async fn zashi_session_submit(
    State(state): State<AppState>,
    Json(req): Json<ZashiSessionSubmitRequest>,
) -> Result<Json<ProviderSessionSnapshot>, ApiError> {
    let policy = state
        .provider_sessions()
        .begin_submission(&req.session_id)
        .map_err(session_error)?;
    if let Err(err) = ensure_zashi_policy(&policy) {
        let reason = err.message.clone();
        state
            .provider_sessions()
            .finish_failure(&req.session_id, reason);
        return Err(err);
    }

    let attestation = req.attestation;
    if attestation.currency_code_int != policy.required_currency_code {
        state
            .provider_sessions()
            .finish_failure(&req.session_id, "currency mismatch".into());
        return Err(ApiError::bad_request(
            CODE_POLICY_MISMATCH,
            "attestation currency_code_int does not match policy",
        ));
    }
    if attestation.balance_raw < policy.threshold_raw {
        state
            .provider_sessions()
            .finish_failure(&req.session_id, "threshold not met".into());
        return Err(ApiError::bad_request(
            CODE_POLICY_MISMATCH,
            "balance_raw does not satisfy policy threshold",
        ));
    }

    // Verify the attestation message hash is correctly computed
    if let Err(_) = attestation.verify_message_hash() {
        state
            .provider_sessions()
            .finish_failure(&req.session_id, "invalid attestation hash".into());
        return Err(ApiError::bad_request(CODE_PUBLIC_INPUTS, "invalid attestation hash"));
    }

    // Verify the ECDSA signature over the message hash.
    // This provides early rejection of invalid signatures before expensive proof
    // generation. The circuit also verifies, so this is defense-in-depth.
    if verify_secp256k1_ecdsa(
        &attestation.custodian_pubkey,
        &attestation.signature,
        &attestation.message_hash,
    ).is_err() {
        state
            .provider_sessions()
            .finish_failure(&req.session_id, "invalid attestation signature".into());
        return Err(ApiError::bad_request(CODE_PUBLIC_INPUTS, "invalid attestation signature"));
    }

    let witness = attestation.to_witness();
    let account_id_hash = witness.account_id_hash;
    // Derive the custodian_pubkey_hash directly from the attestation’s
    // secp256k1 public key instead of requiring an out-of-band allowlist
    // entry for the custodian_id.
    let pubkey_hash = custodian_pubkey_hash(&witness.custodian_pubkey);

    let current_epoch = state.epoch_config().current_epoch();
    let nullifier = compute_nullifier_fr(
        &account_id_hash,
        policy.verifier_scope_id,
        policy.policy_id,
        current_epoch,
    );

    let public = PublicInputs {
        threshold_raw: policy.threshold_raw,
        required_currency_code: policy.required_currency_code,
        current_epoch,
        verifier_scope_id: policy.verifier_scope_id,
        policy_id: policy.policy_id,
        nullifier,
        custodian_pubkey_hash: pubkey_hash,
    };

    let input = ZkpfCircuitInput {
        attestation: witness,
        public,
    };

    let bundle = match prove_with_policy(&state, &policy, input) {
        Ok(bundle) => bundle,
        Err(err) => {
            state
                .provider_sessions()
                .finish_failure(&req.session_id, err.message.clone());
            return Err(err);
        }
    };

    let snapshot = state
        .provider_sessions()
        .finish_success(&req.session_id, bundle)
        .map_err(session_error)?;

    Ok(Json(snapshot))
}

async fn zashi_session_status(
    State(state): State<AppState>,
    AxumPath(session_id): AxumPath<Uuid>,
) -> Result<Json<ProviderSessionSnapshot>, ApiError> {
    state
        .provider_sessions()
        .snapshot(&session_id)
        .map(Json)
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                CODE_SESSION_NOT_FOUND,
                format!("session {} not found", session_id),
            )
        })
}

async fn provider_prove_balance_handler(
    State(state): State<AppState>,
    Json(req): Json<ProviderProveBalanceRequest>,
) -> Result<Json<ProofBundle>, ApiError> {
    // Validate account_tag length before processing
    if req.attestation.account_tag.len() > MAX_ACCOUNT_TAG_LEN {
        return Err(ApiError::bad_request(
            CODE_PUBLIC_INPUTS,
            "account_tag exceeds maximum allowed length",
        ));
    }

    // Look up the policy to determine threshold, currency, scope, and the
    // required provider identifier (re-using the custodial ID field).
    let policy = state
        .policy_store()
        .get(req.policy_id)
        .ok_or_else(|| ApiError::policy_not_found(req.policy_id))?;

    let current_epoch = state.epoch_config().current_epoch();

    let att = req.attestation;

    // Normalize the opaque account_tag into a field element using the same
    // big-endian reduction helper used elsewhere in the stack.
    let account_tag_bytes = parse_hex_32(&att.account_tag)?;
    let account_id_hash = reduce_be_bytes_to_fr(&account_tag_bytes);

    // Compute the canonical nullifier field element that the circuit expects.
    let nullifier = nullifier_fr(
        account_id_hash,
        policy.verifier_scope_id,
        policy.policy_id,
        current_epoch,
    );

    // Hash the provider's secp256k1 public key into the field element that the
    // circuit and policy layer both use.
    let pubkey_hash = custodian_pubkey_hash(&att.custodian_pubkey);

    let public = PublicInputs {
        threshold_raw: policy.threshold_raw,
        required_currency_code: policy.required_currency_code,
        current_epoch,
        verifier_scope_id: policy.verifier_scope_id,
        policy_id: policy.policy_id,
        nullifier,
        custodian_pubkey_hash: pubkey_hash,
    };

    let witness = AttestationWitness {
        balance_raw: att.balance_raw,
        currency_code_int: att.currency_code_int,
        custodian_id: 0,
        attestation_id: att.attestation_id,
        issued_at: att.issued_at,
        valid_until: att.valid_until,
        account_id_hash,
        custodian_pubkey: att.custodian_pubkey,
        signature: att.signature,
        message_hash: att.message_hash,
    };

    let circuit_input = ZkpfCircuitInput {
        attestation: witness,
        public,
    };

    let mut bundle = prove_with_policy(&state, &policy, circuit_input)?;

    // Mark this bundle as belonging to the provider-balance rail so that
    // multi-rail verification routes it correctly.
    bundle.rail_id = PROVIDER_BALANCE_RAIL_ID.to_string();

    Ok(Json(bundle))
}

fn process_verification(
    state: &AppState,
    rail: &RailVerifier,
    policy: &PolicyExpectations,
    public_inputs: &VerifierPublicInputs,
    proof: &[u8],
) -> Result<VerifyResponse, ApiError> {
    // Input size validation to prevent DoS
    if proof.len() > MAX_PROOF_SIZE_BYTES {
        return Ok(VerifyResponse::failure(
            rail.circuit_version,
            CODE_PROOF_INVALID,
            "proof exceeds maximum allowed size",
        ));
    }

    if let Err(err) = policy.validate_against(public_inputs) {
        return Ok(VerifyResponse::failure(
            rail.circuit_version,
            CODE_POLICY_MISMATCH,
            err,
        ));
    }

    if let Err(err) = validate_epoch(state.epoch_config(), public_inputs) {
        return Ok(VerifyResponse::failure(
            rail.circuit_version,
            CODE_EPOCH_DRIFT,
            err,
        ));
    }

    // Optimistic pre-check for already-spent nullifiers.
    // This allows fast rejection before expensive proof verification.
    // The authoritative check happens atomically in record_atomic below.
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
            eprintln!(
                "[ZKPF Error] public_inputs_to_instances_with_layout failed: layout={:?}, error={}",
                rail.layout, err
            );
            ApiError::bad_request(
                CODE_PUBLIC_INPUTS,
                format!("invalid public inputs for layout {:?}: {}", rail.layout, err),
            )
        })?;

    let (params, vk) = match &rail.artifacts {
        RailArtifacts::Prover(a) => (&a.params, &a.vk),
        RailArtifacts::Verifier(a) => (&a.params, &a.vk),
    };

    // Diagnostic logging for proof verification failures
    eprintln!(
        "[ZKPF Debug] Verifying proof: circuit_version={}, layout={:?}, proof_len={}, instances_cols={}",
        rail.circuit_version,
        rail.layout,
        proof.len(),
        instances.len()
    );
    eprintln!(
        "[ZKPF Debug] Public inputs: threshold={}, currency={}, epoch={}, scope={}, policy={}",
        public_inputs.threshold_raw,
        public_inputs.required_currency_code,
        public_inputs.current_epoch,
        public_inputs.verifier_scope_id,
        public_inputs.policy_id
    );
    eprintln!(
        "[ZKPF Debug] Nullifier (first 8 bytes): {:?}",
        &public_inputs.nullifier[..8]
    );
    eprintln!(
        "[ZKPF Debug] Custodian pubkey hash (first 8 bytes): {:?}",
        &public_inputs.custodian_pubkey_hash[..8]
    );

    if !verify(params, vk, proof, &instances) {
        eprintln!("[ZKPF Debug] VERIFICATION FAILED!");
        return Ok(VerifyResponse::failure(
            rail.circuit_version,
            CODE_PROOF_INVALID,
            "proof verification failed",
        ));
    }
    eprintln!("[ZKPF Debug] Verification succeeded");

    // Atomic nullifier recording using compare-and-swap.
    // This prevents race conditions where two concurrent requests could both
    // pass the optimistic already_spent check but only one should succeed.
    match state.nullifier_store().record_atomic(nullifier_key) {
        Ok(()) => Ok(VerifyResponse::success(rail.circuit_version)),
        Err(err) if err == NULLIFIER_SPENT_ERR => Ok(VerifyResponse::failure(
            rail.circuit_version,
            CODE_NULLIFIER_REPLAY,
            NULLIFIER_SPENT_ERR,
        )),
        Err(_) => Err(ApiError::nullifier_store("nullifier store error")),
    }
}

fn load_artifacts() -> ProverArtifacts {
    let path = env::var(MANIFEST_ENV).unwrap_or_else(|_| DEFAULT_MANIFEST_PATH.to_string());
    let prover_enabled = prover_enabled_from_env();
    eprintln!(
        "zkpf-backend: loading artifacts from {} ({}={} => prover_enabled={})",
        path,
        ENABLE_PROVER_ENV,
        env::var(ENABLE_PROVER_ENV).unwrap_or_else(|_| "<unset>".to_string()),
        prover_enabled
    );

    // Use lazy loading for the proving key (~700MB) to reduce startup memory.
    // The pk will be loaded on-demand when the first proof is requested.
    // This allows the server to start with ~65MB (params + vk) instead of ~765MB.
    let loader = if prover_enabled {
        load_prover_artifacts_lazy
    } else {
        load_prover_artifacts_without_pk
    };

    loader(&path).unwrap_or_else(|err| {
        panic!(
            "failed to load artifacts from {path} (prover_enabled={}): {err}",
            prover_enabled
        )
    })
}

fn load_orchard_artifacts() -> Result<ProverArtifacts, String> {
    let path = env::var(ORCHARD_MANIFEST_ENV)
        .unwrap_or_else(|_| ORCHARD_DEFAULT_MANIFEST_PATH.to_string());
    eprintln!("zkpf-backend: loading Orchard artifacts from {}", path);
    load_orchard_prover_artifacts_from_path(&path).map_err(|e| {
        format!("failed to load Orchard artifacts from {}: {}", path, e)
    })
}

fn prover_enabled_from_env() -> bool {
    env::var(ENABLE_PROVER_ENV)
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(true)
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

fn ensure_zashi_policy(_policy: &PolicyExpectations) -> Result<(), ApiError> {
    Ok(())
}

fn session_error(err: SessionError) -> ApiError {
    match err {
        SessionError::NotFound => ApiError::new(
            StatusCode::NOT_FOUND,
            CODE_SESSION_NOT_FOUND,
            "session not found",
        ),
        SessionError::Expired => {
            ApiError::new(StatusCode::GONE, CODE_SESSION_STATE, "session expired")
        }
        SessionError::State(reason) => {
            ApiError::new(StatusCode::CONFLICT, CODE_SESSION_STATE, reason)
        }
    }
}

fn system_time_secs(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
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

/// Verify a secp256k1 ECDSA signature over a message hash.
///
/// This provides early rejection of invalid signatures before expensive proof
/// generation. The circuit also verifies the signature, so this is a defense-in-depth
/// measure that catches invalid signatures at the API layer.
///
/// # Arguments
/// * `pubkey` - The secp256k1 public key (x, y coordinates)
/// * `signature` - The ECDSA signature (r, s components)
/// * `message_hash` - The 32-byte message hash that was signed
///
/// # Returns
/// * `Ok(())` if signature is valid
/// * `Err(String)` with a generic error message (to avoid leaking information)
fn verify_secp256k1_ecdsa(
    pubkey: &Secp256k1Pubkey,
    signature: &EcdsaSignature,
    message_hash: &[u8; 32],
) -> Result<(), String> {
    // Construct uncompressed SEC1 public key: 0x04 || x || y
    let mut pubkey_bytes = [0u8; 65];
    pubkey_bytes[0] = 0x04;
    pubkey_bytes[1..33].copy_from_slice(&pubkey.x);
    pubkey_bytes[33..65].copy_from_slice(&pubkey.y);

    let verifying_key = K256VerifyingKey::from_sec1_bytes(&pubkey_bytes)
        .map_err(|_| "invalid public key".to_string())?;

    // Construct signature: r || s (64 bytes)
    let mut sig_bytes = [0u8; 64];
    sig_bytes[..32].copy_from_slice(&signature.r);
    sig_bytes[32..].copy_from_slice(&signature.s);

    let sig = K256Signature::from_slice(&sig_bytes)
        .map_err(|_| "invalid signature format".to_string())?;

    // Verify signature over the message hash
    // Note: k256 uses the prehash variant for raw message hashes
    verifying_key
        .verify(message_hash, &sig)
        .map_err(|_| "signature verification failed".to_string())
}

async fn get_epoch(State(state): State<AppState>) -> Json<EpochResponse> {
    let epoch = state.epoch_config().current_epoch();
    let drift = state.epoch_config().max_drift_secs();
    Json(EpochResponse {
        current_epoch: epoch,
        max_drift_secs: drift,
    })
}

/// Health check endpoint for load balancers and orchestrators.
/// Returns 200 OK immediately without requiring any state initialization.
async fn health_check() -> &'static str {
    "ok"
}

fn snap_dir() -> String {
    env::var(SNAP_DIR_ENV).unwrap_or_else(|_| DEFAULT_SNAP_DIR.to_string())
}

async fn serve_snap_manifest() -> Result<Response, ApiError> {
    let path = format!("{}/snap.manifest.json", snap_dir());
    serve_snap_file(&path, "application/json").await
}

async fn serve_snap_bundle() -> Result<Response, ApiError> {
    let path = format!("{}/dist/bundle.js", snap_dir());
    serve_snap_file(&path, "application/javascript").await
}

async fn serve_snap_logo() -> Result<Response, ApiError> {
    let path = format!("{}/images/logo.svg", snap_dir());
    serve_snap_file(&path, "image/svg+xml").await
}

async fn serve_snap_file(path: &str, content_type: &'static str) -> Result<Response, ApiError> {
    let file = File::open(path).await.map_err(|err| {
        // Log the actual error for debugging but don't expose path to client
        eprintln!("snap file not found at {}: {}", path, err);
        ApiError::new(
            StatusCode::NOT_FOUND,
            CODE_ARTIFACT_NOT_FOUND,
            "snap file not found",
        )
    })?;

    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    let mut response = Response::new(body);
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    // Cache snap files for 1 hour (they change infrequently)
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=3600"),
    );

    Ok(response)
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

    /// Check if a nullifier has already been spent (non-authoritative).
    ///
    /// This is an optimistic pre-check that can be used to fast-fail before
    /// expensive proof verification. However, due to potential race conditions,
    /// the authoritative check is in `record_atomic` which uses compare-and-swap.
    fn already_spent(&self, key: &NullifierKey) -> Result<bool, String> {
        match &*self.backend {
            NullifierBackend::InMemory(store) => Ok(store
                .lock()
                .expect("nullifier store poisoned")
                .contains(key)),
            NullifierBackend::Persistent(db) => db
                .contains_key(key.storage_key())
                .map_err(|_| "nullifier store error".to_string()),
        }
    }

    /// Atomically record a nullifier, returning an error if already spent.
    ///
    /// This method uses atomic compare-and-swap to prevent race conditions
    /// where two concurrent requests could both pass the `already_spent` check.
    /// This is the authoritative nullifier check and should be called after
    /// proof verification succeeds.
    ///
    /// # Race Condition Prevention
    ///
    /// The sequence is:
    /// 1. `already_spent` - optimistic pre-check (fast-fail)
    /// 2. Proof verification (expensive)
    /// 3. `record_atomic` - authoritative atomic insert
    ///
    /// If two requests race between steps 1 and 3, only one will succeed
    /// in step 3; the other will get a NULLIFIER_REPLAY error.
    fn record_atomic(&self, key: NullifierKey) -> Result<(), String> {
        match &*self.backend {
            NullifierBackend::InMemory(store) => {
                let mut guard = store.lock().expect("nullifier store poisoned");
                // HashSet::insert returns false if the key was already present
                if !guard.insert(key) {
                    return Err(NULLIFIER_SPENT_ERR.into());
                }
                Ok(())
            }
            NullifierBackend::Persistent(db) => {
                // Use compare_and_swap for atomic insert-if-not-exists.
                // old=None means "only insert if key doesn't exist"
                // new=Some(&[]) is the value to insert
                let storage_key = key.storage_key();
                match db.compare_and_swap(
                    storage_key,
                    None::<&[u8]>,  // old: key must not exist
                    Some(&[] as &[u8]),  // new: insert empty value
                ) {
                    Ok(Ok(())) => Ok(()), // Successfully inserted (key didn't exist)
                    Ok(Err(_)) => {
                        // CAS failed: key already existed
                        Err(NULLIFIER_SPENT_ERR.into())
                    }
                    Err(err) => {
                        // Database error - don't expose internal details
                        eprintln!("nullifier db CAS error: {err}");
                        Err("nullifier store error".into())
                    }
                }
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
