//! Error types for the x402 crate

use thiserror::Error;

/// Result type for x402 operations
pub type X402Result<T> = Result<T, X402Error>;

/// Errors that can occur during x402 operations
#[derive(Error, Debug)]
pub enum X402Error {
    /// Invalid payment address
    #[error("Invalid payment address: {0}")]
    InvalidAddress(String),

    /// Invalid payment amount
    #[error("Invalid payment amount: {0}")]
    InvalidAmount(String),

    /// Missing required field
    #[error("Missing required field: {0}")]
    MissingField(&'static str),

    /// Invalid payment proof
    #[error("Invalid payment proof: {0}")]
    InvalidPaymentProof(String),

    /// Payment expired
    #[error("Payment requirements expired at {0}")]
    PaymentExpired(String),

    /// Payment not found
    #[error("Payment not found: {0}")]
    PaymentNotFound(String),

    /// Insufficient confirmations
    #[error("Insufficient confirmations: got {got}, need {required}")]
    InsufficientConfirmations { got: u32, required: u32 },

    /// Amount mismatch
    #[error("Payment amount mismatch: expected {expected} zatoshis, got {got}")]
    AmountMismatch { expected: u64, got: u64 },

    /// Address mismatch
    #[error("Payment address mismatch")]
    AddressMismatch,

    /// Network mismatch
    #[error("Network mismatch: expected {expected}, got {got}")]
    NetworkMismatch { expected: String, got: String },

    /// Invalid header format
    #[error("Invalid header format: {0}")]
    InvalidHeader(String),

    /// Serialization error
    #[error("Serialization error: {0}")]
    SerializationError(String),

    /// Verification error
    #[error("Verification error: {0}")]
    VerificationError(String),

    /// Lightwalletd connection error
    #[error("Lightwalletd error: {0}")]
    LightwalletdError(String),

    /// Generic internal error
    #[error("Internal error: {0}")]
    InternalError(String),
}

impl From<serde_json::Error> for X402Error {
    fn from(e: serde_json::Error) -> Self {
        X402Error::SerializationError(e.to_string())
    }
}

impl From<base64::DecodeError> for X402Error {
    fn from(e: base64::DecodeError) -> Self {
        X402Error::InvalidPaymentProof(format!("Base64 decode error: {}", e))
    }
}

impl From<hex::FromHexError> for X402Error {
    fn from(e: hex::FromHexError) -> Self {
        X402Error::InvalidPaymentProof(format!("Hex decode error: {}", e))
    }
}

