//! Error types for the Tachyon wallet.

use thiserror::Error;

/// Errors that can occur in the Tachyon wallet.
#[derive(Debug, Error)]
pub enum TachyonError {
    // ═══════════════════════════════════════════════════════════════════════════════
    // RAIL ERRORS
    // ═══════════════════════════════════════════════════════════════════════════════

    #[error("rail not available: {0}")]
    RailNotAvailable(String),

    #[error("rail operation failed: {rail}: {message}")]
    RailOperation { rail: String, message: String },

    #[error("rail timeout: {rail} after {timeout_secs}s")]
    RailTimeout { rail: String, timeout_secs: u64 },

    #[error("rail sync failed: {rail}: {message}")]
    RailSync { rail: String, message: String },

    #[error("sync error: {0}")]
    Sync(String),

    // ═══════════════════════════════════════════════════════════════════════════════
    // PROOF ERRORS
    // ═══════════════════════════════════════════════════════════════════════════════

    #[error("proof generation failed: {0}")]
    ProofGeneration(String),

    #[error("proof verification failed: {0}")]
    ProofVerification(String),

    #[error("proof aggregation failed: {0}")]
    ProofAggregation(String),

    #[error("insufficient funds: required {required}, available {available}")]
    InsufficientFunds { required: u128, available: u128 },

    #[error("proof expired: generated at {generated_at}, current epoch {current_epoch}")]
    ProofExpired { generated_at: u64, current_epoch: u64 },

    // ═══════════════════════════════════════════════════════════════════════════════
    // TRANSPORT ERRORS
    // ═══════════════════════════════════════════════════════════════════════════════

    #[error("transport error: {0}")]
    Transport(String),

    #[error("message encoding failed: {0}")]
    MessageEncoding(String),

    #[error("untrusted source: chain={chain}, address={address}")]
    UntrustedSource { chain: String, address: String },

    #[error("cross-chain message expired")]
    MessageExpired,

    // ═══════════════════════════════════════════════════════════════════════════════
    // CONFIGURATION ERRORS
    // ═══════════════════════════════════════════════════════════════════════════════

    #[error("invalid configuration: {0}")]
    InvalidConfig(String),

    #[error("missing required config: {0}")]
    MissingConfig(String),

    // ═══════════════════════════════════════════════════════════════════════════════
    // STATE ERRORS
    // ═══════════════════════════════════════════════════════════════════════════════

    #[error("state corruption detected: {0}")]
    StateCorruption(String),

    #[error("wallet not initialized")]
    NotInitialized,

    #[error("wallet already initialized")]
    AlreadyInitialized,

    // ═══════════════════════════════════════════════════════════════════════════════
    // PRIVACY ERRORS
    // ═══════════════════════════════════════════════════════════════════════════════

    #[error("privacy violation: {0}")]
    PrivacyViolation(String),

    #[error("linking attempt detected: {0}")]
    LinkingAttempt(String),

    // ═══════════════════════════════════════════════════════════════════════════════
    // INTERNAL ERRORS
    // ═══════════════════════════════════════════════════════════════════════════════

    #[error("internal error: {0}")]
    Internal(String),

    #[error("serialization error: {0}")]
    Serialization(String),

    #[error(transparent)]
    Io(#[from] std::io::Error),
}

impl From<serde_json::Error> for TachyonError {
    fn from(err: serde_json::Error) -> Self {
        TachyonError::Serialization(err.to_string())
    }
}

impl From<zkpf_mina::MinaRailError> for TachyonError {
    fn from(err: zkpf_mina::MinaRailError) -> Self {
        TachyonError::RailOperation {
            rail: "MINA".to_string(),
            message: err.to_string(),
        }
    }
}

impl From<zkpf_starknet_l2::StarknetRailError> for TachyonError {
    fn from(err: zkpf_starknet_l2::StarknetRailError) -> Self {
        TachyonError::RailOperation {
            rail: "STARKNET".to_string(),
            message: err.to_string(),
        }
    }
}

impl From<zkpf_axelar_gmp::AxelarGmpError> for TachyonError {
    fn from(err: zkpf_axelar_gmp::AxelarGmpError) -> Self {
        TachyonError::Transport(err.to_string())
    }
}

impl From<zkpf_zcash_orchard_wallet::WalletError> for TachyonError {
    fn from(err: zkpf_zcash_orchard_wallet::WalletError) -> Self {
        TachyonError::RailOperation {
            rail: "ZCASH_ORCHARD".to_string(),
            message: err.to_string(),
        }
    }
}

