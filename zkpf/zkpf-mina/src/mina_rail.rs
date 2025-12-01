//! Mina Rail integration for zkpf-backend.
//!
//! This module provides the Mina Recursive Rail API endpoints,
//! allowing tachystamp aggregation alongside the main ZKPF backend.

use std::sync::Arc;

use axum::Router;
use once_cell::sync::Lazy;
use tokio::sync::RwLock;

use zkpf_mina_rail::{
    aggregator::EpochAggregator,
    bridge::{Bridge, BridgeConfig},
    server::{AppState as MinaRailAppState, create_router as create_mina_rail_router, ServerConfig},
    types::MinaRailConfig,
};

/// Environment variable names for Mina Rail configuration.
const MINA_RAIL_NUM_SHARDS_ENV: &str = "MINA_RAIL_NUM_SHARDS";
const MINA_RAIL_MAX_TACHYSTAMPS_ENV: &str = "MINA_RAIL_MAX_TACHYSTAMPS";
const MINA_RAIL_EPOCH_SLOTS_ENV: &str = "MINA_RAIL_EPOCH_SLOTS";
const MINA_RAIL_IVC_DEPTH_ENV: &str = "MINA_RAIL_IVC_DEPTH";
const MINA_RAIL_ENABLED_ENV: &str = "MINA_RAIL_ENABLED";
const TACHYON_L1_RPC_URL_ENV: &str = "TACHYON_L1_RPC_URL";
const MINA_GRAPHQL_URL_ENV: &str = "MINA_GRAPHQL_URL";

/// Lazy-initialized Mina Rail state.
static MINA_RAIL_STATE: Lazy<Option<Arc<MinaRailAppState>>> = Lazy::new(|| {
    if !mina_rail_enabled() {
        eprintln!("zkpf-backend: Mina Rail is disabled (set {}=1 to enable)", MINA_RAIL_ENABLED_ENV);
        return None;
    }
    
    eprintln!("zkpf-backend: Initializing Mina Rail...");
    
    let config = load_mina_rail_config();
    let aggregator = EpochAggregator::new(config.rail_config.clone());
    let bridge = Bridge::new(config.bridge_config.clone());
    
    eprintln!("zkpf-backend: Mina Rail initialized with {} shards", config.rail_config.num_shards);
    
    Some(Arc::new(MinaRailAppState {
        aggregator: RwLock::new(aggregator),
        bridge: RwLock::new(bridge),
        config,
    }))
});

/// Check if Mina Rail is enabled via environment.
fn mina_rail_enabled() -> bool {
    std::env::var(MINA_RAIL_ENABLED_ENV)
        .map(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(true) // Enabled by default
}

/// Load Mina Rail configuration from environment.
fn load_mina_rail_config() -> ServerConfig {
    let num_shards: usize = std::env::var(MINA_RAIL_NUM_SHARDS_ENV)
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(16);
    
    let max_tachystamps: usize = std::env::var(MINA_RAIL_MAX_TACHYSTAMPS_ENV)
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(10_000);
    
    let epoch_duration_slots: u64 = std::env::var(MINA_RAIL_EPOCH_SLOTS_ENV)
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(7200);
    
    let ivc_tree_depth: usize = std::env::var(MINA_RAIL_IVC_DEPTH_ENV)
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(14);
    
    let l1_rpc_url = std::env::var(TACHYON_L1_RPC_URL_ENV)
        .unwrap_or_else(|_| "http://localhost:8232".into());
    
    let mina_graphql_url = std::env::var(MINA_GRAPHQL_URL_ENV)
        .unwrap_or_else(|_| "http://localhost:3085/graphql".into());
    
    ServerConfig {
        listen_addr: "0.0.0.0:3001".into(), // Not used when embedded
        rail_config: MinaRailConfig {
            num_shards,
            max_tachystamps_per_epoch: max_tachystamps,
            epoch_duration_slots,
            tachyon_bridge_address: [0u8; 20],
            mina_app_address: [0u8; 55],
            ivc_tree_depth,
        },
        bridge_config: BridgeConfig {
            l1_rpc_url,
            bridge_contract: [0u8; 20],
            mina_graphql_url,
            operator_key: None,
            confirmation_blocks: 6,
        },
        enable_cors: true,
    }
}

/// Create the Mina Rail router if enabled.
///
/// This returns a router mounted at `/mina-rail/*` that handles:
/// - GET /mina-rail/status - Rail status
/// - GET /mina-rail/epoch/current/state - Current epoch state
/// - GET /mina-rail/epoch/:epoch/state - Historical epoch state  
/// - GET /mina-rail/epoch/:epoch/proof - Epoch proof
/// - POST /mina-rail/tachystamp/submit - Submit a tachystamp
/// - GET /mina-rail/nullifier/:nf/check - Check nullifier usage
/// - POST /mina-rail/admin/finalize - Finalize epoch (admin)
pub fn mina_rail_router() -> Option<Router> {
    MINA_RAIL_STATE.as_ref().map(|state| {
        create_mina_rail_router(state.clone())
    })
}

/// Check if Mina Rail is active.
pub fn is_mina_rail_active() -> bool {
    MINA_RAIL_STATE.is_some()
}

