//! DeFi position queries for Starknet protocols.
//!
//! This module provides protocol-specific queries for fetching DeFi positions
//! including LP tokens, lending positions, vault shares, and more.
//!
//! # Supported Protocols
//! - JediSwap: AMM LP tokens
//! - Nostra: Lending positions (supply/borrow)
//! - zkLend: Lending positions (deposits/collateral)
//! - Ekubo: Concentrated liquidity positions
//! - Haiko: Vault shares

#![cfg(feature = "starknet-rpc")]

use starknet::{
    core::types::{BlockId, BlockTag, FieldElement, FunctionCall},
    providers::{jsonrpc::HttpTransport, JsonRpcClient, Provider},
};
use std::sync::Arc;
use thiserror::Error;

use crate::{DefiPosition, PositionType};

/// Error type for DeFi queries.
#[derive(Debug, Error)]
pub enum DefiQueryError {
    #[error("rpc error: {0}")]
    Rpc(String),
    #[error("invalid address: {0}")]
    InvalidAddress(String),
    #[error("protocol not supported: {0}")]
    UnsupportedProtocol(String),
    #[error("parse error: {0}")]
    ParseError(String),
}

/// Trait for protocol-specific DeFi queries.
pub trait DefiPositionQuery: Send + Sync {
    /// Get all positions for an account in this protocol.
    fn get_positions(
        &self,
        provider: Arc<JsonRpcClient<HttpTransport>>,
        account_address: &str,
    ) -> impl std::future::Future<Output = Result<Vec<DefiPosition>, DefiQueryError>> + Send;
    
    /// Protocol name.
    fn protocol_name(&self) -> &'static str;
}

/// Represents a DeFi protocol with its contract addresses and query logic.
pub struct DefiProtocol {
    pub name: String,
    pub router_address: Option<String>,
    pub factory_address: Option<String>,
    pub pool_addresses: Vec<String>,
}

// ============================================================================
// JediSwap AMM
// ============================================================================

/// JediSwap LP token query.
pub struct JediSwapQuery {
    /// Factory contract address.
    pub factory_address: String,
    /// Known pair addresses to check.
    pub pair_addresses: Vec<String>,
}

impl JediSwapQuery {
    /// Create a new JediSwap query with mainnet addresses.
    pub fn mainnet() -> Self {
        Self {
            factory_address: "0x00dad44c139a476c7a17fc8141e6db680e9abc9f56fe249a105094c44382c2fd".to_string(),
            pair_addresses: vec![
                // ETH/USDC pair
                "0x04d0390b777b424e43839cd1e744799f3de6c176c7e32c1812a41dbd9c19db6a".to_string(),
                // ETH/USDT pair  
                "0x045e7131d776dddc137e30bdd490b431c7144677e97bf9369f629ed8d3fb7dd6".to_string(),
                // ETH/DAI pair
                "0x07e2a13b40fc1119ec55e0bcf9428eedaa581ab3c924561ad4e955f95da63138".to_string(),
            ],
        }
    }
    
    /// Create a new JediSwap query with sepolia addresses.
    pub fn sepolia() -> Self {
        Self {
            factory_address: "0x050d3df81b920d3e608c4f7aeb67945a830413f618a1cf486bdcce66a395109c".to_string(),
            pair_addresses: vec![],
        }
    }
}

