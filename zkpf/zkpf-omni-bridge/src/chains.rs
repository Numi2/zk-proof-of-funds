//! Chain definitions and capabilities for Omni Bridge.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use crate::types::BridgeChainId;

/// Supported chain with metadata.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SupportedChain {
    /// Chain identifier.
    pub chain_id: BridgeChainId,
    /// Human-readable name.
    pub name: String,
    /// Short symbol (e.g., "ETH", "NEAR").
    pub symbol: String,
    /// Native currency symbol.
    pub native_currency: String,
    /// Native currency decimals.
    pub native_decimals: u8,
    /// Capabilities supported on this chain.
    pub capabilities: HashSet<ChainCapability>,
    /// Whether this chain is production-ready.
    pub production_ready: bool,
    /// Average block time in seconds.
    pub block_time_secs: f64,
    /// Finality time in seconds (approximate).
    pub finality_secs: u64,
}

/// Capabilities that a chain may support.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ChainCapability {
    /// Can lock native tokens.
    LockNative,
    /// Can lock ERC20/NEP-141/SPL tokens.
    LockTokens,
    /// Can mint bridged tokens.
    MintBridged,
    /// Can burn bridged tokens.
    BurnBridged,
    /// Supports Wormhole VAAs.
    WormholeVaa,
    /// Supports light client proofs.
    LightClientProof,
    /// Supports fast finality.
    FastFinality,
    /// Supports batched transfers.
    BatchedTransfers,
}

/// Chain configuration for bridge operations.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChainConfig {
    /// Chain details.
    pub chain: SupportedChain,
    /// RPC endpoint.
    pub rpc_url: String,
    /// Explorer URL.
    pub explorer_url: Option<String>,
    /// Bridge contract address (if applicable).
    pub bridge_contract: Option<String>,
    /// Gas price multiplier for this chain.
    pub gas_multiplier: f64,
    /// Maximum gas limit.
    pub max_gas: u64,
}

impl SupportedChain {
    /// Get all supported mainnet chains.
    pub fn mainnets() -> Vec<Self> {
        vec![
            Self::near_mainnet(),
            Self::ethereum_mainnet(),
            Self::arbitrum_one(),
            Self::base_mainnet(),
            Self::solana_mainnet(),
        ]
    }

    /// Get all supported testnet chains.
    pub fn testnets() -> Vec<Self> {
        vec![
            Self::near_testnet(),
            Self::ethereum_sepolia(),
            Self::arbitrum_sepolia(),
            Self::base_sepolia(),
            Self::solana_devnet(),
        ]
    }

    /// NEAR mainnet configuration.
    pub fn near_mainnet() -> Self {
        Self {
            chain_id: BridgeChainId::NearMainnet,
            name: "NEAR Protocol".to_string(),
            symbol: "NEAR".to_string(),
            native_currency: "NEAR".to_string(),
            native_decimals: 24,
            capabilities: [
                ChainCapability::LockNative,
                ChainCapability::LockTokens,
                ChainCapability::MintBridged,
                ChainCapability::BurnBridged,
                ChainCapability::LightClientProof,
                ChainCapability::FastFinality,
            ]
            .into_iter()
            .collect(),
            production_ready: true,
            block_time_secs: 1.0,
            finality_secs: 2,
        }
    }

    /// NEAR testnet configuration.
    pub fn near_testnet() -> Self {
        Self {
            chain_id: BridgeChainId::NearTestnet,
            name: "NEAR Testnet".to_string(),
            symbol: "NEAR".to_string(),
            native_currency: "NEAR".to_string(),
            native_decimals: 24,
            capabilities: Self::near_mainnet().capabilities,
            production_ready: false,
            block_time_secs: 1.0,
            finality_secs: 2,
        }
    }

    /// Ethereum mainnet configuration.
    pub fn ethereum_mainnet() -> Self {
        Self {
            chain_id: BridgeChainId::EthereumMainnet,
            name: "Ethereum".to_string(),
            symbol: "ETH".to_string(),
            native_currency: "ETH".to_string(),
            native_decimals: 18,
            capabilities: [
                ChainCapability::LockNative,
                ChainCapability::LockTokens,
                ChainCapability::MintBridged,
                ChainCapability::BurnBridged,
                ChainCapability::LightClientProof,
            ]
            .into_iter()
            .collect(),
            production_ready: true,
            block_time_secs: 12.0,
            finality_secs: 900, // ~15 minutes for finality
        }
    }

    /// Ethereum Sepolia testnet configuration.
    pub fn ethereum_sepolia() -> Self {
        Self {
            chain_id: BridgeChainId::EthereumSepolia,
            name: "Ethereum Sepolia".to_string(),
            symbol: "ETH".to_string(),
            native_currency: "ETH".to_string(),
            native_decimals: 18,
            capabilities: Self::ethereum_mainnet().capabilities.clone(),
            production_ready: false,
            block_time_secs: 12.0,
            finality_secs: 180,
        }
    }

