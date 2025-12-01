//! Token definitions and registry for Omni Bridge.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::error::OmniBridgeError;
use crate::types::{BridgeAsset, BridgeChainId};

/// Information about a bridgeable token.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TokenInfo {
    /// Token symbol.
    pub symbol: String,
    /// Token name.
    pub name: String,
    /// Decimal places.
    pub decimals: u8,
    /// Logo URL (optional).
    pub logo_url: Option<String>,
    /// Coingecko ID for price data (optional).
    pub coingecko_id: Option<String>,
    /// Whether this is a stablecoin.
    pub is_stablecoin: bool,
    /// Addresses on each chain.
    pub chain_addresses: HashMap<String, String>,
}

impl TokenInfo {
    /// Get the address for a specific chain.
    pub fn address_on_chain(&self, chain: &BridgeChainId) -> Option<&str> {
        self.chain_addresses
            .get(chain.omni_chain_id())
            .map(|s| s.as_str())
    }

    /// Check if the token is available on a chain.
    pub fn available_on(&self, chain: &BridgeChainId) -> bool {
        self.chain_addresses.contains_key(chain.omni_chain_id())
    }
}

/// A bridged token representation.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BridgedToken {
    /// Original token info.
    pub original: TokenInfo,
    /// Origin chain where the token was first created.
    pub origin_chain: BridgeChainId,
    /// Bridged representations on other chains.
    pub bridged_addresses: HashMap<String, BridgedTokenAddress>,
}

/// Address of a bridged token on a specific chain.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BridgedTokenAddress {
    /// Token contract address.
    pub address: String,
    /// Whether this is the canonical bridged version.
    pub is_canonical: bool,
    /// Deployment timestamp.
    pub deployed_at: Option<u64>,
    /// Total bridged supply.
    pub bridged_supply: Option<u128>,
}

/// Token registry for managing bridgeable tokens.
#[derive(Clone, Debug, Default)]
pub struct TokenRegistry {
    /// Registered tokens by symbol.
    tokens: HashMap<String, TokenInfo>,
    /// Bridged token mappings.
    bridged: HashMap<String, BridgedToken>,
}

impl TokenRegistry {
    /// Create a new token registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a registry with common tokens pre-loaded.
    pub fn with_common_tokens() -> Self {
        let mut registry = Self::new();
        registry.register_common_tokens();
        registry
    }

    /// Register common bridgeable tokens.
    pub fn register_common_tokens(&mut self) {
        // USDC
        self.register(TokenInfo {
            symbol: "USDC".to_string(),
            name: "USD Coin".to_string(),
            decimals: 6,
            logo_url: Some("https://cryptologos.cc/logos/usd-coin-usdc-logo.png".to_string()),
            coingecko_id: Some("usd-coin".to_string()),
            is_stablecoin: true,
            chain_addresses: [
                ("ethereum".to_string(), "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48".to_string()),
                ("arbitrum".to_string(), "0xaf88d065e77c8cC2239327C5EDb3A432268e5831".to_string()),
                ("base".to_string(), "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".to_string()),
                ("solana".to_string(), "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".to_string()),
                ("near".to_string(), "usdc.near".to_string()),
            ].into_iter().collect(),
        });

        // USDT
        self.register(TokenInfo {
            symbol: "USDT".to_string(),
            name: "Tether USD".to_string(),
            decimals: 6,
            logo_url: Some("https://cryptologos.cc/logos/tether-usdt-logo.png".to_string()),
            coingecko_id: Some("tether".to_string()),
            is_stablecoin: true,
            chain_addresses: [
                ("ethereum".to_string(), "0xdAC17F958D2ee523a2206206994597C13D831ec7".to_string()),
                ("arbitrum".to_string(), "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9".to_string()),
                ("solana".to_string(), "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB".to_string()),
                ("near".to_string(), "usdt.tether-token.near".to_string()),
            ].into_iter().collect(),
        });

        // wETH (Wrapped Ethereum)
        self.register(TokenInfo {
            symbol: "WETH".to_string(),
            name: "Wrapped Ether".to_string(),
            decimals: 18,
            logo_url: Some("https://cryptologos.cc/logos/ethereum-eth-logo.png".to_string()),
            coingecko_id: Some("weth".to_string()),
            is_stablecoin: false,
            chain_addresses: [
                ("ethereum".to_string(), "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2".to_string()),
                ("arbitrum".to_string(), "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1".to_string()),
                ("base".to_string(), "0x4200000000000000000000000000000000000006".to_string()),
                ("near".to_string(), "aurora".to_string()),
            ].into_iter().collect(),
        });

        // wBTC (Wrapped Bitcoin)
        self.register(TokenInfo {
            symbol: "WBTC".to_string(),
            name: "Wrapped Bitcoin".to_string(),
            decimals: 8,
            logo_url: Some("https://cryptologos.cc/logos/wrapped-bitcoin-wbtc-logo.png".to_string()),
            coingecko_id: Some("wrapped-bitcoin".to_string()),
            is_stablecoin: false,
            chain_addresses: [
                ("ethereum".to_string(), "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599".to_string()),
                ("arbitrum".to_string(), "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f".to_string()),
                ("solana".to_string(), "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh".to_string()),
            ].into_iter().collect(),
        });

        // NEAR token
        self.register(TokenInfo {
            symbol: "NEAR".to_string(),
            name: "NEAR Protocol".to_string(),
            decimals: 24,
            logo_url: Some("https://cryptologos.cc/logos/near-protocol-near-logo.png".to_string()),
            coingecko_id: Some("near".to_string()),
            is_stablecoin: false,
            chain_addresses: [
                ("near".to_string(), "wrap.near".to_string()),
                ("ethereum".to_string(), "0x85F17Cf997934a597031b2E18a9aB6ebD4B9f6a4".to_string()),
            ].into_iter().collect(),
        });

        // DAI
        self.register(TokenInfo {
            symbol: "DAI".to_string(),
            name: "Dai Stablecoin".to_string(),
            decimals: 18,
            logo_url: Some("https://cryptologos.cc/logos/multi-collateral-dai-dai-logo.png".to_string()),
            coingecko_id: Some("dai".to_string()),
            is_stablecoin: true,
            chain_addresses: [
                ("ethereum".to_string(), "0x6B175474E89094C44Da98b954EesIdHe36B4F7B8".to_string()),
                ("arbitrum".to_string(), "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1".to_string()),
                ("base".to_string(), "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb".to_string()),
                ("near".to_string(), "dai.near".to_string()),
            ].into_iter().collect(),
        });
    }

