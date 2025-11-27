//! Error types for the Starknet L2 rail.
//!
//! This module provides granular error types and codes for all Starknet rail operations.

use thiserror::Error;

/// Aggregated error type for the Starknet rail.
#[derive(Debug, Error)]
pub enum StarknetRailError {
    /// Error from Starknet RPC client.
    #[error("starknet rpc error: {0}")]
    Rpc(String),

    /// Error reading account state.
    #[error("state error: {0}")]
    State(String),

    /// Validation error in inputs.
    #[error("invalid input: {0}")]
    InvalidInput(String),

    /// Circuit/proof generation error.
    #[error("proof error: {0}")]
    Proof(String),

    /// Account abstraction / signing error.
    #[error("wallet error: {0}")]
    Wallet(String),

    /// Network/chain mismatch.
    #[error("chain error: {0}")]
    Chain(String),

    /// Feature not yet implemented.
    #[error("not implemented: {0}")]
    NotImplemented(String),
    
    /// Verification failed.
    #[error("verification failed: {0}")]
    Verification(String),
    
    /// Artifact loading failed.
    #[error("artifact error: {0}")]
    Artifact(String),
    
    /// DeFi query failed.
    #[error("defi query error: {0}")]
    Defi(String),
    
    /// Timeout error.
    #[error("timeout: {0}")]
    Timeout(String),
}

impl StarknetRailError {
    /// Get a machine-readable error code.
    pub fn error_code(&self) -> &'static str {
        match self {
            StarknetRailError::Rpc(_) => "RPC_ERROR",
            StarknetRailError::State(_) => "STATE_ERROR",
            StarknetRailError::InvalidInput(_) => "INVALID_INPUT",
            StarknetRailError::Proof(_) => "PROOF_ERROR",
            StarknetRailError::Wallet(_) => "WALLET_ERROR",
            StarknetRailError::Chain(_) => "CHAIN_ERROR",
            StarknetRailError::NotImplemented(_) => "NOT_IMPLEMENTED",
            StarknetRailError::Verification(_) => "VERIFICATION_FAILED",
            StarknetRailError::Artifact(_) => "ARTIFACT_ERROR",
            StarknetRailError::Defi(_) => "DEFI_ERROR",
            StarknetRailError::Timeout(_) => "TIMEOUT",
        }
    }
    
    /// Check if this error is retryable.
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            StarknetRailError::Rpc(_)
                | StarknetRailError::Timeout(_)
                | StarknetRailError::Defi(_)
        )
    }
    
    /// Get HTTP status code suggestion.
    pub fn suggested_status_code(&self) -> u16 {
        match self {
            StarknetRailError::InvalidInput(_) => 400,
            StarknetRailError::Wallet(_) => 401,
            StarknetRailError::Chain(_) => 400,
            StarknetRailError::NotImplemented(_) => 501,
            StarknetRailError::Rpc(_) => 502,
            StarknetRailError::Timeout(_) => 504,
            StarknetRailError::Verification(_) => 400,
            StarknetRailError::Artifact(_) => 500,
            StarknetRailError::State(_) => 500,
            StarknetRailError::Proof(_) => 500,
            StarknetRailError::Defi(_) => 502,
        }
    }
}

impl From<anyhow::Error> for StarknetRailError {
    fn from(err: anyhow::Error) -> Self {
        StarknetRailError::InvalidInput(err.to_string())
    }
}

/// Detailed error context for API responses.
#[derive(Debug, Clone)]
pub struct ErrorContext {
    /// Machine-readable error code.
    pub code: String,
    /// Human-readable message.
    pub message: String,
    /// Optional field that caused the error.
    pub field: Option<String>,
    /// Optional additional details.
    pub details: Option<String>,
    /// Whether the operation can be retried.
    pub retryable: bool,
}

impl From<&StarknetRailError> for ErrorContext {
    fn from(err: &StarknetRailError) -> Self {
        ErrorContext {
            code: err.error_code().to_string(),
            message: err.to_string(),
            field: None,
            details: None,
            retryable: err.is_retryable(),
        }
    }
}

