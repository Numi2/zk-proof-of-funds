//! HTTP server for the Mina Rail API.
//!
//! This module implements the REST API for the Mina Recursive Rail,
//! allowing clients to submit tachystamps, query status, and retrieve epoch proofs.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};

use crate::aggregator::{EpochAggregator, ShardStatus, SubmitResult};
use crate::bridge::{Bridge, BridgeConfig};
use crate::tachystamp::TachystampSubmission;
use crate::types::{EpochProof, EpochState, MinaRailConfig};

/// Application state shared across handlers.
pub struct AppState {
    /// The epoch aggregator.
    pub aggregator: RwLock<EpochAggregator>,
    
    /// The bridge.
    pub bridge: RwLock<Bridge>,
    
    /// Server configuration.
    pub config: ServerConfig,
}

/// Server configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ServerConfig {
    /// Listen address.
    pub listen_addr: String,
    
    /// Rail configuration.
    pub rail_config: MinaRailConfig,
    
    /// Bridge configuration.
    pub bridge_config: BridgeConfig,
    
    /// Enable CORS.
    pub enable_cors: bool,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            listen_addr: "0.0.0.0:3001".into(),
            rail_config: MinaRailConfig::default(),
            bridge_config: BridgeConfig::default(),
            enable_cors: true,
        }
    }
}

/// Create the API router.
pub fn create_router(state: Arc<AppState>) -> Router {
    let api_routes = Router::new()
        // Status endpoints
        .route("/status", get(get_status))
        
        // Epoch endpoints
        .route("/epoch/current/state", get(get_current_epoch_state))
        .route("/epoch/:epoch/state", get(get_epoch_state))
        .route("/epoch/:epoch/proof", get(get_epoch_proof))
        .route("/epochs/finalized", get(get_finalized_epochs))
        
        // Tachystamp endpoints
        .route("/tachystamp/submit", post(submit_tachystamp))
        .route("/tachystamp/:id", get(get_tachystamp))
        
        // Nullifier endpoints
        .route("/nullifier/:nullifier/check", get(check_nullifier))
        
        // Holder endpoints
        .route("/holder/:commitment/history", get(get_holder_history))
        
        // Admin endpoints
        .route("/admin/finalize", post(finalize_epoch))
        .route("/admin/generate-shard-proof/:shard_id", post(generate_shard_proof))
        
        // Verification endpoints (IVC-based)
        .route("/epoch/:epoch/verify", post(verify_epoch_proof));
    
    let mut router = Router::new()
        .nest("/mina-rail", api_routes)
        .with_state(state.clone());
    
    // Add CORS if enabled
    if state.config.enable_cors {
        router = router.layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        );
    }
    
    router
}

/// Run the server.
pub async fn run_server(config: ServerConfig) -> anyhow::Result<()> {
    let aggregator = EpochAggregator::new(config.rail_config.clone());
    let bridge = Bridge::new(config.bridge_config.clone());
    
    let state = Arc::new(AppState {
        aggregator: RwLock::new(aggregator),
        bridge: RwLock::new(bridge),
        config: config.clone(),
    });
    
    let router = create_router(state);
    
    let listener = tokio::net::TcpListener::bind(&config.listen_addr).await?;
    log::info!("Mina Rail server listening on {}", config.listen_addr);
    
    axum::serve(listener, router).await?;
    
    Ok(())
}

// ============================================================
// Response types
// ============================================================

#[derive(Serialize)]
struct StatusResponse {
    current_epoch: u64,
    shards: Vec<ShardStatusResponse>,
    total_tachystamps: u64,
    aggregation_progress: u8,
    sync_status: String,
    latest_finalized_epoch: u64,
    latest_epoch_proof_hash: Option<String>,
    time_to_next_epoch: u64,
    error: Option<String>,
}

#[derive(Serialize)]
struct ShardStatusResponse {
    shard_id: usize,
    tachystamp_count: u64,
    nullifier_root: String,
    is_proof_generated: bool,
    proof_hash: Option<String>,
}

impl From<ShardStatus> for ShardStatusResponse {
    fn from(s: ShardStatus) -> Self {
        Self {
            shard_id: s.shard_id,
            tachystamp_count: s.tachystamp_count,
            nullifier_root: format!("0x{}", hex::encode(s.nullifier_root)),
            is_proof_generated: s.is_proof_generated,
            proof_hash: s.proof_hash.map(|h| format!("0x{}", hex::encode(h))),
        }
    }
}

