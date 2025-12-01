//! Error types for Omni Bridge integration.

use thiserror::Error;

/// Errors that can occur during bridge operations.
#[derive(Error, Debug)]
pub enum OmniBridgeError {
    /// Configuration error.
    #[error("Configuration error: {0}")]
    Config(String),

    /// Chain not supported.
    #[error("Chain not supported: {0}")]
    UnsupportedChain(String),

    /// Token not found or not bridgeable.
    #[error("Token not bridgeable: {0}")]
    TokenNotBridgeable(String),

    /// Insufficient balance for transfer.
    #[error("Insufficient balance: have {have}, need {need}")]
    InsufficientBalance { have: u128, need: u128 },

    /// Transfer failed.
    #[error("Transfer failed: {0}")]
    TransferFailed(String),

    /// Transfer timeout.
    #[error("Transfer timed out after {0} seconds")]
    TransferTimeout(u64),

    /// RPC error.
    #[error("RPC error: {0}")]
    Rpc(String),

    /// Proof generation error.
    #[error("Proof generation failed: {0}")]
    ProofGeneration(String),

    /// Proof verification error.
    #[error("Proof verification failed: {0}")]
    ProofVerification(String),

    /// Bridge contract error.
    #[error("Bridge contract error: {0}")]
    BridgeContract(String),

    /// Wormhole VAA error.
    #[error("Wormhole VAA error: {0}")]
    WormholeVaa(String),

    /// Serialization error.
    #[error("Serialization error: {0}")]
    Serialization(String),

    /// Network error.
    #[error("Network error: {0}")]
    Network(String),

    /// Invalid address format.
    #[error("Invalid address: {0}")]
    InvalidAddress(String),

    /// Storage deposit required.
    #[error("Storage deposit required: {0} yoctoNEAR")]
    StorageDepositRequired(u128),

    /// Operation not permitted.
    #[error("Operation not permitted: {0}")]
    NotPermitted(String),

    /// Internal error.
    #[error("Internal error: {0}")]
    Internal(String),
}

impl From<serde_json::Error> for OmniBridgeError {
    fn from(err: serde_json::Error) -> Self {
        Self::Serialization(err.to_string())
    }
}

impl From<reqwest::Error> for OmniBridgeError {
    fn from(err: reqwest::Error) -> Self {
        Self::Network(err.to_string())
    }
}

impl From<std::io::Error> for OmniBridgeError {
    fn from(err: std::io::Error) -> Self {
        Self::Internal(err.to_string())
    }
}

/// Result type for bridge operations.
pub type BridgeResult<T> = Result<T, OmniBridgeError>;