/// Validation error builder for detailed input validation.
pub struct ValidationError {
    field: String,
    message: String,
    value: Option<String>,
}

impl ValidationError {
    /// Create a new validation error.
    pub fn new(field: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            field: field.into(),
            message: message.into(),
            value: None,
        }
    }
    
    /// Add the invalid value to the error.
    pub fn with_value(mut self, value: impl std::fmt::Display) -> Self {
        self.value = Some(value.to_string());
        self
    }
    
    /// Convert to a StarknetRailError.
    pub fn into_error(self) -> StarknetRailError {
        let msg = if let Some(value) = self.value {
            format!("{}: {} (got: {})", self.field, self.message, value)
        } else {
            format!("{}: {}", self.field, self.message)
        };
        StarknetRailError::InvalidInput(msg)
    }
}

/// Common validation functions.
pub mod validation {
    use super::*;
    
    /// Validate that a value is non-zero.
    pub fn require_nonzero(field: &str, value: u64) -> Result<(), StarknetRailError> {
        if value == 0 {
            Err(ValidationError::new(field, "must be greater than 0")
                .with_value(value)
                .into_error())
        } else {
            Ok(())
        }
    }
    
    /// Validate that a slice is non-empty.
    pub fn require_nonempty<T>(field: &str, slice: &[T]) -> Result<(), StarknetRailError> {
        if slice.is_empty() {
            Err(ValidationError::new(field, "must not be empty").into_error())
        } else {
            Ok(())
        }
    }
    
    /// Validate that a slice doesn't exceed max length.
    pub fn require_max_length<T>(
        field: &str,
        slice: &[T],
        max: usize,
    ) -> Result<(), StarknetRailError> {
        if slice.len() > max {
            Err(ValidationError::new(field, format!("exceeds maximum length of {}", max))
                .with_value(slice.len())
                .into_error())
        } else {
            Ok(())
        }
    }
    
    /// Validate a Starknet address format.
    pub fn require_valid_address(field: &str, address: &str) -> Result<(), StarknetRailError> {
        let trimmed = address.strip_prefix("0x").unwrap_or(address);
        if trimmed.is_empty() {
            return Err(ValidationError::new(field, "address is empty").into_error());
        }
        if !trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(ValidationError::new(field, "invalid hex characters in address")
                .with_value(address)
                .into_error());
        }
        if trimmed.len() > 64 {
            return Err(ValidationError::new(field, "address too long (max 64 hex chars)")
                .with_value(trimmed.len())
                .into_error());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_error_codes() {
        assert_eq!(StarknetRailError::Rpc("test".into()).error_code(), "RPC_ERROR");
        assert_eq!(StarknetRailError::InvalidInput("test".into()).error_code(), "INVALID_INPUT");
        assert_eq!(StarknetRailError::Verification("test".into()).error_code(), "VERIFICATION_FAILED");
    }
    
    #[test]
    fn test_retryable() {
        assert!(StarknetRailError::Rpc("test".into()).is_retryable());
        assert!(StarknetRailError::Timeout("test".into()).is_retryable());
        assert!(!StarknetRailError::InvalidInput("test".into()).is_retryable());
    }
    
    #[test]
    fn test_validation_nonzero() {
        assert!(validation::require_nonzero("threshold", 100).is_ok());
        assert!(validation::require_nonzero("threshold", 0).is_err());
    }
    
    #[test]
    fn test_validation_nonempty() {
        let nonempty = vec![1, 2, 3];
        let empty: Vec<i32> = vec![];
        assert!(validation::require_nonempty("accounts", &nonempty).is_ok());
        assert!(validation::require_nonempty("accounts", &empty).is_err());
    }
    
    #[test]
    fn test_validation_address() {
        assert!(validation::require_valid_address("addr", "0x1234abcd").is_ok());
        assert!(validation::require_valid_address("addr", "1234abcd").is_ok());
        assert!(validation::require_valid_address("addr", "0xGGGG").is_err());
        assert!(validation::require_valid_address("addr", "").is_err());
    }
}