    /// Register a token.
    pub fn register(&mut self, token: TokenInfo) {
        self.tokens.insert(token.symbol.clone(), token);
    }

    /// Get a token by symbol.
    pub fn get(&self, symbol: &str) -> Option<&TokenInfo> {
        self.tokens.get(symbol)
    }

    /// Get all registered tokens.
    pub fn all(&self) -> impl Iterator<Item = &TokenInfo> {
        self.tokens.values()
    }

    /// Get tokens available on a specific chain.
    pub fn tokens_on_chain(&self, chain: &BridgeChainId) -> Vec<&TokenInfo> {
        self.tokens
            .values()
            .filter(|t| t.available_on(chain))
            .collect()
    }

    /// Check if a token can be bridged between two chains.
    pub fn can_bridge(
        &self,
        symbol: &str,
        from: &BridgeChainId,
        to: &BridgeChainId,
    ) -> Result<bool, OmniBridgeError> {
        let token = self.get(symbol).ok_or_else(|| {
            OmniBridgeError::TokenNotBridgeable(format!("Token {} not registered", symbol))
        })?;

        Ok(token.available_on(from) && token.available_on(to))
    }

    /// Get the BridgeAsset for a token on a specific chain.
    pub fn as_bridge_asset(
        &self,
        symbol: &str,
        chain: &BridgeChainId,
    ) -> Result<BridgeAsset, OmniBridgeError> {
        let token = self.get(symbol).ok_or_else(|| {
            OmniBridgeError::TokenNotBridgeable(format!("Token {} not registered", symbol))
        })?;

        let address = token.address_on_chain(chain).ok_or_else(|| {
            OmniBridgeError::TokenNotBridgeable(format!(
                "Token {} not available on {}",
                symbol, chain
            ))
        })?;

        match chain {
            BridgeChainId::NearMainnet | BridgeChainId::NearTestnet => {
                Ok(BridgeAsset::Nep141 {
                    account_id: address.to_string(),
                    symbol: token.symbol.clone(),
                    decimals: token.decimals,
                })
            }
            BridgeChainId::SolanaMainnet | BridgeChainId::SolanaDevnet => {
                Ok(BridgeAsset::Spl {
                    mint: address.to_string(),
                    symbol: token.symbol.clone(),
                    decimals: token.decimals,
                })
            }
            _ if chain.is_evm() => {
                Ok(BridgeAsset::Erc20 {
                    address: address.to_string(),
                    symbol: token.symbol.clone(),
                    decimals: token.decimals,
                })
            }
            _ => Err(OmniBridgeError::UnsupportedChain(chain.to_string())),
        }
    }
}

