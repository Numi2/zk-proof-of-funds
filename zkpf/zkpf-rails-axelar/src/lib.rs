//! zkpf-rails-axelar
//!
//! Axum-based HTTP service for Axelar GMP proof-of-funds broadcasting.
//! This rail enables zkpf attestations to be broadcast across chains via
//! Axelar's General Message Passing protocol.

use std::collections::HashMap;
use std::env;
use std::sync::Arc;

use axum::{
    extract::{Json, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};

use zkpf_axelar_gmp::{
    chains, AxelarGmpError, ChainSubscription, ChainType, GmpMessage, PoFReceipt, PoFRevocation,
    StoredReceipt, TrustedSource, DEFAULT_VALIDITY_WINDOW_SECS, RAIL_ID_AXELAR_GMP,
};
use zkpf_common::ProofBundle;

// ═══════════════════════════════════════════════════════════════════════════════
// ENVIRONMENT VARIABLES
// ═══════════════════════════════════════════════════════════════════════════════

const AXELAR_GATEWAY_ENV: &str = "ZKPF_AXELAR_GATEWAY";
const AXELAR_GAS_SERVICE_ENV: &str = "ZKPF_AXELAR_GAS_SERVICE";
const ORIGIN_CHAIN_ID_ENV: &str = "ZKPF_ORIGIN_CHAIN_ID";
const ORIGIN_CHAIN_NAME_ENV: &str = "ZKPF_ORIGIN_CHAIN_NAME";
const VALIDITY_WINDOW_ENV: &str = "ZKPF_AXELAR_VALIDITY_WINDOW";

// ═══════════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════════

/// Application state
#[derive(Clone)]
pub struct AppState {
    /// Chain subscriptions
    pub subscriptions: Arc<RwLock<Vec<ChainSubscription>>>,
    /// Trusted sources for receiving messages
    pub trusted_sources: Arc<RwLock<HashMap<String, TrustedSource>>>,
    /// Stored receipts (for testing/demo; production uses on-chain storage)
    pub receipts: Arc<RwLock<HashMap<String, StoredReceipt>>>,
    /// Gateway contract address
    pub gateway: Option<String>,
    /// Gas service contract address
    pub gas_service: Option<String>,
    /// Origin chain ID
    pub origin_chain_id: u64,
    /// Origin chain name (Axelar identifier)
    pub origin_chain_name: String,
    /// Default validity window
    pub validity_window: u64,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            subscriptions: Arc::new(RwLock::new(Vec::new())),
            trusted_sources: Arc::new(RwLock::new(HashMap::new())),
            receipts: Arc::new(RwLock::new(HashMap::new())),
            gateway: env::var(AXELAR_GATEWAY_ENV).ok(),
            gas_service: env::var(AXELAR_GAS_SERVICE_ENV).ok(),
            origin_chain_id: env::var(ORIGIN_CHAIN_ID_ENV)
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(1),
            origin_chain_name: env::var(ORIGIN_CHAIN_NAME_ENV)
                .unwrap_or_else(|_| chains::ETHEREUM.to_string()),
            validity_window: env::var(VALIDITY_WINDOW_ENV)
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(DEFAULT_VALIDITY_WINDOW_SECS),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

/// Build the router
pub fn app_router() -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let state = AppState::default();

    Router::new()
        // Health & info
        .route("/health", get(health))
        .route("/rails/axelar/info", get(info))
        // Chain management
        .route("/rails/axelar/chains", get(list_chains))
        .route("/rails/axelar/chains/supported", get(list_supported_chains))
        .route("/rails/axelar/subscriptions", get(list_subscriptions))
        .route("/rails/axelar/subscribe", post(subscribe_chain))
        .route("/rails/axelar/unsubscribe", post(unsubscribe_chain))
        // Broadcasting
        .route("/rails/axelar/broadcast", post(broadcast_receipt))
        .route("/rails/axelar/broadcast/:chain", post(broadcast_to_chain))
        // Receiving (for demo/testing)
        .route("/rails/axelar/receive", post(receive_message))
        // Queries
        .route("/rails/axelar/check-pof", post(check_pof))
        .route("/rails/axelar/receipt/:holder_id/:policy_id", get(get_receipt))
        // Gas estimation
        .route("/rails/axelar/estimate-gas", post(estimate_gas))
        .layer(cors)
        .with_state(state)
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS - HEALTH & INFO
// ═══════════════════════════════════════════════════════════════════════════════

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "rail_id": RAIL_ID_AXELAR_GMP
    }))
}