#[derive(Serialize)]
struct EpochStateResponse {
    epoch: u64,
    start_slot: u64,
    end_slot: Option<u64>,
    nullifier_root: String,
    tachystamp_count: u64,
    holder_count: u64,
    accumulator_hash: String,
    previous_epoch_hash: String,
    is_finalized: bool,
}

impl From<EpochState> for EpochStateResponse {
    fn from(s: EpochState) -> Self {
        Self {
            epoch: s.epoch,
            start_slot: s.start_slot,
            end_slot: s.end_slot,
            nullifier_root: format!("0x{}", hex::encode(s.nullifier_root)),
            tachystamp_count: s.tachystamp_count,
            holder_count: s.holder_count,
            accumulator_hash: format!("0x{}", hex::encode(s.accumulator_hash)),
            previous_epoch_hash: format!("0x{}", hex::encode(s.previous_epoch_hash)),
            is_finalized: s.end_slot.is_some(),
        }
    }
}

#[derive(Serialize)]
struct EpochProofResponse {
    is_finalized: bool,
    proof: Option<EpochProofData>,
    epoch_state: EpochStateResponse,
}

#[derive(Serialize)]
struct EpochProofData {
    epoch: u64,
    pre_state_hash: String,
    post_state_hash: String,
    nullifier_root: String,
    proof_count: u64,
    ivc_proof: IVCProofResponse,
    shard_commitment: String,
    mina_anchor_hash: String,
    mina_slot: u64,
    proof_hash: String,
}

#[derive(Serialize)]
struct IVCProofResponse {
    proof_bytes: String,
    public_inputs: Vec<String>,
    challenges: Vec<String>,
    accumulator_commitment: String,
}

impl From<EpochProof> for EpochProofData {
    fn from(p: EpochProof) -> Self {
        Self {
            epoch: p.epoch,
            pre_state_hash: format!("0x{}", hex::encode(p.pre_state_hash)),
            post_state_hash: format!("0x{}", hex::encode(p.post_state_hash)),
            nullifier_root: format!("0x{}", hex::encode(p.nullifier_root)),
            proof_count: p.proof_count,
            ivc_proof: IVCProofResponse {
                proof_bytes: base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    &p.ivc_proof.proof_bytes,
                ),
                public_inputs: p.ivc_proof.public_inputs
                    .iter()
                    .map(|i| format!("0x{}", hex::encode(i)))
                    .collect(),
                challenges: p.ivc_proof.challenges
                    .iter()
                    .map(|c| format!("0x{}", hex::encode(c)))
                    .collect(),
                accumulator_commitment: format!("0x{}", hex::encode(p.ivc_proof.accumulator_commitment)),
            },
            shard_commitment: format!("0x{}", hex::encode(p.shard_commitment)),
            mina_anchor_hash: format!("0x{}", hex::encode(p.mina_anchor_hash)),
            mina_slot: p.mina_slot,
            proof_hash: format!("0x{}", hex::encode(p.hash())),
        }
    }
}

#[derive(Serialize)]
struct SubmitTachystampResponse {
    success: bool,
    tachystamp_id: String,
    shard_id: usize,
    epoch: u64,
    queue_position: usize,
    error: Option<String>,
}

impl From<SubmitResult> for SubmitTachystampResponse {
    fn from(r: SubmitResult) -> Self {
        Self {
            success: r.success,
            tachystamp_id: r.tachystamp_id,
            shard_id: r.shard_id,
            epoch: r.epoch,
            queue_position: r.queue_position,
            error: r.error,
        }
    }
}

#[derive(Serialize)]
struct NullifierCheckResponse {
    used: bool,
}

#[derive(Serialize)]
struct HolderHistoryResponse {
    holder_commitment: String,
    tachystamps: Vec<TachystampInfo>,
    finalized_epochs: Vec<u64>,
    nullifier_count: u64,
}

#[derive(Serialize)]
struct TachystampInfo {
    id: String,
    epoch: u64,
    nullifier: String,
    policy_id: u64,
    threshold: u64,
    submitted_at: u64,
}

#[derive(Deserialize)]
struct SubmitRequest {
    tachystamp: TachystampSubmission,
}

#[derive(Deserialize)]
struct FinalizedEpochsQuery {
    since: Option<u64>,
}

// ============================================================
// Handlers
// ============================================================