impl DefiPositionQuery for JediSwapQuery {
    async fn get_positions(
        &self,
        provider: Arc<JsonRpcClient<HttpTransport>>,
        account_address: &str,
    ) -> Result<Vec<DefiPosition>, DefiQueryError> {
        let mut positions = vec![];
        let account = parse_felt(account_address)?;
        
        // balanceOf selector
        let balance_selector = FieldElement::from_hex_be(
            "0x02e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e"
        ).unwrap();
        
        for pair_addr in &self.pair_addresses {
            let pair = parse_felt(pair_addr)?;
            
            // Check LP token balance
            let result = provider.call(
                FunctionCall {
                    contract_address: pair,
                    entry_point_selector: balance_selector,
                    calldata: vec![account],
                },
                BlockId::Tag(BlockTag::Latest),
            ).await;
            
            if let Ok(res) = result {
                if res.len() >= 2 {
                    let balance = felt_pair_to_u128(&res[0], &res[1]);
                    if balance > 0 {
                        positions.push(DefiPosition {
                            protocol: "JediSwap".to_string(),
                            position_type: PositionType::LiquidityPool,
                            contract_address: pair_addr.clone(),
                            value: balance,
                            usd_value: None, // Would need reserve calculations
                        });
                    }
                }
            }
        }
        
        Ok(positions)
    }
    
    fn protocol_name(&self) -> &'static str {
        "JediSwap"
    }
}

// ============================================================================
// Nostra Lending
// ============================================================================

/// Nostra lending protocol query.
pub struct NostraQuery {
    /// Lending market addresses.
    pub market_addresses: Vec<NostraMarket>,
}

/// A Nostra lending market.
pub struct NostraMarket {
    pub name: String,
    pub address: String,
    pub underlying_token: String,
}

impl NostraQuery {
    /// Create with mainnet addresses.
    pub fn mainnet() -> Self {
        Self {
            market_addresses: vec![
                NostraMarket {
                    name: "ETH".to_string(),
                    address: "0x04f89253e37ca0ab7190b2e9565808f105585c9cacca6b2fa6145f055e5b4c4d".to_string(),
                    underlying_token: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7".to_string(),
                },
                NostraMarket {
                    name: "USDC".to_string(),
                    address: "0x05327df4c669cb9be5c1e2cf79e121edef43c1416c8e6db98b56f3c5e4aa2c9e".to_string(),
                    underlying_token: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8".to_string(),
                },
                NostraMarket {
                    name: "USDT".to_string(),
                    address: "0x0360f9786a6595137f84f2d6931aaec09ceec476a94a98dcad2bb092c6c06701".to_string(),
                    underlying_token: "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8".to_string(),
                },
            ],
        }
    }
    
    /// Create with sepolia addresses.
    pub fn sepolia() -> Self {
        Self {
            market_addresses: vec![],
        }
    }
}

impl DefiPositionQuery for NostraQuery {
    async fn get_positions(
        &self,
        provider: Arc<JsonRpcClient<HttpTransport>>,
        account_address: &str,
    ) -> Result<Vec<DefiPosition>, DefiQueryError> {
        let mut positions = vec![];
        let account = parse_felt(account_address)?;
        
        // balanceOf selector for nTokens (supply tokens)
        let balance_selector = FieldElement::from_hex_be(
            "0x02e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e"
        ).unwrap();
        
        for market in &self.market_addresses {
            let market_addr = parse_felt(&market.address)?;
            
            // Check supply token balance
            let result = provider.call(
                FunctionCall {
                    contract_address: market_addr,
                    entry_point_selector: balance_selector,
                    calldata: vec![account],
                },
                BlockId::Tag(BlockTag::Latest),
            ).await;
            
            if let Ok(res) = result {
                if res.len() >= 2 {
                    let balance = felt_pair_to_u128(&res[0], &res[1]);
                    if balance > 0 {
                        positions.push(DefiPosition {
                            protocol: "Nostra".to_string(),
                            position_type: PositionType::Lending,
                            contract_address: market.address.clone(),
                            value: balance,
                            usd_value: None,
                        });
                    }
                }
            }
        }
        
        Ok(positions)
    }
    
    fn protocol_name(&self) -> &'static str {
        "Nostra"
    }
}

// ============================================================================
// zkLend
// ============================================================================

/// zkLend lending protocol query.
pub struct ZkLendQuery {
    /// Market contract address.
    pub market_address: String,
    /// zToken addresses to check.
    pub z_tokens: Vec<ZkLendToken>,
}

