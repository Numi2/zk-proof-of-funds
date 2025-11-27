//! zkpf-rails-starknet library
//!
//! Axum-based HTTP service for Starknet proof-of-funds.
//!
//! # Features
//! - Proof generation for Starknet accounts and DeFi positions
//! - Cryptographic proof verification using Halo2/bn256
//! - Snapshot building via Starknet RPC
//! - Support for account abstraction and session keys

use std::env;
use std::sync::Arc;

use axum::{
    extract::{Json, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};

use zkpf_common::ProofBundle;
use zkpf_starknet_l2::{
    prove_starknet_pof, verify_starknet_proof_with_loaded_artifacts,
    HolderId, PublicMetaInputs, StarknetPublicMeta,
    StarknetRailError, StarknetSnapshot, RAIL_ID_STARKNET_L2,
    StarknetChainConfig, StarknetRpcClient,
    known_tokens,
};

// Environment variables
const STARKNET_RPC_URL_ENV: &str = "ZKPF_STARKNET_RPC_URL";
const STARKNET_CHAIN_ID_ENV: &str = "ZKPF_STARKNET_CHAIN_ID";
const DEFAULT_CHAIN_ID: &str = "SN_SEPOLIA";

/// Application state
#[derive(Clone)]
pub struct AppState {
    pub chain_id: String,
    pub chain_id_numeric: u128,
    pub rpc_url: Option<String>,
    /// Optional RPC client (initialized lazily on first use)
    rpc_client: Arc<RwLock<Option<Arc<StarknetRpcClient>>>>,
}

impl AppState {
    /// Create a new AppState with the given configuration.
    pub fn new(chain_id: String, rpc_url: Option<String>) -> Self {
        let chain_id_numeric: u128 = match chain_id.as_str() {
            "SN_MAIN" => 0x534e5f4d41494e,
            "SN_SEPOLIA" => 0x534e5f5345504f4c4941,
            _ => 0,
        };

        Self {
            chain_id,
            chain_id_numeric,
            rpc_url,
            rpc_client: Arc::new(RwLock::new(None)),
        }
    }

    /// Get or create the RPC client.
    pub async fn get_rpc_client(&self) -> Result<Arc<StarknetRpcClient>, StarknetRailError> {
        // Check if already initialized
        {
            let guard = self.rpc_client.read().await;
            if let Some(ref client) = *guard {
                return Ok(client.clone());
            }
        }

        // Need to initialize
        let rpc_url = self.rpc_url.as_ref().ok_or_else(|| {
            StarknetRailError::Rpc(format!(
                "RPC not configured. Set {} environment variable",
                STARKNET_RPC_URL_ENV
            ))
        })?;

        let config = match self.chain_id.as_str() {
            "SN_MAIN" => StarknetChainConfig::mainnet(rpc_url),
            _ => StarknetChainConfig::sepolia(rpc_url),
        };

        let client = StarknetRpcClient::new(config)?;
        let client = Arc::new(client);

        // Store and return
        {
            let mut guard = self.rpc_client.write().await;
            *guard = Some(client.clone());
        }

        Ok(client)
    }
}

impl Default for AppState {
    fn default() -> Self {
        let chain_id = env::var(STARKNET_CHAIN_ID_ENV).unwrap_or_else(|_| DEFAULT_CHAIN_ID.to_string());
        let rpc_url = env::var(STARKNET_RPC_URL_ENV).ok();
        Self::new(chain_id, rpc_url)
    }
}

/// Build the router.
pub fn app_router() -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let state = AppState::default();

    Router::new()
        .route("/health", get(health))
        .route("/rails/starknet/info", get(info))
        .route("/rails/starknet/status", get(status))
        .route("/rails/starknet/proof-of-funds", post(prove_pof))
        .route("/rails/starknet/verify", post(verify_proof))
        .route("/rails/starknet/verify-batch", post(verify_batch))
        .route("/rails/starknet/build-snapshot", post(build_snapshot))
        .route("/rails/starknet/get-balance", post(get_balance))
        .layer(cors)
        .with_state(state)
}

