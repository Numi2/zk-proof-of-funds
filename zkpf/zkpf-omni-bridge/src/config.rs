//! Configuration for Omni Bridge integration.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::types::BridgeChainId;

/// Configuration for the Omni Bridge.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OmniBridgeConfig {
    /// Whether the bridge is enabled.
    pub enabled: bool,
    /// Default source chain.
    pub default_source_chain: BridgeChainId,
    /// Endpoints for each supported chain.
    pub endpoints: HashMap<String, BridgeEndpoint>,
    /// Bridge contract addresses on NEAR.
    pub near_bridge_contracts: NearBridgeContracts,
    /// Token registry for supported bridged tokens.
    pub token_registry: TokenRegistryConfig,
    /// Transfer timeout in seconds.
    pub transfer_timeout_secs: u64,
    /// Maximum concurrent transfers.
    pub max_concurrent_transfers: usize,
    /// Whether to use testnet configurations.
    pub use_testnet: bool,
}

impl Default for OmniBridgeConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            default_source_chain: BridgeChainId::NearMainnet,
            endpoints: default_mainnet_endpoints(),
            near_bridge_contracts: NearBridgeContracts::mainnet(),
            token_registry: TokenRegistryConfig::default(),
            transfer_timeout_secs: 600,
            max_concurrent_transfers: 10,
            use_testnet: false,
        }
    }
}

impl OmniBridgeConfig {
    /// Create a testnet configuration.
    pub fn testnet() -> Self {
        Self {
            enabled: true,
            default_source_chain: BridgeChainId::NearTestnet,
            endpoints: default_testnet_endpoints(),
            near_bridge_contracts: NearBridgeContracts::testnet(),
            token_registry: TokenRegistryConfig::default(),
            transfer_timeout_secs: 600,
            max_concurrent_transfers: 10,
            use_testnet: true,
        }
    }

    /// Get the endpoint for a chain.
    pub fn endpoint_for_chain(&self, chain: &BridgeChainId) -> Option<&BridgeEndpoint> {
        self.endpoints.get(chain.omni_chain_id())
    }
}

/// Endpoint configuration for a chain.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BridgeEndpoint {
    /// RPC URL for the chain.
    pub rpc_url: String,
    /// WebSocket URL (optional, for subscriptions).
    pub ws_url: Option<String>,
    /// Chain explorer URL.
    pub explorer_url: Option<String>,
    /// Bridge contract address on this chain.
    pub bridge_contract: Option<String>,
    /// Whether this endpoint is healthy.
    #[serde(default = "default_healthy")]
    pub healthy: bool,
}

fn default_healthy() -> bool {
    true
}

/// NEAR bridge contract addresses.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NearBridgeContracts {
    /// Omni bridge locker contract.
    pub omni_locker: String,
    /// Token factory contract.
    pub token_factory: String,
    /// Prover contract (for light client proofs).
    pub prover: String,
    /// Ethereum connector.
    pub eth_connector: String,
    /// Solana connector.
    pub sol_connector: Option<String>,
}

impl NearBridgeContracts {
    /// Mainnet contract addresses.
    pub fn mainnet() -> Self {
        Self {
            omni_locker: "omni-locker.near".to_string(),
            token_factory: "token-factory.bridge.near".to_string(),
            prover: "prover.bridge.near".to_string(),
            eth_connector: "aurora".to_string(),
            sol_connector: Some("solana-connector.bridge.near".to_string()),
        }
    }

    /// Testnet contract addresses.
    pub fn testnet() -> Self {
        Self {
            omni_locker: "omni-locker.testnet".to_string(),
            token_factory: "token-factory.testnet".to_string(),
            prover: "prover.testnet".to_string(),
            eth_connector: "aurora".to_string(),
            sol_connector: None,
        }
    }
}

/// Token registry configuration.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct TokenRegistryConfig {
    /// Custom token mappings (source token -> bridged token on NEAR).
    pub custom_tokens: HashMap<String, String>,
    /// Whitelisted tokens for bridging.
    pub whitelist: Vec<String>,
    /// Blacklisted tokens (not allowed to bridge).
    pub blacklist: Vec<String>,
}

