//! Error types for URI-Encapsulated Payments

use thiserror::Error;

/// Result type alias for URI payment operations
pub type Result<T> = std::result::Result<T, Error>;

/// Errors that can occur during URI payment operations
#[derive(Debug, Error)]
pub enum Error {
    /// Invalid URI format
    #[error("Invalid URI format: {0}")]
    InvalidUri(String),

    /// Missing required URI parameter
    #[error("Missing required parameter: {0}")]
    MissingParameter(&'static str),

    /// Invalid amount format
    #[error("Invalid amount: {0}")]
    InvalidAmount(String),

    /// Amount has too many decimal places (max 8)
    #[error("Amount has too many decimal places (max 8): {0}")]
    TooManyDecimalPlaces(String),

    /// Invalid key encoding
    #[error("Invalid key encoding: {0}")]
    InvalidKeyEncoding(String),

    /// Bech32 encoding/decoding error
    #[error("Bech32 error: {0}")]
    Bech32(String),

    /// Key derivation failed
    #[error("Key derivation failed: {0}")]
    KeyDerivation(String),

    /// Invalid network
    #[error("Invalid network: {0}")]
    InvalidNetwork(String),

    /// Note construction failed
    #[error("Note construction failed: {0}")]
    NoteConstruction(String),

    /// Invalid diversifier
    #[error("Invalid diversifier")]
    InvalidDiversifier,

    /// Spending key derivation failed
    #[error("Spending key derivation failed: {0}")]
    SpendingKeyDerivation(String),

    /// Payment index overflow
    #[error("Payment index overflow: maximum {0} payments supported")]
    PaymentIndexOverflow(u32),

    /// URL parsing error
    #[error("URL parse error: {0}")]
    UrlParse(#[from] url::ParseError),

    /// Protocol error
    #[error("Protocol error: {0}")]
    Protocol(String),

    /// Cryptographic error
    #[error("Cryptographic error: {0}")]
    Crypto(String),

    /// The payment note was not found on chain
    #[error("Payment note not found on chain")]
    NoteNotFound,

    /// The payment note has already been spent
    #[error("Payment note has already been spent")]
    NoteAlreadySpent,

    /// Insufficient funds for the fee
    #[error("Insufficient funds for transaction fee")]
    InsufficientFee,
}

impl From<bech32::primitives::decode::CheckedHrpstringError> for Error {
    fn from(e: bech32::primitives::decode::CheckedHrpstringError) -> Self {
        Error::Bech32(e.to_string())
    }
}