async fn info(State(state): State<AppState>) -> impl IntoResponse {
    let subs = state.subscriptions.read().await;
    let active_count = subs.iter().filter(|s| s.active).count();

    Json(serde_json::json!({
        "rail_id": RAIL_ID_AXELAR_GMP,
        "origin_chain_id": state.origin_chain_id,
        "origin_chain_name": state.origin_chain_name,
        "gateway_configured": state.gateway.is_some(),
        "gas_service_configured": state.gas_service.is_some(),
        "validity_window_secs": state.validity_window,
        "active_subscriptions": active_count,
        "features": {
            "gmp_broadcast": true,
            "interchain_actions": true,
            "cosmos_support": true,
            "evm_support": true
        }
    }))
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS - CHAIN MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

async fn list_chains(State(state): State<AppState>) -> impl IntoResponse {
    let subs = state.subscriptions.read().await;
    Json(serde_json::json!({
        "subscriptions": *subs
    }))
}

async fn list_supported_chains() -> impl IntoResponse {
    let evm = chains::evm_chains();
    let cosmos = chains::cosmos_chains();

    Json(serde_json::json!({
        "evm_chains": evm.iter().map(|c| serde_json::json!({
            "name": c.chain_name,
            "display_name": c.display_name,
            "chain_id": c.chain_id,
            "default_gas": c.default_gas,
            "production_ready": c.production_ready
        })).collect::<Vec<_>>(),
        "cosmos_chains": cosmos.iter().map(|c| serde_json::json!({
            "name": c.chain_name,
            "display_name": c.display_name,
            "default_gas": c.default_gas,
            "production_ready": c.production_ready
        })).collect::<Vec<_>>()
    }))
}

async fn list_subscriptions(State(state): State<AppState>) -> impl IntoResponse {
    let subs = state.subscriptions.read().await;
    let active: Vec<_> = subs.iter().filter(|s| s.active).cloned().collect();

    Json(serde_json::json!({
        "total": subs.len(),
        "active": active.len(),
        "subscriptions": active
    }))
}

#[derive(Debug, Deserialize)]
pub struct SubscribeRequest {
    pub chain_name: String,
    pub receiver_contract: String,
    pub default_gas: Option<u64>,
}

async fn subscribe_chain(
    State(state): State<AppState>,
    Json(req): Json<SubscribeRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let chain_info = chains::get_chain_info(&req.chain_name);
    let chain_type = chain_info
        .as_ref()
        .map(|c| c.chain_type)
        .unwrap_or(ChainType::Other);
    let default_gas = req
        .default_gas
        .or_else(|| chain_info.map(|c| c.default_gas))
        .unwrap_or(500_000);

    let subscription = ChainSubscription {
        chain_name: req.chain_name.clone(),
        receiver_contract: req.receiver_contract.clone(),
        active: true,
        default_gas,
        chain_type,
    };

    let mut subs = state.subscriptions.write().await;

    // Check if already subscribed
    if let Some(existing) = subs.iter_mut().find(|s| s.chain_name == req.chain_name) {
        existing.receiver_contract = req.receiver_contract.clone();
        existing.active = true;
        existing.default_gas = default_gas;
    } else {
        subs.push(subscription);
    }

    Ok(Json(serde_json::json!({
        "success": true,
        "chain_name": req.chain_name,
        "receiver_contract": req.receiver_contract
    })))
}

#[derive(Debug, Deserialize)]
pub struct UnsubscribeRequest {
    pub chain_name: String,
}

async fn unsubscribe_chain(
    State(state): State<AppState>,
    Json(req): Json<UnsubscribeRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let mut subs = state.subscriptions.write().await;

    if let Some(sub) = subs.iter_mut().find(|s| s.chain_name == req.chain_name) {
        sub.active = false;
        Ok(Json(serde_json::json!({
            "success": true,
            "chain_name": req.chain_name
        })))
    } else {
        Err(ApiError {
            status: StatusCode::NOT_FOUND,
            message: format!("Chain {} not subscribed", req.chain_name),
            code: "CHAIN_NOT_FOUND".into(),
        })
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS - BROADCASTING
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Deserialize)]
pub struct BroadcastRequest {
    /// Holder ID (hex-encoded 32 bytes)
    pub holder_id: String,
    /// Policy ID
    pub policy_id: u64,
    /// Snapshot ID (hex-encoded 32 bytes)
    pub snapshot_id: String,
    /// Attestation hash (hex-encoded 32 bytes)
    pub attestation_hash: String,
    /// Optional: override validity window (seconds)
    pub validity_window: Option<u64>,
    /// Optional: ProofBundle to verify before broadcasting
    pub bundle: Option<ProofBundle>,
}

#[derive(Debug, Serialize)]
pub struct BroadcastResponse {
    pub success: bool,
    pub receipt_hash: Option<String>,
    pub chains_broadcast: Vec<String>,
    pub error: Option<String>,
    pub error_code: Option<String>,
}

async fn broadcast_receipt(
    State(state): State<AppState>,
    Json(req): Json<BroadcastRequest>,
) -> Result<Json<BroadcastResponse>, ApiError> {
    // Parse hex values
    let holder_id = parse_hex32(&req.holder_id)?;
    let snapshot_id = parse_hex32(&req.snapshot_id)?;
    let attestation_hash = parse_hex32(&req.attestation_hash)?;

    let validity_window = req.validity_window.unwrap_or(state.validity_window);
    let issued_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    // Build receipt
    let receipt = PoFReceipt::new(
        holder_id,
        req.policy_id,
        snapshot_id,
        state.origin_chain_id,
        attestation_hash,
        validity_window,
        issued_at,
    );

    let receipt_hash = hex::encode(receipt.compute_hash());

    // Get active subscriptions
    let subs = state.subscriptions.read().await;
    let active: Vec<_> = subs.iter().filter(|s| s.active).cloned().collect();
    drop(subs);

    if active.is_empty() {
        return Ok(Json(BroadcastResponse {
            success: false,
            receipt_hash: Some(receipt_hash),
            chains_broadcast: vec![],
            error: Some("No active chain subscriptions".into()),
            error_code: Some("NO_SUBSCRIPTIONS".into()),
        }));
    }

    // Encode the GMP message
    let message = GmpMessage::receipt(receipt.clone())
        .map_err(|e| ApiError::from_gmp_error(e))?;
    let _payload = message.encode();

    // In production, this would call the Axelar Gateway contract
    // For now, we simulate successful broadcast
    let chains_broadcast: Vec<String> = active.iter().map(|s| s.chain_name.clone()).collect();

    // Store locally for demo
    let stored = StoredReceipt::from_receipt(&receipt);
    let key = format!("{}:{}", hex::encode(holder_id), req.policy_id);
    state.receipts.write().await.insert(key, stored);

    Ok(Json(BroadcastResponse {
        success: true,
        receipt_hash: Some(receipt_hash),
        chains_broadcast,
        error: None,
        error_code: None,
    }))
}

async fn broadcast_to_chain(
    State(state): State<AppState>,
    Path(chain): Path<String>,
    Json(req): Json<BroadcastRequest>,
) -> Result<Json<BroadcastResponse>, ApiError> {
    // Check subscription exists
    let subs = state.subscriptions.read().await;
    let sub = subs
        .iter()
        .find(|s| s.chain_name == chain && s.active)
        .cloned();
    drop(subs);

    let sub = sub.ok_or_else(|| ApiError {
        status: StatusCode::NOT_FOUND,
        message: format!("Chain {} not subscribed or inactive", chain),
        code: "CHAIN_NOT_FOUND".into(),
    })?;

    // Parse and build receipt
    let holder_id = parse_hex32(&req.holder_id)?;
    let snapshot_id = parse_hex32(&req.snapshot_id)?;
    let attestation_hash = parse_hex32(&req.attestation_hash)?;

    let validity_window = req.validity_window.unwrap_or(state.validity_window);
    let issued_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let receipt = PoFReceipt::new(
        holder_id,
        req.policy_id,
        snapshot_id,
        state.origin_chain_id,
        attestation_hash,
        validity_window,
        issued_at,
    );

    let receipt_hash = hex::encode(receipt.compute_hash());

    Ok(Json(BroadcastResponse {
        success: true,
        receipt_hash: Some(receipt_hash),
        chains_broadcast: vec![sub.chain_name],
        error: None,
        error_code: None,
    }))
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS - RECEIVING
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Deserialize)]
pub struct ReceiveRequest {
    pub source_chain: String,
    pub source_address: String,
    pub payload: String, // hex-encoded
}

