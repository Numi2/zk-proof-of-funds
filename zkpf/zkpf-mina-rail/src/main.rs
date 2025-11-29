//! Mina Rail Server
//!
//! This is the main entry point for the Mina Recursive Rail server.

use std::env;

use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use zkpf_mina_rail::server::{run_server, ServerConfig};
use zkpf_mina_rail::types::MinaRailConfig;
use zkpf_mina_rail::bridge::BridgeConfig;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,zkpf_mina_rail=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();
    
    log::info!("Starting Mina Recursive Rail server...");
    
    // Load configuration
    let config = load_config();
    
    log::info!("Configuration:");
    log::info!("  Listen address: {}", config.listen_addr);
    log::info!("  Number of shards: {}", config.rail_config.num_shards);
    log::info!("  Max tachystamps per epoch: {}", config.rail_config.max_tachystamps_per_epoch);
    log::info!("  Epoch duration (slots): {}", config.rail_config.epoch_duration_slots);
    log::info!("  IVC tree depth: {}", config.rail_config.ivc_tree_depth);
    
    // Start server
    run_server(config).await
}

fn load_config() -> ServerConfig {
    let listen_addr = env::var("MINA_RAIL_LISTEN_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:3001".into());
    
    let num_shards: usize = env::var("MINA_RAIL_NUM_SHARDS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(16);
    
    let max_tachystamps: usize = env::var("MINA_RAIL_MAX_TACHYSTAMPS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(10_000);
    
    let epoch_duration_slots: u64 = env::var("MINA_RAIL_EPOCH_SLOTS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(7200);
    
    let ivc_tree_depth: usize = env::var("MINA_RAIL_IVC_DEPTH")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(14);
    
    let l1_rpc_url = env::var("TACHYON_L1_RPC_URL")
        .unwrap_or_else(|_| "http://localhost:8232".into());
    
    let mina_graphql_url = env::var("MINA_GRAPHQL_URL")
        .unwrap_or_else(|_| "http://localhost:3085/graphql".into());
    
    let enable_cors = env::var("MINA_RAIL_ENABLE_CORS")
        .map(|s| s.to_lowercase() != "false" && s != "0")
        .unwrap_or(true);
    
    ServerConfig {
        listen_addr,
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
        enable_cors,
    }
}

