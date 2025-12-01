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
    bridge::{BroadcastStatus, CredentialBuilder, ZcashBridge, ZcashBridgeConfig},
    chains, AxelarGmpError, ChainSubscription, ChainType, GmpMessage, PoFReceipt,
    RevocationReason, StoredReceipt, TrustedSource, ZecCredential, ZecTier,
    DEFAULT_VALIDITY_WINDOW_SECS, RAIL_ID_AXELAR_GMP,
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
    /// Zcash bridge for credential broadcasting
    pub zcash_bridge: Arc<RwLock<ZcashBridge>>,
    /// Stored ZEC credentials
    pub credentials: Arc<RwLock<HashMap<String, ZecCredential>>>,
    /// Revoked credential IDs
    pub revoked_credentials: Arc<RwLock<HashMap<String, RevocationReason>>>,
}

impl Default for AppState {
    fn default() -> Self {
        let bridge_config = ZcashBridgeConfig::with_evm_chains();
        let zcash_bridge = ZcashBridge::new(bridge_config);

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
            zcash_bridge: Arc::new(RwLock::new(zcash_bridge)),
            credentials: Arc::new(RwLock::new(HashMap::new())),
            revoked_credentials: Arc::new(RwLock::new(HashMap::new())),
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
        // === ZEC CREDENTIAL ROUTES ===
        // Issue a new ZEC credential
        .route("/rails/axelar/zec/issue", post(issue_zec_credential))
        // Broadcast ZEC credential to chains
        .route("/rails/axelar/zec/broadcast", post(broadcast_zec_credential))
        .route("/rails/axelar/zec/broadcast/:chain", post(broadcast_zec_to_chain))
        // Revoke a credential
        .route("/rails/axelar/zec/revoke", post(revoke_credential))
        // Query credentials
        .route("/rails/axelar/zec/credential/:credential_id", get(get_credential))
        .route("/rails/axelar/zec/credentials/:account_tag", get(get_account_credentials))
        .route("/rails/axelar/zec/check", post(check_zec_credential))
        // Tier information
        .route("/rails/axelar/zec/tiers", get(list_tiers))
        // Bridge stats
        .route("/rails/axelar/zec/bridge/stats", get(get_bridge_stats))
        .route("/rails/axelar/zec/bridge/pending", get(get_pending_broadcasts))
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

#[derive(Debug, Serialize, Deserialize)]
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
        .map_err(ApiError::from_gmp_error)?;
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

    let message = GmpMessage::decode(&payload_bytes).map_err(ApiError::from_gmp_error)?;

    match message.msg_type {
        zkpf_axelar_gmp::MessageType::PoFReceipt => {
            let receipt = message.as_receipt().map_err(ApiError::from_gmp_error)?;
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
                .map_err(ApiError::from_gmp_error)?;
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
// HANDLERS - ZEC CREDENTIALS
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Deserialize)]
pub struct IssueCredentialRequest {
    /// Account tag (hex-encoded 32 bytes)
    pub account_tag: String,
    /// Balance tier (0-5)
    pub tier: u8,
    /// State root (hex-encoded 32 bytes)
    pub state_root: String,
    /// Block height
    pub block_height: u64,
    /// Proof commitment/nullifier (hex-encoded 32 bytes)
    pub proof_commitment: String,
    /// Attestation hash (hex-encoded 32 bytes)
    pub attestation_hash: String,
    /// Optional validity window override (seconds)
    pub validity_window: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct IssueCredentialResponse {
    pub success: bool,
    pub credential_id: Option<String>,
    pub tier: Option<String>,
    pub expires_at: Option<u64>,
    pub error: Option<String>,
}

async fn issue_zec_credential(
    State(state): State<AppState>,
    Json(req): Json<IssueCredentialRequest>,
) -> Result<Json<IssueCredentialResponse>, ApiError> {
    // Parse tier
    let tier = ZecTier::try_from(req.tier).map_err(|_| ApiError {
        status: StatusCode::BAD_REQUEST,
        message: format!("Invalid tier: {}", req.tier),
        code: "INVALID_TIER".into(),
    })?;

    // Parse hex values
    let account_tag = parse_hex32(&req.account_tag)?;
    let state_root = parse_hex32(&req.state_root)?;
    let proof_commitment = parse_hex32(&req.proof_commitment)?;
    let attestation_hash = parse_hex32(&req.attestation_hash)?;

    let validity_window = req.validity_window.unwrap_or(state.validity_window);

    // Build credential
    let credential = CredentialBuilder::new()
        .account_tag(account_tag)
        .tier(tier)
        .state_root(state_root)
        .block_height(req.block_height)
        .proof_commitment(proof_commitment)
        .attestation_hash(attestation_hash)
        .validity_window(validity_window)
        .build()
        .map_err(ApiError::from_gmp_error)?;

    let credential_id = hex::encode(credential.credential_id());
    let expires_at = credential.expires_at;

    // Store credential
    state.credentials.write().await.insert(credential_id.clone(), credential);

    Ok(Json(IssueCredentialResponse {
        success: true,
        credential_id: Some(credential_id),
        tier: Some(tier.name().to_string()),
        expires_at: Some(expires_at),
        error: None,
    }))
}

#[derive(Debug, Deserialize)]
pub struct BroadcastCredentialRequest {
    /// Credential ID (hex-encoded)
    pub credential_id: String,
    /// Optional: specific chains to broadcast to
    pub target_chains: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct BroadcastCredentialResponse {
    pub success: bool,
    pub broadcast_id: Option<String>,
    pub chains_broadcast: Vec<String>,
    pub error: Option<String>,
}

async fn broadcast_zec_credential(
    State(state): State<AppState>,
    Json(req): Json<BroadcastCredentialRequest>,
) -> Result<Json<BroadcastCredentialResponse>, ApiError> {
    // Get credential
    let credentials = state.credentials.read().await;
    let credential = credentials.get(&req.credential_id).cloned().ok_or_else(|| ApiError {
        status: StatusCode::NOT_FOUND,
        message: "Credential not found".into(),
        code: "CREDENTIAL_NOT_FOUND".into(),
    })?;
    drop(credentials);

    // Check not revoked
    if state.revoked_credentials.read().await.contains_key(&req.credential_id) {
        return Err(ApiError {
            status: StatusCode::FORBIDDEN,
            message: "Credential has been revoked".into(),
            code: "CREDENTIAL_REVOKED".into(),
        });
    }

    // Prepare broadcast
    let mut bridge = state.zcash_bridge.write().await;
    let pending = bridge
        .prepare_broadcast(credential, req.target_chains)
        .map_err(ApiError::from_gmp_error)?;

    let broadcast_id = hex::encode(pending.broadcast_id);
    let chains_broadcast = pending.target_chains.clone();

    // In production, this would call the Axelar Gateway
    // For now, mark as sent
    for chain in &chains_broadcast {
        bridge.update_broadcast_status(&pending.broadcast_id, chain, BroadcastStatus::Sent);
    }

    Ok(Json(BroadcastCredentialResponse {
        success: true,
        broadcast_id: Some(broadcast_id),
        chains_broadcast,
        error: None,
    }))
}

async fn broadcast_zec_to_chain(
    State(state): State<AppState>,
    Path(chain): Path<String>,
    Json(req): Json<BroadcastCredentialRequest>,
) -> Result<Json<BroadcastCredentialResponse>, ApiError> {
    // Get credential
    let credentials = state.credentials.read().await;
    let credential = credentials.get(&req.credential_id).cloned().ok_or_else(|| ApiError {
        status: StatusCode::NOT_FOUND,
        message: "Credential not found".into(),
        code: "CREDENTIAL_NOT_FOUND".into(),
    })?;
    drop(credentials);

    // Prepare broadcast to specific chain
    let mut bridge = state.zcash_bridge.write().await;
    let pending = bridge
        .prepare_broadcast(credential.clone(), Some(vec![chain.clone()]))
        .map_err(ApiError::from_gmp_error)?;

    let broadcast_id = hex::encode(pending.broadcast_id);

    // Encode for the specific chain
    let _payload = bridge.encode_for_chain(&credential, &chain)
        .map_err(ApiError::from_gmp_error)?;

    // Mark as sent
    bridge.update_broadcast_status(&pending.broadcast_id, &chain, BroadcastStatus::Sent);

    Ok(Json(BroadcastCredentialResponse {
        success: true,
        broadcast_id: Some(broadcast_id),
        chains_broadcast: vec![chain],
        error: None,
    }))
}

#[derive(Debug, Deserialize)]
pub struct RevokeCredentialRequest {
    /// Credential ID to revoke
    pub credential_id: String,
    /// Revocation reason (0-4)
    pub reason: u8,
    /// Optional: broadcast revocation to chains
    pub broadcast: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct RevokeCredentialResponse {
    pub success: bool,
    pub chains_notified: Vec<String>,
    pub error: Option<String>,
}

async fn revoke_credential(
    State(state): State<AppState>,
    Json(req): Json<RevokeCredentialRequest>,
) -> Result<Json<RevokeCredentialResponse>, ApiError> {
    let reason = match req.reason {
        0 => RevocationReason::UserRequested,
        1 => RevocationReason::BalanceDropped,
        2 => RevocationReason::FraudAttempt,
        3 => RevocationReason::Expired,
        4 => RevocationReason::PolicyUpdate,
        _ => return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: format!("Invalid revocation reason: {}", req.reason),
            code: "INVALID_REASON".into(),
        }),
    };

    // Mark as revoked
    state.revoked_credentials.write().await.insert(req.credential_id.clone(), reason);

    let mut chains_notified = Vec::new();

    // Broadcast revocation if requested
    if req.broadcast.unwrap_or(true) {
        let bridge = state.zcash_bridge.read().await;
        let subs = bridge.config.active_subscriptions();

        // Parse credential ID
        if let Ok(cred_id_bytes) = parse_hex32(&req.credential_id) {
            for sub in subs {
                if let Ok(_payload) = bridge.encode_revocation(cred_id_bytes, reason, &sub.chain_name) {
                    chains_notified.push(sub.chain_name.clone());
                }
            }
        }
    }

    Ok(Json(RevokeCredentialResponse {
        success: true,
        chains_notified,
        error: None,
    }))
}

async fn get_credential(
    State(state): State<AppState>,
    Path(credential_id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let credentials = state.credentials.read().await;
    let credential = credentials.get(&credential_id).cloned().ok_or_else(|| ApiError {
        status: StatusCode::NOT_FOUND,
        message: "Credential not found".into(),
        code: "CREDENTIAL_NOT_FOUND".into(),
    })?;
    drop(credentials);

    let revoked = state.revoked_credentials.read().await.contains_key(&credential_id);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    Ok(Json(serde_json::json!({
        "credential_id": credential_id,
        "account_tag": hex::encode(credential.account_tag),
        "tier": credential.tier.name(),
        "tier_value": credential.tier.as_u8(),
        "policy_id": credential.policy_id,
        "state_root": hex::encode(credential.state_root),
        "block_height": credential.block_height,
        "issued_at": credential.issued_at,
        "expires_at": credential.expires_at,
        "proof_commitment": hex::encode(credential.proof_commitment),
        "attestation_hash": hex::encode(credential.attestation_hash),
        "revoked": revoked,
        "is_valid": !revoked && now < credential.expires_at
    })))
}

async fn get_account_credentials(
    State(state): State<AppState>,
    Path(account_tag): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let account_tag_bytes = parse_hex32(&account_tag)?;
    let credentials = state.credentials.read().await;
    let revoked = state.revoked_credentials.read().await;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let account_creds: Vec<serde_json::Value> = credentials
        .iter()
        .filter(|(_, c)| c.account_tag == account_tag_bytes)
        .map(|(id, c)| {
            let is_revoked = revoked.contains_key(id);
            serde_json::json!({
                "credential_id": id,
                "tier": c.tier.name(),
                "tier_value": c.tier.as_u8(),
                "issued_at": c.issued_at,
                "expires_at": c.expires_at,
                "revoked": is_revoked,
                "is_valid": !is_revoked && now < c.expires_at
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "account_tag": account_tag,
        "credentials": account_creds,
        "count": account_creds.len()
    })))
}

#[derive(Debug, Deserialize)]
pub struct CheckCredentialRequest {
    /// Account tag (hex-encoded 32 bytes)
    pub account_tag: String,
    /// Minimum tier required (0-5)
    pub min_tier: u8,
}

async fn check_zec_credential(
    State(state): State<AppState>,
    Json(req): Json<CheckCredentialRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let account_tag_bytes = parse_hex32(&req.account_tag)?;
    let min_tier = ZecTier::try_from(req.min_tier).map_err(|_| ApiError {
        status: StatusCode::BAD_REQUEST,
        message: format!("Invalid tier: {}", req.min_tier),
        code: "INVALID_TIER".into(),
    })?;

    let credentials = state.credentials.read().await;
    let revoked = state.revoked_credentials.read().await;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    // Find best valid credential meeting tier requirement
    let best_cred = credentials
        .iter()
        .filter(|(id, c)| {
            c.account_tag == account_tag_bytes
                && c.tier >= min_tier
                && now < c.expires_at
                && !revoked.contains_key(*id)
        })
        .max_by_key(|(_, c)| c.tier);

    match best_cred {
        Some((id, c)) => Ok(Json(serde_json::json!({
            "has_credential": true,
            "credential_id": id,
            "tier": c.tier.name(),
            "tier_value": c.tier.as_u8(),
            "expires_at": c.expires_at,
            "time_remaining": c.expires_at - now
        }))),
        None => Ok(Json(serde_json::json!({
            "has_credential": false,
            "credential_id": null,
            "reason": "No valid credential meeting tier requirement"
        }))),
    }
}

async fn list_tiers() -> impl IntoResponse {
    Json(serde_json::json!({
        "tiers": [
            {"value": 0, "name": "0.1+ ZEC", "threshold_zec": 0.1, "threshold_zatoshis": 10_000_000u64},
            {"value": 1, "name": "1+ ZEC", "threshold_zec": 1.0, "threshold_zatoshis": 100_000_000u64},
            {"value": 2, "name": "10+ ZEC", "threshold_zec": 10.0, "threshold_zatoshis": 1_000_000_000u64},
            {"value": 3, "name": "100+ ZEC", "threshold_zec": 100.0, "threshold_zatoshis": 10_000_000_000u64},
            {"value": 4, "name": "1000+ ZEC", "threshold_zec": 1000.0, "threshold_zatoshis": 100_000_000_000u64},
            {"value": 5, "name": "10000+ ZEC", "threshold_zec": 10000.0, "threshold_zatoshis": 1_000_000_000_000u64}
        ]
    }))
}

async fn get_bridge_stats(State(state): State<AppState>) -> impl IntoResponse {
    let bridge = state.zcash_bridge.read().await;
    let stats = bridge.stats();

    Json(serde_json::json!({
        "total_broadcast": stats.total_broadcast,
        "successful": stats.successful,
        "failed": stats.failed,
        "total_gas_spent": stats.total_gas_spent,
        "chain_stats": stats.chain_stats
    }))
}

async fn get_pending_broadcasts(State(state): State<AppState>) -> impl IntoResponse {
    let bridge = state.zcash_bridge.read().await;
    let pending = bridge.pending_broadcasts();

    let pending_json: Vec<serde_json::Value> = pending
        .iter()
        .map(|p| serde_json::json!({
            "broadcast_id": hex::encode(p.broadcast_id),
            "account_tag": hex::encode(p.credential.account_tag),
            "tier": p.credential.tier.name(),
            "target_chains": p.target_chains,
            "queued_at": p.queued_at,
            "chain_status": p.chain_status.iter().map(|(c, s)| {
                serde_json::json!({
                    "chain": c,
                    "status": format!("{:?}", s)
                })
            }).collect::<Vec<_>>()
        }))
        .collect();

    Json(serde_json::json!({
        "count": pending_json.len(),
        "pending": pending_json
    }))
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
                "holder_id": format!("0x{}", "01".repeat(32)),
                "policy_id": 271828,
                "snapshot_id": format!("0x{}", "02".repeat(32)),
                "attestation_hash": format!("0x{}", "03".repeat(32))
            }))
            .await;
        broadcast_response.assert_status_ok();

        let body: BroadcastResponse = broadcast_response.json();
        assert!(body.success);
        assert!(body.chains_broadcast.contains(&"osmosis".to_string()));
    }
}