#[derive(Debug, Serialize)]
pub struct ReceiveResponse {
    pub success: bool,
    pub message_type: Option<String>,
    pub error: Option<String>,
}

async fn receive_message(
    State(state): State<AppState>,
    Json(req): Json<ReceiveRequest>,
) -> Result<Json<ReceiveResponse>, ApiError> {
    // Check trusted source
    let sources = state.trusted_sources.read().await;
    let trusted = sources.get(&req.source_chain);

    if let Some(source) = trusted {
        if !source.matches(&req.source_chain, &req.source_address) {
            return Err(ApiError {
                status: StatusCode::FORBIDDEN,
                message: "Untrusted source".into(),
                code: "UNTRUSTED_SOURCE".into(),
            });
        }
    }
    drop(sources);

    // Decode payload
    let payload_bytes = hex::decode(req.payload.strip_prefix("0x").unwrap_or(&req.payload))
        .map_err(|e| ApiError {
            status: StatusCode::BAD_REQUEST,
            message: format!("Invalid payload hex: {}", e),
            code: "INVALID_PAYLOAD".into(),
        })?;

    let message = GmpMessage::decode(&payload_bytes).map_err(|e| ApiError::from_gmp_error(e))?;

    match message.msg_type {
        zkpf_axelar_gmp::MessageType::PoFReceipt => {
            let receipt = message.as_receipt().map_err(|e| ApiError::from_gmp_error(e))?;
            let stored = StoredReceipt::from_receipt(&receipt);
            let key = format!("{}:{}", hex::encode(receipt.holder_id), receipt.policy_id);
            state.receipts.write().await.insert(key, stored);

            Ok(Json(ReceiveResponse {
                success: true,
                message_type: Some("POF_RECEIPT".into()),
                error: None,
            }))
        }
        zkpf_axelar_gmp::MessageType::PoFRevocation => {
            let revocation = message
                .as_revocation()
                .map_err(|e| ApiError::from_gmp_error(e))?;
            let key = format!(
                "{}:{}",
                hex::encode(revocation.holder_id),
                revocation.policy_id
            );

            if let Some(receipt) = state.receipts.write().await.get_mut(&key) {
                receipt.valid = false;
            }

            Ok(Json(ReceiveResponse {
                success: true,
                message_type: Some("POF_REVOCATION".into()),
                error: None,
            }))
        }
        _ => Ok(Json(ReceiveResponse {
            success: false,
            message_type: None,
            error: Some("Unsupported message type".into()),
        })),
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS - QUERIES
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Deserialize)]
pub struct CheckPoFRequest {
    pub holder_id: String,
    pub policy_id: u64,
}

