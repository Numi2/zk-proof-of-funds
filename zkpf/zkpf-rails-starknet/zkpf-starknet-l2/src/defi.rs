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
// Carmine Options Protocol
// ============================================================================

/// Carmine options protocol query.
pub struct CarmineQuery {
    /// AMM contract address.
    pub amm_address: String,
    /// Known option pools.
    pub option_pools: Vec<CarmineOptionPool>,
}

/// A Carmine option pool.
pub struct CarmineOptionPool {
    pub name: String,
    pub lp_token_address: String,
    pub underlying_asset: String,
    pub quote_asset: String,
    pub is_call: bool,
}

impl CarmineQuery {
    /// Create with mainnet addresses.
    pub fn mainnet() -> Self {
        Self {
            amm_address: "0x047472e6755afc57ada9550b6a3ac93129cc4b5f98f51c73e0644d129fd208d9".to_string(),
            option_pools: vec![
                CarmineOptionPool {
                    name: "ETH/USDC Call".to_string(),
                    lp_token_address: "0x7aba50fdb4a0779c22aba8a19f1e1bb0db4e1a6e6f8f7c0ee1b9b0e1b5f1c8d".to_string(),
                    underlying_asset: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7".to_string(),
                    quote_asset: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8".to_string(),
                    is_call: true,
                },
                CarmineOptionPool {
                    name: "ETH/USDC Put".to_string(),
                    lp_token_address: "0x6aba50fdb4a0779c22aba8a19f1e1bb0db4e1a6e6f8f7c0ee1b9b0e1b5f1c8e".to_string(),
                    underlying_asset: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7".to_string(),
                    quote_asset: "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8".to_string(),
                    is_call: false,
                },
            ],
        }
    }
    
    /// Create with sepolia addresses.
    pub fn sepolia() -> Self {
        Self {
            amm_address: "0x0".to_string(),
            option_pools: vec![],
        }
    }
}

impl DefiPositionQuery for CarmineQuery {
    async fn get_positions(
        &self,
        provider: Arc<JsonRpcClient<HttpTransport>>,
        account_address: &str,
    ) -> Result<Vec<DefiPosition>, DefiQueryError> {
        let mut positions = vec![];
        let account = parse_felt(account_address)?;
        
        // balanceOf selector for LP tokens
        let balance_selector = FieldElement::from_hex_be(
            "0x02e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e"
        ).unwrap();
        
        for pool in &self.option_pools {
            let lp_token = parse_felt(&pool.lp_token_address)?;
            
            let result = provider.call(
                FunctionCall {
                    contract_address: lp_token,
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
                            protocol: "Carmine".to_string(),
                            position_type: PositionType::Other, // Options
                            contract_address: pool.lp_token_address.clone(),
                            value: balance,
                            usd_value: None, // Would need options pricing model
                        });
                    }
                }
            }
        }
        
        Ok(positions)
    }
    
    fn protocol_name(&self) -> &'static str {
        "Carmine"
    }
}

// ============================================================================
// Price Oracle Integration
// ============================================================================

/// Pragma Oracle integration for price feeds.
pub struct PragmaOracle {
    /// Oracle contract address.
    pub oracle_address: String,
    /// Asset pair IDs for price lookups.
    pub price_feeds: Vec<PriceFeed>,
}

/// A price feed configuration.
#[derive(Clone, Debug)]
pub struct PriceFeed {
    pub asset_symbol: String,
    pub pair_id: String,
    pub decimals: u8,
}

impl PragmaOracle {
    /// Create with mainnet Pragma oracle addresses.
    pub fn mainnet() -> Self {
        Self {
            oracle_address: "0x2a85bd616f912537c50a49a4076db02c00b29b2cdc8a197ce92ed1837fa875b".to_string(),
            price_feeds: vec![
                PriceFeed {
                    asset_symbol: "ETH".to_string(),
                    pair_id: "ETH/USD".to_string(),
                    decimals: 8,
                },
                PriceFeed {
                    asset_symbol: "STRK".to_string(),
                    pair_id: "STRK/USD".to_string(),
                    decimals: 8,
                },
                PriceFeed {
                    asset_symbol: "BTC".to_string(),
                    pair_id: "BTC/USD".to_string(),
                    decimals: 8,
                },
                PriceFeed {
                    asset_symbol: "WBTC".to_string(),
                    pair_id: "WBTC/USD".to_string(),
                    decimals: 8,
                },
            ],
        }
    }
    
