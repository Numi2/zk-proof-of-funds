//! Error types for the PCZT transparent-to-shielded library.

use thiserror::Error;

/// Errors that can occur during PCZT operations.
#[derive(Debug, Error)]
pub enum PcztError {
    /// Error during transaction proposal creation
    #[error("Proposal error: {0}")]
    ProposalError(String),

    /// Error during proof generation
    #[error("Prover error: {0}")]
    ProverError(String),

    /// Error during signature verification or application
    #[error("Signature error: {0}")]
    SignatureError(String),

    /// Error during sighash computation
    #[error("Sighash error: {0}")]
    SighashError(String),

    /// Error during pre-signing verification
    #[error("Verification error: {0}")]
    VerificationError(String),

    /// Error during PCZT combination
    #[error("Combine error: {0}")]
    CombineError(String),

    /// Error during finalization or extraction
    #[error("Finalization error: {0}")]
    FinalizationError(String),

    /// Error parsing PCZT bytes
    #[error("Parse error: {0}")]
    ParseError(String),

    /// Error parsing ZIP 321 payment request
    #[error("Invalid payment request: {0}")]
    InvalidPaymentRequest(String),

    /// Error with transparent input
    #[error("Invalid transparent input: {0}")]
    InvalidTransparentInput(String),

    /// Error with Orchard output
    #[error("Invalid Orchard output: {0}")]
    InvalidOrchardOutput(String),

    /// Address parsing error
    #[error("Invalid address: {0}")]
    InvalidAddress(String),

    /// Network mismatch error
    #[error("Network mismatch: {0}")]
    NetworkMismatch(String),

    /// Insufficient funds error
    #[error("Insufficient funds: available {available}, required {required}")]
    InsufficientFunds { available: u64, required: u64 },

    /// Invalid amount error
    #[error("Invalid amount: {0}")]
    InvalidAmount(String),

    /// Script error
    #[error("Script error: {0}")]
    ScriptError(String),

    /// Serialization error
    #[error("Serialization error: {0}")]
    SerializationError(String),

    /// Internal error
    #[error("Internal error: {0}")]
    InternalError(String),
}

/// Result type alias for PCZT operations.
pub type PcztResult<T> = Result<T, PcztError>;

#[cfg(feature = "wasm")]
impl From<PcztError> for wasm_bindgen::JsValue {
    fn from(error: PcztError) -> Self {
        wasm_bindgen::JsValue::from_str(&error.to_string())
    }
}