    /// Arbitrum One mainnet configuration.
    pub fn arbitrum_one() -> Self {
        Self {
            chain_id: BridgeChainId::ArbitrumOne,
            name: "Arbitrum One".to_string(),
            symbol: "ARB".to_string(),
            native_currency: "ETH".to_string(),
            native_decimals: 18,
            capabilities: [
                ChainCapability::LockNative,
                ChainCapability::LockTokens,
                ChainCapability::MintBridged,
                ChainCapability::BurnBridged,
                ChainCapability::WormholeVaa,
                ChainCapability::FastFinality,
            ]
            .into_iter()
            .collect(),
            production_ready: true,
            block_time_secs: 0.25,
            finality_secs: 60,
        }
    }

    /// Arbitrum Sepolia testnet configuration.
    pub fn arbitrum_sepolia() -> Self {
        Self {
            chain_id: BridgeChainId::ArbitrumSepolia,
            name: "Arbitrum Sepolia".to_string(),
            symbol: "ARB".to_string(),
            native_currency: "ETH".to_string(),
            native_decimals: 18,
            capabilities: Self::arbitrum_one().capabilities.clone(),
            production_ready: false,
            block_time_secs: 0.25,
            finality_secs: 60,
        }
    }

    /// Base mainnet configuration.
    pub fn base_mainnet() -> Self {
        Self {
            chain_id: BridgeChainId::BaseMainnet,
            name: "Base".to_string(),
            symbol: "BASE".to_string(),
            native_currency: "ETH".to_string(),
            native_decimals: 18,
            capabilities: [
                ChainCapability::LockNative,
                ChainCapability::LockTokens,
                ChainCapability::MintBridged,
                ChainCapability::BurnBridged,
                ChainCapability::WormholeVaa,
                ChainCapability::FastFinality,
            ]
            .into_iter()
            .collect(),
            production_ready: true,
            block_time_secs: 2.0,
            finality_secs: 60,
        }
    }

    /// Base Sepolia testnet configuration.
    pub fn base_sepolia() -> Self {
        Self {
            chain_id: BridgeChainId::BaseSepolia,
            name: "Base Sepolia".to_string(),
            symbol: "BASE".to_string(),
            native_currency: "ETH".to_string(),
            native_decimals: 18,
            capabilities: Self::base_mainnet().capabilities.clone(),
            production_ready: false,
            block_time_secs: 2.0,
            finality_secs: 60,
        }
    }

    /// Solana mainnet configuration.
    pub fn solana_mainnet() -> Self {
        Self {
            chain_id: BridgeChainId::SolanaMainnet,
            name: "Solana".to_string(),
            symbol: "SOL".to_string(),
            native_currency: "SOL".to_string(),
            native_decimals: 9,
            capabilities: [
                ChainCapability::LockNative,
                ChainCapability::LockTokens,
                ChainCapability::MintBridged,
                ChainCapability::BurnBridged,
                ChainCapability::WormholeVaa,
                ChainCapability::FastFinality,
                ChainCapability::BatchedTransfers,
            ]
            .into_iter()
            .collect(),
            production_ready: true,
            block_time_secs: 0.4,
            finality_secs: 30,
        }
    }

    /// Solana devnet configuration.
    pub fn solana_devnet() -> Self {
        Self {
            chain_id: BridgeChainId::SolanaDevnet,
            name: "Solana Devnet".to_string(),
            symbol: "SOL".to_string(),
            native_currency: "SOL".to_string(),
            native_decimals: 9,
            capabilities: Self::solana_mainnet().capabilities.clone(),
            production_ready: false,
            block_time_secs: 0.4,
            finality_secs: 30,
        }
    }

    /// Check if the chain supports a capability.
    pub fn has_capability(&self, cap: &ChainCapability) -> bool {
        self.capabilities.contains(cap)
    }

    /// Get the chain by ID.
    pub fn by_id(chain_id: &BridgeChainId) -> Option<Self> {
        match chain_id {
            BridgeChainId::NearMainnet => Some(Self::near_mainnet()),
            BridgeChainId::NearTestnet => Some(Self::near_testnet()),
            BridgeChainId::EthereumMainnet => Some(Self::ethereum_mainnet()),
            BridgeChainId::EthereumSepolia => Some(Self::ethereum_sepolia()),
            BridgeChainId::ArbitrumOne => Some(Self::arbitrum_one()),
            BridgeChainId::ArbitrumSepolia => Some(Self::arbitrum_sepolia()),
            BridgeChainId::BaseMainnet => Some(Self::base_mainnet()),
            BridgeChainId::BaseSepolia => Some(Self::base_sepolia()),
            BridgeChainId::SolanaMainnet => Some(Self::solana_mainnet()),
            BridgeChainId::SolanaDevnet => Some(Self::solana_devnet()),
            BridgeChainId::Custom(_) => None,
        }
    }
}