    /// Create with sepolia addresses.
    pub fn sepolia() -> Self {
        Self {
            oracle_address: "0x36031daa264c24520b11d93af622c848b2499b66b41d611bac95e13cfca131a".to_string(),
            price_feeds: vec![
                PriceFeed {
                    asset_symbol: "ETH".to_string(),
                    pair_id: "ETH/USD".to_string(),
                    decimals: 8,
                },
                PriceFeed {
                    asset_symbol: "STRK".to_string(),
                    pair_id: "STRK/USD".to_string(),
                    decimals: 8,
                },
            ],
        }
    }
    
    /// Get price for an asset in USD (returns price * 10^decimals).
    pub async fn get_price(
        &self,
        provider: Arc<JsonRpcClient<HttpTransport>>,
        asset_symbol: &str,
    ) -> Result<Option<PriceData>, DefiQueryError> {
        let feed = self.price_feeds.iter().find(|f| f.asset_symbol == asset_symbol);
        let feed = match feed {
            Some(f) => f,
            None => return Ok(None),
        };
        
        let oracle = parse_felt(&self.oracle_address)?;
        
        // get_data_median selector for Pragma v2
        let get_data_selector = FieldElement::from_hex_be(
            "0x1d4a170ca8b92eb6e1acd77cda9abf2bc86e3c0d0e7df83f6c2a7a80c0e4db8"
        ).unwrap();
        
        // Encode pair_id as felt
        let pair_id_felt = string_to_felt252(&feed.pair_id)?;
        
        let result = provider.call(
            FunctionCall {
                contract_address: oracle,
                entry_point_selector: get_data_selector,
                calldata: vec![pair_id_felt],
            },
            BlockId::Tag(BlockTag::Latest),
        ).await;
        
        match result {
            Ok(res) if res.len() >= 4 => {
                // Response format: (price, decimals, last_updated, num_sources)
                let price = felt_to_u128(&res[0]);
                let decimals = felt_to_u64(&res[1]) as u8;
                let last_updated = felt_to_u64(&res[2]);
                let num_sources = felt_to_u64(&res[3]) as u32;
                
                Ok(Some(PriceData {
                    symbol: asset_symbol.to_string(),
                    price,
                    decimals,
                    last_updated,
                    num_sources,
                }))
            }
            Ok(_) => Ok(None),
            Err(e) => Err(DefiQueryError::Rpc(format!("oracle call failed: {}", e))),
        }
    }
    
    /// Get prices for multiple assets.
    pub async fn get_prices(
        &self,
        provider: Arc<JsonRpcClient<HttpTransport>>,
        assets: &[&str],
    ) -> Result<Vec<PriceData>, DefiQueryError> {
        let mut prices = vec![];
        for asset in assets {
            if let Ok(Some(price)) = self.get_price(provider.clone(), asset).await {
                prices.push(price);
            }
        }
        Ok(prices)
    }
}

/// Price data from oracle.
#[derive(Clone, Debug)]
pub struct PriceData {
    pub symbol: String,
    pub price: u128,
    pub decimals: u8,
    pub last_updated: u64,
    pub num_sources: u32,
}

impl PriceData {
    /// Convert a token balance to USD value (in cents).
    /// 
    /// # Arguments
    /// * `balance` - Token balance in smallest unit
    /// * `token_decimals` - Number of decimals for the token
    pub fn calculate_usd_value(&self, balance: u128, token_decimals: u8) -> u64 {
        // price is in 10^decimals USD
        // balance is in 10^token_decimals tokens
        // We want result in cents (10^-2 USD)
        
        // value_usd = (balance / 10^token_decimals) * (price / 10^price_decimals)
        // value_cents = value_usd * 100
        
        let price_u128 = self.price;
        let numerator = balance
            .saturating_mul(price_u128)
            .saturating_mul(100);
        
        let denominator = 10u128
            .pow(token_decimals as u32)
            .saturating_mul(10u128.pow(self.decimals as u32));
        
        if denominator == 0 {
            return 0;
        }
        
        let result = numerator / denominator;
        result.min(u64::MAX as u128) as u64
    }
}

