//! Core types for Omni Bridge integration.

use serde::{Deserialize, Serialize};

/// Chain identifier for bridge operations.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum BridgeChainId {
    /// NEAR mainnet.
    NearMainnet,
    /// NEAR testnet.
    NearTestnet,
    /// Ethereum mainnet.
    EthereumMainnet,
    /// Ethereum Sepolia testnet.
    EthereumSepolia,
    /// Arbitrum One (mainnet).
    ArbitrumOne,
    /// Arbitrum Sepolia testnet.
    ArbitrumSepolia,
    /// Base mainnet.
    BaseMainnet,
    /// Base Sepolia testnet.
    BaseSepolia,
    /// Solana mainnet.
    SolanaMainnet,
    /// Solana devnet.
    SolanaDevnet,
    /// Custom chain with numeric ID.
    Custom(u64),
}

impl BridgeChainId {
    /// Get the numeric chain ID.
    pub fn as_u64(&self) -> u64 {
        match self {
            Self::NearMainnet => 1313161554,      // NEAR mainnet
            Self::NearTestnet => 1313161555,      // NEAR testnet
            Self::EthereumMainnet => 1,
            Self::EthereumSepolia => 11155111,
            Self::ArbitrumOne => 42161,
            Self::ArbitrumSepolia => 421614,
            Self::BaseMainnet => 8453,
            Self::BaseSepolia => 84532,
            Self::SolanaMainnet => 101,           // Wormhole chain ID
            Self::SolanaDevnet => 1,              // Wormhole devnet
            Self::Custom(id) => *id,
        }
    }

    /// Get the chain name for display.
    pub fn display_name(&self) -> &str {
        match self {
            Self::NearMainnet => "NEAR Mainnet",
            Self::NearTestnet => "NEAR Testnet",
            Self::EthereumMainnet => "Ethereum",
            Self::EthereumSepolia => "Ethereum Sepolia",
            Self::ArbitrumOne => "Arbitrum One",
            Self::ArbitrumSepolia => "Arbitrum Sepolia",
            Self::BaseMainnet => "Base",
            Self::BaseSepolia => "Base Sepolia",
            Self::SolanaMainnet => "Solana",
            Self::SolanaDevnet => "Solana Devnet",
            Self::Custom(_) => "Custom Chain",
        }
    }

    /// Get the Omni Bridge chain identifier string.
    pub fn omni_chain_id(&self) -> &str {
        match self {
            Self::NearMainnet => "near",
            Self::NearTestnet => "near-testnet",
            Self::EthereumMainnet => "ethereum",
            Self::EthereumSepolia => "ethereum-sepolia",
            Self::ArbitrumOne => "arbitrum",
            Self::ArbitrumSepolia => "arbitrum-sepolia",
            Self::BaseMainnet => "base",
            Self::BaseSepolia => "base-sepolia",
            Self::SolanaMainnet => "solana",
            Self::SolanaDevnet => "solana-devnet",
            Self::Custom(id) => "custom",
        }
    }

    /// Check if this is an EVM chain.
    pub fn is_evm(&self) -> bool {
        matches!(
            self,
            Self::EthereumMainnet
                | Self::EthereumSepolia
                | Self::ArbitrumOne
                | Self::ArbitrumSepolia
                | Self::BaseMainnet
                | Self::BaseSepolia
        )
    }

    /// Check if this is a mainnet chain.
    pub fn is_mainnet(&self) -> bool {
        matches!(
            self,
            Self::NearMainnet
                | Self::EthereumMainnet
                | Self::ArbitrumOne
                | Self::BaseMainnet
                | Self::SolanaMainnet
        )
    }
}

impl std::fmt::Display for BridgeChainId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.display_name())
    }
}

/// Asset type for bridge operations.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum BridgeAsset {
    /// Native asset (ETH, NEAR, SOL).
    Native,
    /// ERC20 token on EVM chains.
    Erc20 {
        /// Contract address.
        address: String,
        /// Token symbol.
        symbol: String,
        /// Decimal places.
        decimals: u8,
    },
    /// NEP-141 token on NEAR.
    Nep141 {
        /// Contract account ID.
        account_id: String,
        /// Token symbol.
        symbol: String,
        /// Decimal places.
        decimals: u8,
    },
    /// SPL token on Solana.
    Spl {
        /// Mint address.
        mint: String,
        /// Token symbol.
        symbol: String,
        /// Decimal places.
        decimals: u8,
    },
}

