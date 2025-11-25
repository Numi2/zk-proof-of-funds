//! Axelar chain identifiers and configurations
//!
//! This module provides constants and utilities for working with
//! Axelar-supported chains.

use crate::{ChainSubscription, ChainType};

// ═══════════════════════════════════════════════════════════════════════════════
// EVM CHAIN IDENTIFIERS
// ═══════════════════════════════════════════════════════════════════════════════

/// Ethereum mainnet
pub const ETHEREUM: &str = "ethereum";
/// Ethereum Sepolia testnet
pub const ETHEREUM_SEPOLIA: &str = "ethereum-sepolia";
/// Arbitrum One
pub const ARBITRUM: &str = "arbitrum";
/// Optimism
pub const OPTIMISM: &str = "optimism";
/// Base
pub const BASE: &str = "base";
/// Polygon PoS
pub const POLYGON: &str = "polygon";
/// Avalanche C-Chain
pub const AVALANCHE: &str = "avalanche";
/// BNB Chain
pub const BINANCE: &str = "binance";
/// Fantom
pub const FANTOM: &str = "fantom";
/// Scroll
pub const SCROLL: &str = "scroll";
/// zkSync Era
pub const ZKSYNC: &str = "zksync";
/// Linea
pub const LINEA: &str = "linea";
/// Mantle
pub const MANTLE: &str = "mantle";
/// Blast
pub const BLAST: &str = "blast";

// ═══════════════════════════════════════════════════════════════════════════════
// COSMOS CHAIN IDENTIFIERS
// ═══════════════════════════════════════════════════════════════════════════════

/// Osmosis
pub const OSMOSIS: &str = "osmosis";
/// Neutron
pub const NEUTRON: &str = "neutron";
/// Sei
pub const SEI: &str = "sei";
/// Celestia
pub const CELESTIA: &str = "celestia";
/// Injective
pub const INJECTIVE: &str = "injective";
/// Axelar
pub const AXELAR: &str = "axelar";
/// Kava
pub const KAVA: &str = "kava";
/// Secret Network
pub const SECRET: &str = "secret";
/// Stargaze
pub const STARGAZE: &str = "stargaze";
/// Juno
pub const JUNO: &str = "juno";
/// Terra
pub const TERRA: &str = "terra";
/// dYdX
pub const DYDX: &str = "dydx";

// ═══════════════════════════════════════════════════════════════════════════════
// CHAIN INFO
// ═══════════════════════════════════════════════════════════════════════════════

/// Chain information structure
#[derive(Debug, Clone)]
pub struct ChainInfo {
    /// Axelar chain identifier
    pub chain_name: &'static str,
    /// Human-readable chain name
    pub display_name: &'static str,
    /// Chain ID (for EVM chains)
    pub chain_id: Option<u64>,
    /// Chain type
    pub chain_type: ChainType,
    /// Default gas limit for GMP calls
    pub default_gas: u64,
    /// Whether chain is production-ready
    pub production_ready: bool,
}