/// A zkLend z-token representing a deposit.
pub struct ZkLendToken {
    pub symbol: String,
    pub z_token_address: String,
    pub underlying_address: String,
}

impl ZkLendQuery {
    /// Create with mainnet addresses.
    pub fn mainnet() -> Self {
        Self {
            market_address: "0x04c0a5193d58f74fbace4b74dcf65481e734ed1714121bdc571da345540efa05".to_string(),
            z_tokens: vec![
                ZkLendToken {
                    symbol: "zETH".to_string(),
                    z_token_address: "0x01b5bd713e72fdc5d63ffd83762f81297f6175a5e0a4771cdadbc1dd5fe72cb1".to_string(),
                    underlying_address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7".to_string(),
                },
                ZkLendToken {
                    symbol: "zUSDC".to_string(),
                    z_token_address: "0x047ad51726d891f972e74e4ad858a261b43869f7126ce7436ee0b2529a98f486".to_string(),
                    underlying_address: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8".to_string(),
                },
                ZkLendToken {
                    symbol: "zUSDT".to_string(),
                    z_token_address: "0x00811d8da5dc8a2206ea7fd0b28627c2d77280a515126e62baa4d78e22714c4a".to_string(),
                    underlying_address: "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8".to_string(),
                },
                ZkLendToken {
                    symbol: "zWBTC".to_string(),
                    z_token_address: "0x02b9ea3acdb23da566cee8e8beae3c56a96ea8b29c84e91f39e5f2defc2f59a3".to_string(),
                    underlying_address: "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac".to_string(),
                },
            ],
        }
    }
    
    /// Create with sepolia addresses.
    pub fn sepolia() -> Self {
        Self {
            market_address: "0x04c0a5193d58f74fbace4b74dcf65481e734ed1714121bdc571da345540efa05".to_string(),
            z_tokens: vec![],
        }
    }
}

impl DefiPositionQuery for ZkLendQuery {
    async fn get_positions(
        &self,
        provider: Arc<JsonRpcClient<HttpTransport>>,
        account_address: &str,
    ) -> Result<Vec<DefiPosition>, DefiQueryError> {
        let mut positions = vec![];
        let account = parse_felt(account_address)?;
        
        // balanceOf selector
        let balance_selector = FieldElement::from_hex_be(
            "0x02e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e"
        ).unwrap();
        
        for z_token in &self.z_tokens {
            let token_addr = parse_felt(&z_token.z_token_address)?;
            
            let result = provider.call(
                FunctionCall {
                    contract_address: token_addr,
                    entry_point_selector: balance_selector,
                    calldata: vec![account],
                },
                BlockId::Tag(BlockTag::Latest),
            ).await;
            
            if let Ok(res) = result {
                if res.len() >= 2 {
                    let balance = felt_pair_to_u128(&res[0], &res[1]);
                    if balance > 0 {
                        positions.push(DefiPosition {
                            protocol: "zkLend".to_string(),
                            position_type: PositionType::Lending,
                            contract_address: z_token.z_token_address.clone(),
                            value: balance,
                            usd_value: None,
                        });
                    }
                }
            }
        }
        
        Ok(positions)
    }
    
    fn protocol_name(&self) -> &'static str {
        "zkLend"
    }
}

// ============================================================================
// Ekubo Concentrated Liquidity
// ============================================================================

/// Ekubo concentrated liquidity AMM query.
pub struct EkuboQuery {
    /// Core contract address.
    pub core_address: String,
    /// Positions contract address.
    pub positions_address: String,
}

impl EkuboQuery {
    /// Create with mainnet addresses.
    pub fn mainnet() -> Self {
        Self {
            core_address: "0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b".to_string(),
            positions_address: "0x02e0af29598b407c8716b17f6d2795eca1b471413fa03fb145a5e33722184067".to_string(),
        }
    }
    
    /// Create with sepolia addresses.
    pub fn sepolia() -> Self {
        Self {
            core_address: "0x00000005dd3d2f4429af886cd1a3b08289dbcea99a294197e9eb43b0e0325b4b".to_string(),
            positions_address: "0x0".to_string(),
        }
    }
}

