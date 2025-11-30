//! zkpf-rails-omni
//!
//! HTTP API service for Omni Bridge cross-chain operations.
//! This rail enables token transfers and attestations across NEAR, Ethereum,
//! Arbitrum, Base, and Solana via the Omni Bridge SDK.

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

use zkpf_omni_bridge::{
    BridgeCapability, OmniBridge, OmniBridgeConfig, SupportedChain,
    TransferRequest, TransferResult, TransferStatus,
    BridgeAddress, BridgeAsset, BridgeChainId,
    RAIL_ID_OMNI_BRIDGE,
};

// ═══════════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════════

/// Application state.
#[derive(Clone)]
pub struct AppState {
    /// The Omni Bridge client.
    pub bridge: Arc<RwLock<OmniBridge>>,
    /// Use testnet.
    pub use_testnet: bool,
}

impl Default for AppState {
    fn default() -> Self {
        let use_testnet = env::var("ZKPF_USE_TESTNET")
            .map(|v| v == "true" || v == "1")
            .unwrap_or(false);

        let bridge = if use_testnet {
            OmniBridge::testnet()
        } else {
            OmniBridge::mainnet()
        };

        Self {
            bridge: Arc::new(RwLock::new(bridge)),
            use_testnet,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

/// Build the router.
pub fn app_router() -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let state = AppState::default();

    Router::new()
        // Health & info
        .route("/health", get(health))
        .route("/rails/omni/info", get(info))
        // Chains
        .route("/rails/omni/chains", get(list_chains))
        .route("/rails/omni/chains/:chain_id", get(get_chain))
        // Tokens
        .route("/rails/omni/tokens", get(list_tokens))
        .route("/rails/omni/tokens/:symbol", get(get_token))
        // Transfers
        .route("/rails/omni/transfer", post(initiate_transfer))
        .route("/rails/omni/transfer/:id", get(get_transfer))
        .route("/rails/omni/transfers", get(list_transfers))
        .route("/rails/omni/estimate", post(estimate_fee))
        // Proofs
        .route("/rails/omni/prove-assets", post(prove_bridged_assets))
        .route("/rails/omni/attestation", post(create_attestation))
        .layer(cors)
        .with_state(state)
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS - HEALTH & INFO
// ═══════════════════════════════════════════════════════════════════════════════

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "rail_id": RAIL_ID_OMNI_BRIDGE
    }))
}