/// Detailed status endpoint.
async fn status(State(state): State<AppState>) -> impl IntoResponse {
    let rpc_status = if state.rpc_url.is_some() {
        match state.get_rpc_client().await {
            Ok(client) => {
                match client.get_block_number().await {
                    Ok(block) => serde_json::json!({
                        "connected": true,
                        "latest_block": block
                    }),
                    Err(e) => serde_json::json!({
                        "connected": false,
                        "error": e.to_string()
                    })
                }
            }
            Err(e) => serde_json::json!({
                "connected": false,
                "error": e.to_string()
            })
        }
    } else {
        serde_json::json!({
            "connected": false,
            "error": "RPC not configured"
        })
    };

    Json(serde_json::json!({
        "rail_id": RAIL_ID_STARKNET_L2,
        "chain_id": state.chain_id,
        "chain_id_numeric": format!("0x{:x}", state.chain_id_numeric),
        "rpc": rpc_status,
        "version": env!("CARGO_PKG_VERSION"),
        "features": {
            "account_abstraction": true,
            "session_keys": true,
            "defi_positions": true,
            "multi_account": true,
            "batch_verification": true
        }
    }))
}

/// Health check endpoint.
async fn health() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "rail_id": RAIL_ID_STARKNET_L2
    }))
}

/// Rail info endpoint.
async fn info(State(state): State<AppState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "rail_id": RAIL_ID_STARKNET_L2,
        "chain_id": state.chain_id,
        "chain_id_numeric": format!("0x{:x}", state.chain_id_numeric),
        "rpc_configured": state.rpc_url.is_some(),
        "features": {
            "account_abstraction": true,
            "session_keys": true,
            "defi_positions": true,
            "multi_account": true
        }
    }))
}

/// Proof-of-funds request.
#[derive(Debug, Deserialize)]
pub struct ProveRequest {
    /// Holder identifier.
    pub holder_id: HolderId,
    /// Policy ID to use.
    pub policy_id: u64,
    /// Verifier scope ID.
    pub verifier_scope_id: u64,
    /// Current epoch (Unix timestamp).
    pub current_epoch: u64,
    /// Threshold in smallest unit.
    pub threshold: u64,
    /// Currency code.
    pub currency_code: u32,
    /// Asset filter (e.g., "ETH", "STRK", "USDC", or null for all).
    pub asset_filter: Option<String>,
    /// Starknet snapshot.
    pub snapshot: StarknetSnapshot,
}

/// Proof-of-funds response.
#[derive(Debug, Serialize)]
pub struct ProveResponse {
    pub success: bool,
    pub bundle: Option<ProofBundle>,
    pub error: Option<String>,
    pub error_code: Option<String>,
}

/// Generate a proof-of-funds.
async fn prove_pof(
    State(state): State<AppState>,
    Json(req): Json<ProveRequest>,
) -> Result<Json<ProveResponse>, ApiError> {
    // Build metadata
    let starknet_meta = StarknetPublicMeta {
        chain_id: state.chain_id.clone(),
        chain_id_numeric: state.chain_id_numeric,
        block_number: req.snapshot.block_number,
        account_commitment: [0u8; 32], // Computed by prove_starknet_pof
        holder_binding: [0u8; 32],      // Computed by prove_starknet_pof
    };

    let public_meta = PublicMetaInputs {
        policy_id: req.policy_id,
        verifier_scope_id: req.verifier_scope_id,
        current_epoch: req.current_epoch,
        required_currency_code: req.currency_code,
    };

    // Generate proof
    let asset_filter = req.asset_filter.as_deref();
    match prove_starknet_pof(
        &req.snapshot,
        &req.holder_id,
        req.threshold,
        asset_filter,
        &starknet_meta,
        &public_meta,
    ) {
        Ok(bundle) => Ok(Json(ProveResponse {
            success: true,
            bundle: Some(bundle),
            error: None,
            error_code: None,
        })),
        Err(e) => Ok(Json(ProveResponse {
            success: false,
            bundle: None,
            error: Some(e.to_string()),
            error_code: Some(error_code(&e)),
        })),
    }
}

/// Verify proof request.
#[derive(Debug, Deserialize)]
pub struct VerifyRequest {
    pub bundle: ProofBundle,
    pub policy_id: u64,
}

/// Verify proof response.
#[derive(Debug, Serialize)]
pub struct VerifyResponse {
    pub valid: bool,
    pub error: Option<String>,
    pub error_code: Option<String>,
}