impl DefiPositionQuery for EkuboQuery {
    async fn get_positions(
        &self,
        provider: Arc<JsonRpcClient<HttpTransport>>,
        account_address: &str,
    ) -> Result<Vec<DefiPosition>, DefiQueryError> {
        let mut positions = vec![];
        
        // Ekubo uses NFT-style positions
        // We need to query the positions contract for NFTs owned by the account
        let account = parse_felt(account_address)?;
        let positions_addr = parse_felt(&self.positions_address)?;
        
        // balanceOf selector (ERC721)
        let balance_of_selector = FieldElement::from_hex_be(
            "0x02e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e"
        ).unwrap();
        
        let result = provider.call(
            FunctionCall {
                contract_address: positions_addr,
                entry_point_selector: balance_of_selector,
                calldata: vec![account],
            },
            BlockId::Tag(BlockTag::Latest),
        ).await;
        
        if let Ok(res) = result {
            if !res.is_empty() {
                let num_positions = felt_to_u64(&res[0]);
                if num_positions > 0 {
                    // Note: Getting actual position values requires iterating through
                    // tokenOfOwnerByIndex and then querying each position's liquidity.
                    // For now, we just record that positions exist.
                    positions.push(DefiPosition {
                        protocol: "Ekubo".to_string(),
                        position_type: PositionType::LiquidityPool,
                        contract_address: self.positions_address.clone(),
                        value: num_positions as u128, // Placeholder - should be actual liquidity value
                        usd_value: None,
                    });
                }
            }
        }
        
        Ok(positions)
    }
    
    fn protocol_name(&self) -> &'static str {
        "Ekubo"
    }
}

// ============================================================================
// Haiko Vaults
// ============================================================================

/// Haiko vault protocol query.
pub struct HaikoQuery {
    /// Known vault addresses.
    pub vault_addresses: Vec<String>,
}

impl HaikoQuery {
    /// Create with mainnet addresses.
    pub fn mainnet() -> Self {
        Self {
            vault_addresses: vec![
                // Add known Haiko vault addresses here
            ],
        }
    }
    
    /// Create with sepolia addresses.
    pub fn sepolia() -> Self {
        Self {
            vault_addresses: vec![],
        }
    }
}

impl DefiPositionQuery for HaikoQuery {
    async fn get_positions(
        &self,
        provider: Arc<JsonRpcClient<HttpTransport>>,
        account_address: &str,
    ) -> Result<Vec<DefiPosition>, DefiQueryError> {
        let mut positions = vec![];
        let account = parse_felt(account_address)?;
        
        // balanceOf selector for vault shares
        let balance_selector = FieldElement::from_hex_be(
            "0x02e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e"
        ).unwrap();
        
        for vault_addr in &self.vault_addresses {
            let vault = parse_felt(vault_addr)?;
            
            let result = provider.call(
                FunctionCall {
                    contract_address: vault,
                    entry_point_selector: balance_selector,
                    calldata: vec![account],
                },
                BlockId::Tag(BlockTag::Latest),
            ).await;
            
            if let Ok(res) = result {
                if res.len() >= 2 {
                    let balance = felt_pair_to_u128(&res[0], &res[1]);
                    if balance > 0 {
                        positions.push(DefiPosition {
                            protocol: "Haiko".to_string(),
                            position_type: PositionType::Vault,
                            contract_address: vault_addr.clone(),
                            value: balance,
                            usd_value: None,
                        });
                    }
                }
            }
        }
        
        Ok(positions)
    }
    
    fn protocol_name(&self) -> &'static str {
        "Haiko"
    }
}

// ============================================================================
// Helper functions
// ============================================================================

/// Parse a hex string to FieldElement.
fn parse_felt(hex_str: &str) -> Result<FieldElement, DefiQueryError> {
    FieldElement::from_hex_be(hex_str)
        .map_err(|e| DefiQueryError::InvalidAddress(format!("{}: {}", hex_str, e)))
}