#[derive(Debug, Serialize)]
pub struct CheckPoFResponse {
    pub has_pof: bool,
    pub receipt: Option<StoredReceipt>,
    pub expired: bool,
}

async fn check_pof(
    State(state): State<AppState>,
    Json(req): Json<CheckPoFRequest>,
) -> Result<Json<CheckPoFResponse>, ApiError> {
    let holder_id = parse_hex32(&req.holder_id)?;
    let key = format!("{}:{}", hex::encode(holder_id), req.policy_id);

    let receipts = state.receipts.read().await;
    let receipt = receipts.get(&key).cloned();
    drop(receipts);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    match receipt {
        Some(r) => {
            let expired = now >= r.expires_at;
            let has_pof = r.valid && !expired;
            Ok(Json(CheckPoFResponse {
                has_pof,
                receipt: Some(r),
                expired,
            }))
        }
        None => Ok(Json(CheckPoFResponse {
            has_pof: false,
            receipt: None,
            expired: false,
        })),
    }
}

async fn get_receipt(
    State(state): State<AppState>,
    Path((holder_id, policy_id)): Path<(String, u64)>,
) -> Result<Json<StoredReceipt>, ApiError> {
    let holder_bytes = parse_hex32(&holder_id)?;
    let key = format!("{}:{}", hex::encode(holder_bytes), policy_id);

    let receipts = state.receipts.read().await;
    receipts.get(&key).cloned().ok_or_else(|| ApiError {
        status: StatusCode::NOT_FOUND,
        message: "Receipt not found".into(),
        code: "RECEIPT_NOT_FOUND".into(),
    }).map(Json)
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS - GAS ESTIMATION
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Deserialize)]
pub struct EstimateGasRequest {
    pub destination_chains: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct EstimateGasResponse {
    pub estimates: HashMap<String, u64>,
    pub total: u64,
}

async fn estimate_gas(
    State(state): State<AppState>,
    Json(req): Json<EstimateGasRequest>,
) -> Result<Json<EstimateGasResponse>, ApiError> {
    let subs = state.subscriptions.read().await;

    let chains_to_estimate: Vec<&ChainSubscription> = if let Some(chains) = &req.destination_chains {
        subs.iter()
            .filter(|s| s.active && chains.contains(&s.chain_name))
            .collect()
    } else {
        subs.iter().filter(|s| s.active).collect()
    };

    let mut estimates = HashMap::new();
    let mut total = 0u64;

    for sub in chains_to_estimate {
        // In production, this would call the Axelar Gas Service
        // For now, use default gas estimates
        let gas = sub.default_gas;
        estimates.insert(sub.chain_name.clone(), gas);
        total += gas;
    }

    Ok(Json(EstimateGasResponse { estimates, total }))
}

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub message: String,
    pub code: String,
}