/// Verify a proof with full cryptographic verification.
async fn verify_proof(
    State(_state): State<AppState>,
    Json(req): Json<VerifyRequest>,
) -> Result<Json<VerifyResponse>, ApiError> {
    // Basic validation - rail ID
    if req.bundle.rail_id != RAIL_ID_STARKNET_L2 {
        return Ok(Json(VerifyResponse {
            valid: false,
            error: Some(format!(
                "expected rail_id {}, got {}",
                RAIL_ID_STARKNET_L2, req.bundle.rail_id
            )),
            error_code: Some("RAIL_MISMATCH".into()),
        }));
    }

    // Policy ID validation
    if req.bundle.public_inputs.policy_id != req.policy_id {
        return Ok(Json(VerifyResponse {
            valid: false,
            error: Some("policy_id mismatch".into()),
            error_code: Some("POLICY_MISMATCH".into()),
        }));
    }

    // Structural validation - minimum proof size
    if req.bundle.proof.len() < 16 {
        return Ok(Json(VerifyResponse {
            valid: false,
            error: Some("proof too short".into()),
            error_code: Some("PROOF_INVALID".into()),
        }));
    }

    // Full cryptographic verification
    match verify_starknet_proof_with_loaded_artifacts(
        &req.bundle.proof,
        &req.bundle.public_inputs,
    ) {
        Ok(valid) => {
            if valid {
                Ok(Json(VerifyResponse {
                    valid: true,
                    error: None,
                    error_code: None,
                }))
            } else {
                Ok(Json(VerifyResponse {
                    valid: false,
                    error: Some("cryptographic proof verification failed".into()),
                    error_code: Some("PROOF_VERIFICATION_FAILED".into()),
                }))
            }
        }
        Err(e) => {
            Ok(Json(VerifyResponse {
                valid: false,
                error: Some(format!("verification error: {}", e)),
                error_code: Some("VERIFICATION_ERROR".into()),
            }))
        }
    }
}

/// Batch verify request.
#[derive(Debug, Deserialize)]
pub struct BatchVerifyRequest {
    pub bundles: Vec<VerifyRequest>,
}

/// Batch verify response.
#[derive(Debug, Serialize)]
pub struct BatchVerifyResponse {
    pub results: Vec<VerifyResponse>,
    pub all_valid: bool,
}

/// Verify multiple proofs in batch.
async fn verify_batch(
    State(state): State<AppState>,
    Json(req): Json<BatchVerifyRequest>,
) -> Result<Json<BatchVerifyResponse>, ApiError> {
    let mut results = Vec::with_capacity(req.bundles.len());
    let mut all_valid = true;

    for bundle_req in req.bundles {
        let result = verify_proof(State(state.clone()), Json(bundle_req)).await?;
        if !result.valid {
            all_valid = false;
        }
        results.push(result.0);
    }

    Ok(Json(BatchVerifyResponse { results, all_valid }))
}

/// Get balance request.
#[derive(Debug, Deserialize)]
pub struct GetBalanceRequest {
    /// Account address.
    pub account: String,
    /// Optional token address (if None, returns native balance).
    pub token: Option<String>,
}

/// Get balance response.
#[derive(Debug, Serialize)]
pub struct GetBalanceResponse {
    pub success: bool,
    pub balance: Option<String>,
    pub symbol: Option<String>,
    pub error: Option<String>,
}

/// Get account balance.
async fn get_balance(
    State(state): State<AppState>,
    Json(req): Json<GetBalanceRequest>,
) -> Result<Json<GetBalanceResponse>, ApiError> {
    let rpc_client = match state.get_rpc_client().await {
        Ok(client) => client,
        Err(e) => {
            return Ok(Json(GetBalanceResponse {
                success: false,
                balance: None,
                symbol: None,
                error: Some(format!("RPC client error: {}", e)),
            }));
        }
    };

    let (balance, symbol) = match &req.token {
        Some(token_addr) => {
            match rpc_client.get_erc20_balance(token_addr, &req.account).await {
                Ok(bal) => {
                    let symbol = zkpf_starknet_l2::state::get_token_metadata(token_addr)
                        .map(|m| m.symbol)
                        .unwrap_or_else(|| "UNKNOWN".to_string());
                    (bal, symbol)
                }
                Err(e) => {
                    return Ok(Json(GetBalanceResponse {
                        success: false,
                        balance: None,
                        symbol: None,
                        error: Some(format!("failed to get balance: {}", e)),
                    }));
                }
            }
        }
        None => {
            match rpc_client.get_native_balance(&req.account).await {
                Ok(bal) => (bal, "ETH".to_string()),
                Err(e) => {
                    return Ok(Json(GetBalanceResponse {
                        success: false,
                        balance: None,
                        symbol: None,
                        error: Some(format!("failed to get native balance: {}", e)),
                    }));
                }
            }
        }
    };

    Ok(Json(GetBalanceResponse {
        success: true,
        balance: Some(balance.to_string()),
        symbol: Some(symbol),
        error: None,
    }))
}

/// Build snapshot request.
#[derive(Debug, Deserialize)]
pub struct BuildSnapshotRequest {
    /// Account addresses to include.
    pub accounts: Vec<String>,
    /// Tokens to check (addresses).
    pub tokens: Option<Vec<String>>,
    /// Whether to include DeFi positions (default: true).
    #[serde(default = "default_include_defi")]
    pub include_defi: bool,
}