/// Convert a felt pair (low, high) to u128.
fn felt_pair_to_u128(low: &FieldElement, high: &FieldElement) -> u128 {
    let low_bytes = low.to_bytes_be();
    let high_bytes = high.to_bytes_be();
    
    // Take last 16 bytes for low
    let mut low_buf = [0u8; 16];
    low_buf.copy_from_slice(&low_bytes[16..32]);
    let low_val = u128::from_be_bytes(low_buf);
    
    // Take last 16 bytes for high
    let mut high_buf = [0u8; 16];
    high_buf.copy_from_slice(&high_bytes[16..32]);
    let high_val = u128::from_be_bytes(high_buf);
    
    if high_val > 0 {
        // Overflow, return max
        u128::MAX
    } else {
        low_val
    }
}

/// Convert a single felt to u64.
fn felt_to_u64(felt: &FieldElement) -> u64 {
    let bytes = felt.to_bytes_be();
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&bytes[24..32]);
    u64::from_be_bytes(buf)
}

/// Aggregate DeFi query that combines all supported protocols.
pub struct AggregatedDefiQuery {
    pub jediswap: JediSwapQuery,
    pub nostra: NostraQuery,
    pub zklend: ZkLendQuery,
    pub ekubo: EkuboQuery,
    pub haiko: HaikoQuery,
}

impl AggregatedDefiQuery {
    /// Create an aggregated query for mainnet.
    pub fn mainnet() -> Self {
        Self {
            jediswap: JediSwapQuery::mainnet(),
            nostra: NostraQuery::mainnet(),
            zklend: ZkLendQuery::mainnet(),
            ekubo: EkuboQuery::mainnet(),
            haiko: HaikoQuery::mainnet(),
        }
    }
    
    /// Create an aggregated query for sepolia.
    pub fn sepolia() -> Self {
        Self {
            jediswap: JediSwapQuery::sepolia(),
            nostra: NostraQuery::sepolia(),
            zklend: ZkLendQuery::sepolia(),
            ekubo: EkuboQuery::sepolia(),
            haiko: HaikoQuery::sepolia(),
        }
    }
    
    /// Get all DeFi positions for an account across all protocols.
    pub async fn get_all_positions(
        &self,
        provider: Arc<JsonRpcClient<HttpTransport>>,
        account_address: &str,
    ) -> Result<Vec<DefiPosition>, DefiQueryError> {
        let mut all_positions = vec![];
        
        // Query each protocol (could be parallelized with tokio::join!)
        if let Ok(positions) = self.jediswap.get_positions(provider.clone(), account_address).await {
            all_positions.extend(positions);
        }
        
        if let Ok(positions) = self.nostra.get_positions(provider.clone(), account_address).await {
            all_positions.extend(positions);
        }
        
        if let Ok(positions) = self.zklend.get_positions(provider.clone(), account_address).await {
            all_positions.extend(positions);
        }
        
        if let Ok(positions) = self.ekubo.get_positions(provider.clone(), account_address).await {
            all_positions.extend(positions);
        }
        
        if let Ok(positions) = self.haiko.get_positions(provider.clone(), account_address).await {
            all_positions.extend(positions);
        }
        
        Ok(all_positions)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_felt() {
        let felt = parse_felt("0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7");
        assert!(felt.is_ok());
    }
    
    #[test]
    fn test_felt_pair_to_u128() {
        let low = FieldElement::from(1000u64);
        let high = FieldElement::ZERO;
        let result = felt_pair_to_u128(&low, &high);
        assert_eq!(result, 1000);
    }
    
    #[test]
    fn test_aggregated_query_mainnet() {
        let query = AggregatedDefiQuery::mainnet();
        assert!(!query.jediswap.pair_addresses.is_empty());
        assert!(!query.nostra.market_addresses.is_empty());
        assert!(!query.zklend.z_tokens.is_empty());
    }
}