/// Get info for a known chain
pub fn get_chain_info(chain_name: &str) -> Option<ChainInfo> {
    match chain_name {
        // EVM chains
        ETHEREUM => Some(ChainInfo {
            chain_name: ETHEREUM,
            display_name: "Ethereum",
            chain_id: Some(1),
            chain_type: ChainType::Evm,
            default_gas: 200_000,
            production_ready: true,
        }),
        ETHEREUM_SEPOLIA => Some(ChainInfo {
            chain_name: ETHEREUM_SEPOLIA,
            display_name: "Ethereum Sepolia",
            chain_id: Some(11155111),
            chain_type: ChainType::Evm,
            default_gas: 200_000,
            production_ready: false,
        }),
        ARBITRUM => Some(ChainInfo {
            chain_name: ARBITRUM,
            display_name: "Arbitrum One",
            chain_id: Some(42161),
            chain_type: ChainType::Evm,
            default_gas: 1_000_000,
            production_ready: true,
        }),
        OPTIMISM => Some(ChainInfo {
            chain_name: OPTIMISM,
            display_name: "Optimism",
            chain_id: Some(10),
            chain_type: ChainType::Evm,
            default_gas: 500_000,
            production_ready: true,
        }),
        BASE => Some(ChainInfo {
            chain_name: BASE,
            display_name: "Base",
            chain_id: Some(8453),
            chain_type: ChainType::Evm,
            default_gas: 500_000,
            production_ready: true,
        }),
        POLYGON => Some(ChainInfo {
            chain_name: POLYGON,
            display_name: "Polygon",
            chain_id: Some(137),
            chain_type: ChainType::Evm,
            default_gas: 300_000,
            production_ready: true,
        }),
        AVALANCHE => Some(ChainInfo {
            chain_name: AVALANCHE,
            display_name: "Avalanche",
            chain_id: Some(43114),
            chain_type: ChainType::Evm,
            default_gas: 300_000,
            production_ready: true,
        }),
        SCROLL => Some(ChainInfo {
            chain_name: SCROLL,
            display_name: "Scroll",
            chain_id: Some(534352),
            chain_type: ChainType::Evm,
            default_gas: 500_000,
            production_ready: true,
        }),
        ZKSYNC => Some(ChainInfo {
            chain_name: ZKSYNC,
            display_name: "zkSync Era",
            chain_id: Some(324),
            chain_type: ChainType::Evm,
            default_gas: 1_000_000,
            production_ready: true,
        }),
        LINEA => Some(ChainInfo {
            chain_name: LINEA,
            display_name: "Linea",
            chain_id: Some(59144),
            chain_type: ChainType::Evm,
            default_gas: 500_000,
            production_ready: true,
        }),
        BLAST => Some(ChainInfo {
            chain_name: BLAST,
            display_name: "Blast",
            chain_id: Some(81457),
            chain_type: ChainType::Evm,
            default_gas: 500_000,
            production_ready: true,
        }),

        // Cosmos chains
        OSMOSIS => Some(ChainInfo {
            chain_name: OSMOSIS,
            display_name: "Osmosis",
            chain_id: None,
            chain_type: ChainType::Cosmos,
            default_gas: 500_000,
            production_ready: true,
        }),
        NEUTRON => Some(ChainInfo {
            chain_name: NEUTRON,
            display_name: "Neutron",
            chain_id: None,
            chain_type: ChainType::Cosmos,
            default_gas: 500_000,
            production_ready: true,
        }),
        SEI => Some(ChainInfo {
            chain_name: SEI,
            display_name: "Sei",
            chain_id: None,
            chain_type: ChainType::Cosmos,
            default_gas: 500_000,
            production_ready: true,
        }),
        INJECTIVE => Some(ChainInfo {
            chain_name: INJECTIVE,
            display_name: "Injective",
            chain_id: None,
            chain_type: ChainType::Cosmos,
            default_gas: 500_000,
            production_ready: true,
        }),
        CELESTIA => Some(ChainInfo {
            chain_name: CELESTIA,
            display_name: "Celestia",
            chain_id: None,
            chain_type: ChainType::Cosmos,
            default_gas: 500_000,
            production_ready: true,
        }),
        DYDX => Some(ChainInfo {
            chain_name: DYDX,
            display_name: "dYdX",
            chain_id: None,
            chain_type: ChainType::Cosmos,
            default_gas: 500_000,
            production_ready: true,
        }),

        _ => None,
    }
}

/// Get all known EVM chains
pub fn evm_chains() -> Vec<ChainInfo> {
    vec![
        ETHEREUM,
        ETHEREUM_SEPOLIA,
        ARBITRUM,
        OPTIMISM,
        BASE,
        POLYGON,
        AVALANCHE,
        SCROLL,
        ZKSYNC,
        LINEA,
        BLAST,
    ]
    .into_iter()
    .filter_map(get_chain_info)
    .collect()
}

/// Get all known Cosmos chains
pub fn cosmos_chains() -> Vec<ChainInfo> {
    vec![OSMOSIS, NEUTRON, SEI, INJECTIVE, CELESTIA, DYDX]
        .into_iter()
        .filter_map(get_chain_info)
        .collect()
}

/// Get all production-ready chains
pub fn production_chains() -> Vec<ChainInfo> {
    let mut chains = evm_chains();
    chains.extend(cosmos_chains());
    chains.into_iter().filter(|c| c.production_ready).collect()
}