/// Get default mainnet endpoints.
fn default_mainnet_endpoints() -> HashMap<String, BridgeEndpoint> {
    let mut endpoints = HashMap::new();

    endpoints.insert(
        "near".to_string(),
        BridgeEndpoint {
            rpc_url: "https://rpc.mainnet.near.org".to_string(),
            ws_url: Some("wss://ws.mainnet.near.org".to_string()),
            explorer_url: Some("https://nearblocks.io".to_string()),
            bridge_contract: Some("omni-locker.near".to_string()),
            healthy: true,
        },
    );

    endpoints.insert(
        "ethereum".to_string(),
        BridgeEndpoint {
            rpc_url: "https://eth.llamarpc.com".to_string(),
            ws_url: Some("wss://eth.llamarpc.com".to_string()),
            explorer_url: Some("https://etherscan.io".to_string()),
            bridge_contract: None, // Uses Omni Bridge factory
            healthy: true,
        },
    );

    endpoints.insert(
        "arbitrum".to_string(),
        BridgeEndpoint {
            rpc_url: "https://arb1.arbitrum.io/rpc".to_string(),
            ws_url: Some("wss://arb1.arbitrum.io/ws".to_string()),
            explorer_url: Some("https://arbiscan.io".to_string()),
            bridge_contract: None,
            healthy: true,
        },
    );

    endpoints.insert(
        "base".to_string(),
        BridgeEndpoint {
            rpc_url: "https://mainnet.base.org".to_string(),
            ws_url: Some("wss://mainnet.base.org".to_string()),
            explorer_url: Some("https://basescan.org".to_string()),
            bridge_contract: None,
            healthy: true,
        },
    );

    endpoints.insert(
        "solana".to_string(),
        BridgeEndpoint {
            rpc_url: "https://api.mainnet-beta.solana.com".to_string(),
            ws_url: Some("wss://api.mainnet-beta.solana.com".to_string()),
            explorer_url: Some("https://solscan.io".to_string()),
            bridge_contract: None,
            healthy: true,
        },
    );

    endpoints
}

/// Get default testnet endpoints.
fn default_testnet_endpoints() -> HashMap<String, BridgeEndpoint> {
    let mut endpoints = HashMap::new();

    endpoints.insert(
        "near-testnet".to_string(),
        BridgeEndpoint {
            rpc_url: "https://rpc.testnet.near.org".to_string(),
            ws_url: Some("wss://ws.testnet.near.org".to_string()),
            explorer_url: Some("https://testnet.nearblocks.io".to_string()),
            bridge_contract: Some("omni-locker.testnet".to_string()),
            healthy: true,
        },
    );

    endpoints.insert(
        "ethereum-sepolia".to_string(),
        BridgeEndpoint {
            rpc_url: "https://rpc.sepolia.org".to_string(),
            ws_url: None,
            explorer_url: Some("https://sepolia.etherscan.io".to_string()),
            bridge_contract: None,
            healthy: true,
        },
    );

    endpoints.insert(
        "arbitrum-sepolia".to_string(),
        BridgeEndpoint {
            rpc_url: "https://sepolia-rollup.arbitrum.io/rpc".to_string(),
            ws_url: None,
            explorer_url: Some("https://sepolia.arbiscan.io".to_string()),
            bridge_contract: None,
            healthy: true,
        },
    );

    endpoints.insert(
        "base-sepolia".to_string(),
        BridgeEndpoint {
            rpc_url: "https://sepolia.base.org".to_string(),
            ws_url: None,
            explorer_url: Some("https://sepolia.basescan.org".to_string()),
            bridge_contract: None,
            healthy: true,
        },
    );

    endpoints.insert(
        "solana-devnet".to_string(),
        BridgeEndpoint {
            rpc_url: "https://api.devnet.solana.com".to_string(),
            ws_url: Some("wss://api.devnet.solana.com".to_string()),
            explorer_url: Some("https://solscan.io/?cluster=devnet".to_string()),
            bridge_contract: None,
            healthy: true,
        },
    );

    endpoints
}