async fn info(State(state): State<AppState>) -> impl IntoResponse {
    let bridge = state.bridge.read().await;
    let capabilities: Vec<_> = bridge.capabilities().into_iter().collect();

    Json(serde_json::json!({
        "rail_id": RAIL_ID_OMNI_BRIDGE,
        "version": zkpf_omni_bridge::OMNI_BRIDGE_VERSION,
        "network": if state.use_testnet { "testnet" } else { "mainnet" },
        "enabled": bridge.is_enabled(),
        "capabilities": capabilities.iter().map(|c| format!("{:?}", c)).collect::<Vec<_>>(),
        "supported_chains": bridge.supported_chains().iter().map(|c| c.chain_id.display_name()).collect::<Vec<_>>()
    }))
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS - CHAINS
// ═══════════════════════════════════════════════════════════════════════════════

async fn list_chains(State(state): State<AppState>) -> impl IntoResponse {
    let bridge = state.bridge.read().await;
    let chains = bridge.supported_chains();

    Json(serde_json::json!({
        "chains": chains.iter().map(|c| serde_json::json!({
            "chain_id": c.chain_id.omni_chain_id(),
            "name": c.name,
            "symbol": c.symbol,
            "native_currency": c.native_currency,
            "production_ready": c.production_ready,
            "finality_secs": c.finality_secs
        })).collect::<Vec<_>>()
    }))
}

async fn get_chain(
    State(state): State<AppState>,
    Path(chain_id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let bridge = state.bridge.read().await;

    let chain = bridge
        .supported_chains()
        .into_iter()
        .find(|c| c.chain_id.omni_chain_id() == chain_id)
        .ok_or_else(|| ApiError::not_found("Chain not found"))?;

    Ok(Json(serde_json::json!({
        "chain_id": chain.chain_id.omni_chain_id(),
        "name": chain.name,
        "symbol": chain.symbol,
        "native_currency": chain.native_currency,
        "native_decimals": chain.native_decimals,
        "production_ready": chain.production_ready,
        "finality_secs": chain.finality_secs,
        "block_time_secs": chain.block_time_secs,
        "capabilities": chain.capabilities.iter().map(|c| format!("{:?}", c)).collect::<Vec<_>>()
    })))
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS - TOKENS
// ═══════════════════════════════════════════════════════════════════════════════

async fn list_tokens(State(state): State<AppState>) -> impl IntoResponse {
    let bridge = state.bridge.read().await;
    let tokens: Vec<_> = bridge.tokens().all().collect();

    Json(serde_json::json!({
        "tokens": tokens.iter().map(|t| serde_json::json!({
            "symbol": t.symbol,
            "name": t.name,
            "decimals": t.decimals,
            "is_stablecoin": t.is_stablecoin,
            "logo_url": t.logo_url,
            "available_chains": t.chain_addresses.keys().collect::<Vec<_>>()
        })).collect::<Vec<_>>()
    }))
}

async fn get_token(
    State(state): State<AppState>,
    Path(symbol): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let bridge = state.bridge.read().await;

    let token = bridge
        .tokens()
        .get(&symbol)
        .ok_or_else(|| ApiError::not_found("Token not found"))?;

    Ok(Json(serde_json::json!({
        "symbol": token.symbol,
        "name": token.name,
        "decimals": token.decimals,
        "is_stablecoin": token.is_stablecoin,
        "logo_url": token.logo_url,
        "coingecko_id": token.coingecko_id,
        "chain_addresses": token.chain_addresses
    })))
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS - TRANSFERS
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Deserialize)]
pub struct InitiateTransferRequest {
    pub source_chain: String,
    pub destination_chain: String,
    pub sender: String,
    pub recipient: String,
    pub token: String,
    pub amount: String, // String to handle large numbers
    pub memo: Option<String>,
    pub fast_mode: Option<bool>,
}

async fn initiate_transfer(
    State(state): State<AppState>,
    Json(req): Json<InitiateTransferRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let bridge = state.bridge.read().await;

    // Parse amount
    let amount: u128 = req.amount.parse().map_err(|_| {
        ApiError::bad_request("Invalid amount format")
    })?;

    // Parse chains
    let source_chain = parse_chain_id(&req.source_chain)?;
    let destination_chain = parse_chain_id(&req.destination_chain)?;

    // Get token info
    let token_info = bridge.tokens().get(&req.token).ok_or_else(|| {
        ApiError::bad_request(&format!("Token {} not supported", req.token))
    })?;

    // Create addresses
    let sender = parse_address(&req.sender, &source_chain)?;
    let recipient = parse_address(&req.recipient, &destination_chain)?;

    // Create asset
    let asset = bridge
        .tokens()
        .as_bridge_asset(&req.token, &source_chain)
        .map_err(|e| ApiError::bad_request(&e.to_string()))?;

    // Build request
    let mut transfer_req = TransferRequest::new(
        source_chain,
        destination_chain,
        sender,
        recipient,
        asset,
        amount,
    );

    if let Some(memo) = req.memo {
        transfer_req = transfer_req.with_memo(memo);
    }

    if req.fast_mode.unwrap_or(false) {
        transfer_req = transfer_req.with_fast_mode();
    }

    drop(bridge);

    // Initiate transfer
    let mut bridge = state.bridge.write().await;
    let result = bridge.transfer(transfer_req).await.map_err(|e| {
        ApiError::internal(&e.to_string())
    })?;

    Ok(Json(serde_json::json!({
        "transfer_id": hex::encode(result.transfer_id),
        "status": format!("{:?}", result.status),
        "estimated_completion": result.estimated_completion,
        "estimated_fee": result.estimated_fee.map(|f| serde_json::json!({
            "amount": f.amount.to_string(),
            "currency": f.currency
        }))
    })))
}

async fn get_transfer(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let transfer_id = parse_hex32(&id)?;
    let bridge = state.bridge.read().await;

    let result = bridge.get_transfer(&transfer_id).await.ok_or_else(|| {
        ApiError::not_found("Transfer not found")
    })?;

    Ok(Json(serde_json::json!({
        "transfer_id": hex::encode(result.transfer_id),
        "status": format!("{:?}", result.status),
        "source_chain": result.metadata.source_chain.display_name(),
        "destination_chain": result.metadata.destination_chain.display_name(),
        "amount": result.metadata.amount.to_string(),
        "asset": result.metadata.asset.symbol(),
        "created_at": result.metadata.created_at,
        "completed_at": result.metadata.completed_at,
        "source_tx_hash": result.metadata.source_tx_hash,
        "destination_tx_hash": result.metadata.destination_tx_hash,
        "error": result.error
    })))
}

async fn list_transfers(State(state): State<AppState>) -> impl IntoResponse {
    let bridge = state.bridge.read().await;
    let transfers = bridge.transfer_history().await;

    Json(serde_json::json!({
        "transfers": transfers.iter().map(|t| serde_json::json!({
            "transfer_id": hex::encode(t.transfer_id),
            "status": format!("{:?}", t.status),
            "source_chain": t.metadata.source_chain.display_name(),
            "destination_chain": t.metadata.destination_chain.display_name(),
            "amount": t.metadata.amount.to_string(),
            "asset": t.metadata.asset.symbol(),
            "created_at": t.metadata.created_at,
            "completed_at": t.metadata.completed_at
        })).collect::<Vec<_>>()
    }))
}

#[derive(Debug, Deserialize)]
pub struct EstimateFeeRequest {
    pub source_chain: String,
    pub destination_chain: String,
    pub token: String,
    pub amount: String,
    pub fast_mode: Option<bool>,
}

async fn estimate_fee(
    State(state): State<AppState>,
    Json(req): Json<EstimateFeeRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let bridge = state.bridge.read().await;

    let amount: u128 = req.amount.parse().map_err(|_| {
        ApiError::bad_request("Invalid amount format")
    })?;

    let source_chain = parse_chain_id(&req.source_chain)?;
    let destination_chain = parse_chain_id(&req.destination_chain)?;

    let asset = bridge
        .tokens()
        .as_bridge_asset(&req.token, &source_chain)
        .map_err(|e| ApiError::bad_request(&e.to_string()))?;

    let mut transfer_req = TransferRequest::new(
        source_chain,
        destination_chain,
        BridgeAddress::near("estimate.near"),
        BridgeAddress::near("estimate.near"),
        asset,
        amount,
    );

    if req.fast_mode.unwrap_or(false) {
        transfer_req = transfer_req.with_fast_mode();
    }

    let fee = bridge.estimate_fee(&transfer_req).await.map_err(|e| {
        ApiError::internal(&e.to_string())
    })?;

    Ok(Json(serde_json::json!({
        "amount": fee.amount.to_string(),
        "currency": fee.currency,
        "recipient": fee.recipient
    })))
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDLERS - PROOFS
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Deserialize)]
pub struct ProveBridgedAssetsRequest {
    pub chain: String,
    pub address: String,
    pub tokens: Vec<String>,
}

async fn prove_bridged_assets(
    State(state): State<AppState>,
    Json(req): Json<ProveBridgedAssetsRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let bridge = state.bridge.read().await;

    let chain = parse_chain_id(&req.chain)?;
    let address = parse_address(&req.address, &chain)?;

    let mut assets = Vec::new();
    for token in &req.tokens {
        let asset = bridge
            .tokens()
            .as_bridge_asset(token, &chain)
            .map_err(|e| ApiError::bad_request(&e.to_string()))?;
        assets.push(asset);
    }

    let proof = bridge
        .prove_bridged_assets(&chain, &address, &assets)
        .await
        .map_err(|e| ApiError::internal(&e.to_string()))?;

    Ok(Json(serde_json::json!({
        "chain": proof.chain.display_name(),
        "holder_address": proof.holder_address.to_string(),
        "proof_hash": hex::encode(proof.proof_hash),
        "block_number": proof.block_number,
        "timestamp": proof.timestamp,
        "assets": proof.assets.iter().map(|(asset, balance)| serde_json::json!({
            "symbol": asset.symbol(),
            "balance": balance.to_string()
        })).collect::<Vec<_>>()
    })))
}

#[derive(Debug, Deserialize)]
pub struct CreateAttestationRequest {
    pub holder_id: String,
    pub source_chain: String,
    pub destination_chain: String,
    pub address: String,
    pub tokens: Vec<String>,
}

async fn create_attestation(
    State(state): State<AppState>,
    Json(req): Json<CreateAttestationRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let bridge = state.bridge.read().await;

    let holder_id = parse_hex32(&req.holder_id)?;
    let source_chain = parse_chain_id(&req.source_chain)?;
    let destination_chain = parse_chain_id(&req.destination_chain)?;
    let address = parse_address(&req.address, &source_chain)?;

    let mut assets = Vec::new();
    for token in &req.tokens {
        let asset = bridge
            .tokens()
            .as_bridge_asset(token, &source_chain)
            .map_err(|e| ApiError::bad_request(&e.to_string()))?;
        assets.push(asset);
    }

    let proof = bridge
        .prove_bridged_assets(&source_chain, &address, &assets)
        .await
        .map_err(|e| ApiError::internal(&e.to_string()))?;

    let attestation = bridge
        .create_attestation(&holder_id, &source_chain, &destination_chain, &proof)
        .await
        .map_err(|e| ApiError::internal(&e.to_string()))?;

    Ok(Json(serde_json::json!({
        "attestation_id": hex::encode(attestation.attestation_id),
        "holder_binding": hex::encode(attestation.holder_binding),
        "source_chain": attestation.source_chain.display_name(),
        "target_chain": attestation.target_chain.display_name(),
        "attested_at": attestation.attested_at,
        "expires_at": attestation.expires_at,
        "is_valid": attestation.is_valid(),
        "encoded": hex::encode(attestation.encode())
    })))
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
    fn not_found(message: &str) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: message.to_string(),
            code: "NOT_FOUND".to_string(),
        }
    }

    fn bad_request(message: &str) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.to_string(),
            code: "BAD_REQUEST".to_string(),
        }
    }

    fn internal(message: &str) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: message.to_string(),
            code: "INTERNAL_ERROR".to_string(),
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

