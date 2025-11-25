//! Error types for the Mina rail.

use thiserror::Error;

/// Error type for the Mina recursive proof hub rail.
#[derive(Error, Debug)]
pub enum MinaRailError {
    /// GraphQL API error.
    #[error("GraphQL error: {0}")]
    GraphQL(String),

    /// Invalid input error.
    #[error("invalid input: {0}")]
    InvalidInput(String),

    /// Proof generation/verification error.
    #[error("proof error: {0}")]
    Proof(String),

    /// State/storage error.
    #[error("state error: {0}")]
    State(String),

    /// zkApp interaction error.
    #[error("zkApp error: {0}")]
    ZkApp(String),

    /// Network/chain error.
    #[error("network error: {0}")]
    Network(String),

    /// Bridge/cross-chain error.
    #[error("bridge error: {0}")]
    Bridge(String),

    /// Feature not implemented.
    #[error("not implemented: {0}")]
    NotImplemented(String),
}

impl From<anyhow::Error> for MinaRailError {
    fn from(err: anyhow::Error) -> Self {
        MinaRailError::InvalidInput(err.to_string())
    }
}

impl From<serde_json::Error> for MinaRailError {
    fn from(err: serde_json::Error) -> Self {
        MinaRailError::InvalidInput(err.to_string())
    }
}