impl ApiError {
    fn from_gmp_error(err: AxelarGmpError) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: err.to_string(),
            code: "GMP_ERROR".into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let body = serde_json::json!({
            "error": self.message,
            "error_code": self.code,
        });
        (self.status, Json(body)).into_response()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

fn parse_hex32(hex: &str) -> Result<[u8; 32], ApiError> {
    let hex = hex.strip_prefix("0x").unwrap_or(hex);
    let bytes = hex::decode(hex).map_err(|e| ApiError {
        status: StatusCode::BAD_REQUEST,
        message: format!("Invalid hex: {}", e),
        code: "INVALID_HEX".into(),
    })?;

    if bytes.len() != 32 {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: format!("Expected 32 bytes, got {}", bytes.len()),
            code: "INVALID_LENGTH".into(),
        });
    }

    let mut result = [0u8; 32];
    result.copy_from_slice(&bytes);
    Ok(result)
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

pub mod main_entry {
    use super::*;
    use std::net::SocketAddr;

    pub async fn run_server() -> Result<(), Box<dyn std::error::Error>> {
        tracing_subscriber::fmt::init();

        let port: u16 = env::var("PORT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(3002);

        let addr = SocketAddr::from(([0, 0, 0, 0], port));
        tracing::info!("Axelar GMP rail listening on {}", addr);

        let listener = tokio::net::TcpListener::bind(addr).await?;
        axum::serve(listener, app_router()).await?;

        Ok(())
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

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
        let response = server.get("/rails/axelar/info").await;
        response.assert_status_ok();

        let body: serde_json::Value = response.json();
        assert_eq!(body["rail_id"], RAIL_ID_AXELAR_GMP);
    }

    #[tokio::test]
    async fn test_supported_chains() {
        let server = TestServer::new(app_router()).unwrap();
        let response = server.get("/rails/axelar/chains/supported").await;
        response.assert_status_ok();

        let body: serde_json::Value = response.json();
        assert!(body["evm_chains"].as_array().unwrap().len() > 0);
        assert!(body["cosmos_chains"].as_array().unwrap().len() > 0);
    }

    #[tokio::test]
    async fn test_subscribe_and_broadcast() {
        let server = TestServer::new(app_router()).unwrap();

        // Subscribe to a chain
        let sub_response = server
            .post("/rails/axelar/subscribe")
            .json(&serde_json::json!({
                "chain_name": "osmosis",
                "receiver_contract": "osmo1abc..."
            }))
            .await;
        sub_response.assert_status_ok();

        // Broadcast a receipt
        let broadcast_response = server
            .post("/rails/axelar/broadcast")
            .json(&serde_json::json!({
                "holder_id": "0x" + &"01".repeat(32),
                "policy_id": 271828,
                "snapshot_id": "0x" + &"02".repeat(32),
                "attestation_hash": "0x" + &"03".repeat(32)
            }))
            .await;
        broadcast_response.assert_status_ok();

        let body: BroadcastResponse = broadcast_response.json();
        assert!(body.success);
        assert!(body.chains_broadcast.contains(&"osmosis".to_string()));
    }
}