async fn get_status(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let aggregator = state.aggregator.read().await;
    let _bridge = state.bridge.read().await;
    
    let shards: Vec<ShardStatusResponse> = aggregator
        .shard_statuses()
        .into_iter()
        .map(ShardStatusResponse::from)
        .collect();
    
    let latest_finalized = aggregator.latest_finalized_epoch().unwrap_or(0);
    let latest_proof_hash = aggregator
        .get_epoch_proof(latest_finalized)
        .map(|p| format!("0x{}", hex::encode(p.hash())));
    
    // Estimate time to next epoch (~1 day in ms)
    let epoch_duration_ms = aggregator.config().epoch_duration_slots as u64 * 180_000; // 3 min/slot
    let time_to_next = epoch_duration_ms - (now_ms() % epoch_duration_ms);
    
    let response = StatusResponse {
        current_epoch: aggregator.current_epoch(),
        shards,
        total_tachystamps: aggregator.total_tachystamp_count(),
        aggregation_progress: aggregator.aggregation_progress(),
        sync_status: "idle".into(),
        latest_finalized_epoch: latest_finalized,
        latest_epoch_proof_hash: latest_proof_hash,
        time_to_next_epoch: time_to_next,
        error: None,
    };
    
    Json(response)
}

async fn get_current_epoch_state(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let aggregator = state.aggregator.read().await;
    let epoch_state = aggregator.current_state().clone();
    
    Json(EpochStateResponse::from(epoch_state))
}

async fn get_epoch_state(
    State(state): State<Arc<AppState>>,
    Path(epoch): Path<u64>,
) -> Result<impl IntoResponse, StatusCode> {
    let aggregator = state.aggregator.read().await;
    
    match aggregator.get_epoch_state(epoch) {
        Some(epoch_state) => Ok(Json(EpochStateResponse::from(epoch_state))),
        None => Err(StatusCode::NOT_FOUND),
    }
}

async fn get_epoch_proof(
    State(state): State<Arc<AppState>>,
    Path(epoch): Path<u64>,
) -> Result<impl IntoResponse, StatusCode> {
    let aggregator = state.aggregator.read().await;
    
    let epoch_state = aggregator
        .get_epoch_state(epoch)
        .ok_or(StatusCode::NOT_FOUND)?;
    
    let proof = aggregator.get_epoch_proof(epoch).cloned();
    
    let response = EpochProofResponse {
        is_finalized: epoch_state.end_slot.is_some(),
        proof: proof.map(EpochProofData::from),
        epoch_state: EpochStateResponse::from(epoch_state),
    };
    
    Ok(Json(response))
}

async fn get_finalized_epochs(
    State(state): State<Arc<AppState>>,
    Query(query): Query<FinalizedEpochsQuery>,
) -> impl IntoResponse {
    let aggregator = state.aggregator.read().await;
    let since = query.since.unwrap_or(0);
    
    let mut proofs = Vec::new();
    let latest = aggregator.latest_finalized_epoch().unwrap_or(0);
    
    for epoch in since..=latest {
        if let Some(proof) = aggregator.get_epoch_proof(epoch) {
            proofs.push(EpochProofData::from(proof.clone()));
        }
    }
    
    Json(proofs)
}

async fn submit_tachystamp(
    State(state): State<Arc<AppState>>,
    Json(request): Json<SubmitRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<SubmitTachystampResponse>)> {
    let mut aggregator = state.aggregator.write().await;
    
    match aggregator.submit_tachystamp(request.tachystamp) {
        Ok(result) => Ok(Json(SubmitTachystampResponse::from(result))),
        Err(e) => {
            let response = SubmitTachystampResponse {
                success: false,
                tachystamp_id: String::new(),
                shard_id: 0,
                epoch: aggregator.current_epoch(),
                queue_position: 0,
                error: Some(e.to_string()),
            };
            Err((StatusCode::BAD_REQUEST, Json(response)))
        }
    }
}