/// Create a chain subscription from chain info
impl ChainInfo {
    /// Create a subscription configuration for this chain
    pub fn to_subscription(&self, receiver_contract: &str) -> ChainSubscription {
        ChainSubscription {
            chain_name: self.chain_name.to_string(),
            receiver_contract: receiver_contract.to_string(),
            active: true,
            default_gas: self.default_gas,
            chain_type: self.chain_type,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AXELAR CONTRACT ADDRESSES
// ═══════════════════════════════════════════════════════════════════════════════

/// Axelar Gateway contract addresses (mainnet)
pub mod gateway_addresses {
    /// Ethereum mainnet
    pub const ETHEREUM: &str = "0x4F4495243837681061C4743b74B3eEdf548D56A5";
    /// Arbitrum One
    pub const ARBITRUM: &str = "0xe432150cce91c13a887f7D836923d5597adD8E31";
    /// Optimism
    pub const OPTIMISM: &str = "0xe432150cce91c13a887f7D836923d5597adD8E31";
    /// Base
    pub const BASE: &str = "0xe432150cce91c13a887f7D836923d5597adD8E31";
    /// Polygon
    pub const POLYGON: &str = "0x6f015F16De9fC8791b234eF68D486d2bF203FBA8";
    /// Avalanche
    pub const AVALANCHE: &str = "0x5029C0EFf6C34351a0CEc334542cDb22c7928f78";
}

/// Axelar Gas Service contract addresses (mainnet)
pub mod gas_service_addresses {
    /// Ethereum mainnet
    pub const ETHEREUM: &str = "0x2d5d7d31F671F86C782533cc367F14109a082712";
    /// Arbitrum One
    pub const ARBITRUM: &str = "0x2d5d7d31F671F86C782533cc367F14109a082712";
    /// Optimism
    pub const OPTIMISM: &str = "0x2d5d7d31F671F86C782533cc367F14109a082712";
    /// Base
    pub const BASE: &str = "0x2d5d7d31F671F86C782533cc367F14109a082712";
    /// Polygon
    pub const POLYGON: &str = "0x2d5d7d31F671F86C782533cc367F14109a082712";
    /// Avalanche
    pub const AVALANCHE: &str = "0x2d5d7d31F671F86C782533cc367F14109a082712";
}

/// Get gateway address for a chain
pub fn get_gateway_address(chain_name: &str) -> Option<&'static str> {
    match chain_name {
        ETHEREUM => Some(gateway_addresses::ETHEREUM),
        ARBITRUM => Some(gateway_addresses::ARBITRUM),
        OPTIMISM => Some(gateway_addresses::OPTIMISM),
        BASE => Some(gateway_addresses::BASE),
        POLYGON => Some(gateway_addresses::POLYGON),
        AVALANCHE => Some(gateway_addresses::AVALANCHE),
        _ => None,
    }
}

/// Get gas service address for a chain
pub fn get_gas_service_address(chain_name: &str) -> Option<&'static str> {
    match chain_name {
        ETHEREUM => Some(gas_service_addresses::ETHEREUM),
        ARBITRUM => Some(gas_service_addresses::ARBITRUM),
        OPTIMISM => Some(gas_service_addresses::OPTIMISM),
        BASE => Some(gas_service_addresses::BASE),
        POLYGON => Some(gas_service_addresses::POLYGON),
        AVALANCHE => Some(gas_service_addresses::AVALANCHE),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chain_info() {
        let eth = get_chain_info(ETHEREUM).unwrap();
        assert_eq!(eth.chain_id, Some(1));
        assert_eq!(eth.chain_type, ChainType::Evm);
        assert!(eth.production_ready);

        let osmosis = get_chain_info(OSMOSIS).unwrap();
        assert_eq!(osmosis.chain_id, None);
        assert_eq!(osmosis.chain_type, ChainType::Cosmos);
    }

    #[test]
    fn test_chain_lists() {
        let evm = evm_chains();
        assert!(evm.iter().any(|c| c.chain_name == ETHEREUM));
        assert!(evm.iter().all(|c| c.chain_type == ChainType::Evm));

        let cosmos = cosmos_chains();
        assert!(cosmos.iter().any(|c| c.chain_name == OSMOSIS));
        assert!(cosmos.iter().all(|c| c.chain_type == ChainType::Cosmos));
    }

    #[test]
    fn test_gateway_addresses() {
        assert!(get_gateway_address(ETHEREUM).is_some());
        assert!(get_gateway_address("unknown").is_none());
    }
}

