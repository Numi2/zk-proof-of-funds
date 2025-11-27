//! Relayer configuration.

use anyhow::{Context, Result};
use std::env;

/// Relayer configuration.
#[derive(Clone, Debug)]
pub struct RelayerConfig {
    /// Mina GraphQL endpoint.
    pub mina_graphql_url: String,
    /// zkApp address to listen for events.
    pub zkapp_address: String,
    /// Target chains to relay to.
    pub target_chains: Vec<String>,
    /// Ethereum RPC URL.
    pub ethereum_rpc_url: Option<String>,
    /// Bridge contract address on EVM.
    pub bridge_address: Option<String>,
    /// Relayer private key for signing EVM transactions.
    pub relayer_private_key: Option<String>,
    /// Starknet RPC URL.
    pub starknet_rpc_url: Option<String>,
    /// Starknet bridge contract address.
    pub starknet_bridge_address: Option<String>,
    /// Starknet account address for signing.
    pub starknet_account_address: Option<String>,
    /// Starknet private key (stark key).
    pub starknet_private_key: Option<String>,
    /// Polling interval in seconds.
    pub poll_interval_secs: u64,
    /// Maximum retries per attestation.
    pub max_retries: u32,
}

impl RelayerConfig {
    /// Load configuration from environment variables.
    pub fn from_env() -> Result<Self> {
        let mina_graphql_url = env::var("MINA_GRAPHQL_URL")
            .unwrap_or_else(|_| "https://proxy.testworld.minaprotocol.network/graphql".to_string());

        let zkapp_address = env::var("ZKPF_ZKAPP_ADDRESS")
            .context("ZKPF_ZKAPP_ADDRESS must be set")?;

        let target_chains: Vec<String> = env::var("TARGET_CHAINS")
            .unwrap_or_else(|_| "ethereum".to_string())
            .split(',')
            .map(|s| s.trim().to_string())
            .collect();

        // Ethereum/EVM config
        let ethereum_rpc_url = env::var("ETHEREUM_RPC_URL").ok();
        let bridge_address = env::var("BRIDGE_ADDRESS").ok();
        let relayer_private_key = env::var("RELAYER_PRIVATE_KEY").ok();
        
        // Starknet config
        let starknet_rpc_url = env::var("STARKNET_RPC_URL").ok();
        let starknet_bridge_address = env::var("STARKNET_BRIDGE_ADDRESS").ok();
        let starknet_account_address = env::var("STARKNET_ACCOUNT_ADDRESS").ok();
        let starknet_private_key = env::var("STARKNET_PRIVATE_KEY").ok();

        let poll_interval_secs: u64 = env::var("POLL_INTERVAL_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(30);

        let max_retries: u32 = env::var("MAX_RETRIES")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(3);

        Ok(Self {
            mina_graphql_url,
            zkapp_address,
            target_chains,
            ethereum_rpc_url,
            bridge_address,
            relayer_private_key,
            starknet_rpc_url,
            starknet_bridge_address,
            starknet_account_address,
            starknet_private_key,
            poll_interval_secs,
            max_retries,
        })
    }
}