fn parse_hex32(hex_str: &str) -> Result<[u8; 32], ApiError> {
    let hex_str = hex_str.strip_prefix("0x").unwrap_or(hex_str);
    let bytes = hex::decode(hex_str).map_err(|e| {
        ApiError::bad_request(&format!("Invalid hex: {}", e))
    })?;

    if bytes.len() != 32 {
        return Err(ApiError::bad_request(&format!(
            "Expected 32 bytes, got {}",
            bytes.len()
        )));
    }

    let mut result = [0u8; 32];
    result.copy_from_slice(&bytes);
    Ok(result)
}

fn parse_chain_id(chain: &str) -> Result<BridgeChainId, ApiError> {
    match chain.to_lowercase().as_str() {
        "near" | "near-mainnet" => Ok(BridgeChainId::NearMainnet),
        "near-testnet" => Ok(BridgeChainId::NearTestnet),
        "ethereum" | "eth" | "ethereum-mainnet" => Ok(BridgeChainId::EthereumMainnet),
        "ethereum-sepolia" | "sepolia" => Ok(BridgeChainId::EthereumSepolia),
        "arbitrum" | "arbitrum-one" => Ok(BridgeChainId::ArbitrumOne),
        "arbitrum-sepolia" => Ok(BridgeChainId::ArbitrumSepolia),
        "base" | "base-mainnet" => Ok(BridgeChainId::BaseMainnet),
        "base-sepolia" => Ok(BridgeChainId::BaseSepolia),
        "solana" | "solana-mainnet" => Ok(BridgeChainId::SolanaMainnet),
        "solana-devnet" => Ok(BridgeChainId::SolanaDevnet),
        _ => Err(ApiError::bad_request(&format!(
            "Unknown chain: {}",
            chain
        ))),
    }
}