/// Position value calculator with price oracle integration.
pub struct PositionValueCalculator {
    pub oracle: PragmaOracle,
    price_cache: std::collections::HashMap<String, PriceData>,
}

impl PositionValueCalculator {
    /// Create a new calculator for mainnet.
    pub fn mainnet() -> Self {
        Self {
            oracle: PragmaOracle::mainnet(),
            price_cache: std::collections::HashMap::new(),
        }
    }
    
    /// Create a new calculator for sepolia.
    pub fn sepolia() -> Self {
        Self {
            oracle: PragmaOracle::sepolia(),
            price_cache: std::collections::HashMap::new(),
        }
    }
    
    /// Refresh price cache for given assets.
    pub async fn refresh_prices(
        &mut self,
        provider: Arc<JsonRpcClient<HttpTransport>>,
        assets: &[&str],
    ) -> Result<(), DefiQueryError> {
        let prices = self.oracle.get_prices(provider, assets).await?;
        for price in prices {
            self.price_cache.insert(price.symbol.clone(), price);
        }
        Ok(())
    }
    
    /// Get cached price for an asset.
    pub fn get_cached_price(&self, symbol: &str) -> Option<&PriceData> {
        self.price_cache.get(symbol)
    }
    
    /// Calculate USD value for a position.
    pub fn calculate_position_usd(
        &self,
        position: &DefiPosition,
        underlying_symbol: &str,
        underlying_decimals: u8,
    ) -> Option<u64> {
        let price = self.price_cache.get(underlying_symbol)?;
        Some(price.calculate_usd_value(position.value, underlying_decimals))
    }
    
