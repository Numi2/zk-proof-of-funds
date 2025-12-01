//! Type definitions for Starknet integration.

use serde::{Deserialize, Serialize};

/// Starknet chain configuration.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StarknetChainConfig {
    /// Chain identifier string (e.g., "SN_MAIN", "SN_SEPOLIA").
    pub chain_id: String,
    /// Numeric encoding of chain ID for circuit use.
    /// Uses u128 to accommodate full felt252 chain ID encodings.
    pub chain_id_numeric: u128,
    /// RPC endpoint URL.
    pub rpc_url: String,
    /// Optional block explorer URL.
    pub explorer_url: Option<String>,
    /// Native token symbol (ETH or STRK).
    pub native_token: String,
}

impl StarknetChainConfig {
    /// Starknet Mainnet configuration.
    pub fn mainnet(rpc_url: impl Into<String>) -> Self {
        Self {
            chain_id: "SN_MAIN".to_string(),
            chain_id_numeric: 0x534e5f4d41494e, // "SN_MAIN" as felt
            rpc_url: rpc_url.into(),
            explorer_url: Some("https://starkscan.co".to_string()),
            native_token: "ETH".to_string(),
        }
    }

    /// Starknet Sepolia testnet configuration.
    pub fn sepolia(rpc_url: impl Into<String>) -> Self {
        Self {
            chain_id: "SN_SEPOLIA".to_string(),
            chain_id_numeric: 0x534e5f5345504f4c4941, // "SN_SEPOLIA" as felt
            rpc_url: rpc_url.into(),
            explorer_url: Some("https://sepolia.starkscan.co".to_string()),
            native_token: "ETH".to_string(),
        }
    }
}

/// Account abstraction wallet type.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WalletType {
    /// OpenZeppelin account.
    OpenZeppelin,
    /// Argent account.
    Argent,
    /// Braavos account.
    Braavos,
    /// Generic Cairo 1 account.
    Cairo1,
    /// Unknown/custom account.
    Unknown,
}

impl WalletType {
    /// Detect wallet type from class hash.
    pub fn from_class_hash(class_hash: &str) -> Self {
        // Known class hashes for different account types
        // These would need to be updated as new versions are deployed
        let hash = class_hash.to_lowercase();
        
        if hash.contains("argentx") || hash.starts_with("0x01a736d6ed154502257f02b1ccdf4d9d1089f80811cd6acad48e6b6a9d1f2003") {
            WalletType::Argent
        } else if hash.starts_with("0x00816dd0297efc55dc1e7559020a3a825e81ef734b558f03c83325d4da7e6253") {
            WalletType::Braavos
        } else if hash.starts_with("0x05400e90f7e0ae78bd02c77cd75527280470e2fe19c54970dd79dc37a9d3645c") {
            WalletType::OpenZeppelin
        } else {
            WalletType::Unknown
        }
    }
}

/// Session key configuration for account abstraction.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SessionKeyConfig {
    /// Session public key (Stark curve point).
    pub public_key: String,
    /// Allowed methods (selectors) for this session.
    pub allowed_methods: Vec<String>,
    /// Expiration timestamp (Unix seconds).
    pub expires_at: u64,
    /// Maximum transaction value per call.
    pub max_value_per_call: Option<u128>,
    /// Maximum total value for session.
    pub max_total_value: Option<u128>,
}

/// Signed session key authorization.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SessionKeyAuth {
    /// The session key configuration.
    pub config: SessionKeyConfig,
    /// Signature from the main account key authorizing this session.
    pub authorization_signature: Vec<String>,
}

/// Batched signature request.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BatchedSignatureRequest {
    /// Holder ID for proof binding.
    pub holder_id: String,
    /// Policy ID being proven.
    pub policy_id: u64,
    /// Epoch for the proof.
    pub epoch: u64,
    /// Account addresses to include.
    pub accounts: Vec<String>,
    /// Optional session key to use.
    pub session_key: Option<SessionKeyAuth>,
}

/// Token metadata for value calculation.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TokenMetadata {
    /// Contract address.
    pub address: String,
    /// Token symbol.
    pub symbol: String,
    /// Decimal places.
    pub decimals: u8,
    /// USD price (optional, in cents).
    pub usd_price_cents: Option<u64>,
}

/// Known token addresses on Starknet.
pub mod known_tokens {
    /// ETH token address on Starknet.
    pub const ETH: &str = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
    /// STRK token address.
    pub const STRK: &str = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
    /// USDC token address.
    pub const USDC: &str = "0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8";
    /// USDT token address.
    pub const USDT: &str = "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8";
    /// DAI token address.
    pub const DAI: &str = "0x00da114221cb83fa859dbdb4c44beeaa0bb37c7537ad5ae66fe5e0efd20e6eb3";
    /// WBTC token address.
    pub const WBTC: &str = "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac";
}

/// Known DeFi protocols on Starknet.
pub mod known_protocols {
    /// JediSwap AMM.
    pub const JEDISWAP: &str = "JediSwap";
    /// 10K Swap AMM.
    pub const TENK_SWAP: &str = "10KSwap";
    /// Nostra lending protocol.
    pub const NOSTRA: &str = "Nostra";
    /// zkLend lending protocol.
    pub const ZKLEND: &str = "zkLend";
    /// Ekubo concentrated liquidity AMM.
    pub const EKUBO: &str = "Ekubo";
    /// Haiko vault protocol.
    pub const HAIKO: &str = "Haiko";
    /// Carmine options protocol.
    pub const CARMINE: &str = "Carmine";
}

/// Asset denomination for threshold comparison.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AssetDenomination {
    /// Native ETH.
    Eth,
    /// Native STRK.
    Strk,
    /// USD value.
    Usd,
    /// Specific token by address.
    Token(String),
}

impl AssetDenomination {
    /// Currency code for policy configuration.
    pub fn currency_code(&self) -> u32 {
        match self {
            AssetDenomination::Eth => 1027, // ETH currency code
            AssetDenomination::Strk => 22691, // STRK currency code
            AssetDenomination::Usd => 840, // USD
            AssetDenomination::Token(_) => 0, // Custom
        }
    }
}

