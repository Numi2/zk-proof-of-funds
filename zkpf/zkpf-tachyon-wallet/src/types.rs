//! Core types for the Tachyon wallet.

use serde::{Deserialize, Serialize};

// ═══════════════════════════════════════════════════════════════════════════════
// IDENTIFIERS
// ═══════════════════════════════════════════════════════════════════════════════

/// Unique wallet identifier (derived from seed).
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct WalletId(pub [u8; 32]);

impl WalletId {
    pub fn from_seed_fingerprint(fingerprint: &[u8; 32]) -> Self {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"tachyon_wallet_id_v1");
        hasher.update(fingerprint);
        Self(*hasher.finalize().as_bytes())
    }
}

/// Holder identity - can be pseudonymous or derived from real identity.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct HolderId(pub String);

impl HolderId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    pub fn pseudonymous() -> Self {
        use rand::Rng;
        let random_bytes: [u8; 16] = rand::thread_rng().gen();
        Self(hex::encode(random_bytes))
    }
}

impl AsRef<str> for HolderId {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CURRENCY
// ═══════════════════════════════════════════════════════════════════════════════

/// ISO 4217 style currency codes extended for crypto assets.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u32)]
pub enum CurrencyCode {
    /// US Dollar
    USD = 840,
    /// Euro
    EUR = 978,
    /// Bitcoin
    BTC = 1000,
    /// Ethereum
    ETH = 1027,
    /// Zcash (ZEC)
    ZEC = 1042,
    /// USDC
    USDC = 2001,
    /// USDT
    USDT = 2002,
    /// DAI
    DAI = 2003,
    /// Starknet STRK
    STRK = 22691,
    /// Mina MINA
    MINA = 22693,
    /// NEAR
    NEAR = 22694,
}

impl CurrencyCode {
    pub fn from_u32(code: u32) -> Option<Self> {
        match code {
            840 => Some(Self::USD),
            978 => Some(Self::EUR),
            1000 => Some(Self::BTC),
            1027 => Some(Self::ETH),
            1042 => Some(Self::ZEC),
            2001 => Some(Self::USDC),
            2002 => Some(Self::USDT),
            2003 => Some(Self::DAI),
            22691 => Some(Self::STRK),
            22693 => Some(Self::MINA),
            22694 => Some(Self::NEAR),
            _ => None,
        }
    }

    pub fn as_u32(self) -> u32 {
        self as u32
    }

    pub fn symbol(self) -> &'static str {
        match self {
            Self::USD => "USD",
            Self::EUR => "EUR",
            Self::BTC => "BTC",
            Self::ETH => "ETH",
            Self::ZEC => "ZEC",
            Self::USDC => "USDC",
            Self::USDT => "USDT",
            Self::DAI => "DAI",
            Self::STRK => "STRK",
            Self::MINA => "MINA",
            Self::NEAR => "NEAR",
        }
    }

    pub fn decimals(self) -> u8 {
        match self {
            Self::USD | Self::EUR | Self::USDC | Self::USDT | Self::DAI => 6,
            Self::BTC => 8,
            Self::ETH | Self::ZEC | Self::STRK | Self::MINA | Self::NEAR => 18,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// POLICY
// ═══════════════════════════════════════════════════════════════════════════════

/// Policy definition for proof requirements.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Policy {
    /// Unique policy identifier.
    pub policy_id: u64,
    /// Human-readable label.
    pub label: String,
    /// Minimum balance threshold.
    pub threshold: u128,
    /// Required currency.
    pub currency: CurrencyCode,
    /// Verifier scope (domain separator).
    pub verifier_scope_id: u64,
    /// Allowed rails for this policy.
    pub allowed_rails: Vec<String>,
    /// Validity window in seconds.
    pub validity_window_secs: u64,
}

// ═══════════════════════════════════════════════════════════════════════════════
// EPOCH
// ═══════════════════════════════════════════════════════════════════════════════

/// Epoch information for proof timing.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Epoch {
    /// Unix timestamp marking epoch start.
    pub timestamp: u64,
    /// Epoch index (optional, for discrete epoch systems).
    pub index: Option<u64>,
    /// Duration in seconds (optional).
    pub duration_secs: Option<u64>,
}

impl Epoch {
    pub fn current() -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_secs();
        Self {
            timestamp: now,
            index: None,
            duration_secs: None,
        }
    }

    pub fn from_timestamp(timestamp: u64) -> Self {
        Self {
            timestamp,
            index: None,
            duration_secs: None,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROOF REQUEST
// ═══════════════════════════════════════════════════════════════════════════════

/// Request for generating a proof-of-funds.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProofRequest {
    /// Holder identity.
    pub holder_id: HolderId,
    /// Policy to prove against.
    pub policy: Policy,
    /// Current epoch for the proof.
    pub epoch: Epoch,
    /// Preferred rail (optional - coordinator selects if not specified).
    pub preferred_rail: Option<String>,
    /// Whether to aggregate across multiple rails.
    pub aggregate_rails: bool,
    /// Target chains for cross-chain attestation (via Axelar).
    pub target_chains: Vec<String>,
}

/// Result of a proof generation.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProofResult {
    /// The generated proof bundle.
    pub bundle: zkpf_common::ProofBundle,
    /// Rail that generated the proof.
    pub rail_id: String,
    /// Attestation record (if cross-chain targets specified).
    pub attestation: Option<super::attestation::UnifiedAttestation>,
    /// Metadata about the proof generation.
    pub metadata: ProofMetadata,
}

/// Metadata about proof generation.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProofMetadata {
    /// Time taken to generate the proof (milliseconds).
    pub generation_time_ms: u64,
    /// Number of accounts/notes aggregated.
    pub aggregated_count: usize,
    /// Block heights used per chain.
    pub block_heights: std::collections::HashMap<String, u64>,
    /// Whether the proof was cached.
    pub cached: bool,
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHAIN-SPECIFIC TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/// Chain identifier for multi-chain operations.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ChainId {
    /// Zcash mainnet
    ZcashMainnet,
    /// Zcash testnet
    ZcashTestnet,
    /// Mina mainnet
    MinaMainnet,
    /// Mina testnet (Berkeley)
    MinaBerkeley,
    /// Starknet mainnet
    StarknetMainnet,
    /// Starknet Sepolia
    StarknetSepolia,
    /// NEAR mainnet
    NearMainnet,
    /// NEAR testnet
    NearTestnet,
    /// Custom chain with string identifier
    Custom(String),
}

impl ChainId {
    pub fn as_str(&self) -> &str {
        match self {
            Self::ZcashMainnet => "zcash_mainnet",
            Self::ZcashTestnet => "zcash_testnet",
            Self::MinaMainnet => "mina_mainnet",
            Self::MinaBerkeley => "mina_berkeley",
            Self::StarknetMainnet => "starknet_mainnet",
            Self::StarknetSepolia => "starknet_sepolia",
            Self::NearMainnet => "near_mainnet",
            Self::NearTestnet => "near_testnet",
            Self::Custom(s) => s,
        }
    }
}

// We need hex for HolderId::pseudonymous
mod hex {
    pub fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }
}