impl BridgeAsset {
    /// Get the token symbol.
    pub fn symbol(&self) -> &str {
        match self {
            Self::Native => "NATIVE",
            Self::Erc20 { symbol, .. } => symbol,
            Self::Nep141 { symbol, .. } => symbol,
            Self::Spl { symbol, .. } => symbol,
        }
    }

    /// Get decimal places.
    pub fn decimals(&self) -> u8 {
        match self {
            Self::Native => 18,
            Self::Erc20 { decimals, .. } => *decimals,
            Self::Nep141 { decimals, .. } => *decimals,
            Self::Spl { decimals, .. } => *decimals,
        }
    }

    /// Get the contract/mint address if applicable.
    pub fn address(&self) -> Option<&str> {
        match self {
            Self::Native => None,
            Self::Erc20 { address, .. } => Some(address),
            Self::Nep141 { account_id, .. } => Some(account_id),
            Self::Spl { mint, .. } => Some(mint),
        }
    }
}

/// Address type that can represent addresses on different chains.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum BridgeAddress {
    /// NEAR account ID.
    Near(String),
    /// EVM address (20 bytes, hex-encoded with 0x prefix).
    Evm(String),
    /// Solana public key (base58 encoded).
    Solana(String),
}

impl BridgeAddress {
    /// Create a NEAR address.
    pub fn near(account_id: impl Into<String>) -> Self {
        Self::Near(account_id.into())
    }

    /// Create an EVM address.
    pub fn evm(address: impl Into<String>) -> Self {
        let addr = address.into();
        // Normalize to lowercase with 0x prefix
        let normalized = if addr.starts_with("0x") || addr.starts_with("0X") {
            format!("0x{}", addr[2..].to_lowercase())
        } else {
            format!("0x{}", addr.to_lowercase())
        };
        Self::Evm(normalized)
    }

    /// Create a Solana address.
    pub fn solana(pubkey: impl Into<String>) -> Self {
        Self::Solana(pubkey.into())
    }

    /// Get the raw address string.
    pub fn as_str(&self) -> &str {
        match self {
            Self::Near(s) | Self::Evm(s) | Self::Solana(s) => s,
        }
    }

    /// Check if this is a valid address for the given chain.
    pub fn is_valid_for_chain(&self, chain: &BridgeChainId) -> bool {
        match (self, chain) {
            (Self::Near(_), BridgeChainId::NearMainnet | BridgeChainId::NearTestnet) => true,
            (Self::Evm(_), chain) if chain.is_evm() => true,
            (Self::Solana(_), BridgeChainId::SolanaMainnet | BridgeChainId::SolanaDevnet) => true,
            _ => false,
        }
    }
}

impl std::fmt::Display for BridgeAddress {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Transfer direction.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TransferDirection {
    /// Lock on source, mint on destination.
    LockAndMint,
    /// Burn on source, unlock on destination.
    BurnAndUnlock,
}

/// Bridge fee information.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BridgeFee {
    /// Fee amount in native currency.
    pub amount: u128,
    /// Fee currency symbol.
    pub currency: String,
    /// Fee recipient (if applicable).
    pub recipient: Option<String>,
}

/// Transfer metadata for tracking and verification.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TransferMetadata {
    /// Unique transfer ID.
    pub transfer_id: [u8; 32],
    /// Source chain.
    pub source_chain: BridgeChainId,
    /// Destination chain.
    pub destination_chain: BridgeChainId,
    /// Source address.
    pub sender: BridgeAddress,
    /// Destination address.
    pub recipient: BridgeAddress,
    /// Asset being transferred.
    pub asset: BridgeAsset,
    /// Amount transferred (in smallest unit).
    pub amount: u128,
    /// Transfer direction.
    pub direction: TransferDirection,
    /// Creation timestamp (Unix seconds).
    pub created_at: u64,
    /// Completion timestamp (if complete).
    pub completed_at: Option<u64>,
    /// Transaction hash on source chain.
    pub source_tx_hash: Option<String>,
    /// Transaction hash on destination chain.
    pub destination_tx_hash: Option<String>,
    /// Wormhole VAA (if applicable).
    pub wormhole_vaa: Option<String>,
}