async fn get_tachystamp(
    State(_state): State<Arc<AppState>>,
    Path(_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // In a real implementation, we'd look up the tachystamp by ID
    // For now, return not found
    Err(StatusCode::NOT_FOUND)
}

async fn check_nullifier(
    State(state): State<Arc<AppState>>,
    Path(nullifier): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let nullifier_bytes = parse_hex_32(&nullifier)
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    
    let aggregator = state.aggregator.read().await;
    let used = aggregator.is_nullifier_used(&nullifier_bytes);
    
    Ok(Json(NullifierCheckResponse { used }))
}

async fn get_holder_history(
    State(_state): State<Arc<AppState>>,
    Path(commitment): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    // In a real implementation, we'd look up holder history
    // For now, return empty history
    let response = HolderHistoryResponse {
        holder_commitment: commitment,
        tachystamps: Vec::new(),
        finalized_epochs: Vec::new(),
        nullifier_count: 0,
    };
    
    Ok(Json(response))
}

async fn finalize_epoch(
    State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let mut aggregator = state.aggregator.write().await;
    
    let mina_slot = now_ms() / 180_000; // Approximate slot
    
    match aggregator.finalize_epoch(mina_slot) {
        Ok(proof) => {
            // Submit to bridge
            let mut bridge = state.bridge.write().await;
            let _ = bridge.submit_epoch_proof(proof.clone());
            
            Ok(Json(EpochProofData::from(proof)))
        }
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

async fn generate_shard_proof(
    State(state): State<Arc<AppState>>,
    Path(shard_id): Path<usize>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let aggregator = state.aggregator.read().await;
    
    match aggregator.generate_shard_proof(shard_id) {
        Ok(proof) => {
            let response = serde_json::json!({
                "shard_id": proof.shard_id,
                "epoch": proof.epoch,
                "nullifier_count": proof.nullifier_count,
                "nullifier_root": format!("0x{}", hex::encode(proof.nullifier_root)),
                "proof_hash": format!("0x{}", hex::encode(proof.hash())),
            });
            Ok(Json(response))
        }
        Err(e) => Err((StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

// ============================================================
// IVC Verification Endpoints
// ============================================================

/// Request for epoch proof verification.
#[derive(Debug, Deserialize)]
struct VerifyEpochRequest {
    /// Expected nullifier roots from shards (optional, for full verification)
    expected_nullifier_roots: Option<Vec<String>>,
}

/// Response for epoch proof verification.
#[derive(Debug, Serialize)]
struct VerifyEpochResponse {
    /// Whether verification succeeded.
    valid: bool,
    /// Epoch number.
    epoch: u64,
    /// Number of proofs aggregated.
    proof_count: u64,
    /// Verification details.
    details: Option<String>,
    /// Error message if failed.
    error: Option<String>,
}

/// Verify an epoch proof using IVC accumulator verification.
///
/// This endpoint verifies:
/// 1. The epoch proof exists and is finalized
/// 2. The IVC accumulator commitment is valid
/// 3. (Optional) The nullifier roots match expected values
async fn verify_epoch_proof(
    State(state): State<Arc<AppState>>,
    Path(epoch): Path<u64>,
    Json(request): Json<VerifyEpochRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<VerifyEpochResponse>)> {
    use crate::ivc::IVCVerifier;
    
    let aggregator = state.aggregator.read().await;
    
    // Get the epoch proof
    let proof = aggregator.get_epoch_proof(epoch).ok_or_else(|| {
        (StatusCode::NOT_FOUND, Json(VerifyEpochResponse {
            valid: false,
            epoch,
            proof_count: 0,
            details: None,
            error: Some(format!("Epoch {} proof not found", epoch)),
        }))
    })?;
    
    let verifier = IVCVerifier::new();
    
    // Verify the IVC proof
    let verification_result = if let Some(expected_roots) = request.expected_nullifier_roots {
        // Full verification with expected nullifier roots
        let roots: Result<Vec<[u8; 32]>, _> = expected_roots
            .iter()
            .map(|s| parse_hex_32(s))
            .collect();
        
        match roots {
            Ok(roots) => verifier.verify_epoch_transition(&proof.ivc_proof, &roots, epoch),
            Err(e) => Err(crate::ivc::IVCError::VerificationFailed(format!(
                "Invalid nullifier root hex: {}",
                e
            ))),
        }
    } else {
        // Basic structural verification
        verifier.verify(&proof.ivc_proof)
    };
    
    match verification_result {
        Ok(valid) => Ok(Json(VerifyEpochResponse {
            valid,
            epoch,
            proof_count: proof.proof_count,
            details: Some(format!(
                "IVC verification passed: {} proofs aggregated, accumulator commitment: 0x{}",
                proof.proof_count,
                hex::encode(&proof.ivc_proof.accumulator_commitment[..8])
            )),
            error: None,
        })),
        Err(e) => {
            tracing::warn!("Epoch {} verification failed: {}", epoch, e);
            Ok(Json(VerifyEpochResponse {
                valid: false,
                epoch,
                proof_count: proof.proof_count,
                details: None,
                error: Some(e.to_string()),
            }))
        }
    }
}

// ============================================================
// Helpers
// ============================================================

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn parse_hex_32(s: &str) -> Result<[u8; 32], String> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    if s.len() != 64 {
        return Err(format!("expected 64 hex chars, got {}", s.len()));
    }
    let bytes = hex::decode(s).map_err(|e| e.to_string())?;
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