fn parse_address(address: &str, chain: &BridgeChainId) -> Result<BridgeAddress, ApiError> {
    match chain {
        BridgeChainId::NearMainnet | BridgeChainId::NearTestnet => {
            Ok(BridgeAddress::near(address))
        }
        BridgeChainId::SolanaMainnet | BridgeChainId::SolanaDevnet => {
            Ok(BridgeAddress::solana(address))
        }
        _ if chain.is_evm() => {
            Ok(BridgeAddress::evm(address))
        }
        _ => Err(ApiError::bad_request("Cannot determine address type for chain")),
    }
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
            .unwrap_or(3003);

        let addr = SocketAddr::from(([0, 0, 0, 0], port));
        tracing::info!("Omni Bridge rail listening on {}", addr);

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
        let response = server.get("/rails/omni/info").await;
        response.assert_status_ok();

        let body: serde_json::Value = response.json();
        assert_eq!(body["rail_id"], RAIL_ID_OMNI_BRIDGE);
    }

    #[tokio::test]
    async fn test_list_chains() {
        let server = TestServer::new(app_router()).unwrap();
        let response = server.get("/rails/omni/chains").await;
        response.assert_status_ok();

        let body: serde_json::Value = response.json();
        assert!(body["chains"].as_array().unwrap().len() > 0);
    }

    #[tokio::test]
    async fn test_list_tokens() {
        let server = TestServer::new(app_router()).unwrap();
        let response = server.get("/rails/omni/tokens").await;
        response.assert_status_ok();

        let body: serde_json::Value = response.json();
        assert!(body["tokens"].as_array().unwrap().len() > 0);
    }
}

