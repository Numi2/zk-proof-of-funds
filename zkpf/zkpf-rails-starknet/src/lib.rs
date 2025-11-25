//! zkpf-rails-starknet library
//!
//! Axum-based HTTP service for Starknet proof-of-funds.

use std::{env, sync::Arc};

use axum::{
    extract::{Json, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use tower_http::cors::{Any, CorsLayer};
use uuid::Uuid;

use zkpf_common::ProofBundle;
use zkpf_starknet_l2::{
    prove_starknet_pof, HolderId, PublicMetaInputs, StarknetAccountSnapshot, StarknetPublicMeta,
    StarknetRailError, StarknetSnapshot, RAIL_ID_STARKNET_L2,
};

// Environment variables
const STARKNET_RPC_URL_ENV: &str = "ZKPF_STARKNET_RPC_URL";
const STARKNET_CHAIN_ID_ENV: &str = "ZKPF_STARKNET_CHAIN_ID";
const DEFAULT_CHAIN_ID: &str = "SN_SEPOLIA";

/// Application state
#[derive(Clone)]
pub struct AppState {
    pub chain_id: String,
    pub chain_id_numeric: u64,
    pub rpc_url: Option<String>,
}

impl Default for AppState {
    fn default() -> Self {
        let chain_id = env::var(STARKNET_CHAIN_ID_ENV).unwrap_or_else(|_| DEFAULT_CHAIN_ID.to_string());
        let chain_id_numeric = match chain_id.as_str() {
            "SN_MAIN" => 0x534e5f4d41494e,
            "SN_SEPOLIA" => 0x534e5f5345504f4c4941,
            _ => 0,
        };
        let rpc_url = env::var(STARKNET_RPC_URL_ENV).ok();

        Self {
            chain_id,
            chain_id_numeric,
            rpc_url,
        }
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
        .route("/rails/starknet/proof-of-funds", post(prove_pof))
        .route("/rails/starknet/verify", post(verify_proof))
        .route("/rails/starknet/build-snapshot", post(build_snapshot))
        .layer(cors)
        .with_state(state)
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
        "chain_id_numeric": state.chain_id_numeric,
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

/// Verify a proof (basic validation).
async fn verify_proof(
    State(_state): State<AppState>,
    Json(req): Json<VerifyRequest>,
) -> Result<Json<VerifyResponse>, ApiError> {
    // Basic validation
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

    if req.bundle.public_inputs.policy_id != req.policy_id {
        return Ok(Json(VerifyResponse {
            valid: false,
            error: Some("policy_id mismatch".into()),
            error_code: Some("POLICY_MISMATCH".into()),
        }));
    }

    // For full verification, the proof should be verified against the circuit
    // For now, we check basic structure
    if req.bundle.proof.len() < 16 {
        return Ok(Json(VerifyResponse {
            valid: false,
            error: Some("proof too short".into()),
            error_code: Some("PROOF_INVALID".into()),
        }));
    }

    Ok(Json(VerifyResponse {
        valid: true,
        error: None,
        error_code: None,
    }))
}

/// Build snapshot request.
#[derive(Debug, Deserialize)]
pub struct BuildSnapshotRequest {
    /// Account addresses to include.
    pub accounts: Vec<String>,
    /// Tokens to check (addresses).
    pub tokens: Option<Vec<String>>,
}

/// Build snapshot response.
#[derive(Debug, Serialize)]
pub struct BuildSnapshotResponse {
    pub success: bool,
    pub snapshot: Option<StarknetSnapshot>,
    pub error: Option<String>,
}

/// Build a snapshot for accounts.
async fn build_snapshot(
    State(state): State<AppState>,
    Json(req): Json<BuildSnapshotRequest>,
) -> Result<Json<BuildSnapshotResponse>, ApiError> {
    // This requires the RPC client feature
    // For now, return a placeholder response
    if state.rpc_url.is_none() {
        return Ok(Json(BuildSnapshotResponse {
            success: false,
            snapshot: None,
            error: Some(format!(
                "RPC not configured. Set {} to enable snapshot building.",
                STARKNET_RPC_URL_ENV
            )),
        }));
    }

    // Build mock snapshot for demonstration
    let accounts: Vec<StarknetAccountSnapshot> = req
        .accounts
        .iter()
        .map(|addr| StarknetAccountSnapshot {
            address: addr.clone(),
            class_hash: "0x0".to_string(),
            native_balance: 0, // Would be fetched via RPC
            token_balances: vec![],
            defi_positions: vec![],
        })
        .collect();

    let snapshot = StarknetSnapshot {
        chain_id: state.chain_id,
        block_number: 0, // Would be fetched via RPC
        block_hash: "0x0".to_string(),
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
        accounts,
    };

    Ok(Json(BuildSnapshotResponse {
        success: true,
        snapshot: Some(snapshot),
        error: None,
    }))
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
        ApiError {
            status: StatusCode::BAD_REQUEST,
            message: err.to_string(),
        }
    }
}

fn error_code(err: &StarknetRailError) -> String {
    match err {
        StarknetRailError::Rpc(_) => "RPC_ERROR".into(),
        StarknetRailError::State(_) => "STATE_ERROR".into(),
        StarknetRailError::InvalidInput(_) => "INVALID_INPUT".into(),
        StarknetRailError::Proof(_) => "PROOF_ERROR".into(),
        StarknetRailError::Wallet(_) => "WALLET_ERROR".into(),
        StarknetRailError::Chain(_) => "CHAIN_ERROR".into(),
        StarknetRailError::NotImplemented(_) => "NOT_IMPLEMENTED".into(),
    }
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

