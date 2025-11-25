//! Error types for the Starknet L2 rail.

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
}

impl From<anyhow::Error> for StarknetRailError {
    fn from(err: anyhow::Error) -> Self {
        StarknetRailError::InvalidInput(err.to_string())
    }
}