    /// Enrich positions with USD values.
    pub fn enrich_positions_with_usd(
        &self,
        positions: &mut [DefiPosition],
        symbol_mapping: &std::collections::HashMap<String, (String, u8)>,
    ) {
        for position in positions.iter_mut() {
            if let Some((symbol, decimals)) = symbol_mapping.get(&position.contract_address) {
                if let Some(usd_value) = self.calculate_position_usd(position, symbol, *decimals) {
                    position.usd_value = Some(usd_value);
                }
            }
        }
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

/// Convert a string to felt252 (for pair IDs, etc.).
fn string_to_felt252(s: &str) -> Result<FieldElement, DefiQueryError> {
    // Encode string as bytes and convert to felt
    let bytes = s.as_bytes();
    if bytes.len() > 31 {
        return Err(DefiQueryError::ParseError("string too long for felt252".into()));
    }
    
    let mut felt_bytes = [0u8; 32];
    felt_bytes[32 - bytes.len()..].copy_from_slice(bytes);
    
    FieldElement::from_bytes_be(&felt_bytes)
        .map_err(|e| DefiQueryError::ParseError(format!("failed to encode string: {:?}", e)))
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

/// Convert a single felt to u128.
fn felt_to_u128(felt: &FieldElement) -> u128 {
    let bytes = felt.to_bytes_be();
    let mut buf = [0u8; 16];
    buf.copy_from_slice(&bytes[16..32]);
    u128::from_be_bytes(buf)
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
    pub carmine: CarmineQuery,
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
            carmine: CarmineQuery::mainnet(),
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
            carmine: CarmineQuery::sepolia(),
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
        
        if let Ok(positions) = self.carmine.get_positions(provider.clone(), account_address).await {
            all_positions.extend(positions);
        }
        
        Ok(all_positions)
    }
    
    /// Get all DeFi positions with USD values enriched via price oracle.
    pub async fn get_all_positions_with_usd(
        &self,
        provider: Arc<JsonRpcClient<HttpTransport>>,
        account_address: &str,
        value_calculator: &mut PositionValueCalculator,
    ) -> Result<Vec<DefiPosition>, DefiQueryError> {
        // First refresh prices for common assets
        value_calculator.refresh_prices(
            provider.clone(),
            &["ETH", "STRK", "BTC", "WBTC"],
        ).await?;
        
        let mut positions = self.get_all_positions(provider, account_address).await?;
        
        // Build symbol mapping for known protocols
        let mut symbol_mapping = std::collections::HashMap::new();
        
        // zkLend z-tokens
        for z_token in &self.zklend.z_tokens {
            let symbol = z_token.symbol.strip_prefix('z').unwrap_or(&z_token.symbol);
            let decimals = match symbol {
                "ETH" => 18u8,
                "USDC" | "USDT" => 6,
                "WBTC" => 8,
                _ => 18,
            };
            symbol_mapping.insert(z_token.z_token_address.clone(), (symbol.to_string(), decimals));
        }
        
        // Nostra markets
        for market in &self.nostra.market_addresses {
            let decimals = match market.name.as_str() {
                "ETH" => 18u8,
                "USDC" | "USDT" => 6,
                "WBTC" => 8,
                _ => 18,
            };
            symbol_mapping.insert(market.address.clone(), (market.name.clone(), decimals));
        }
        
        // Enrich positions with USD values
        value_calculator.enrich_positions_with_usd(&mut positions, &symbol_mapping);
        
        Ok(positions)
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
        assert!(!query.carmine.option_pools.is_empty());
    }
    
    #[test]
    fn test_carmine_query_mainnet() {
        let query = CarmineQuery::mainnet();
        assert!(!query.amm_address.is_empty());
        assert!(!query.option_pools.is_empty());
        
        // Verify pool configuration
        let call_pool = query.option_pools.iter().find(|p| p.is_call);
        assert!(call_pool.is_some());
        
        let put_pool = query.option_pools.iter().find(|p| !p.is_call);
        assert!(put_pool.is_some());
    }
    
    #[test]
    fn test_pragma_oracle_mainnet() {
        let oracle = PragmaOracle::mainnet();
        assert!(!oracle.oracle_address.is_empty());
        assert!(!oracle.price_feeds.is_empty());
        
        // Verify ETH feed exists
        let eth_feed = oracle.price_feeds.iter().find(|f| f.asset_symbol == "ETH");
        assert!(eth_feed.is_some());
        assert_eq!(eth_feed.unwrap().decimals, 8);
    }
    
    #[test]
    fn test_price_data_usd_calculation() {
        let price_data = PriceData {
            symbol: "ETH".to_string(),
            price: 2000_00000000, // $2000 with 8 decimals
            decimals: 8,
            last_updated: 1700000000,
            num_sources: 5,
        };
        
        // 1 ETH = $2000
        let one_eth = 1_000_000_000_000_000_000u128; // 1 ETH in wei (18 decimals)
        let usd_cents = price_data.calculate_usd_value(one_eth, 18);
        assert_eq!(usd_cents, 200000); // $2000.00 in cents
        
        // 0.5 ETH = $1000
        let half_eth = 500_000_000_000_000_000u128;
        let usd_cents_half = price_data.calculate_usd_value(half_eth, 18);
        assert_eq!(usd_cents_half, 100000); // $1000.00 in cents
    }
    
    #[test]
    fn test_price_data_usdc_calculation() {
        let price_data = PriceData {
            symbol: "ETH".to_string(),
            price: 2500_00000000, // $2500 with 8 decimals
            decimals: 8,
            last_updated: 1700000000,
            num_sources: 5,
        };
        
        // USDC has 6 decimals, but for stablecoins we'd use a different price feed
        // Here we test a hypothetical "USDC priced in ETH" scenario
        // 1000 USDC (assuming it's 1000e6 base units)
        let thousand_usdc = 1_000_000_000u128; // 1000 USDC with 6 decimals
        
        // If USDC were priced at $1 each:
        let usdc_price = PriceData {
            symbol: "USDC".to_string(),
            price: 1_00000000, // $1 with 8 decimals
            decimals: 8,
            last_updated: 1700000000,
            num_sources: 5,
        };
        let usd_cents = usdc_price.calculate_usd_value(thousand_usdc, 6);
        assert_eq!(usd_cents, 100000); // $1000.00 in cents
    }
    
    #[test]
    fn test_position_value_calculator() {
        let calculator = PositionValueCalculator::mainnet();
        assert!(!calculator.oracle.oracle_address.is_empty());
        assert!(calculator.price_cache.is_empty()); // Initially empty
    }
    
    #[test]
    fn test_string_to_felt252() {
        let result = string_to_felt252("ETH/USD");
        assert!(result.is_ok());
        
        // Test long string rejection
        let long_string = "this_is_a_very_long_string_that_exceeds_31_bytes_limit";
        let long_result = string_to_felt252(long_string);
        assert!(long_result.is_err());
    }
}