fn default_include_defi() -> bool {
    true
}

/// Build snapshot response.
#[derive(Debug, Serialize)]
pub struct BuildSnapshotResponse {
    pub success: bool,
    pub snapshot: Option<StarknetSnapshot>,
    pub error: Option<String>,
}

/// Build a snapshot for accounts using the Starknet RPC client.
async fn build_snapshot(
    State(state): State<AppState>,
    Json(req): Json<BuildSnapshotRequest>,
) -> Result<Json<BuildSnapshotResponse>, ApiError> {
    // Validate request
    if req.accounts.is_empty() {
        return Ok(Json(BuildSnapshotResponse {
            success: false,
            snapshot: None,
            error: Some("no accounts specified".to_string()),
        }));
    }

    // Get the RPC client (this will fail if RPC not configured)
    let rpc_client = match state.get_rpc_client().await {
        Ok(client) => client,
        Err(e) => {
            return Ok(Json(BuildSnapshotResponse {
                success: false,
                snapshot: None,
                error: Some(format!(
                    "RPC client error: {}. Set {} to enable snapshot building.",
                    e, STARKNET_RPC_URL_ENV
                )),
            }));
        }
    };

    // Determine which tokens to check
    let default_tokens = vec![
        known_tokens::ETH,
        known_tokens::STRK,
        known_tokens::USDC,
        known_tokens::USDT,
        known_tokens::DAI,
        known_tokens::WBTC,
    ];

    let tokens_to_check: Vec<&str> = match &req.tokens {
        Some(tokens) if !tokens.is_empty() => {
            tokens.iter().map(|s| s.as_str()).collect()
        }
        _ => default_tokens,
    };

    // Convert account addresses to &str
    let account_refs: Vec<&str> = req.accounts.iter().map(|s| s.as_str()).collect();

    // Build the snapshot via RPC (with or without DeFi positions)
    let result = if req.include_defi {
        rpc_client.build_snapshot(&account_refs, &tokens_to_check).await
    } else {
        // Build without DeFi positions (faster)
        let mut accounts = Vec::with_capacity(account_refs.len());
        for addr in &account_refs {
            match rpc_client.build_account_snapshot_basic(addr, &tokens_to_check).await {
                Ok(snap) => accounts.push(snap),
                Err(e) => {
                    return Ok(Json(BuildSnapshotResponse {
                        success: false,
                        snapshot: None,
                        error: Some(format!("failed to fetch account {}: {}", addr, e)),
                    }));
                }
            }
        }
        // Get block info for the snapshot
        match rpc_client.get_block_number().await {
            Ok(block_number) => Ok(StarknetSnapshot {
                chain_id: state.chain_id.clone(),
                block_number,
                block_hash: "0x0".to_string(), // Would need another RPC call
                timestamp: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs(),
                accounts,
            }),
            Err(e) => Err(e),
        }
    };

    match result {
        Ok(snapshot) => Ok(Json(BuildSnapshotResponse {
            success: true,
            snapshot: Some(snapshot),
            error: None,
        })),
        Err(e) => Ok(Json(BuildSnapshotResponse {
            success: false,
            snapshot: None,
            error: Some(format!("failed to build snapshot: {}", e)),
        })),
    }
}

/// API error type.
#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let body = serde_json::json!({
            "error": self.message,
        });
        (self.status, Json(body)).into_response()
    }
}

impl From<StarknetRailError> for ApiError {
    fn from(err: StarknetRailError) -> Self {
        let status = match err.suggested_status_code() {
            400 => StatusCode::BAD_REQUEST,
            401 => StatusCode::UNAUTHORIZED,
            500 => StatusCode::INTERNAL_SERVER_ERROR,
            501 => StatusCode::NOT_IMPLEMENTED,
            502 => StatusCode::BAD_GATEWAY,
            504 => StatusCode::GATEWAY_TIMEOUT,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        ApiError {
            status,
            message: err.to_string(),
        }
    }
}

fn error_code(err: &StarknetRailError) -> String {
    err.error_code().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum_test::TestServer;

    #[tokio::test]
    async fn test_health() {
        let server = TestServer::new(app_router()).unwrap();
        let response = server.get("/health").await;
        response.assert_status_ok();
    }

    #[tokio::test]
    async fn test_info() {
        let server = TestServer::new(app_router()).unwrap();
        let response = server.get("/rails/starknet/info").await;
        response.assert_status_ok();
        let body: serde_json::Value = response.json();
        assert_eq!(body["rail_id"], RAIL_ID_STARKNET_L2);
    }
}

